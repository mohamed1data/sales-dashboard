-- =====================================================
-- Product catalog = the reference the bot checks against
-- Run AFTER: sales_bot_schema, dashboard_policies, stock_migration, reps_admin, rep_portal, (security_fix)
-- Safe to re-run.
-- =====================================================

-- 1) catalog fields
alter table products add column if not exists alt_units  jsonb not null default '[]';  -- [{"name":"كرتونة","factor":24}]  1 alt unit = factor x base unit
alter table products add column if not exists min_price  numeric(12,2);                -- lowest allowed selling price (per base unit)
-- default_price (already exists) = list SELLING price per base unit

-- factory/purchase price lives in its OWN table: reps can read the catalog, but must not see your cost
create table if not exists product_costs (
  product_id uuid primary key references products(id) on delete cascade,
  cost_price numeric(12,2) not null          -- per base unit
);
alter table product_costs enable row level security;

-- quantities are also stored in the BASE unit, so stock math is right when the rep buys in cartons and sells in packs
alter table visit_items       add column if not exists base_qty numeric(14,2);
alter table stock_issue_items add column if not exists base_qty numeric(14,2);

-- product names should be unique (ignore case)
do $$ begin
  create unique index if not exists products_name_uniq on products (lower(name));
exception when others then raise notice 'duplicate product names exist: rename them, then re-run this file';
end $$;

-- 2) names the reps said that are NOT in the catalog (the manager adds them in one tap)
create table if not exists product_requests (
  name text primary key,
  rep_id uuid references reps(id) on delete set null,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);
alter table product_requests enable row level security;

-- 3) permissions: the manager edits the catalog, reps only read it (rep_read exists), the bot uses the service role
drop policy if exists dash_insert on products;
drop policy if exists dash_update on products;
drop policy if exists dash_delete on products;
create policy dash_insert on products for insert to authenticated with check (is_dashboard_user());
create policy dash_update on products for update to authenticated using (is_dashboard_user()) with check (is_dashboard_user());
create policy dash_delete on products for delete to authenticated using (is_dashboard_user());
drop policy if exists dash_read   on product_requests;
drop policy if exists dash_delete on product_requests;
create policy dash_read   on product_requests for select to authenticated using (is_dashboard_user());
create policy dash_delete on product_requests for delete to authenticated using (is_dashboard_user());
drop policy if exists dash_read   on product_costs;
drop policy if exists dash_insert on product_costs;
drop policy if exists dash_update on product_costs;
drop policy if exists dash_delete on product_costs;
create policy dash_read   on product_costs for select to authenticated using (is_dashboard_user());
create policy dash_insert on product_costs for insert to authenticated with check (is_dashboard_user());
create policy dash_update on product_costs for update to authenticated using (is_dashboard_user()) with check (is_dashboard_user());
create policy dash_delete on product_costs for delete to authenticated using (is_dashboard_user());
grant select, insert, update, delete on product_costs, product_requests to authenticated;
grant all on product_costs to service_role;
grant select, insert, update, delete on product_requests to authenticated;
grant all on product_requests to service_role;

-- 4) what each rep holds, now in BASE units
create or replace view rep_stock as
with moved as (
  select s.rep_id, it.product_id,
         case when it.product_id is null then it.product_text end as unmatched_text,
         sum(case when s.kind = 'issue' then coalesce(it.base_qty, it.quantity) else -coalesce(it.base_qty, it.quantity) end) as received,
         sum(case when s.kind = 'issue' then coalesce(it.line_total,0) else -coalesce(it.line_total,0) end) as received_value
  from stock_issues s join stock_issue_items it on it.issue_id = s.id
  where s.status = 'confirmed'
  group by s.rep_id, it.product_id, case when it.product_id is null then it.product_text end
), sold as (
  select v.rep_id, vi.product_id, sum(coalesce(vi.base_qty, vi.quantity)) as sold
  from visits v join visit_items vi on vi.visit_id = v.id
  where v.status = 'confirmed' and vi.product_id is not null
  group by v.rep_id, vi.product_id
), keys as (
  select rep_id, product_id, unmatched_text from moved
  union
  select rep_id, product_id, null::text from sold
)
select k.rep_id, k.product_id,
       coalesce(p.name, k.unmatched_text) as item, p.unit,
       coalesce(m.received, 0) as received,
       coalesce(sd.sold, 0) as sold,
       coalesce(m.received, 0) - coalesce(sd.sold, 0) as on_hand,
       case when coalesce(m.received, 0) > 0
            then round(m.received_value / m.received * (m.received - coalesce(sd.sold, 0)), 2)
            else 0 end as on_hand_value
from keys k
left join products p on p.id = k.product_id
left join moved m on m.rep_id = k.rep_id
                 and m.product_id is not distinct from k.product_id
                 and m.unmatched_text is not distinct from k.unmatched_text
left join sold sd on sd.rep_id = k.rep_id and sd.product_id = k.product_id;
alter view rep_stock set (security_invoker = true);
