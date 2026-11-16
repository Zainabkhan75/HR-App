create function public.can_change_hr_admin_login_email(p_actor uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce(p_actor = '3faa501e-6e0a-4a62-9137-e6973569e43c'::uuid, false)
 and exists(select 1 from public.user_roles where user_id=p_actor and role='hr_admin');
$$;
revoke all on function public.can_change_hr_admin_login_email(uuid) from public,anon,authenticated;
grant execute on function public.can_change_hr_admin_login_email(uuid) to service_role;

create or replace function public.confirm_employee_login_email(p_employee uuid,p_actor uuid,p_confirmed text) returns text
language plpgsql security definer set search_path='' as $$
declare a public.employee_accounts%rowtype; old_email text; number text; candidate text:=lower(btrim(p_confirmed));
begin
 if not exists(select 1 from public.user_roles where user_id=p_actor and role='hr_admin') then raise exception 'HR administrator required'; end if;
 select employee_no into strict number from public.employee_records where id=p_employee and employment_state='active' for update;
 select * into strict a from public.employee_accounts where employee_id=p_employee and is_active for update;
 if exists(select 1 from public.user_roles where user_id=a.user_id and role='hr_admin') and not public.can_change_hr_admin_login_email(p_actor) then
  raise exception 'Only the Super Admin can change an HR Admin sign-in email' using errcode='42501';
 end if;
 if candidate is null or length(candidate)>254 or candidate!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 then
  raise exception 'Enter a valid new sign-in email' using errcode='22023';
 end if;
 if exists(select 1 from auth.users where lower(email)=candidate and id<>a.user_id)
 or exists(select 1 from hrms_private.employee_login_emails where email=candidate and (blocked or user_id is distinct from a.user_id))
 or exists(select 1 from public.employee_accounts where lower(login_email)=candidate and employee_id<>p_employee) then
  raise exception 'This sign-in address is unavailable' using errcode='23505';
 end if;
 select email into strict old_email from auth.users where id=a.user_id for update;
 if lower(old_email) is distinct from lower(a.login_email) then raise exception 'Sign-in account does not match employee credentials'; end if;
 if old_email=candidate then return candidate; end if;
 update auth.users set email=candidate,email_confirmed_at=now(),email_change='',email_change_token_new='',email_change_token_current='',email_change_confirm_status=0,email_change_sent_at=null,updated_at=now() where id=a.user_id;
 update auth.identities set identity_data=jsonb_set(identity_data,'{email}',to_jsonb(candidate)),updated_at=now() where user_id=a.user_id and provider='email';
 delete from auth.one_time_tokens where user_id=a.user_id and token_type::text in ('email_change_token_current','email_change_token_new');
 if public.resolve_signin_email(candidate) is distinct from candidate or not exists(select 1 from public.employee_accounts where user_id=a.user_id and login_email=candidate) then raise exception 'Sign-in address failed verification'; end if;
 insert into public.employee_action_audit(employee_id,employee_no,action,actor_id,reason,record_snapshot)
 values(p_employee,number,'admin_login_email_changed',p_actor,'HR confirmed mailbox ownership',jsonb_build_object('old_email',old_email,'new_email',candidate));
 return candidate;
end $$;
