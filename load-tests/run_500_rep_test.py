#!/usr/bin/env python3
"""Safe, isolated Supabase load/RLS test for this Sales Rep Bot project.

It creates a temporary tenant, 500 reps, synthetic activity, runs authenticated
load/security checks, writes a redacted JSON result, then removes all test data.
No secret is stored in this file. Required env vars:
  SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY
Run only against a non-customer test project:
  CONFIRM_LOAD_TEST=YES python3 load-tests/run_500_rep_test.py
"""
from __future__ import annotations

import concurrent.futures as futures
import datetime as dt
import json
import os
import random
import statistics
import sys
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

BASE = os.environ.get("SUPABASE_URL", "").rstrip("/")
SECRET = os.environ.get("SUPABASE_SECRET_KEY", "")
PUBLIC = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
CONFIRM = os.environ.get("CONFIRM_LOAD_TEST") == "YES"
REPS = int(os.environ.get("LOADTEST_REPS", "500"))
VISITS_PER_REP = int(os.environ.get("LOADTEST_VISITS_PER_REP", "10"))
# Password grants have a project/IP rate limit. A paced login phase represents
# existing authenticated sessions without turning Auth itself into the bottleneck.
LOGIN_INTERVAL_S = float(os.environ.get("LOADTEST_LOGIN_INTERVAL_S", "0"))
BOOT_WORKERS = int(os.environ.get("LOADTEST_BOOT_WORKERS", "100"))

if not (BASE and SECRET and PUBLIC and CONFIRM):
    sys.exit("Missing env or confirmation. Nothing was changed.")

RUN = f"arena-{int(time.time())}-{uuid.uuid4().hex[:6]}"
PREFIX = f"__LOADTEST_{RUN}__"
RESULT_DIR = Path("load-tests/results")
RESULT_DIR.mkdir(parents=True, exist_ok=True)
report: dict = {"run": RUN, "started_at": dt.datetime.now(dt.timezone.utc).isoformat(), "configuration": {"reps": REPS, "visits_per_rep": VISITS_PER_REP, "login_interval_s": LOGIN_INTERVAL_S, "boot_workers": BOOT_WORKERS}, "checks": {}, "timings_ms": {}, "cleanup": {}}
created = {"tenant_ids": [], "auth_user_ids": [], "storage_paths": []}


def raw(method: str, path: str, *, key: str, token: str | None = None, payload=None, headers=None, body: bytes | None = None, timeout=60):
    h = {"apikey": key}
    if token:
        h["Authorization"] = "Bearer " + token
    if headers:
        h.update(headers)
    data = body if body is not None else (json.dumps(payload, separators=(",", ":")).encode() if payload is not None else None)
    if payload is not None and "Content-Type" not in h:
        h["Content-Type"] = "application/json"
    request = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = response.read()
            return response.status, dict(response.headers), data, (time.perf_counter() - started) * 1000
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), error.read(), (time.perf_counter() - started) * 1000
    except Exception as error:
        return 0, {}, str(error).encode(), (time.perf_counter() - started) * 1000


def parse(data: bytes):
    try:
        return json.loads(data)
    except Exception:
        return None


def rest(method: str, table: str, query="", *, payload=None, key=SECRET, token=None, prefer="return=representation", extra_headers=None):
    sep = "?" if query else ""
    headers = {"Prefer": prefer}
    if extra_headers:
        headers.update(extra_headers)
    return raw(method, f"/rest/v1/{table}{sep}{query}", key=key, token=token, payload=payload, headers=headers)


def rpc(name: str, *, payload=None, key=PUBLIC, token=None):
    return raw("POST", f"/rest/v1/rpc/{name}", key=key, token=token, payload=payload or {})


def admin_create(email: str, password: str):
    status, _, body, _ = raw("POST", "/auth/v1/admin/users", key=SECRET, payload={"email": email, "password": password, "email_confirm": True})
    result = parse(body) or {}
    if status not in (200, 201) or not result.get("id"):
        raise RuntimeError(f"Auth user creation failed ({status})")
    created["auth_user_ids"].append(result["id"])
    return result["id"]


def password_login(email: str, password: str):
    status, _, body, elapsed = raw("POST", "/auth/v1/token?grant_type=password", key=PUBLIC, payload={"email": email, "password": password})
    data = parse(body) or {}
    return status, data.get("access_token"), elapsed


def post_batches(table: str, rows: list[dict], batch_size=100):
    for start in range(0, len(rows), batch_size):
        chunk = rows[start:start + batch_size]
        status, _, _, _ = rest("POST", table, payload=chunk, prefer="return=minimal")
        if status not in (200, 201):
            raise RuntimeError(f"Insert into {table} failed in batch {start // batch_size}: HTTP {status}")


