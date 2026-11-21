-- Preserve the existing API columns during the transition to position-owned titles.
create or replace view public.employees as
select e.id,
       e.employee_no,
       e.full_name,
       case when e.position_id is not null then p.position_title
            else g.title end as designation,
       d.name as department,
       e.reports_to_text,
       e.location,
       e.created_at,
       e.updated_at,
       e.employment_state,
       e.record_status,
       e.source_note,
       e.leaving_date,
       e.position_id,
       e.designation_id,
       dpt.department_id
from public.employee_records e
left join public.position_records p on p.id = e.position_id
left join public.designations g on g.id = e.designation_id and e.position_id is null
cross join lateral (
  select case when e.position_id is not null then p.department_id
              else g.department_id end as department_id
) dpt
left join public.departments d on d.id = dpt.department_id;
