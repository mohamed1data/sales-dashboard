-- =====================================================================
-- Dashboard performance migration — run AFTER multitenant_migration.sql
-- Safe to re-run. It moves dashboard aggregation into PostgreSQL and
-- reduces each rep's startup from 6 browser requests to 2 RPC requests.
-- =====================================================================

begin;

-- Match the tenant-scoped filters used by the dashboard and the new RPCs.
create index if not exists visits_tenant_status_created_idx
  on public.visits (tenant_id, status, created_at desc);
create index if not exists visits_tenant_rep_created_idx
  on public.visits (tenant_id, rep_id, created_at desc);
create index if not exists payments_tenant_created_idx
  on public.payments (tenant_id, created_at desc);
create index if not exists collections_tenant_status_due_idx
  on public.collections (tenant_id, status, due_at);
create index if not exists stock_issues_tenant_rep_created_idx
  on public.stock_issues (tenant_id, rep_id, created_at desc);

-- One post-login identity call. Managers/founders win if an account was
-- accidentally linked to both manager and rep records, just like the old UI.
create or replace function public.my_app_context()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  d record;
  r record;
  has_overlap boolean := false;
begin
  if public.is_dashboard_user() then
    select du.role, t.id as tenant_id, t.name as tenant_name, t.rep_limit,
           t.invite_code, t.is_owner
      into d
      from public.dashboard_users du
      join public.tenants t on t.id = du.tenant_id
     where t.active
       and lower(du.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
     limit 1;

    select exists (
      select 1 from public.reps x where x.auth_user_id = auth.uid()
    ) into has_overlap;

    return jsonb_build_object(
      'kind', 'manager',
      'role', d.role,
      'tenant_id', d.tenant_id,
      'tenant_name', d.tenant_name,
      'rep_limit', d.rep_limit,
      'invite_code', d.invite_code,
      'is_owner', d.is_owner,
      'overlap', has_overlap
    );
  end if;

  select x.id, x.name, x.active
    into r
    from public.reps x
    join public.tenants t on t.id = x.tenant_id
   where x.auth_user_id = auth.uid() and x.active and t.active
   limit 1;

  if found then
    return jsonb_build_object(
      'kind', 'rep',
      'rep', jsonb_build_object('id', r.id, 'name', r.name, 'active', r.active)
    );
  end if;

  return jsonb_build_object('kind', 'none');
end;
$$;
revoke all on function public.my_app_context() from public, anon;
grant execute on function public.my_app_context() to authenticated;

-- Tenant-manager overview. Returns aggregates only; it never downloads all
-- visits to the browser and therefore remains accurate after 1,000 visits.
create or replace function public.dashboard_overview(
  p_range text default 'today',
  p_timezone text default 'Africa/Cairo'
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t uuid;
  today_date date;
  range_start_date date;
  range_start_at timestamptz;
  range_end_at timestamptz;
  last_14_start_at timestamptz;
  v_visits bigint := 0;
  v_sales numeric := 0;
  v_collected numeric := 0;
  v_outstanding numeric := 0;
  v_pending bigint := 0;
  v_overdue bigint := 0;
  v_drafts bigint := 0;
  v_by_rep jsonb := '[]'::jsonb;
  v_days jsonb := '[]'::jsonb;
begin
  if not public.is_dashboard_user() then
    raise exception 'not allowed';
  end if;
  t := public.current_tenant_id();
  if t is null then
    raise exception 'inactive or missing tenant';
  end if;

  today_date := (now() at time zone p_timezone)::date;
  range_start_date := case p_range
    when 'today' then today_date
    when 'week' then today_date - 6
    when 'month' then date_trunc('month', today_date)::date
    else raise exception 'invalid range'
  end;
  range_start_at := range_start_date::timestamp at time zone p_timezone;
  range_end_at := (today_date + 1)::timestamp at time zone p_timezone;
  last_14_start_at := (today_date - 13)::timestamp at time zone p_timezone;

  with scoped_visits as (
    select v.id
      from public.visits v
     where v.tenant_id = t
       and v.status = 'confirmed'
       and v.created_at >= range_start_at
       and v.created_at < range_end_at
  ), totals as (
    select sv.id, coalesce(sum(vi.line_total), 0) as sales
      from scoped_visits sv
      left join public.visit_items vi on vi.visit_id = sv.id
     group by sv.id
  )
  select count(*), coalesce(sum(sales), 0)
    into v_visits, v_sales
    from totals;

  select coalesce(sum(p.amount), 0)
    into v_collected
    from public.payments p
   where p.tenant_id = t
     and p.created_at >= range_start_at
     and p.created_at < range_end_at;

  with sales as (
    select v.client_id, coalesce(sum(vi.line_total), 0) as total_sales
      from public.visits v
      join public.visit_items vi on vi.visit_id = v.id
     where v.tenant_id = t and v.status = 'confirmed' and v.client_id is not null
     group by v.client_id
  ), paid as (
    select p.client_id, coalesce(sum(p.amount), 0) as total_paid
      from public.payments p
     where p.tenant_id = t
     group by p.client_id
  )
  select coalesce(sum(greatest(coalesce(s.total_sales, 0) - coalesce(p.total_paid, 0), 0)), 0)
    into v_outstanding
    from public.clients c
    left join sales s on s.client_id = c.id
    left join paid p on p.client_id = c.id
   where c.tenant_id = t;

  select count(*), count(*) filter (where c.due_at < now())
    into v_pending, v_overdue
    from public.collections c
   where c.tenant_id = t and c.status = 'pending';

  select count(*) into v_drafts
    from public.visits v
   where v.tenant_id = t and v.status = 'draft';

  with rep_totals as (
    select v.rep_id, count(distinct v.id) as visits, coalesce(sum(vi.line_total), 0) as sales
      from public.visits v
      left join public.visit_items vi on vi.visit_id = v.id
     where v.tenant_id = t
       and v.status = 'confirmed'
       and v.created_at >= range_start_at
       and v.created_at < range_end_at
     group by v.rep_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object('name', r.name, 'visits', x.visits, 'sales', x.sales)
    order by x.sales desc, r.name
  ), '[]'::jsonb)
    into v_by_rep
    from rep_totals x
    left join public.reps r on r.id = x.rep_id;

  with calendar as (
    select d::date as day
      from generate_series(today_date - 13, today_date, interval '1 day') as d
  ), day_sales as (
    select (v.created_at at time zone p_timezone)::date as day,
           coalesce(sum(vi.line_total), 0) as sales
      from public.visits v
      join public.visit_items vi on vi.visit_id = v.id
     where v.tenant_id = t
       and v.status = 'confirmed'
       and v.created_at >= last_14_start_at
       and v.created_at < range_end_at
     group by (v.created_at at time zone p_timezone)::date
  )
  select coalesce(jsonb_agg(
    jsonb_build_object('k', to_char(c.day, 'YYYY-MM-DD'), 'val', coalesce(s.sales, 0))
    order by c.day
  ), '[]'::jsonb)
    into v_days
    from calendar c
    left join day_sales s on s.day = c.day;

  return jsonb_build_object(
    'visits', v_visits,
    'sales', v_sales,
    'collected', v_collected,
    'outstanding', v_outstanding,
    'overdue', v_overdue,
    'pending', v_pending,
    'drafts', v_drafts,
    'byRep', v_by_rep,
    'days', v_days
  );
end;
$$;
revoke all on function public.dashboard_overview(text, text) from public, anon;
grant execute on function public.dashboard_overview(text, text) to authenticated;

-- One call for the rep home page. Every row is explicitly constrained to the
-- authenticated rep, even though the function itself executes with definer rights.
create or replace function public.rep_today(p_timezone text default 'Africa/Cairo')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r uuid;
  today_date date;
  month_start_date date;
  today_start_at timestamptz;
  month_start_at timestamptz;
  tomorrow_start_at timestamptz;
  v_today_visits bigint := 0;
  v_today_sales numeric := 0;
  v_today_paid numeric := 0;
  v_month_sales numeric := 0;
  v_custody numeric := 0;
  v_drafts bigint := 0;
  v_over jsonb := '[]'::jsonb;
  v_today_collections jsonb := '[]'::jsonb;
  v_next jsonb := '[]'::jsonb;
  v_holding jsonb := '[]'::jsonb;
begin
  r := public.current_rep_id();
  if r is null then
    raise exception 'not allowed';
  end if;

  today_date := (now() at time zone p_timezone)::date;
  month_start_date := date_trunc('month', today_date)::date;
  today_start_at := today_date::timestamp at time zone p_timezone;
  tomorrow_start_at := (today_date + 1)::timestamp at time zone p_timezone;
  month_start_at := month_start_date::timestamp at time zone p_timezone;

  with visit_totals as (
    select v.id, v.created_at, coalesce(sum(vi.line_total), 0) as sales
      from public.visits v
      left join public.visit_items vi on vi.visit_id = v.id
     where v.rep_id = r
       and v.status = 'confirmed'
       and v.created_at >= month_start_at
       and v.created_at < tomorrow_start_at
     group by v.id, v.created_at
  )
  select count(*) filter (where created_at >= today_start_at),
         coalesce(sum(sales) filter (where created_at >= today_start_at), 0),
         coalesce(sum(sales), 0)
    into v_today_visits, v_today_sales, v_month_sales
    from visit_totals;

  select coalesce(sum(p.amount), 0)
    into v_today_paid
    from public.payments p
   where p.rep_id = r
     and p.created_at >= today_start_at
     and p.created_at < tomorrow_start_at;

  select count(*) into v_drafts
    from public.visits v
   where v.rep_id = r and v.status = 'draft';

  select coalesce(sum(s.on_hand_value), 0),
         coalesce(jsonb_agg(
           jsonb_build_object('item', s.item, 'unit', s.unit, 'on_hand', s.on_hand, 'on_hand_value', s.on_hand_value)
           order by s.item
         ) filter (where s.on_hand <> 0), '[]'::jsonb)
    into v_custody, v_holding
    from public.rep_stock s
   where s.rep_id = r;

  with collection_rows as (
    select c.id, c.due_at, c.amount_due,
           jsonb_build_object('name', cl.name, 'phone', cl.phone, 'lat', cl.lat, 'lng', cl.lng) as clients,
           (c.due_at at time zone p_timezone)::date as due_day
      from public.collections c
      left join public.clients cl on cl.id = c.client_id
     where c.rep_id = r and c.status = 'pending'
  )
  select
    coalesce(jsonb_agg(jsonb_build_object('id', id, 'due_at', due_at, 'amount_due', amount_due, 'clients', clients) order by due_at)
      filter (where due_day < today_date), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('id', id, 'due_at', due_at, 'amount_due', amount_due, 'clients', clients) order by due_at)
      filter (where due_day = today_date), '[]'::jsonb)
    into v_over, v_today_collections
    from collection_rows;

  select coalesce(jsonb_agg(x.row order by x.due_at), '[]'::jsonb)
    into v_next
    from (
      select c.due_at,
             jsonb_build_object(
               'id', c.id, 'due_at', c.due_at, 'amount_due', c.amount_due,
               'clients', jsonb_build_object('name', cl.name, 'phone', cl.phone, 'lat', cl.lat, 'lng', cl.lng)
             ) as row
        from public.collections c
        left join public.clients cl on cl.id = c.client_id
       where c.rep_id = r
         and c.status = 'pending'
         and (c.due_at at time zone p_timezone)::date > today_date
       order by c.due_at
       limit 8
    ) x;

  return jsonb_build_object(
    'today', jsonb_build_object('visits', v_today_visits, 'sales', v_today_sales, 'paid', v_today_paid),
    'month', jsonb_build_object('sales', v_month_sales),
    'custody', v_custody,
    'drafts', v_drafts,
    'over', v_over,
    'todayC', v_today_collections,
    'next', v_next,
    'holding', v_holding
  );
end;
$$;
revoke all on function public.rep_today(text) from public, anon;
grant execute on function public.rep_today(text) to authenticated;

commit;
