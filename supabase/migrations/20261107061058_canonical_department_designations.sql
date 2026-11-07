-- Department + title identifies one shared designation. Existing employee and
-- position APIs become projections of these masters, preserving their callers.
create table hrms_private.organisation_assignment_backup (
 id integer primary key check (id=1),
 captured_at timestamptz not null default now(),
 employees jsonb not null,
 positions jsonb not null
);
alter table hrms_private.organisation_assignment_backup enable row level security;
revoke all on hrms_private.organisation_assignment_backup from public,anon,authenticated;
insert into hrms_private.organisation_assignment_backup(id,employees,positions)
select 1,(select jsonb_agg(to_jsonb(e)) from public.employees e),
 (select jsonb_agg(to_jsonb(p)) from public.positions p);

create table public.designations (
 id bigint generated always as identity primary key,
 department_id bigint not null references public.departments(id) on delete restrict,
 title text not null check (title=btrim(title) and title<>''),
 unique (id,department_id)
);
create unique index designations_department_title_idx
 on public.designations(department_id,lower(title));
alter table public.designations enable row level security;
revoke all on public.designations from public,anon,authenticated;
grant select,insert,update on public.designations to authenticated,service_role;
grant usage on sequence public.designations_id_seq to authenticated,service_role;
create policy "HR reads designation assignments" on public.designations for select to authenticated
 using ((select public.is_hr_admin()));
create policy "HR adds designations" on public.designations for insert to authenticated
 with check ((select public.is_hr_admin()));
create policy "HR maintains designations" on public.designations for update to authenticated
 using ((select public.is_hr_admin())) with check ((select public.is_hr_admin()));
grant insert,update on public.departments to authenticated;
grant usage on sequence public.departments_id_seq to authenticated;
create policy "HR adds departments" on public.departments for insert to authenticated
 with check ((select public.is_hr_admin()));
create policy "HR maintains departments" on public.departments for update to authenticated
 using ((select public.is_hr_admin())) with check ((select public.is_hr_admin()));

insert into public.departments(name)
select min(btrim(department)) from public.employees
where nullif(btrim(department),'') is not null
group by lower(btrim(department))
on conflict (lower(btrim(name))) do nothing;
insert into public.designations(department_id,title)
select d.id,min(btrim(e.designation)) from public.employees e
join public.departments d on lower(btrim(d.name))=lower(btrim(e.department))
where nullif(btrim(e.designation),'') is not null
group by d.id,lower(btrim(e.designation));
insert into public.designations(department_id,title)
select p.department_id,min(btrim(p.title)) from public.positions p
group by p.department_id,lower(btrim(p.title))
on conflict (department_id,lower(title)) do nothing;

create function hrms_private.register_designation_name()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.title:=btrim(new.title);
 insert into public.approved_designations(title) values(new.title) on conflict (lower(title)) do nothing;
 return new;
end;
$$;
revoke all on function hrms_private.register_designation_name() from public,anon,authenticated;
create trigger register_designation_name before insert or update of title on public.designations
for each row execute function hrms_private.register_designation_name();

alter table public.employees add column designation_id bigint references public.designations(id) on delete restrict;
alter table public.positions add column designation_id bigint references public.designations(id) on delete restrict;
update public.employees e set designation_id=g.id
from public.designations g join public.departments d on d.id=g.department_id
where lower(btrim(e.designation))=lower(g.title) and lower(btrim(e.department))=lower(btrim(d.name));
update public.positions p set designation_id=g.id
from public.designations g where g.department_id=p.department_id and lower(g.title)=lower(btrim(p.title));
-- Seed occupied seats with the latest saved assignments, including HR cleanups.
update public.positions p set designation_id=e.designation_id,location=e.location
from public.employees e where e.position_id=p.id and e.employment_state='active';
alter table public.positions alter column designation_id set not null;

drop trigger employees_require_approved_designation on public.employees;
alter table public.employees rename to employee_records;
alter table public.positions rename to position_records;
alter table public.employee_records drop column designation,drop column department;
alter table public.position_records drop column title,drop column department_id;

create view public.positions with (security_invoker=true) as
select p.id,
 (select g.department_id from public.designations g where g.id=p.designation_id) as department_id,
 (select g.title from public.designations g where g.id=p.designation_id) as title,
 p.location,p.reports_to_position_id,p.designation_id
