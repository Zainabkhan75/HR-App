create or replace function public.apply_payroll_cycle(
  p_month date, p_actor uuid, p_employees jsonb, p_new jsonb, p_changes jsonb, p_rows jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  item jsonb;
  employee public.employees%rowtype;
  ids jsonb := '{}'::jsonb;
  slips jsonb := '[]'::jsonb;
  generated jsonb := '[]'::jsonb;
  employee_id_value uuid;
  reference text;
  field_name text;
  new_value text;
  leaving date;
  changed integer := 0;
  published integer;
  existing_month boolean;
begin
  if not exists (select 1 from public.user_roles where user_id=p_actor and role='hr_admin') then
    raise exception 'HR administrator access required';
  end if;
  if p_month is null or p_month < date '2026-10-01' or extract(day from p_month) <> 1 then
    raise exception 'Invalid payroll month';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(260611, p_month - date '2026-10-01');
  existing_month := exists (select 1 from public.monthly_payroll where payroll_month=p_month);
  lock table public.employees in share row exclusive mode;
  for item in select value from jsonb_array_elements(p_employees) loop
    reference := item->>'reference';
    select * into strict employee from public.employees
      where id=(item->>'id')::uuid and employee_no=reference for update;
    if employee.updated_at is distinct from (item->>'updated_at')::timestamptz then
      raise exception 'Employee changed after preview';
    end if;
    ids := ids || jsonb_build_object(reference,employee.id);
  end loop;
  for item in select value from jsonb_array_elements(p_new) loop
    reference := item->>'reference';
    if ids ? reference or coalesce(btrim(item->>'name'),'')='' or coalesce(btrim(item->>'designation'),'')='' then
      raise exception 'Invalid new employee';
    end if;
    if exists (select 1 from public.employees e
      where regexp_replace(lower(e.full_name),'[^a-z0-9]','','g') =
            regexp_replace(lower(item->>'name'),'[^a-z0-9]','','g')) then
      raise exception 'Possible duplicate new employee';
    end if;
    insert into public.employees(employee_no,full_name,designation,employment_state)
      values (nextval('public.employee_number_sequence')::text,btrim(item->>'name'),btrim(item->>'designation'),'active')
      returning * into employee;
    insert into public.employee_details(employee_id) values(employee.id);
    ids := ids || jsonb_build_object(reference,employee.id);
    generated := generated || jsonb_build_array(jsonb_build_object('employee_no',employee.employee_no,'name',employee.full_name));
  end loop;
  for item in select value from jsonb_array_elements(p_changes) loop
    employee_id_value := (ids->>(item->>'reference'))::uuid;
    field_name := item->>'field';
    new_value := item->>'value';
    if employee_id_value is null or field_name is null or new_value is null or length(new_value)>1000 then
      raise exception 'Invalid employee change';
    end if;
    if field_name='deactivate' then
      leaving := nullif(new_value,'')::date;
      if leaving > (now() at time zone 'Asia/Karachi')::date then raise exception 'Future leaving date'; end if;
      select * into strict employee from public.employees where id=employee_id_value;
      update public.employees set employment_state='inactive',
        leaving_date=coalesce(leaving,employees.leaving_date),updated_at=now()
        where id=employee_id_value
          and (employment_state <> 'inactive' or (leaving is not null and leaving_date is distinct from leaving));
      if found then
        insert into public.employee_action_audit(employee_id,employee_no,action,actor_id,reason)
          values(employee_id_value,employee.employee_no,'deactivate',p_actor,'Approved payroll review for ' || p_month::text);
        changed := changed+1;
      end if;
    elsif field_name in ('designation','department','location') and btrim(new_value)<>'' then
      update public.employees set
        designation=case when field_name='designation' then new_value else designation end,
        department=case when field_name='department' then new_value else department end,
        location=case when field_name='location' then new_value else location end,
        updated_at=now()
        where id=employee_id_value and to_jsonb(employees)->>field_name is distinct from new_value;
      if found then changed := changed+1; end if;
    elsif field_name in ('date_of_joining','new_card','notes') and btrim(new_value)<>'' then
      if field_name='date_of_joining' then perform new_value::date; end if;
      insert into public.employee_details(employee_id,profile)
        values (employee_id_value,jsonb_build_object(field_name,new_value))
        on conflict (employee_id) do update set
          profile=jsonb_set(coalesce(employee_details.profile,'{}'::jsonb),array[field_name],
            to_jsonb(case when field_name='notes' then concat_ws(E'\n\n',nullif(employee_details.profile->>'notes',''),new_value) else new_value end)),
          updated_at=now()
        where case when field_name='notes' then strpos(coalesce(employee_details.profile->>'notes',''),new_value)=0 else employee_details.profile->>field_name is distinct from new_value end;
      if found then changed := changed+1; end if;
    else
      raise exception 'Unsupported employee change';
    end if;
  end loop;
  for item in select value from jsonb_array_elements(p_rows) loop
    employee_id_value := (ids->>(item->>'reference'))::uuid;
    if employee_id_value is null then raise exception 'Payroll employee missing'; end if;
    slips := slips || jsonb_build_array(jsonb_build_object('employee_id',employee_id_value,'fields',item->'fields'));
  end loop;
  if existing_month then
    if jsonb_array_length(p_new)<>0 or
       (select count(*) from public.monthly_payroll where payroll_month=p_month)<>jsonb_array_length(slips) or
       (select count(distinct value->>'employee_id') from jsonb_array_elements(slips))<>jsonb_array_length(slips) or
       exists (select 1 from jsonb_array_elements(slips) s
        left join public.monthly_payroll mp on mp.payroll_month=p_month and mp.employee_id=(s.value->>'employee_id')::uuid
        where (mp.fields-'new_card') is distinct from (s.value->'fields'-'new_card')) then
      raise exception 'Workbook pay figures differ from published payroll';
    end if;
    published := 0;
  else
    published := public.publish_monthly_payroll(p_month,slips,p_actor);
  end if;
  return jsonb_build_object('published',published,'changed',changed,'created',generated);
end;
$$;
revoke all on function public.apply_payroll_cycle(date,uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.apply_payroll_cycle(date,uuid,jsonb,jsonb,jsonb,jsonb) to service_role;
