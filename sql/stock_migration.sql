-- =====================================================
-- Stock / factory invoices (run AFTER sales_bot_schema.sql)
-- If you use the dashboard, run dashboard_policies.sql BEFORE this file
-- (the dashboard policies for the new tables are added at the end, only if that file was run).
-- =====================================================

-- ---------- Invoices received from the factory (or returned to it) ----------
create table stock_issues (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references reps(id),
  kind text not null default 'issue' check (kind in ('issue','return')),  -- issue = rep takes goods, return = rep gives goods back
  source text not null default 'photo' check (source in ('photo','voice','text')),
  invoice_no text,
  invoice_date date,
  declared_total numeric(14,2),               -- grand total written on the invoice
  notes text,
  photo_path text,                            -- path in Storage bucket "invoices"
  photo_file_id text,
  voice_path text,                            -- path in Storage bucket "voices" (voice entry)
  voice_file_id text,
  transcript text,
  tg_message_id bigint,
  ai_json jsonb,
  status text not null default 'draft' check (status in ('draft','confirmed','cancelled')),
  draft_reminded boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index stock_issues_rep_msg_uniq on stock_issues (rep_id, tg_message_id);
create index on stock_issues (rep_id, created_at desc);
create index on stock_issues (invoice_no);
create index on stock_issues (status, created_at);

create table stock_issue_items (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references stock_issues(id) on delete cascade,
  product_id uuid references products(id),
  product_text text,
  quantity numeric(12,2) not null,
  unit text,
  unit_price numeric(12,2),
  line_total numeric(14,2)
);
create index on stock_issue_items (issue_id);

-- ---------- Bot session extras ----------
alter table rep_sessions add column if not exists editing_stock_id uuid references stock_issues(id) on delete set null;
alter table rep_sessions add column if not exists stock_mode_until timestamptz;

-- ---------- What each rep currently holds ----------
-- on_hand = received (invoices) - returned - sold (confirmed visits). Value uses the average invoice price.
create view rep_stock as
with moved as (
  select s.rep_id, it.product_id,
         case when it.product_id is null then it.product_text end as unmatched_text,
         sum(case when s.kind = 'issue' then it.quantity else -it.quantity end) as received,
         sum(case when s.kind = 'issue' then coalesce(it.line_total,0) else -coalesce(it.line_total,0) end) as received_value
  from stock_issues s join stock_issue_items it on it.issue_id = s.id
  where s.status = 'confirmed'
  group by s.rep_id, it.product_id, case when it.product_id is null then it.product_text end
), sold as (
  select v.rep_id, vi.product_id, sum(vi.quantity) as sold
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

-- ---------- Security ----------
alter table stock_issues      enable row level security;
alter table stock_issue_items enable row level security;
alter view rep_stock set (security_invoker = true);

-- private bucket for invoice photos
insert into storage.buckets (id, name, public) values ('invoices', 'invoices', false)
on conflict (id) do nothing;

-- dashboard read access (only if dashboard_policies.sql was already run)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'is_dashboard_user') then
    execute 'create policy dash_read on stock_issues      for select to authenticated using (is_dashboard_user())';
    execute 'create policy dash_read on stock_issue_items for select to authenticated using (is_dashboard_user())';
    execute 'create policy dash_invoices on storage.objects for select to authenticated using (bucket_id = ''invoices'' and is_dashboard_user())';
  else
    raise notice 'is_dashboard_user() not found: run dashboard_policies.sql, then re-run the 3 policy lines at the end of this file.';
  end if;
end $$;
