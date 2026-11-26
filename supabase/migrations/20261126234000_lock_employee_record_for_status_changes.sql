create or replace function public.set_employee_state(p_employee_id uuid, p_new_state text, p_reason text)
returns text language plpgsql security definer set search_path to '' as $$
declare
  employee public.employee_records%rowtype;
begin
  if not public.is_hr_admin() then raise exception 'Not authorised'; end if;
  if p_new_state is null or p_new_state not in ('active','inactive') then raise exception 'Invalid state'; end if;
  if length(btrim(coalesce(p_reason,''))) < 5 then raise exception 'Reason must have at least five characters'; end if;

  select * into employee from public.employee_records where id=p_employee_id for update;
  if not found then raise exception 'Employee not found'; end if;
  if employee.employment_state=p_new_state then raise exception 'Employee already has this status'; end if;

  update public.employees set employment_state=p_new_state where id=p_employee_id;
  insert into public.employee_action_audit(employee_id,employee_no,action,actor_id,reason)
  values(p_employee_id,employee.employee_no,case when p_new_state='active' then 'reactivate' else 'deactivate' end,auth.uid(),btrim(p_reason));
  return employee.employee_no;
end;
$$;
