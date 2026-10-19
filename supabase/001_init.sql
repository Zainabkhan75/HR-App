-- Run in Supabase SQL editor, then manually create only authorised HR users.
create extension if not exists pgcrypto;
create table public.user_roles (user_id uuid not null references auth.users(id) on delete cascade, role text not null check(role in ('hr_admin','manager','employee')), primary key(user_id,role));
create table public.employees (
 id uuid primary key default gen_random_uuid(),
 employee_no text not null unique check(employee_no ~ '^BND-[0-9]{3,}$'),
 full_name text not null check(length(btrim(full_name)) > 0),
 designation text, department text, reports_to_text text, location text,
 record_status text, source_note text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create sequence public.employee_number_sequence start with 1;
create or replace function public.is_hr_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_roles r where r.user_id=(select auth.uid()) and r.role='hr_admin');
$$;
revoke all on function public.is_hr_admin() from public;
grant execute on function public.is_hr_admin() to authenticated;
alter table public.employees enable row level security;
alter table public.user_roles enable row level security;
create policy "hr reads employees" on public.employees for select to authenticated using (public.is_hr_admin());
create policy "hr updates employees" on public.employees for update to authenticated using (public.is_hr_admin()) with check (public.is_hr_admin());
create policy "hr can inspect own role" on public.user_roles for select to authenticated using(user_id=(select auth.uid()));
-- No direct INSERT/DELETE grants or policies for employee records.
revoke insert, delete on public.employees from authenticated, anon;
create or replace function public.set_employee_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
create trigger employee_timestamp before update on public.employees for each row execute function public.set_employee_updated_at();
-- Employee numbers may never be edited after creation.
create or replace function public.prevent_employee_number_change() returns trigger language plpgsql as $$begin
 if new.employee_no is distinct from old.employee_no then raise exception 'Employee number is immutable'; end if;
 return new;
end$$;
create trigger no_employee_number_change before update on public.employees for each row execute function public.prevent_employee_number_change();
create or replace function public.create_employee(p_full_name text,p_designation text default null,p_department text default null,p_reports_to_text text default null,p_location text default null,p_record_status text default null,p_source_note text default null)
returns text language plpgsql security definer set search_path='' as $$
declare n bigint; code text;
begin
 if not public.is_hr_admin() then raise exception 'Not authorised'; end if;
 if nullif(btrim(p_full_name),'') is null then raise exception 'Employee name is required'; end if;
 n:=nextval('public.employee_number_sequence');
 code:='BND-'||lpad(n::text,3,'0');
 insert into public.employees(employee_no,full_name,designation,department,reports_to_text,location,record_status,source_note)
 values(code,btrim(p_full_name),nullif(btrim(p_designation),''),nullif(btrim(p_department),''),nullif(btrim(p_reports_to_text),''),nullif(btrim(p_location),''),nullif(btrim(p_record_status),''),nullif(btrim(p_source_note),''));
 return code;
end $$;
revoke all on function public.create_employee(text,text,text,text,text,text,text) from public;
grant execute on function public.create_employee(text,text,text,text,text,text,text) to authenticated;
-- AFTER importing existing employee numbers, set sequence to the HIGHEST EXISTING NUMBER:
-- SELECT setval('public.employee_number_sequence', COALESCE((SELECT max(substring(employee_no from 5)::bigint) FROM public.employees),1), true);
-- WARNING: do this BEFORE allowing anyone to add employees in the app.
-- Grant HR role only after verifying user identity using Supabase Auth Users:
-- INSERT INTO public.user_roles(user_id,role) VALUES ('AUTH-USER-UUID-HERE','hr_admin');