def delete_tenant_rows(table: str, tenant_id: str):
    # Delete order is handled by cleanup(); this helper only reports HTTP status.
    status, _, _, _ = rest("DELETE", table, f"tenant_id=eq.{tenant_id}", prefer="return=minimal")
    return status in (200, 204)


def query_token(token: str, table: str, query: str, method="GET", payload=None):
    return rest(method, table, query, payload=payload, key=PUBLIC, token=token, prefer="return=representation")


def summarize(samples: list[tuple[int, float]]):
    latencies = [x[1] for x in samples]
    statuses = Counter(x[0] for x in samples)
    if not latencies:
        return {"requests": 0}
    ordered = sorted(latencies)
    p95 = ordered[min(len(ordered) - 1, max(0, int(len(ordered) * .95) - 1))]
    return {"requests": len(samples), "status_counts": dict(statuses), "mean_ms": round(statistics.mean(latencies), 1), "median_ms": round(statistics.median(latencies), 1), "p95_ms": round(p95, 1), "max_ms": round(max(latencies), 1), "non_2xx": sum(v for k, v in statuses.items() if not 200 <= k < 300)}


def cleanup():
    # Keep this defensive: cleanup must continue even when one relationship was not created.
    for tenant_id in reversed(created["tenant_ids"]):
        stages = [
            "payments", "collections", "visit_items", "visits", "stock_issue_items", "stock_issues",
            "rep_sessions", "clients", "product_costs", "product_requests", "products", "reps", "dashboard_users",
        ]
        stage_results = {}
        for table in stages:
            try:
                stage_results[table] = delete_tenant_rows(table, tenant_id)
            except Exception:
                stage_results[table] = False
        # Auth records are independent from tenant deletion. Delete only identities made by this run.
        report["cleanup"][tenant_id] = stage_results
        try:
            status, _, _, _ = rest("DELETE", "tenants", f"id=eq.{tenant_id}", prefer="return=minimal")
            report["cleanup"][tenant_id]["tenant"] = status in (200, 204)
        except Exception:
            report["cleanup"][tenant_id]["tenant"] = False
    for user_id in reversed(created["auth_user_ids"]):
        try:
            status, _, _, _ = raw("DELETE", f"/auth/v1/admin/users/{user_id}", key=SECRET)
            report["cleanup"].setdefault("auth_users", []).append(status in (200, 204))
        except Exception:
            report["cleanup"].setdefault("auth_users", []).append(False)


