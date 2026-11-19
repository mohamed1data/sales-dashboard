-- =====================================================================
-- EMPIRE_AI Sales Rep Bot — MULTI-TENANT migration
-- Run ONCE in Supabase -> SQL Editor (needs Postgres 15+, the default on Supabase).
-- Everything that exists today is moved into ONE tenant called "EMPIRE (direct)" = the founder's own business.
-- After this, every company (manager) gets its own tenant: its own reps, clients, products, stock, visits.
--
-- What it guarantees, inside the database itself (so a bug in n8n or the dashboard can not break it):
--   1) a row always belongs to exactly one tenant, and can never be moved to another
--   2) a row can only point to rows of the SAME tenant (visit -> client, rep, product ...)
--   3) a manager/rep can only read rows of his own tenant (Row Level Security)
--   4) a tenant can not have more active reps than tenants.rep_limit, and only the founder can change the limit
--   5) voice notes / invoice photos in Storage are readable only by the owning tenant
-- Deploy it TOGETHER with the new n8n workflow (sales_bot_workflow_v2.json) and the new dashboard files.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1) tenants (companies). The row with is_owner = true is the founder's own business.
-- ---------------------------------------------------------------------
create table if not exists public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  rep_limit   integer check (rep_limit is null or rep_limit >= 0),   -- null = unlimited
  active      boolean not null default true,                         -- false = suspended (nobody of this tenant can log in / use the bot)
  is_owner    boolean not null default false,
  invite_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  notes       text,
  created_at  timestamptz not null default now()
);
create unique index if not exists tenants_one_owner on public.tenants ((true)) where is_owner;
alter table public.tenants enable row level security;

alter table public.tenants drop constraint if exists owner_always_active;
alter table public.tenants add constraint owner_always_active check (not is_owner or active);   -- the founder can never lock himself out

insert into public.tenants (name, is_owner)
select 'EMPIRE (direct)', true
where not exists (select 1 from public.tenants where is_owner);

-- ---------------------------------------------------------------------
-- 2) tenant_id on every table (existing rows go to the owner tenant)
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  owner uuid;
begin
  select id into owner from public.tenants where is_owner;
  foreach t in array array[
    'reps','clients','products','visits','visit_items','payments','collections',
    'stock_issues','stock_issue_items','product_costs','product_requests','rep_sessions','dashboard_users'
  ] loop
    execute format('alter table public.%I add column if not exists tenant_id uuid references public.tenants(id)', t);
    execute format('update public.%I set tenant_id = $1 where tenant_id is null', t) using owner;
    execute format('alter table public.%I alter column tenant_id set not null', t);
    execute format('create index if not exists %I on public.%I (tenant_id)', t || '_tenant_idx', t);
  end loop;
end $$;

-- join requests: tenant_id stays NULL when the person did not come through a company invite link
alter table public.rep_requests add column if not exists tenant_id uuid references public.tenants(id);

-- dashboard users: role founder / manager
alter table public.dashboard_users add column if not exists role text;
update public.dashboard_users set role = 'founder' where role is null;      -- every existing dashboard user is the founder
alter table public.dashboard_users alter column role set default 'manager';
alter table public.dashboard_users alter column role set not null;
alter table public.dashboard_users drop constraint if exists dashboard_users_role_check;
alter table public.dashboard_users add constraint dashboard_users_role_check check (role in ('founder', 'manager'));

-- ---------------------------------------------------------------------
-- 3) uniqueness is now PER TENANT (two companies may both sell "شيبسي")
-- ---------------------------------------------------------------------
drop index if exists public.products_name_uniq;
create unique index products_name_uniq on public.products (tenant_id, lower(name));

alter table public.product_requests drop constraint if exists product_requests_pkey;
alter table public.product_requests add primary key (tenant_id, name);

-- (reps.telegram_id stays globally unique: one Telegram account = one rep in one company)