from public.position_records p;
create view public.employees with (security_invoker=true) as
select e.id,e.employee_no,e.full_name,
 (select g.title from public.designations g where g.id=e.designation_id) as designation,
 (select d.name from public.designations g join public.departments d on d.id=g.department_id
  where g.id=e.designation_id) as department,
 e.reports_to_text,e.location,e.created_at,e.updated_at,e.employment_state,
 e.record_status,e.source_note,e.leaving_date,e.position_id,e.designation_id,
 (select g.department_id from public.designations g where g.id=e.designation_id) as department_id
from public.employee_records e;
revoke all on public.employees,public.positions from public,anon,authenticated;
grant select,update on public.employees to authenticated;
grant select,insert,update,delete on public.employees to service_role;
grant select on public.positions to authenticated;
grant select,insert,update,delete on public.positions to service_role;

create function hrms_private.designation_for_assignment(p_department text,p_title text)
returns bigint language plpgsql set search_path='' as $$
declare department_number bigint; designation_number bigint;
begin
 if nullif(btrim(p_department),'') is null and nullif(btrim(p_title),'') is null then return null; end if;
 if nullif(btrim(p_department),'') is null or nullif(btrim(p_title),'') is null then
  raise exception 'Choose both a department and a designation' using errcode='22023';
 end if;
 select id into department_number from public.departments where lower(btrim(name))=lower(btrim(p_department));
 if not found then
  if not public.is_hr_admin() and session_user not in ('postgres','supabase_admin') and coalesce(auth.jwt()->>'role','')<>'service_role' then
   raise exception 'Choose an existing department' using errcode='42501';
  end if;
  insert into public.departments(name) values(btrim(p_department))
  on conflict (lower(btrim(name))) do nothing;
  select id into strict department_number from public.departments where lower(btrim(name))=lower(btrim(p_department));
 end if;
 select id into designation_number from public.designations
 where department_id=department_number and lower(title)=lower(btrim(p_title));
 if not found then
  if not public.is_hr_admin() and session_user not in ('postgres','supabase_admin') and coalesce(auth.jwt()->>'role','')<>'service_role' then
   raise exception 'Choose a designation assigned to this department' using errcode='42501';
  end if;
  if not exists(select 1 from public.approved_designations where lower(title)=lower(btrim(p_title))) then
   raise exception 'Choose an approved designation' using errcode='22023';
  end if;
  insert into public.designations(department_id,title) values(department_number,btrim(p_title))
  on conflict (department_id,lower(title)) do nothing;
  select id into strict designation_number from public.designations
  where department_id=department_number and lower(title)=lower(btrim(p_title));
 end if;
 return designation_number;
end;
$$;
revoke all on function hrms_private.designation_for_assignment(text,text) from public,anon,authenticated;

create function hrms_private.write_employee_assignment()
returns trigger language plpgsql security definer set search_path='' as $$
declare saved public.employee_records%rowtype; assignment bigint; seat bigint;
 trusted boolean:=session_user in ('postgres','supabase_admin') or
  coalesce(auth.jwt()->>'role','')='service_role' or public.is_hr_admin();