def main():
    manager_password = "Load!" + uuid.uuid4().hex + "9"
    manager_email = f"loadtest.manager.{RUN}@example.com"
    other_manager_password = "Load!" + uuid.uuid4().hex + "9"
    other_manager_email = f"loadtest.isolation.{RUN}@example.com"

    # 1) Create two isolated tenants / managers: A carries load; B is for cross-tenant RLS tests.
    status, _, body, _ = rest("POST", "tenants", payload={"name": PREFIX + "TENANT_A", "rep_limit": REPS, "active": True, "is_owner": False})
    if status not in (200, 201):
        raise RuntimeError(f"Cannot create load tenant: HTTP {status}")
    tenant_a = parse(body)[0]["id"]
    created["tenant_ids"].append(tenant_a)
    status, _, body, _ = rest("POST", "tenants", payload={"name": PREFIX + "TENANT_B", "rep_limit": 5, "active": True, "is_owner": False})
    if status not in (200, 201):
        raise RuntimeError(f"Cannot create isolation tenant: HTTP {status}")
    tenant_b = parse(body)[0]["id"]
    created["tenant_ids"].append(tenant_b)

    manager_id = admin_create(manager_email, manager_password)
    other_manager_id = admin_create(other_manager_email, other_manager_password)
    post_batches("dashboard_users", [
        {"email": manager_email, "role": "manager", "tenant_id": tenant_a},
        {"email": other_manager_email, "role": "manager", "tenant_id": tenant_b},
    ])
    status, manager_token, _ = password_login(manager_email, manager_password)
    status_b, manager_b_token, _ = password_login(other_manager_email, other_manager_password)
    if status != 200 or status_b != 200 or not manager_token or not manager_b_token:
        raise RuntimeError("Cannot obtain manager sessions")

    # 2) Seed one catalog product, 500 reps, two clients/rep, 10 visits/rep plus related activity.
    product_id = str(uuid.uuid4())
    post_batches("products", [{"id": product_id, "tenant_id": tenant_a, "name": PREFIX + "PRODUCT", "aliases": [], "unit": "pack", "default_price": 10, "min_price": 8, "alt_units": [], "active": True}])
    rep_rows, rep_meta = [], []
    telegram_base = int(time.time() * 1000) * 1000
    for i in range(REPS):
        rep_id = str(uuid.uuid4())
        email = f"loadtest.rep.{RUN}.{i}@example.com"
        password = "Rep!" + uuid.uuid4().hex + "9"
        rep_rows.append({"id": rep_id, "tenant_id": tenant_a, "name": f"{PREFIX}REP_{i:03d}", "telegram_id": telegram_base + i, "active": True})
        rep_meta.append({"id": rep_id, "email": email, "password": password, "index": i})
    post_batches("reps", rep_rows, 100)

    # Admin creates login identities in bounded parallelism to avoid a synthetic burst during provisioning.
    def make_rep_account(rep):
        user_id = admin_create(rep["email"], rep["password"])
        status, _, _, _ = rest("PATCH", "reps", f"id=eq.{rep['id']}", payload={"auth_user_id": user_id, "email": rep["email"]}, prefer="return=minimal")
        return status
    with futures.ThreadPoolExecutor(max_workers=20) as pool:
        account_statuses = list(pool.map(make_rep_account, rep_meta))
    report["checks"]["rep_account_provisioning"] = {"requested": REPS, "successful": sum(x in (200, 204) for x in account_statuses)}
    if report["checks"]["rep_account_provisioning"]["successful"] != REPS:
        raise RuntimeError("Not all rep login accounts were linked")

    client_rows, visit_rows, item_rows, payment_rows, collection_rows, issue_rows, issue_item_rows, session_rows = [], [], [], [], [], [], [], []
    now = dt.datetime.now(dt.timezone.utc)
    for rep in rep_meta:
        client_ids = [str(uuid.uuid4()), str(uuid.uuid4())]
        for c, client_id in enumerate(client_ids):
            client_rows.append({"id": client_id, "tenant_id": tenant_a, "rep_id": rep["id"], "name": f"{PREFIX}CLIENT_{rep['index']:03d}_{c}", "aliases": [], "type": "test"})
        issue_id = str(uuid.uuid4())
        issue_rows.append({"id": issue_id, "tenant_id": tenant_a, "rep_id": rep["id"], "kind": "issue", "source": "text", "status": "confirmed", "created_at": now.isoformat()})
        issue_item_rows.append({"id": str(uuid.uuid4()), "tenant_id": tenant_a, "issue_id": issue_id, "product_id": product_id, "product_text": PREFIX + "PRODUCT", "quantity": 100, "unit": "pack", "unit_price": 10})
        session_rows.append({"tenant_id": tenant_a, "rep_id": rep["id"], "lat": 30.5, "lng": 31.0, "location_at": now.isoformat()})
        for j in range(VISITS_PER_REP):
            visit_id = str(uuid.uuid4())
            created_at = (now - dt.timedelta(minutes=(j * 7 + rep["index"] % 11))).isoformat()
            status_value = "confirmed" if j < VISITS_PER_REP - 2 else "draft"
            client_id = client_ids[j % 2]
            visit_rows.append({"id": visit_id, "tenant_id": tenant_a, "rep_id": rep["id"], "client_id": client_id, "visit_type": "sale", "status": status_value, "raw_text": "load test", "tg_message_id": rep["index"] * 100000 + j, "created_at": created_at})
            item_rows.append({"id": str(uuid.uuid4()), "tenant_id": tenant_a, "visit_id": visit_id, "product_id": product_id, "product_text": PREFIX + "PRODUCT", "quantity": 2, "unit": "pack", "unit_price": 10})
            if status_value == "confirmed":
                payment_rows.append({"id": str(uuid.uuid4()), "tenant_id": tenant_a, "client_id": client_id, "rep_id": rep["id"], "visit_id": visit_id, "amount": 10, "method": "cash", "created_at": created_at})
        collection_rows.append({"id": str(uuid.uuid4()), "tenant_id": tenant_a, "client_id": client_ids[0], "rep_id": rep["id"], "due_at": (now + dt.timedelta(days=2)).isoformat(), "amount_due": 20, "status": "pending"})
    post_batches("clients", client_rows)
    post_batches("stock_issues", issue_rows)
    post_batches("stock_issue_items", issue_item_rows)
    post_batches("rep_sessions", session_rows)
    post_batches("visits", visit_rows, 100)
    post_batches("visit_items", item_rows, 100)
    post_batches("payments", payment_rows, 100)
    post_batches("collections", collection_rows, 100)
    report["checks"]["seed"] = {"reps": REPS, "clients": len(client_rows), "visits": len(visit_rows), "confirmed_visits": len(payment_rows), "payments": len(payment_rows), "collections": len(collection_rows)}

    # Tenant B gets one rep and one visit; this gives concrete objects for isolation tests.
    other_rep_id = str(uuid.uuid4())
    other_client_id, other_visit_id = str(uuid.uuid4()), str(uuid.uuid4())
    post_batches("reps", [{"id": other_rep_id, "tenant_id": tenant_b, "name": PREFIX + "OTHER_REP", "telegram_id": telegram_base + REPS + 1, "active": True}])
    post_batches("clients", [{"id": other_client_id, "tenant_id": tenant_b, "rep_id": other_rep_id, "name": PREFIX + "OTHER_CLIENT", "aliases": []}])
    post_batches("visits", [{"id": other_visit_id, "tenant_id": tenant_b, "rep_id": other_rep_id, "client_id": other_client_id, "visit_type": "sale", "status": "confirmed", "tg_message_id": 9999999}])

    # 3) Security/RLS checks with manager A and a rep account.
    status, _, body, _ = query_token(manager_token, "reps", f"id=eq.{other_rep_id}&select=id")
    no_cross_read = status == 200 and parse(body) == []
    status_u, _, body_u, _ = query_token(manager_token, "reps", f"id=eq.{other_rep_id}", method="PATCH", payload={"name": "SHOULD_NOT_CHANGE"})
    no_cross_update = status_u in (200, 204) and (not body_u or parse(body_u) in ([], None))
    status, _, body, _ = query_token(manager_token, "visits", f"id=eq.{other_visit_id}&select=id")
    no_cross_visit = status == 200 and parse(body) == []
    # First rep sees exactly its own 10 visits, but cannot see another rep's visit.
    first = rep_meta[0]
    status, first_token, _ = password_login(first["email"], first["password"])
    if status != 200 or not first_token:
        raise RuntimeError("Representative password login failed")
    status, _, body, _ = query_token(first_token, "visits", "select=id&limit=1000")
    own_rows = parse(body) if status == 200 else []
    status2, _, body2, _ = query_token(first_token, "visits", f"id=eq.{other_visit_id}&select=id")
    rep_isolated = status2 == 200 and parse(body2) == []
    # Unauthenticated request must not return data.
    status3, _, body3, _ = rest("GET", "visits", "select=id&limit=1", key=PUBLIC, prefer="return=representation")
    anon_safe = not (status3 == 200 and isinstance(parse(body3), list) and len(parse(body3)) > 0)
    report["checks"]["rls"] = {"manager_cannot_read_other_tenant_rep": no_cross_read, "manager_cannot_update_other_tenant_rep": no_cross_update, "manager_cannot_read_other_tenant_visit": no_cross_visit, "rep_own_visit_count": len(own_rows), "rep_cannot_read_other_tenant_visit": rep_isolated, "anon_cannot_read_visits": anon_safe}

    # 4) Verify the current manager-overview request truncates at 1,000 raw visits.
    status_all, headers_all, _, _ = rest("GET", "visits", f"tenant_id=eq.{tenant_a}&status=eq.confirmed&select=id", key=SECRET, prefer="count=exact", extra_headers={"Range": "0-0"})
    total_confirmed = int(headers_all.get("Content-Range", "*/0").split("/")[-1]) if status_all in (200, 206) else 0
    query = urllib.parse.urlencode({"select": "id,created_at,rep_id,reps(name),visit_items(line_total)", "status": "eq.confirmed", "created_at": "gte." + (now - dt.timedelta(days=32)).isoformat(), "limit": "1000"})
    status_limited, _, body_limited, _ = query_token(manager_token, "visits", query)
    limited_rows = len(parse(body_limited) or []) if status_limited == 200 else 0
    report["checks"]["overview_limit"] = {"confirmed_visits_in_tenant": total_confirmed, "rows_returned_by_current_overview_query": limited_rows, "truncated": total_confirmed > limited_rows}

    # 5) Simulate 500 current RepToday boot flows with staged cohorts. The requests mirror the app's
    # manager-role check, rep lookup, then visits/payments/collections/stock parallel data reads.
    since = (now - dt.timedelta(days=32)).isoformat()
    visits_q = urllib.parse.urlencode({"select": "id,created_at,status,visit_items(line_total)", "status": "neq.cancelled", "created_at": "gte." + since, "limit": "1000"})
    payments_q = urllib.parse.urlencode({"select": "amount,created_at", "created_at": "gte." + since, "limit": "1000"})
    collections_q = urllib.parse.urlencode({"select": "id,due_at,amount_due,clients(name,phone,lat,lng)", "status": "eq.pending", "order": "due_at.asc", "limit": "100"})
    stock_q = urllib.parse.urlencode({"select": "item,unit,on_hand,on_hand_value"})

    # Obtain independent user sessions. Burst password grants are measured separately by
    # this harness's default mode; paced mode models users who already have sessions and
    # avoids turning the Auth endpoint's intentional anti-abuse limit into a DB result.
    def log_one(rep):
        st, tok, elapsed = password_login(rep["email"], rep["password"])
        return rep["id"], st, tok, elapsed
    login_samples, tokens = [], {}
    if LOGIN_INTERVAL_S > 0:
        for position, rep in enumerate(rep_meta):
            rep_id, st, tok, elapsed = log_one(rep)
            login_samples.append((st, elapsed))
            if tok:
                tokens[rep_id] = tok
            if position < len(rep_meta) - 1:
                time.sleep(LOGIN_INTERVAL_S)
    else:
        with futures.ThreadPoolExecutor(max_workers=50) as pool:
            for rep_id, st, tok, elapsed in pool.map(log_one, rep_meta):
                login_samples.append((st, elapsed))
                if tok:
                    tokens[rep_id] = tok
    report["timings_ms"][f"{REPS}_password_logins"] = summarize(login_samples)
    report["checks"]["authenticated_rep_sessions"] = {"requested": REPS, "successful": len(tokens)}
    if len(tokens) != REPS:
        raise RuntimeError("Auth rate limiting prevented a complete rep-dashboard wave; see login results")

    def boot_request(item):
        rep_id, token = item
        out = []
        st, _, _, elapsed = rpc("is_dashboard_user", key=PUBLIC, token=token)
        out.append(("is_dashboard_user", st, elapsed))
        q = urllib.parse.urlencode({"select": "id,name,active", "auth_user_id": "eq." + rep_id})
        st, _, _, elapsed = query_token(token, "reps", q)
        out.append(("rep_identity", st, elapsed))
        # RepToday starts these four reads together after the identity check. Keep that
        # browser-like fan-out inside each virtual rep instead of serialising the reads.
        today_reads = [("today_visits", "visits", visits_q), ("today_payments", "payments", payments_q), ("today_collections", "collections", collections_q), ("today_stock", "rep_stock", stock_q)]
        def today_read(spec):
            label, table, query = spec
            st, _, _, elapsed = query_token(token, table, query)
            return label, st, elapsed
        with futures.ThreadPoolExecutor(max_workers=4) as today_pool:
            out.extend(today_pool.map(today_read, today_reads))
        return out

    all_samples: dict[str, list[tuple[int, float]]] = {x: [] for x in ["is_dashboard_user", "rep_identity", "today_visits", "today_payments", "today_collections", "today_stock"]}
    stages = sorted(set(min(size, REPS) for size in [50, 100, 250, REPS]))
    for size in stages:
        subset = list(tokens.items())[:size]
        started = time.perf_counter()
        phase = {x: [] for x in all_samples}
        with futures.ThreadPoolExecutor(max_workers=min(BOOT_WORKERS, size)) as pool:
            for request_set in pool.map(boot_request, subset):
                for label, st, elapsed in request_set:
                    phase[label].append((st, elapsed))
                    all_samples[label].append((st, elapsed))
        report["timings_ms"][f"rep_boot_{size}"] = {"outer_concurrency": min(BOOT_WORKERS, size), "wall_clock_s": round(time.perf_counter() - started, 2), **{k: summarize(v) for k, v in phase.items()}}
    report["timings_ms"]["all_rep_boot_requests"] = {k: summarize(v) for k, v in all_samples.items()}

    report["checks"]["test_completed"] = True


try:
    main()
except Exception as error:
    report["checks"]["test_completed"] = False
    report["fatal_error"] = str(error)
finally:
    cleanup()
    report["finished_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    # Results never include secrets, access tokens, account passwords, or complete emails.
    out = RESULT_DIR / f"{RUN}.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({"result_file": str(out), "test_completed": report["checks"].get("test_completed", False), "fatal_error": report.get("fatal_error"), "seed": report["checks"].get("seed"), "rls": report["checks"].get("rls"), "overview_limit": report["checks"].get("overview_limit"), "login": report["timings_ms"].get(f"{REPS}_password_logins"), "cleanup": report["cleanup"]}, ensure_ascii=False, indent=2))
    if report["checks"].get("test_completed") is not True:
        sys.exit(1)