-- ---------------------------------------------------------------------
-- 4) helper functions used by the policies
-- ---------------------------------------------------------------------
create or replace function public.is_founder()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from dashboard_users d join tenants t on t.id = d.tenant_id
    where d.role = 'founder' and t.active and lower(d.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- manager or founder of an ACTIVE tenant
create or replace function public.is_dashboard_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from dashboard_users d join tenants t on t.id = d.tenant_id
    where t.active and lower(d.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- the tenant of whoever is logged in (manager/founder through dashboard_users, rep through reps)
create or replace function public.current_tenant_id()
returns uuid language sql stable security definer set search_path = public as $$
  select t.id from tenants t
  where t.active and t.id = coalesce(
    (select d.tenant_id from dashboard_users d where lower(d.email) = lower(coalesce(auth.jwt() ->> 'email', ''))),
    (select r.tenant_id from reps r where r.auth_user_id = auth.uid() and r.active)
  );
$$;

create or replace function public.current_rep_id()
returns uuid language sql stable security definer set search_path = public as $$
  select r.id from reps r join tenants t on t.id = r.tenant_id
  where r.auth_user_id = auth.uid() and r.active and t.active;
$$;

-- ---------------------------------------------------------------------
-- 5) guard trigger: fills tenant_id, forbids changing it, forbids cross-tenant references
--    arguments = pairs (column, referenced table)
-- ---------------------------------------------------------------------
create or replace function public.tenant_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  i int := 0;
  t uuid;
  col text;
  ref text;
  ref_id uuid;
  ref_tenant uuid;
begin
  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'tenant_id can not be changed (% )', tg_table_name;
    end if;
    t := old.tenant_id;
  else
    t := new.tenant_id;
    if t is null then t := public.current_tenant_id(); end if;
  end if;

  while i < tg_nargs loop
    col := tg_argv[i];
    ref := tg_argv[i + 1];
    ref_id := nullif(to_jsonb(new) ->> col, '')::uuid;
    if ref_id is not null then
      execute format('select tenant_id from public.%I where id = $1', ref) into ref_tenant using ref_id;
      if t is null then t := ref_tenant; end if;
      if ref_tenant is distinct from t then
        raise exception 'cross-tenant reference blocked: %.% -> %', tg_table_name, col, ref;
      end if;
    end if;
    i := i + 2;
  end loop;

  if t is null then
    raise exception 'tenant_id is required on %', tg_table_name;
  end if;
  new.tenant_id := t;
  return new;
end $$;

do $$
declare
  spec text[];
  specs text[][] := array[
    ['reps',              ''],
    ['products',          ''],
    ['clients',           $q$'rep_id','reps'$q$],
    ['visits',            $q$'rep_id','reps','client_id','clients'$q$],
    ['visit_items',       $q$'visit_id','visits','product_id','products'$q$],
    ['payments',          $q$'client_id','clients','rep_id','reps','visit_id','visits'$q$],
    ['collections',       $q$'client_id','clients','rep_id','reps','source_visit_id','visits'$q$],
    ['stock_issues',      $q$'rep_id','reps'$q$],
    ['stock_issue_items', $q$'issue_id','stock_issues','product_id','products'$q$],
    ['product_costs',     $q$'product_id','products'$q$],
    ['product_requests',  $q$'rep_id','reps'$q$],
    ['rep_sessions',      $q$'rep_id','reps','editing_visit_id','visits','editing_stock_id','stock_issues','awaiting_loc_visit','visits'$q$]
  ];
  i int;
begin
  for i in 1 .. array_length(specs, 1) loop
    execute format('drop trigger if exists trg_a_tenant_guard on public.%I', specs[i][1]);
    execute format(
      'create trigger trg_a_tenant_guard before insert or update on public.%I for each row execute function public.tenant_guard(%s)',
      specs[i][1], specs[i][2]);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6) rep limit (counts EVERY active rep of the tenant, so it can not be dodged by flagging a rep as manager)
-- ---------------------------------------------------------------------
create or replace function public.enforce_rep_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  lim int;
  used int;