begin
 if not trusted then
  if tg_op<>'UPDATE' or not exists(select 1 from public.employee_accounts a
   join public.employee_records e on e.id=a.employee_id where a.employee_id=old.id
   and a.user_id=auth.uid() and a.is_active and not a.must_change_password and e.employment_state='active') then
   raise exception 'Employee assignment access denied' using errcode='42501';
  end if;
 end if;
 if tg_op='DELETE' then delete from public.employee_records where id=old.id;return old;end if;
 if tg_op='UPDATE' then
  select * into strict saved from public.employee_records where id=old.id for update;
  if saved.updated_at is distinct from old.updated_at then
   raise exception 'The employee assignment changed. Reload before saving.' using errcode='40001';
  end if;
  if new.id is distinct from old.id or new.employee_no is distinct from old.employee_no then
   raise exception 'Employee identity cannot be changed' using errcode='22023';
  end if;
  if new.department_id is distinct from old.department_id and new.designation_id is not distinct from old.designation_id then
   raise exception 'Choose the designation assignment to change departments' using errcode='22023';
  end if;
 end if;
 assignment:=new.designation_id;
 if tg_op='INSERT' then
  if assignment is null and new.position_id is not null and new.department is null and new.designation is null then
   select designation_id into strict assignment from public.position_records where id=new.position_id;
  elsif assignment is null then assignment:=hrms_private.designation_for_assignment(new.department,new.designation);end if;
 elsif new.designation_id is not distinct from old.designation_id then
  if new.designation is distinct from old.designation or new.department is distinct from old.department then
   assignment:=hrms_private.designation_for_assignment(new.department,new.designation);
  end if;
 end if;
 if tg_op='UPDATE' and new.position_id is distinct from old.position_id and new.position_id is not null then
  if new.designation_id is not distinct from old.designation_id and new.designation is not distinct from old.designation
   and new.department is not distinct from old.department then
   select designation_id into strict assignment from public.position_records where id=new.position_id;
  end if;
 end if;
 if assignment is not null then perform 1 from public.designations where id=assignment for share;
  if not found then raise exception 'Designation is unavailable' using errcode='23503';end if;
 end if;
 seat:=new.position_id;
 if assignment is null then seat:=null;
 elsif seat is null and coalesce(new.employment_state,'active')='active' then
  insert into public.position_records(designation_id,location) values(assignment,new.location) returning id into seat;
 end if;
 if assignment is distinct from saved.designation_id and seat is not null then
  perform 1 from public.position_records where id=seat for update;
  if exists(select 1 from public.employee_records where position_id=seat and id<>new.id and employment_state='active') then
   if new.employment_state='active' then raise exception 'Position already has an active employee' using errcode='23505';end if;
  elsif new.employment_state='active' and assignment is not null then
   update public.position_records set designation_id=assignment where id=seat;
  end if;
 end if;
 if tg_op='INSERT' then
  insert into public.employee_records(id,employee_no,full_name,reports_to_text,location,created_at,updated_at,
   employment_state,record_status,source_note,leaving_date,position_id,designation_id)
  values(coalesce(new.id,gen_random_uuid()),new.employee_no,new.full_name,new.reports_to_text,new.location,
   coalesce(new.created_at,now()),coalesce(new.updated_at,now()),coalesce(new.employment_state,'active'),
   new.record_status,new.source_note,new.leaving_date,seat,assignment) returning * into saved;
 else
  update public.employee_records set full_name=new.full_name,reports_to_text=new.reports_to_text,
   location=new.location,employment_state=new.employment_state,record_status=new.record_status,
   source_note=new.source_note,leaving_date=new.leaving_date,position_id=seat,designation_id=assignment
  where id=old.id returning * into saved;
 end if;
 select * into new from public.employees where id=saved.id;
 return new;
end;
$$;
revoke all on function hrms_private.write_employee_assignment() from public,anon,authenticated;
create trigger write_employee_assignment instead of insert or update or delete on public.employees
for each row execute function hrms_private.write_employee_assignment();

create function hrms_private.write_position_assignment()
returns trigger language plpgsql security definer set search_path='' as $$
declare assignment bigint; result_id bigint;
begin
 if session_user not in ('postgres','supabase_admin') and coalesce(auth.jwt()->>'role','')<>'service_role'
  and not public.is_hr_admin() then raise exception 'HR access required' using errcode='42501';end if;
 if tg_op='DELETE' then delete from public.position_records where id=old.id;return old;end if;
 assignment:=new.designation_id;
 if tg_op='INSERT' then
  if assignment is null then
   assignment:=hrms_private.designation_for_assignment((select name from public.departments where id=new.department_id),new.title);
  end if;
 elsif new.designation_id is not distinct from old.designation_id and
  (new.title is distinct from old.title or new.department_id is distinct from old.department_id) then
  assignment:=hrms_private.designation_for_assignment((select name from public.departments where id=new.department_id),new.title);
 end if;
 if tg_op='INSERT' then
  insert into public.position_records(designation_id,location,reports_to_position_id)
  values(assignment,new.location,new.reports_to_position_id) returning id into result_id;
 else
  update public.position_records set designation_id=assignment,location=new.location,reports_to_position_id=new.reports_to_position_id
  where id=old.id returning id into result_id;
 end if;
 select * into new from public.positions where id=result_id;return new;
