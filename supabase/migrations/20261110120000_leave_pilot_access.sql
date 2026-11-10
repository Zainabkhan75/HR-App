begin;

create function hrms_private.leave_pilot_access(p_applicant_only boolean)
returns boolean language sql stable security definer set search_path='' as $f$
 select exists(
  select 1 from public.employee_accounts a join public.employees e on e.id=a.employee_id
  where a.user_id=auth.uid() and a.is_active and not a.must_change_password and e.employment_state<>'inactive'
   and (
    exists(select 1 from hrms_private.leave_pilot_routes r where r.employee_id=a.employee_id)
    or (not p_applicant_only and (
     exists(select 1 from hrms_private.leave_pilot_routes r where auth.uid() in (r.hod_user_id,r.hr_user_id,r.ceo_user_id)
      or exists(select 1 from public.manager_team_links l where l.member_employee_id=r.employee_id and l.manager_employee_id=a.employee_id))
     or exists(select 1 from hrms_private.leave_request_route q where auth.uid()=any(q.approvers))
    ))
   )
 );
$f$;
revoke all on function hrms_private.leave_pilot_access(boolean) from public,anon;
grant execute on function hrms_private.leave_pilot_access(boolean) to authenticated;

create or replace function public.leave_workspace(p_year integer)
returns jsonb language plpgsql stable security invoker set search_path='' as $f$
begin
 if not public.is_hr_admin() and not hrms_private.leave_pilot_access(false) then
  raise exception 'Leave and Inbox are coming in Phase 2' using errcode='42501';
 end if;
 return hrms_private.leave_workspace(p_year) || jsonb_build_object('pilot_applicant',hrms_private.leave_pilot_access(true));
end $f$;

create or replace function public.leave_action(p_action text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $f$
begin
 if p_action in ('submit','cancel') and not hrms_private.leave_pilot_access(true) then
  raise exception 'Leave applications are restricted to pilot applicants' using errcode='42501';
 end if;
 if not public.is_hr_admin() and not hrms_private.leave_pilot_access(false) then
  raise exception 'Leave and Inbox are coming in Phase 2' using errcode='42501';
 end if;
 return hrms_private.leave_action(p_action,p_payload);
end $f$;

commit;
