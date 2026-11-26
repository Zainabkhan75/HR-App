-- Resolve the first occupied reporting position for each seat, including shared seats.
create or replace view hrms_private.position_reporting_contacts as
with recursive chain(seat_id, ancestor_id, visited) as (
  select id, reports_to_position_id, array[id]
  from public.position_records
  where not coalesce(is_reporting_root,false) and reports_to_position_id <> id
  union all
  select c.seat_id, p.reports_to_position_id, c.visited || p.id
  from chain c
  join public.position_records p on p.id = c.ancestor_id
  where not coalesce(p.is_reporting_root,false)
    and p.reports_to_position_id <> all(c.visited || p.id)
    and not exists (select 1 from public.employee_records holder
                    where holder.position_id=p.id and holder.employment_state='active')
)
select c.seat_id, p.id as manager_position_id, p.position_title as manager_title,
       holder.id as manager_id, holder.employee_no as manager_no, holder.full_name as manager_name
from chain c
join public.position_records p on p.id=c.ancestor_id
join public.employee_records holder on holder.position_id=p.id and holder.employment_state='active';

create or replace view hrms_private.leave_reporting_links as
select c.manager_id as manager_employee_id, e.id as member_employee_id
from public.employee_records e
join hrms_private.position_reporting_contacts c on c.seat_id=e.position_id
where e.employment_state='active';

create or replace view hrms_private.employee_reporting_hierarchy as
select e.id as employee_id, d.name as department,
       coalesce(c.manager_title,parent.position_title) as manager_title,
       c.manager_name, c.manager_no,
       case when seat.id is null then 'position_unassigned'
            when seat.is_reporting_root then 'root'
            when parent.id is null then 'parent_unassigned'
            when c.manager_id is null then 'vacant'
            else 'occupied' end as status
from public.employee_records e
left join public.position_records seat on seat.id=e.position_id
left join public.departments d on d.id=seat.department_id
left join public.position_records parent on parent.id=seat.reports_to_position_id
left join hrms_private.position_reporting_contacts c on c.seat_id=seat.id;

create or replace function public.my_team_summary()
returns table(employee_no text, full_name text, designation text, department text)
language sql stable security definer set search_path to '' as $$
  select e.employee_no,e.full_name,e.designation,e.department
  from public.employee_accounts a
  join hrms_private.leave_reporting_links m on m.manager_employee_id=a.employee_id
  join public.employees e on e.id=m.member_employee_id
  join public.user_roles r on r.user_id=a.user_id and r.role='manager'
  where a.user_id=(select auth.uid()) and a.is_active
  order by e.full_name
$$;
