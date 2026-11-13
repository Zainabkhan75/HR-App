begin;
alter table public.employee_action_audit
 drop constraint employee_action_audit_action_check,
 add constraint employee_action_audit_action_check check(action in
 ('deactivate','reactivate','delete','admin_password_generated','admin_login_email_changed'));
create function public.propose_employee_login_email(p_employee uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p jsonb; work text; candidate text; shared boolean; owner uuid;
begin
 select profile into p from public.employee_details where employee_id=p_employee;
 select user_id into owner from public.employee_accounts where employee_id=p_employee;
 work:=lower(btrim(coalesce(p->>'email','')));
 shared:=coalesce(p->>'shared_work_mailbox','false')='true' or (work<>'' and exists(
  select 1 from public.employee_details d where d.employee_id<>p_employee
  and work in (lower(btrim(d.profile->>'email')),lower(btrim(d.profile->>'personal_email')))
 ));
 candidate:=case when shared then lower(btrim(coalesce(p->>'personal_email',''))) else work end;
 if length(candidate)>254 or candidate!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
  return jsonb_build_object('reason',case when shared then 'Add a valid personal email for the shared work mailbox.' else 'Add a valid work email.' end);
 end if;
 if exists(select 1 from public.employee_details d where d.employee_id<>p_employee and candidate in (lower(btrim(d.profile->>'email')),lower(btrim(d.profile->>'personal_email'))))
 or exists(select 1 from auth.users where lower(email)=candidate and id is distinct from owner)
 or exists(select 1 from hrms_private.employee_login_emails where email=candidate and (blocked or user_id is distinct from owner))
 or exists(select 1 from public.employee_accounts where lower(login_email)=candidate and employee_id<>p_employee) then
  return jsonb_build_object('reason','The proposed address is already used or unavailable.');
 end if;
 return jsonb_build_object('email',candidate,'reason',case when shared then 'Personal email for a shared work mailbox' else 'Unique work email' end);
end $$;

create or replace function public.prepare_confirmed_employee_login(p_employee uuid,p_actor uuid,p_confirmed text)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare e public.employees%rowtype;d public.employee_details%rowtype;  selected text; job uuid; r jsonb;
begin
 if not exists(select 1 from public.user_roles where user_id=p_actor and role='hr_admin') then raise exception 'HR administrator required';end if;
 select * into e from public.employees where id=p_employee for update;
 select * into d from public.employee_details where employee_id=p_employee;
 if e.id is null or d.employee_id is null then raise exception 'Save the employee profile first';end if;
 if e.employment_state<>'active' then raise exception 'Activate the employee before creating a login';end if;
 if exists(select 1 from public.employee_accounts where employee_id=p_employee) then raise exception 'Employee already has a login. Its password was not changed.';end if;
 if exists(select 1 from hrms_private.employee_import_jobs j,jsonb_array_elements(j.rows) v where j.status in ('pending','running') and j.expires_at>now() and v->>'employee_id'=p_employee::text) then raise exception 'Login creation is already in progress. Please wait before retrying.';end if;
 selected:=public.propose_employee_login_email(p_employee)->>'email';
 if selected is null or selected is distinct from p_confirmed then raise exception 'Review the current proposed sign-in email again';end if;
 r:=jsonb_build_object('employee_id',e.id,'employee_no',e.employee_no,'login_email',selected,'expected_updated_at',e.updated_at,'expected_profile_updated_at',d.updated_at,'actor_id',p_actor);
 insert into hrms_private.employee_import_jobs(source_file,token_hash,expires_at,status,rows)
 values('Admin portal employee login creation','',now()+interval '10 minutes','running',jsonb_build_array(r)) returning id into job;
 return jsonb_build_object('job',job,'employee_id',e.id,'employee_no',e.employee_no,'full_name',e.full_name,'username',selected,'initial_password','Pakistan1234');
end $f$;

create function public.confirm_employee_login_email(p_employee uuid,p_actor uuid,p_confirmed text) returns text
language plpgsql security definer set search_path='' as $$
declare a public.employee_accounts%rowtype; old_email text; number text;
begin
 if not exists(select 1 from public.user_roles where user_id=p_actor and role='hr_admin') then raise exception 'HR administrator required'; end if;
 select employee_no into strict number from public.employee_records where id=p_employee and employment_state='active' for update;
 perform 1 from public.employee_details where employee_id=p_employee for update;
 select * into strict a from public.employee_accounts where employee_id=p_employee and is_active for update;
 if exists(select 1 from public.user_roles where user_id=a.user_id and role='hr_admin') then raise exception 'HR Admin accounts use administrator recovery'; end if;
 if p_confirmed is null or p_confirmed is distinct from (public.propose_employee_login_email(p_employee)->>'email') then raise exception 'Review the current proposed sign-in email again'; end if;
 select email into strict old_email from auth.users where id=a.user_id for update;
 if lower(old_email) is distinct from lower(a.login_email) then raise exception 'Sign-in account does not match employee credentials'; end if;
 if old_email=p_confirmed then return p_confirmed; end if;
 update auth.users set email=p_confirmed,email_confirmed_at=now(),email_change='',email_change_token_new='',email_change_token_current='',email_change_confirm_status=0,email_change_sent_at=null,updated_at=now() where id=a.user_id;
 update auth.identities set identity_data=jsonb_set(identity_data,'{email}',to_jsonb(p_confirmed)),updated_at=now() where user_id=a.user_id and provider='email';
 delete from auth.one_time_tokens where user_id=a.user_id and token_type::text in ('email_change_token_current','email_change_token_new');
 if public.resolve_signin_email(p_confirmed) is distinct from p_confirmed or not exists(select 1 from public.employee_accounts where user_id=a.user_id and login_email=p_confirmed) then raise exception 'Sign-in address failed verification'; end if;
 insert into public.employee_action_audit(employee_id,employee_no,action,actor_id,reason,record_snapshot)
 values(p_employee,number,'admin_login_email_changed',p_actor,'HR confirmed mailbox ownership',jsonb_build_object('old_email',old_email,'new_email',p_confirmed));
 return p_confirmed;
end $$;
revoke all on function public.propose_employee_login_email(uuid),public.prepare_confirmed_employee_login(uuid,uuid,text),public.confirm_employee_login_email(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.propose_employee_login_email(uuid),public.prepare_confirmed_employee_login(uuid,uuid,text),public.confirm_employee_login_email(uuid,uuid,text) to service_role;
commit;
