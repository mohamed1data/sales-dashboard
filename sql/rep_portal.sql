-- =====================================================
-- Rep portal: reps log in to the dashboard and see ONLY their own data
-- Run AFTER: sales_bot_schema.sql, dashboard_policies.sql, stock_migration.sql, reps_admin.sql
-- =====================================================

alter table reps add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;
alter table reps add column if not exists email text;

-- the rep id of the logged-in user (null if not a rep, or deactivated)
create or replace function current_rep_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from reps where auth_user_id = auth.uid() and active
$$;

-- a rep sees his own row, visits, items, payments, collections, stock
create policy rep_self    on reps            for select to authenticated using (auth_user_id = auth.uid());
create policy rep_read    on visits          for select to authenticated using (rep_id = current_rep_id());
create policy rep_read    on visit_items     for select to authenticated
  using (exists (select 1 from visits v where v.id = visit_items.visit_id and v.rep_id = current_rep_id()));
create policy rep_read    on payments        for select to authenticated using (rep_id = current_rep_id());
create policy rep_read    on collections     for select to authenticated using (rep_id = current_rep_id());
create policy rep_read    on stock_issues    for select to authenticated using (rep_id = current_rep_id());
create policy rep_read    on stock_issue_items for select to authenticated
  using (exists (select 1 from stock_issues s where s.id = stock_issue_items.issue_id and s.rep_id = current_rep_id()));
-- clients: the ones assigned to him or that he visited
create policy rep_read    on clients         for select to authenticated
  using (current_rep_id() is not null and (rep_id = current_rep_id()
         or exists (select 1 from visits v where v.client_id = clients.id and v.rep_id = current_rep_id())));
create policy rep_read    on products        for select to authenticated using (current_rep_id() is not null);

-- balances of HIS clients only. Computed over ALL reps' data (so the number is the real debt),
-- from the base tables directly. A function (not a view) so it only runs for logged-in users.
drop view if exists rep_client_balances;
create or replace function rep_client_balances()
returns table (client_id uuid, name text, total_sales numeric, total_paid numeric, balance numeric)
language sql stable security definer set search_path = public as $$
  select c.id, c.name,
         coalesce(s.total_sales, 0), coalesce(p.total_paid, 0),
         coalesce(s.total_sales, 0) - coalesce(p.total_paid, 0)
  from clients c
  left join (select v.client_id, sum(i.line_total) as total_sales
             from visits v join visit_items i on i.visit_id = v.id
             where v.status = 'confirmed' group by v.client_id) s on s.client_id = c.id
  left join (select client_id, sum(amount) as total_paid from payments group by client_id) p on p.client_id = c.id
  where c.id in (select client_id from visits where rep_id = current_rep_id() and client_id is not null)
     or c.rep_id = current_rep_id()
$$;
revoke all on function rep_client_balances() from public, anon;
grant execute on function rep_client_balances() to authenticated;

-- his own voice notes and invoice photos (files are stored under <rep_id>/...)
create policy rep_voices   on storage.objects for select to authenticated
  using (bucket_id = 'voices'   and current_rep_id() is not null and (storage.foldername(name))[1] = current_rep_id()::text);
create policy rep_invoices on storage.objects for select to authenticated
  using (bucket_id = 'invoices' and current_rep_id() is not null and (storage.foldername(name))[1] = current_rep_id()::text);
