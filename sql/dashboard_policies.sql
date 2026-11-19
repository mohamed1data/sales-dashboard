-- =====================================================
-- Dashboard access policies (run AFTER sales_bot_schema.sql)
-- =====================================================

-- 1) Who may use the dashboard (put the manager's email here)
create table if not exists dashboard_users (email text primary key);
alter table dashboard_users enable row level security;
insert into dashboard_users (email) values ('MANAGER@EXAMPLE.COM') on conflict do nothing;

create or replace function is_dashboard_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from dashboard_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- a logged-in user may see only their own row (used by the "authorized?" check)
create policy dash_self on dashboard_users for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- 2) Read access for dashboard users
create policy dash_read on reps          for select to authenticated using (is_dashboard_user());
create policy dash_read on clients       for select to authenticated using (is_dashboard_user());
create policy dash_read on products      for select to authenticated using (is_dashboard_user());
create policy dash_read on visits        for select to authenticated using (is_dashboard_user());
create policy dash_read on visit_items   for select to authenticated using (is_dashboard_user());
create policy dash_read on payments      for select to authenticated using (is_dashboard_user());
create policy dash_read on collections   for select to authenticated using (is_dashboard_user());
create policy dash_read on rep_sessions  for select to authenticated using (is_dashboard_user());

-- 3) The dashboard may mark collections as done / cancelled
create policy dash_update on collections for update to authenticated
  using (is_dashboard_user()) with check (is_dashboard_user());

-- 4) Listen to voice notes (private bucket, signed URLs)
create policy dash_voices on storage.objects for select to authenticated
  using (bucket_id = 'voices' and is_dashboard_user());
