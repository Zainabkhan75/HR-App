-- Run after the canonical-department migration. All test changes roll back.
begin;
do $test$
declare
 actor uuid;
 employee_actor uuid;
 profile jsonb;
 assignment bigint;
 department_number bigint;
 new_employee_number text;
 saved_count integer;
begin
 select count(*) into saved_count from public.employees;
 select u.id into strict actor from auth.users u join public.user_roles r on r.user_id=u.id
 where lower(u.email)='zainab.khan@seidohr.com' and r.role='hr_admin';
 perform set_config('request.jwt.claim.sub',actor::text,true);
 if (select department from public.employees where employee_no='200018')<>'Administration' then
  raise exception 'Latest saved employee department was lost';
 end if;
 select designation_id into assignment from public.employees where employee_no='200017';
 if assignment is distinct from (select designation_id from public.employees where employee_no='200096') then
  raise exception 'The two Finance Managers must share one designation ID';
 end if;
 update public.designations set title='Finance Manager Integration Check' where id=assignment;
 if (select count(*) from public.employees where employee_no in ('200017','200096')
  and designation='Finance Manager Integration Check')<>2 then raise exception 'Shared title did not propagate';end if;
 select department_id into department_number from public.designations where id=assignment;
 update public.departments set name='Finance Integration Check' where id=department_number;
 if (select department from public.employees where employee_no='200017')<>'Finance Integration Check' then
  raise exception 'Department rename did not propagate';end if;
 update public.employees set designation='Office Boy',department='Administration' where employee_no='200018';
 if (select designation_id from public.employees where employee_no='200018') is distinct from
  (select designation_id from public.employees where employee_no='200019') then raise exception 'Reassignment created a duplicate designation';end if;
 if (select p.title from public.positions p join public.employees e on e.position_id=p.id where e.employee_no='200018')<>'Office Boy' then
  raise exception 'Position and person disagree after reassignment';end if;
 new_employee_number:=public.create_employee('Organisation Integration Check','Office Boy','Administration');
 if (select designation_id from public.employees where employee_no=new_employee_number) is distinct from
  (select designation_id from public.employees where employee_no='200019') then raise exception 'New employee did not share the designation';end if;
 perform public.my_profile_options();
 select a.user_id into employee_actor from public.employee_accounts a join public.employees e on e.id=a.employee_id
 where a.is_active and not a.must_change_password and e.employment_state='active'
 and not exists(select 1 from public.user_roles r where r.user_id=a.user_id and r.role='hr_admin') limit 1;
 if employee_actor is null then raise exception 'No eligible employee for self-service test';end if;
 perform set_config('request.jwt.claim.sub',employee_actor::text,true);
 profile:=public.my_employee_profile();
 perform public.update_my_employee_profile('{}'::jsonb,(profile->>'core_updated_at')::timestamptz,(profile->>'profile_updated_at')::timestamptz);
 perform public.update_my_contact_details('{}'::jsonb,(profile->>'profile_updated_at')::timestamptz);
 perform public.my_family_details();
 perform public.my_employee_summary();
 perform public.my_team_summary();
 begin
  perform public.leave_workspace(2026);
 exception when insufficient_privilege then
  if sqlerrm<>'Leave and Inbox are coming in Phase 2' then raise;end if;
 end;
 begin
  perform public.update_my_employee_profile('{"payable_salary_rs":"999999"}'::jsonb,(profile->>'core_updated_at')::timestamptz,(profile->>'profile_updated_at')::timestamptz);
  raise exception 'Employee payroll editing was allowed';
 exception when insufficient_privilege then null;
 end;
 if (select count(*) from public.employees)<>saved_count+1 then raise exception 'Unexpected employee changes';end if;
end;
$test$;
set local role authenticated;
do $privacy$
declare visible integer;
begin
 select count(*) into visible from public.employees;
 if visible<>0 then raise exception 'Employee gained HR directory access';end if;
 begin
  insert into public.departments(name) values('Unauthorised integration check');
  raise exception 'Employee gained department creation access';
 exception when insufficient_privilege then null;
 end;
 perform public.my_employee_profile();
end;
$privacy$;
rollback;
