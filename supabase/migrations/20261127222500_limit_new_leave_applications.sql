create function hrms_private.leave_applications_open()
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select exists (
    select 1 from public.employee_accounts a
    join public.employees e on e.id = a.employee_id
    where a.user_id = auth.uid() and a.is_active and not a.must_change_password
      and e.employment_state <> 'inactive'
      and e.employee_no in ('200023','200084','200105')
  )
$$;
revoke all on function hrms_private.leave_applications_open() from public,anon;
grant execute on function hrms_private.leave_applications_open() to authenticated;
do $$
declare target record; body text;
begin
  for target in select * from (values
    ('public.leave_workspace(integer)','and not hrms_private.leave_pilot_access(false) then','and not hrms_private.leave_pilot_access(false) and not hrms_private.leave_applications_open() then'),
    ('public.leave_workspace(integer)','hrms_private.leave_pilot_access(true)','hrms_private.leave_applications_open()'),
    ('hrms_private.submit_leave_application(jsonb)','hrms_private.leave_pilot_access(true)','hrms_private.leave_applications_open()')
  ) t(sig,needle,replacement) loop
    body:=pg_get_functiondef(target.sig::regprocedure);
    if strpos(body,target.needle)=0 then raise exception 'Unexpected function %',target.sig;end if;
    execute replace(body,target.needle,target.replacement);
  end loop;
end $$;
do $verify$
declare who record; account uuid; expected boolean;
begin
  for who in select a.user_id,e.employee_no from public.employee_accounts a join public.employees e on e.id=a.employee_id where a.is_active and not a.must_change_password and e.employment_state<>'inactive' loop
    perform set_config('request.jwt.claim.sub',who.user_id::text,true);
    expected:=who.employee_no in ('200023','200084','200105');
    if hrms_private.leave_applications_open() is distinct from expected then raise exception 'Applicant verification failed'; end if;
    if who.employee_no='200001' and not hrms_private.leave_pilot_access(false) then raise exception 'CEO approval access missing';end if;
  end loop;
  perform set_config('request.jwt.claim.sub','',true);
end $verify$;