create function public.create_employee_at_position(
 p_full_name text, p_position_id bigint, p_location text default null,
 p_source_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $employee$
declare
 employee_number text;
 employee_id uuid;
begin
 if not coalesce(public.is_hr_admin(),false) then
  raise exception 'HR administrator access required' using errcode='42501';
 end if;
 if p_position_id is null or not exists (
  select 1 from public.position_records where id=p_position_id
 ) then
  raise exception 'Select an existing position.' using errcode='22023';
 end if;
 employee_number := public.create_employee(p_full_name,p_location => p_location);
 update public.employees
 set position_id=p_position_id,source_note=nullif(btrim(p_source_note),'')
 where employee_no=employee_number
 returning id into strict employee_id;
 return employee_id;
end;
$employee$;

revoke all on function public.create_employee_at_position(text,bigint,text,text) from public, anon, authenticated;
grant execute on function public.create_employee_at_position(text,bigint,text,text) to authenticated;