end;
$$;
revoke all on function hrms_private.write_position_assignment() from public,anon,authenticated;
create trigger write_position_assignment instead of insert or update or delete on public.positions
for each row execute function hrms_private.write_position_assignment();

-- Propagate a seat's assignment to its current occupant. Historical inactive
-- employees retain their last designation assignment independently of the seat.
create function hrms_private.position_assignment_to_employee()
returns trigger language plpgsql set search_path='' as $$
begin
 update public.employee_records set designation_id=new.designation_id
 where position_id=new.id and employment_state='active' and designation_id is distinct from new.designation_id;
 return new;
end;
$$;
revoke all on function hrms_private.position_assignment_to_employee() from public,anon,authenticated;
create trigger position_assignment_to_employee after update of designation_id on public.position_records
for each row execute function hrms_private.position_assignment_to_employee();

create function hrms_private.check_employee_position_assignment()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.employment_state='active' and new.position_id is not null and
  new.designation_id is distinct from (select designation_id from public.position_records where id=new.position_id) then
  raise exception 'The employee and position must use the same designation assignment' using errcode='23514';
 end if;
 return new;
end;
$$;
revoke all on function hrms_private.check_employee_position_assignment() from public,anon,authenticated;
create trigger check_employee_position_assignment before insert or update of designation_id,position_id,employment_state
on public.employee_records for each row execute function hrms_private.check_employee_position_assignment();

create function hrms_private.touch_designation_employees()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.employee_records set updated_at=clock_timestamp() where designation_id=new.id;
 return new;
end;
$$;
revoke all on function hrms_private.touch_designation_employees() from public,anon,authenticated;
create trigger touch_designation_employees after update of title,department_id on public.designations
for each row execute function hrms_private.touch_designation_employees();
create function hrms_private.touch_department_employees()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.employee_records set updated_at=clock_timestamp()
 where designation_id in(select id from public.designations where department_id=new.id);
 return new;
end;
$$;
revoke all on function hrms_private.touch_department_employees() from public,anon,authenticated;
create trigger touch_department_employees after update of name on public.departments
for each row execute function hrms_private.touch_department_employees();

create function public.add_department_designation(p_department_id bigint,p_title text)
returns bigint language plpgsql security invoker set search_path='' as $$
declare assignment bigint;
begin
 if not public.is_hr_admin() then raise exception 'HR access required' using errcode='42501';end if;
 if nullif(btrim(p_title),'') is null then raise exception 'Enter a designation' using errcode='22023';end if;
 insert into public.approved_designations(title) values(btrim(p_title)) on conflict (lower(title)) do nothing;
 insert into public.designations(department_id,title) values(p_department_id,btrim(p_title))
 on conflict (department_id,lower(title)) do nothing;
 select id into strict assignment from public.designations where department_id=p_department_id and lower(title)=lower(btrim(p_title));
 return assignment;
end;
$$;
revoke all on function public.add_department_designation(bigint,text) from public,anon;
grant execute on function public.add_department_designation(bigint,text) to authenticated;

-- Keep existing dropdown data and add explicit department/designation IDs.
do $options$
declare definition text; replacement text;
begin
 definition:=pg_get_functiondef('hrms_private.my_profile_options()'::regprocedure);
 replacement:=replace(definition,'return (with candidates as (',
  'return jsonb_build_object(''department_designations'',coalesce((select jsonb_agg(jsonb_build_object(''id'',g.id,''department_id'',d.id,''department'',d.name,''title'',g.title) order by d.name,g.title) from public.designations g join public.departments d on d.id=g.department_id),''[]''::jsonb),''department_options'',coalesce((select jsonb_agg(jsonb_build_object(''id'',id,''name'',name) order by name) from public.departments),''[]''::jsonb)) || (with candidates as (');
 if replacement=definition then raise exception 'Review the current profile dropdown function before migrating';end if;
 execute replacement;
end;
$options$;

-- Rebind row-type declarations and cached SQL plans to the compatibility views.
do $rebind$
declare routine record;
begin
 for routine in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','hrms_private') and p.prokind='f'
   and (p.prosrc ilike '%public.employees%' or p.prosrc ilike '%public.positions%')
 loop
  execute pg_get_functiondef(routine.oid);
 end loop;
end;
$rebind$;

notify pgrst,'reload schema';
