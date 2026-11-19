-- =====================================================
-- SECURITY FIX (idempotent - safe to run more than once)
-- 1) forces Row Level Security ON for every table in the public schema
-- 2) removes all access for the public "anon" key
-- 3) re-creates every dashboard / rep access policy
-- Run it in Supabase SQL Editor. It does not delete any data.
-- =====================================================

-- 1) RLS on for ALL tables (a table with RLS off is readable/writable by every logged-in user)
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- views must run with the caller's permissions
alter view if exists client_balances  set (security_invoker = true);
alter view if exists rep_stock        set (security_invoker = true);
alter view if exists reminders_24h    set (security_invoker = true);
alter view if exists reminders_2h     set (security_invoker = true);

-- 2) the public (anon) key must not touch anything: only logged-in users and the bot (service role) do
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon;
grant execute on all functions in schema public to authenticated, service_role;

-- 3) helper functions
create or replace function is_dashboard_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from dashboard_users where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
create or replace function current_rep_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from reps where auth_user_id = auth.uid() and active
$$;
grant execute on function is_dashboard_user(), current_rep_id() to authenticated;

-- 3b) remove EVERY existing policy on the public tables, including unknown ones added by hand or by an AI assistant
--     (policies are OR-ed together: one "true" policy such as "Allow authenticated full access" defeats all the others).
--     Our own policies are re-created right below.
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
  -- storage: only drop the policies that are open to everybody (true)
  for p in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects' and (qual = 'true' or with_check = 'true') loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- 4) policies
drop policy if exists dash_self on dashboard_users;
create policy dash_self on dashboard_users for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists dash_read on reps;
create policy dash_read on reps          for select to authenticated using (is_dashboard_user());

drop policy if exists dash_read on clients;
create policy dash_read on clients       for select to authenticated using (is_dashboard_user());

drop policy if exists dash_read on products;
create policy dash_read on products      for select to authenticated using (is_dashboard_user());

drop policy if exists dash_read on visits;
create policy dash_read on visits        for select to authenticated using (is_dashboard_user());

drop policy if exists dash_read on visit_items;
create policy dash_read on visit_items   for select to authenticated using (is_dashboard_user());

drop policy if exists dash_read on payments;
create policy dash_read on payments      for select to authenticated using (is_dashboard_user());

drop policy if exists dash_read on collections;
create policy dash_read on collections   for select to authenticated using (is_dashboard_user());

drop policy if exists dash_read on rep_sessions;
create policy dash_read on rep_sessions  for select to authenticated using (is_dashboard_user());

drop policy if exists dash_update on collections;
create policy dash_update on collections for update to authenticated
  using (is_dashboard_user()) with check (is_dashboard_user());

drop policy if exists dash_voices on storage.objects;
create policy dash_voices on storage.objects for select to authenticated
  using (bucket_id = 'voices' and is_dashboard_user());

drop policy if exists dash_read on rep_requests;
create policy dash_read   on rep_requests for select to authenticated using (is_dashboard_user());

drop policy if exists dash_delete on rep_requests;
create policy dash_delete on rep_requests for delete to authenticated using (is_dashboard_user());

drop policy if exists dash_insert on reps;
create policy dash_insert on reps for insert to authenticated with check (is_dashboard_user());

drop policy if exists dash_update on reps;
create policy dash_update on reps for update to authenticated using (is_dashboard_user()) with check (is_dashboard_user());

drop policy if exists rep_self on reps;
create policy rep_self    on reps            for select to authenticated using (auth_user_id = auth.uid());

drop policy if exists rep_read on visits;
create policy rep_read    on visits          for select to authenticated using (rep_id = current_rep_id());

drop policy if exists rep_read on visit_items;
create policy rep_read    on visit_items     for select to authenticated
  using (exists (select 1 from visits v where v.id = visit_items.visit_id and v.rep_id = current_rep_id()));

drop policy if exists rep_read on payments;
create policy rep_read    on payments        for select to authenticated using (rep_id = current_rep_id());

drop policy if exists rep_read on collections;
create policy rep_read    on collections     for select to authenticated using (rep_id = current_rep_id());

