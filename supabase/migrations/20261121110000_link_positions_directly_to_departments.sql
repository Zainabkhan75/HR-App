set local search_path = public, pg_catalog;
alter table public.position_records add column department_id bigint references public.departments(id) on delete restrict;
update public.position_records p set department_id=d.department_id from public.designations d where d.id=p.designation_id;
alter table public.position_records alter column department_id set not null;
create index position_records_department_idx on public.position_records(department_id);
create function hrms_private.default_position_department() returns trigger language plpgsql set search_path='' as $dept$
begin
 if new.department_id is null then
  select d.department_id into strict new.department_id from public.designations d where d.id=new.designation_id;
 end if;
 return new;
end;
$dept$;
create trigger default_position_department before insert on public.position_records
for each row execute function hrms_private.default_position_department();
create or replace view public.positions as
select p.id,p.department_id,p.position_title as title,p.location,p.reports_to_position_id,p.designation_id,p.position_code
from public.position_records p;
create or replace view public.employees as  SELECT id,
    employee_no,
    full_name,
    ( SELECT g.title
           FROM designations g
          WHERE g.id = e.designation_id) AS designation,
    ( SELECT d.name
           FROM designations g
             JOIN departments d ON d.id = coalesce((select p.department_id from public.position_records p where p.id=e.position_id),g.department_id)
          WHERE g.id = e.designation_id) AS department,
    reports_to_text,
    location,
    created_at,
    updated_at,
    employment_state,
    record_status,
    source_note,
    leaving_date,
    position_id,
    designation_id,
    ( SELECT coalesce((select p.department_id from public.position_records p where p.id=e.position_id),g.department_id)
           FROM designations g
          WHERE g.id = e.designation_id) AS department_id
   FROM employee_records e;
create or replace view hrms_private.employee_reporting_hierarchy as  SELECT e.id AS employee_id,
    d.name AS department,
    parent.title AS manager_title,
    manager.full_name AS manager_name,
    manager.employee_no AS manager_no,
        CASE
            WHEN seat.id IS NULL THEN 'position_unassigned'::text
            WHEN seat.is_reporting_root THEN 'root'::text
            WHEN parent.id IS NULL THEN 'parent_unassigned'::text
            WHEN manager.id IS NULL THEN 'vacant'::text
            ELSE 'occupied'::text
        END AS status
   FROM employee_records e
     LEFT JOIN position_records seat ON seat.id = e.position_id
     LEFT JOIN departments d ON d.id = seat.department_id
     LEFT JOIN positions parent ON parent.id = seat.reports_to_position_id
     LEFT JOIN employee_records manager ON manager.position_id = parent.id AND manager.employment_state = 'active'::text;
CREATE OR REPLACE FUNCTION hrms_private.write_position_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  new.title is distinct from old.title then
  assignment:=hrms_private.designation_for_assignment((select name from public.departments where id=new.department_id),new.title);
 end if;
 if tg_op='INSERT' then
  insert into public.position_records(designation_id,location,reports_to_position_id,department_id,position_title)
  values(assignment,new.location,new.reports_to_position_id,new.department_id,new.title) returning id into result_id;
 else
  update public.position_records set designation_id=assignment,department_id=new.department_id,position_title=new.title,location=new.location,reports_to_position_id=new.reports_to_position_id
  where id=old.id returning id into result_id;
 end if;
 select * into new from public.positions where id=result_id;return new;
end;
$function$;
