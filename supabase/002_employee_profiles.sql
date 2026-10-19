-- Bandana HRMS migration 002. Run ONCE after taking/exporting a database backup.
-- Non-destructive schema extension. No existing employee is marked active implicitly.
begin;
alter table public.employees add column if not exists employment_state text not null default 'unverified';
alter table public.employees drop constraint if exists employees_employment_state_check;
alter table public.employees add constraint employees_employment_state_check check (employment_state in ('unverified','active','inactive'));
create table if not exists public.employee_details (
 employee_id uuid primary key references public.employees(id) on delete restrict,
 profile jsonb not null default '{}'::jsonb,
 payroll_aug_2026 jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now()
);
alter table public.employee_details enable row level security;
drop policy if exists "hr reads details" on public.employee_details;
create policy "hr reads details" on public.employee_details for select to authenticated using (public.is_hr_admin());
drop policy if exists "hr inserts details" on public.employee_details;
create policy "hr inserts details" on public.employee_details for insert to authenticated with check (public.is_hr_admin());
drop policy if exists "hr updates details" on public.employee_details;
create policy "hr updates details" on public.employee_details for update to authenticated using (public.is_hr_admin()) with check (public.is_hr_admin());
-- RLS means ordinary employees and managers cannot access extended HR details.
create table if not exists public.employee_action_audit (
 id bigint generated always as identity primary key,
 employee_id uuid,
 employee_no text not null,
 action text not null check (action in ('deactivate','reactivate','delete')),
 actor_id uuid not null,
 reason text not null,
 record_snapshot jsonb,
 occurred_at timestamptz not null default now()
);
alter table public.employee_action_audit enable row level security;
drop policy if exists "hr reads action audit" on public.employee_action_audit;
create policy "hr reads action audit" on public.employee_action_audit for select to authenticated using (public.is_hr_admin());
-- No write policy for action audit: only controlled security-definer RPCs can write.
create or replace function public.set_employee_state(p_employee_id uuid,p_new_state text,p_reason text)
returns text language plpgsql security definer set search_path='' as $func$
declare r public.employees%rowtype;
begin
 if not public.is_hr_admin() then raise exception 'Not authorised'; end if;
 if p_new_state not in ('active','inactive') then raise exception 'Invalid state'; end if;
 if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Reason must have at least five characters'; end if;
 select * into r from public.employees where id=p_employee_id for update;
 if not found then raise exception 'Employee not found'; end if;
 if r.employment_state=p_new_state then raise exception 'Employee already has this status'; end if;
 update public.employees set employment_state=p_new_state where id=p_employee_id;
 insert into public.employee_action_audit(employee_id,employee_no,action,actor_id,reason)
 values(p_employee_id,r.employee_no,case when p_new_state='active' then 'reactivate' else 'deactivate' end,auth.uid(),btrim(p_reason));
 return r.employee_no;
end $func$;
revoke all on function public.set_employee_state(uuid,text,text) from public;
grant execute on function public.set_employee_state(uuid,text,text) to authenticated;
-- Permanent deletion only for a record entered in error. Protect all linked records;
-- a successful delete retains an audit snapshot. Do not use for employee exits.
create or replace function public.delete_employee_error(p_employee_id uuid,p_confirmation text,p_reason text)
returns text language plpgsql security definer set search_path='' as $func$
declare r public.employees%rowtype; d public.employee_details%rowtype;
begin
 if not public.is_hr_admin() then raise exception 'Not authorised'; end if;
 select * into r from public.employees where id=p_employee_id for update;
 if not found then raise exception 'Employee not found'; end if;
 if p_confirmation is distinct from r.employee_no then raise exception 'Employee ID confirmation does not match'; end if;
 if length(btrim(coalesce(p_reason,'')))<10 then raise exception 'Deletion reason must have at least ten characters'; end if;
 select * into d from public.employee_details where employee_id=p_employee_id;
 insert into public.employee_action_audit(employee_id,employee_no,action,actor_id,reason,record_snapshot)
 values(r.id,r.employee_no,'delete',auth.uid(),btrim(p_reason),
 jsonb_build_object('employee',to_jsonb(r),'details',case when d.employee_id is null then null else to_jsonb(d) end));
 delete from public.employee_details where employee_id=p_employee_id;
 delete from public.employees where id=p_employee_id;
 -- Future FK-linked tables must use RESTRICT and will prevent deletion if referenced.
 return r.employee_no;
end $func$;
revoke all on function public.delete_employee_error(uuid,text,text) from public;
grant execute on function public.delete_employee_error(uuid,text,text) to authenticated;
-- Existing sequence never decreases or reuses deleted employee IDs.
commit;
