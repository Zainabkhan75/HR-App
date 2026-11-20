alter table public.position_records add column is_reporting_root boolean not null default false,
  add constraint reporting_root_has_no_parent check (not is_reporting_root or reports_to_position_id is null);
create unique index one_reporting_root on public.position_records(is_reporting_root) where is_reporting_root;

create view hrms_private.employee_reporting_hierarchy with (security_invoker=true) as
select e.id as employee_id, d.name as department, parent.title as manager_title,
  manager.full_name as manager_name, manager.employee_no as manager_no,
  case when seat.id is null then 'position_unassigned'
       when seat.is_reporting_root then 'root'
       when parent.id is null then 'parent_unassigned'
       when manager.id is null then 'vacant'
       else 'occupied' end as status
from public.employee_records e
left join public.position_records seat on seat.id=e.position_id
left join public.designations role on role.id=seat.designation_id
left join public.departments d on d.id=role.department_id
left join public.positions parent on parent.id=seat.reports_to_position_id
left join public.employee_records manager on manager.position_id=parent.id and manager.employment_state='active';
revoke all on hrms_private.employee_reporting_hierarchy from public, anon, authenticated;
create function hrms_private.hr_reporting_directory()
returns setof hrms_private.employee_reporting_hierarchy
language plpgsql stable security definer set search_path='' as $$
begin
  if not coalesce(public.is_hr_admin(),false) then
    raise exception 'HR administrator access required' using errcode='42501';
  end if;
  return query select * from hrms_private.employee_reporting_hierarchy;
end $$;
create function public.hr_reporting_directory()
returns setof hrms_private.employee_reporting_hierarchy
language sql stable security invoker set search_path='' as $$
  select * from hrms_private.hr_reporting_directory()
$$;
revoke all on function public.hr_reporting_directory(), hrms_private.hr_reporting_directory() from public, anon, authenticated;
grant execute on function public.hr_reporting_directory(), hrms_private.hr_reporting_directory() to authenticated;

-- Preserve all profile extensions already applied to the account-scoped reader.
do $$
declare definition text := pg_get_functiondef('hrms_private.my_employee_profile()'::regprocedure);
anchor text := 'return jsonb_build_object(';
begin
  if strpos(definition,anchor)=0 then raise exception 'Unexpected employee profile function'; end if;
  execute replace(definition,anchor,anchor || '''hierarchy'',(select to_jsonb(h) from hrms_private.employee_reporting_hierarchy h where h.employee_id=v_employee.id),');
end $$;