begin
  if new.active is not true then return new; end if;
  if tg_op = 'UPDATE' and old.active is true and old.tenant_id = new.tenant_id then return new; end if;
  select rep_limit into lim from tenants where id = new.tenant_id for update;   -- serialises concurrent inserts
  if lim is null then return new; end if;
  select count(*) into used from reps where tenant_id = new.tenant_id and active and id is distinct from new.id;
  if used >= lim then
    raise exception 'REP_LIMIT: وصلت للحد الأقصى من المناديب (%). كلّم المؤسس لزيادة الحد.', lim;
  end if;
  return new;
end $$;

drop trigger if exists trg_b_rep_limit on public.reps;
create trigger trg_b_rep_limit before insert or update of active, tenant_id on public.reps
  for each row execute function public.enforce_rep_limit();

-- ---------------------------------------------------------------------
-- 7) Row Level Security: drop every old policy of "public" and rebuild them per tenant
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ===== managers / founder: own tenant only =====
do $$
declare
  t text;
begin
  foreach t in array array['reps','clients','products','visits','visit_items','payments','collections',
                           'stock_issues','stock_issue_items','product_costs','product_requests','rep_sessions'] loop
    execute format(
      'create policy dash_read on public.%I for select to authenticated using (tenant_id = public.current_tenant_id() and public.is_dashboard_user())', t);
  end loop;
end $$;

create policy dash_update on public.collections for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_dashboard_user())
  with check (tenant_id = public.current_tenant_id() and public.is_dashboard_user());

create policy dash_insert on public.reps for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.is_dashboard_user());
create policy dash_update on public.reps for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_dashboard_user())
  with check (tenant_id = public.current_tenant_id() and public.is_dashboard_user());

do $$
declare t text;
begin
  foreach t in array array['products','product_costs'] loop
    execute format('create policy dash_insert on public.%I for insert to authenticated with check (tenant_id = public.current_tenant_id() and public.is_dashboard_user())', t);
    execute format('create policy dash_update on public.%I for update to authenticated using (tenant_id = public.current_tenant_id() and public.is_dashboard_user()) with check (tenant_id = public.current_tenant_id() and public.is_dashboard_user())', t);
    execute format('create policy dash_delete on public.%I for delete to authenticated using (tenant_id = public.current_tenant_id() and public.is_dashboard_user())', t);
  end loop;
end $$;

create policy dash_delete on public.product_requests for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_dashboard_user());

-- join requests: a manager sees the requests that came through HIS invite link; the founder also sees the ones without a company
create policy dash_read on public.rep_requests for select to authenticated
  using (public.is_dashboard_user() and (tenant_id = public.current_tenant_id() or (tenant_id is null and public.is_founder())));
create policy dash_delete on public.rep_requests for delete to authenticated
  using (public.is_dashboard_user() and (tenant_id = public.current_tenant_id() or (tenant_id is null and public.is_founder())));

-- dashboard_users: everyone reads his own row, the founder reads all (writes go through the server route with the secret key)
create policy dash_self on public.dashboard_users for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy founder_read on public.dashboard_users for select to authenticated
  using (public.is_founder());

-- tenants: a manager reads his own company (name, limit), the founder reads and edits all
create policy tenant_read on public.tenants for select to authenticated
  using (public.is_founder() or id = public.current_tenant_id());
create policy founder_insert on public.tenants for insert to authenticated with check (public.is_founder());
create policy founder_update on public.tenants for update to authenticated
  using (public.is_founder()) with check (public.is_founder());

-- ===== reps (the personal portal): only their own rows, products only of their tenant =====
create policy rep_self on public.reps for select to authenticated using (auth_user_id = auth.uid());

create policy rep_read on public.clients for select to authenticated
  using (public.current_rep_id() is not null and (
    rep_id = public.current_rep_id()
    or exists (select 1 from public.visits v where v.client_id = clients.id and v.rep_id = public.current_rep_id())));
create policy rep_read on public.collections for select to authenticated using (rep_id = public.current_rep_id());
create policy rep_read on public.payments    for select to authenticated using (rep_id = public.current_rep_id());
create policy rep_read on public.visits      for select to authenticated using (rep_id = public.current_rep_id());
create policy rep_read on public.stock_issues for select to authenticated using (rep_id = public.current_rep_id());
create policy rep_read on public.visit_items for select to authenticated
  using (exists (select 1 from public.visits v where v.id = visit_items.visit_id and v.rep_id = public.current_rep_id()));
