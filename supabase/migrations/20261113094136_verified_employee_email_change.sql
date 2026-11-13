begin;
create table hrms_private.employee_email_change_attempts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 requested_at timestamptz not null
);
alter table hrms_private.employee_email_change_attempts enable row level security;
revoke all on hrms_private.employee_email_change_attempts from public,anon,authenticated;

create function public.can_change_employee_login_email(p_user uuid,p_email text)
returns boolean language sql volatile security definer set search_path='' as $$
 with attempt as (
 insert into hrms_private.employee_email_change_attempts(user_id,requested_at)
 select p_user,now() where exists(
  select 1 from public.employee_accounts a join public.employee_records e on e.id=a.employee_id
  where a.user_id=p_user and a.is_active and e.employment_state='active'
 )
 and not exists(select 1 from public.user_roles where user_id=p_user and role='hr_admin')
 and not exists(select 1 from auth.users where lower(email)=p_email)
 and not exists(select 1 from public.employee_accounts where lower(login_email)=p_email)
 and not exists(select 1 from hrms_private.employee_login_emails where email=p_email)
 and not exists(
  select 1 from public.employee_details d
  where d.employee_id<>(select employee_id from public.employee_accounts where user_id=p_user)
  and p_email in (lower(btrim(d.profile->>'email')),lower(btrim(d.profile->>'personal_email')))
 )
 on conflict(user_id) do update set requested_at=excluded.requested_at
 where hrms_private.employee_email_change_attempts.requested_at<now()-interval '2 minutes'
 returning user_id
 )
 select exists(select 1 from attempt);
$$;
revoke all on function public.can_change_employee_login_email(uuid,text) from public,anon,authenticated;
grant execute on function public.can_change_employee_login_email(uuid,text) to service_role;

create function hrms_private.sync_verified_employee_login_email()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.email is null or new.email_confirmed_at is null then return new;end if;
 if exists(select 1 from public.employee_accounts where user_id=new.id) then
  if exists(select 1 from hrms_private.employee_login_emails where email=lower(new.email) and (blocked or user_id is distinct from new.id)) then
   raise exception 'This sign-in address is unavailable';
  end if;
  update public.employee_accounts set username=lower(new.email),login_email=lower(new.email)
  where user_id=new.id;
  delete from hrms_private.employee_login_emails where user_id=new.id and email=lower(old.email);
 end if;
 return new;
end;
$$;
revoke all on function hrms_private.sync_verified_employee_login_email() from public,anon,authenticated;
create trigger sync_verified_employee_login_email after update of email on auth.users
for each row when (old.email is distinct from new.email)
execute function hrms_private.sync_verified_employee_login_email();
commit;
