-- Upgrade 3A: account linking and mobile ESS/MSS foundation.
-- Run after 001 and 002. Does NOT create or activate accounts.
begin;
create table if not exists public.employee_accounts (
 employee_id uuid primary key references public.employees(id) on delete restrict,
 user_id uuid not null unique references auth.users(id) on delete restrict,
 username text not null unique,
 login_email text not null unique,
 is_active boolean not null default false,
 must_change_password boolean not null default true,
 created_at timestamptz not null default now(),
 constraint username_safe check(username ~ '^[a-z0-9][a-z0-9._-]{2,79}$')
);
create index if not exists employee_accounts_username_idx on public.employee_accounts(username);
alter table public.employee_accounts enable row level security;
-- HR can review account links. Employees can inspect only their own link.
drop policy if exists "hr reads employee accounts" on public.employee_accounts;
create policy "hr reads employee accounts" on public.employee_accounts for select to authenticated using(public.is_hr_admin());
drop policy if exists "own employee account" on public.employee_accounts;
create policy "own employee account" on public.employee_accounts for select to authenticated using(user_id=(select auth.uid()));
-- No browser-side INSERT/UPDATE/DELETE policies: account provisioning is an admin-only operation.
-- Name-based login: lookup returns ONLY the internal auth email, and only for activated accounts.
-- Public lookup may reveal that a username exists; enable rate limiting before broad rollout.
create or replace function public.resolve_login_name(p_name text)
returns text language sql stable security definer set search_path='' as $f$
 select login_email from public.employee_accounts
 where username=lower(btrim(p_name)) and is_active=true limit 1;
$f$;
revoke all on function public.resolve_login_name(text) from public;
grant execute on function public.resolve_login_name(text) to anon, authenticated;
-- Minimal ESS profile, intentionally excludes details JSON and salary/payroll.
create or replace function public.my_employee_summary()
returns table(employee_no text, full_name text, designation text, department text, location text, employment_state text, must_change_password boolean)
language sql stable security definer set search_path='' as $f$
 select e.employee_no,e.full_name,e.designation,e.department,e.location,e.employment_state,a.must_change_password
 from public.employee_accounts a join public.employees e on e.id=a.employee_id
 where a.user_id=(select auth.uid()) and a.is_active=true;
$f$;
revoke all on function public.my_employee_summary() from public;
grant execute on function public.my_employee_summary() to authenticated;
-- Manager team mapping: verified explicitly by HR, no guesswork from free-text reports_to_text.
create table if not exists public.manager_team_links (
 manager_employee_id uuid not null references public.employees(id) on delete restrict,
 member_employee_id uuid not null references public.employees(id) on delete restrict,
 primary key(manager_employee_id,member_employee_id),
 constraint no_self_manager check(manager_employee_id<>member_employee_id)
);
alter table public.manager_team_links enable row level security;
drop policy if exists "hr reads manager mappings" on public.manager_team_links;
create policy "hr reads manager mappings" on public.manager_team_links for select to authenticated using(public.is_hr_admin());
create or replace function public.my_team_summary()
returns table(employee_no text,full_name text,designation text,department text)
language sql stable security definer set search_path='' as $f$
 select e.employee_no,e.full_name,e.designation,e.department
 from public.employee_accounts a
 join public.manager_team_links m on m.manager_employee_id=a.employee_id
 join public.employees e on e.id=m.member_employee_id
 join public.user_roles r on r.user_id=a.user_id and r.role='manager'
 where a.user_id=(select auth.uid()) and a.is_active=true
 order by e.full_name;
$f$;
revoke all on function public.my_team_summary() from public;
grant execute on function public.my_team_summary() to authenticated;
-- Once the employee has changed their password, this authenticated function clears onboarding flag.
-- IMPORTANT: app calls only after a successful Supabase Auth updateUser(password).
create or replace function public.confirm_password_changed()
returns void language plpgsql security definer set search_path='' as $f$
begin
 update public.employee_accounts set must_change_password=false
 where user_id=auth.uid() and is_active=true;
 if not found then raise exception 'Account is not active'; end if;
end $f$;
revoke all on function public.confirm_password_changed() from public;
grant execute on function public.confirm_password_changed() to authenticated;
commit;
