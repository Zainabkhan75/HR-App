create or replace function public.create_organisation_position(
  p_title text, p_department_id bigint, p_designation_id bigint,
  p_reports_to_position_id bigint, p_location text
) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  position_id bigint;
begin
  if not coalesce(public.is_hr_admin(), false) then
    raise exception 'HR access required' using errcode = '42501';
  end if;
  if nullif(btrim(p_title), '') is null or p_department_id is null or p_reports_to_position_id is null then
    raise exception 'Enter a position title, department and reporting position' using errcode = '22023';
  end if;
  perform 1 from public.designations
    where id = p_designation_id and department_id = p_department_id for share;
  if not found then
    raise exception 'Choose a designation registered in the selected department' using errcode = '22023';
  end if;
  insert into public.position_records
    (position_title, department_id, designation_id, reports_to_position_id, location)
  values
    (btrim(p_title), p_department_id, p_designation_id, p_reports_to_position_id, nullif(btrim(p_location), ''))
  returning id into position_id;
  return position_id;
end;
$$;

revoke all on function public.create_organisation_position(text,bigint,bigint,bigint,text) from public, anon;
grant execute on function public.create_organisation_position(text,bigint,bigint,bigint,text) to authenticated;
