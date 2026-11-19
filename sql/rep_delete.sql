-- =====================================================
-- Permanent delete of a rep + safety guards
-- Run AFTER rep_portal.sql
-- =====================================================

-- 1) Deleting a rep keeps the history (visits, invoices, collections, payments) -> rep becomes NULL ("deleted rep")
alter table visits       alter column rep_id drop not null;
alter table stock_issues alter column rep_id drop not null;
alter table collections  alter column rep_id drop not null;

do $$
declare t text; c record;
begin
  foreach t in array array['visits','stock_issues','collections','payments','clients'] loop
    for c in select conname from pg_constraint
             where conrelid = ('public.' || t)::regclass and confrelid = 'public.reps'::regclass and contype = 'f' loop
      execute format('alter table public.%I drop constraint %I', t, c.conname);
    end loop;
    execute format('alter table public.%I add constraint %I foreign key (rep_id) references public.reps(id) on delete set null', t, t || '_rep_id_fkey');
  end loop;
end $$;

-- 2) One email can not be both a manager and a rep (a manager login would otherwise open the manager dashboard)
create or replace function guard_rep_email() returns trigger language plpgsql as $$
begin
  if new.email is not null and exists (select 1 from dashboard_users d where lower(d.email) = lower(new.email)) then
    raise exception 'هذا الإيميل مسجّل كمدير، استخدم إيميلًا مختلفًا للمندوب';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_rep_email on reps;
create trigger trg_guard_rep_email before insert or update of email on reps for each row execute function guard_rep_email();

create or replace function guard_manager_email() returns trigger language plpgsql as $$
begin
  if exists (select 1 from reps r where lower(r.email) = lower(new.email)) then
    raise exception 'هذا الإيميل مرتبط بمندوب، لا يمكن إضافته كمدير';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_manager_email on dashboard_users;
create trigger trg_guard_manager_email before insert or update of email on dashboard_users for each row execute function guard_manager_email();

-- check for an existing overlap (should return 0 rows):
-- select r.name, r.email from reps r join dashboard_users d on lower(d.email) = lower(r.email);
