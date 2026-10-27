begin;
create function hrms_private.my_profile_options()
returns jsonb language plpgsql stable security definer set search_path='' as $f$
begin
 if not exists(select 1 from public.employee_accounts a join public.employees e on e.id=a.employee_id
  where a.user_id=auth.uid() and a.is_active and not a.must_change_password and e.employment_state<>'inactive') then
  raise exception 'Active employee sign-in required' using errcode='42501';
 end if;
 return jsonb_build_object(
  'department',coalesce((select jsonb_agg(value order by value) from(select distinct department as value from public.employees where nullif(btrim(department),'') is not null)s),'[]'::jsonb),
  'location',coalesce((select jsonb_agg(value order by value) from(select distinct location as value from public.employees where nullif(btrim(location),'') is not null)s),'[]'::jsonb),
  'reports_to_text',coalesce((select jsonb_agg(value order by value) from(select distinct reports_to_text as value from public.employees where nullif(btrim(reports_to_text),'') is not null)s),'[]'::jsonb),
  'employment_type',(select jsonb_agg(value order by value) from(select 'Permanent' as value union select distinct profile->>'employment_type' from public.employee_details where nullif(btrim(profile->>'employment_type'),'') is not null)s),
  'work_location_mobility',coalesce((select jsonb_agg(value order by value) from(select distinct profile->>'work_location_mobility' as value from public.employee_details where nullif(btrim(profile->>'work_location_mobility'),'') is not null)s),'[]'::jsonb)
 );
end $f$;
revoke all on function hrms_private.my_profile_options() from public,anon,authenticated;
grant execute on function hrms_private.my_profile_options() to authenticated;
create function public.my_profile_options() returns jsonb language sql stable security invoker set search_path='' as $f$
 select hrms_private.my_profile_options();
$f$;
revoke all on function public.my_profile_options() from public,anon,authenticated;
grant execute on function public.my_profile_options() to authenticated;
commit;
