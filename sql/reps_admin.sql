-- =====================================================
-- Manage reps from the dashboard (run AFTER dashboard_policies.sql)
-- =====================================================

-- People who messaged the bot but are not registered yet (the bot fills this table)
create table if not exists rep_requests (
  telegram_id bigint primary key,
  first_name text,
  last_name text,
  username text,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
alter table rep_requests enable row level security;

create policy dash_read   on rep_requests for select to authenticated using (is_dashboard_user());
create policy dash_delete on rep_requests for delete to authenticated using (is_dashboard_user());

-- the dashboard may add / edit reps
create policy dash_insert on reps for insert to authenticated with check (is_dashboard_user());
create policy dash_update on reps for update to authenticated using (is_dashboard_user()) with check (is_dashboard_user());