drop policy if exists rep_read on stock_issues;
create policy rep_read    on stock_issues    for select to authenticated using (rep_id = current_rep_id());

drop policy if exists rep_read on stock_issue_items;
create policy rep_read    on stock_issue_items for select to authenticated
  using (exists (select 1 from stock_issues s where s.id = stock_issue_items.issue_id and s.rep_id = current_rep_id()));

drop policy if exists rep_read on clients;
create policy rep_read    on clients         for select to authenticated
  using (current_rep_id() is not null and (rep_id = current_rep_id()
         or exists (select 1 from visits v where v.client_id = clients.id and v.rep_id = current_rep_id())));

drop policy if exists rep_read on products;
create policy rep_read    on products        for select to authenticated using (current_rep_id() is not null);

drop policy if exists rep_voices on storage.objects;
create policy rep_voices   on storage.objects for select to authenticated
  using (bucket_id = 'voices'   and current_rep_id() is not null and (storage.foldername(name))[1] = current_rep_id()::text);

drop policy if exists rep_invoices on storage.objects;
create policy rep_invoices on storage.objects for select to authenticated
  using (bucket_id = 'invoices' and current_rep_id() is not null and (storage.foldername(name))[1] = current_rep_id()::text);

drop policy if exists dash_insert on products;
create policy dash_insert on products for insert to authenticated with check (is_dashboard_user());

drop policy if exists dash_update on products;
create policy dash_update on products for update to authenticated using (is_dashboard_user()) with check (is_dashboard_user());

drop policy if exists dash_delete on products;
create policy dash_delete on products for delete to authenticated using (is_dashboard_user());

drop policy if exists dash_read on product_requests;
create policy dash_read   on product_requests for select to authenticated using (is_dashboard_user());

drop policy if exists dash_delete on product_requests;
create policy dash_delete on product_requests for delete to authenticated using (is_dashboard_user());

drop policy if exists dash_read on product_costs;
create policy dash_read   on product_costs for select to authenticated using (is_dashboard_user());

drop policy if exists dash_insert on product_costs;
create policy dash_insert on product_costs for insert to authenticated with check (is_dashboard_user());

drop policy if exists dash_update on product_costs;
create policy dash_update on product_costs for update to authenticated using (is_dashboard_user()) with check (is_dashboard_user());

drop policy if exists dash_delete on product_costs;
create policy dash_delete on product_costs for delete to authenticated using (is_dashboard_user());

drop policy if exists dash_read on stock_issues;
create policy dash_read on stock_issues for select to authenticated using (is_dashboard_user());

drop policy if exists dash_read on stock_issue_items;
create policy dash_read on stock_issue_items for select to authenticated using (is_dashboard_user());

drop policy if exists dash_invoices on storage.objects;
create policy dash_invoices on storage.objects for select to authenticated using (bucket_id = 'invoices' and is_dashboard_user());

-- 5) rep balances function (replaces the old security-definer view)
drop view if exists rep_client_balances;
create or replace function rep_client_balances()
returns table (client_id uuid, name text, total_sales numeric, total_paid numeric, balance numeric)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, coalesce(s.total_sales, 0), coalesce(p.total_paid, 0), coalesce(s.total_sales, 0) - coalesce(p.total_paid, 0)
  from clients c
  left join (select v.client_id, sum(i.line_total) as total_sales from visits v join visit_items i on i.visit_id = v.id where v.status = 'confirmed' group by v.client_id) s on s.client_id = c.id
  left join (select client_id, sum(amount) as total_paid from payments group by client_id) p on p.client_id = c.id
  where c.id in (select client_id from visits where rep_id = current_rep_id() and client_id is not null) or c.rep_id = current_rep_id()
$$;
revoke all on function rep_client_balances() from public, anon;
grant execute on function rep_client_balances() to authenticated;

-- 6) the logged-in role must still be able to use the tables (RLS decides which ROWS)
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- check 1: only OUR policies must be listed (dash_* and rep_*). Anything else = delete it.
select schemaname, tablename, policyname, cmd from pg_policies
where schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, policyname;

-- check 2: every table must show rls_on = true
select c.relname as table_name, c.relrowsecurity as rls_on
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' order by 1;
