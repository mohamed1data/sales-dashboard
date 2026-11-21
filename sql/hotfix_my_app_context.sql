-- HOTFIX: restores the login context required by the performance-ready dashboard.
-- Safe to run now. It does not touch policies or data.

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
