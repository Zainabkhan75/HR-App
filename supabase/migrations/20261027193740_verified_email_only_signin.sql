begin;
create table hrms_private.employee_login_emails(email text primary key check(email=lower(btrim(email))),user_id uuid references auth.users(id),blocked boolean not null default false,source text not null,created_at timestamptz not null default now(),check((blocked and user_id is null) or (not blocked and user_id is not null)));
alter table hrms_private.employee_login_emails enable row level security;
revoke all on hrms_private.employee_login_emails from public,anon,authenticated;
create policy server_managed_login_emails on hrms_private.employee_login_emails as restrictive for all to authenticated using(false) with check(false);
create function hrms_private.resolve_signin_email(p_email text) returns text language plpgsql stable security definer set search_path='' as $f$
declare v_users uuid[];v_email text;v_input text:=lower(btrim(p_email));
begin
 if v_input is null or length(v_input)>254 or v_input!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or exists(select 1 from hrms_private.employee_login_emails where email=v_input and blocked) then return null;end if;
 select array_agg(distinct id) into v_users from(
  select user_id as id from hrms_private.employee_login_emails where email=v_input and not blocked
  union select id from auth.users where lower(email)=v_input
 ) c where exists(select 1 from public.employee_accounts a join public.employees e on e.id=a.employee_id where a.user_id=c.id and a.is_active and e.employment_state<>'inactive') or exists(select 1 from public.user_roles where user_id=c.id and role='hr_admin');
 if coalesce(cardinality(v_users),0)<>1 then return null;end if;
 select email into v_email from auth.users where id=v_users[1];return v_email;
end $f$;
create function public.resolve_signin_email(p_email text) returns text language sql stable security invoker set search_path='' as $f$ select hrms_private.resolve_signin_email(p_email);$f$;
revoke all on function hrms_private.resolve_signin_email(text),public.resolve_signin_email(text) from public,anon,authenticated;
grant execute on function hrms_private.resolve_signin_email(text),public.resolve_signin_email(text) to service_role;
-- The application no longer accepts employee-number or username sign-in.
revoke all on function public.resolve_login_name(text) from public,anon,authenticated;
commit;