create policy rep_read on public.stock_issue_items for select to authenticated
  using (exists (select 1 from public.stock_issues s where s.id = stock_issue_items.issue_id and s.rep_id = public.current_rep_id()));
create policy rep_read on public.products for select to authenticated
  using (public.current_rep_id() is not null and tenant_id = public.current_tenant_id());

-- ---------------------------------------------------------------------
-- 8) Storage (voices / invoices): the file lives in a folder named after the rep id,
--    so access = "that rep belongs to MY tenant" (manager) or "that rep is ME" (rep)
-- ---------------------------------------------------------------------
drop policy if exists dash_invoices on storage.objects;
drop policy if exists dash_voices   on storage.objects;
drop policy if exists rep_invoices  on storage.objects;
drop policy if exists rep_voices    on storage.objects;

create policy dash_invoices on storage.objects for select to authenticated
  using (bucket_id = 'invoices' and public.is_dashboard_user() and exists (
    select 1 from public.reps r where r.id::text = (storage.foldername(objects.name))[1] and r.tenant_id = public.current_tenant_id()));
create policy dash_voices on storage.objects for select to authenticated
  using (bucket_id = 'voices' and public.is_dashboard_user() and exists (
    select 1 from public.reps r where r.id::text = (storage.foldername(objects.name))[1] and r.tenant_id = public.current_tenant_id()));
create policy rep_invoices on storage.objects for select to authenticated
  using (bucket_id = 'invoices' and public.current_rep_id() is not null and (storage.foldername(objects.name))[1] = public.current_rep_id()::text);
create policy rep_voices on storage.objects for select to authenticated
  using (bucket_id = 'voices' and public.current_rep_id() is not null and (storage.foldername(objects.name))[1] = public.current_rep_id()::text);

-- ---------------------------------------------------------------------
-- 9) views must obey the policies of the logged-in user (before: they ran as their owner and could see everything)
-- ---------------------------------------------------------------------
alter view public.client_balances set (security_invoker = true);
alter view public.rep_stock       set (security_invoker = true);
alter view public.reminders_24h   set (security_invoker = true);
alter view public.reminders_2h    set (security_invoker = true);

-- who am I? (role + company) — used by the dashboard right after login
create or replace function public.my_context()
returns table (role text, tenant_id uuid, tenant_name text, rep_limit integer, invite_code text, is_owner boolean)
language sql stable security definer set search_path = public as $$
  select d.role, t.id, t.name, t.rep_limit, t.invite_code, t.is_owner
  from dashboard_users d join tenants t on t.id = d.tenant_id
  where t.active and lower(d.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;
revoke all on function public.my_context() from public, anon;
grant execute on function public.my_context() to authenticated;

-- ---------------------------------------------------------------------
-- 10) founder overview (one row per company) for the founder panel
-- ---------------------------------------------------------------------
create or replace function public.founder_overview()
returns table (
  tenant_id uuid, name text, is_owner boolean, active boolean, rep_limit integer, invite_code text,
  reps_active bigint, managers jsonb, visits_30d bigint, last_visit timestamptz, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_founder() then raise exception 'not allowed'; end if;
  return query
  select t.id, t.name, t.is_owner, t.active, t.rep_limit, t.invite_code,
         (select count(*) from reps r where r.tenant_id = t.id and r.active),
         coalesce((select jsonb_agg(d.email order by d.email) from dashboard_users d where d.tenant_id = t.id and d.role = 'manager'), '[]'::jsonb),
         (select count(*) from visits v where v.tenant_id = t.id and v.status = 'confirmed' and v.created_at > now() - interval '30 days'),
         (select max(v.created_at) from visits v where v.tenant_id = t.id),
         t.created_at
  from tenants t
  order by t.is_owner desc, t.created_at;
end $$;
revoke all on function public.founder_overview() from public, anon;
grant execute on function public.founder_overview() to authenticated;

commit;

-- After it ran, check:   select name, is_owner, rep_limit, invite_code from public.tenants;
