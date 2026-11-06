create table public.approved_designations (
  title text primary key check (title=btrim(title) and title<>'')
);
create unique index approved_designations_case_idx on public.approved_designations(lower(title));
alter table public.approved_designations enable row level security;
revoke all on public.approved_designations from public,anon,authenticated;
grant select on public.approved_designations to authenticated;
grant select,insert on public.approved_designations to service_role;
create policy "Signed-in users read designation options" on public.approved_designations
  for select to authenticated using ((select auth.uid()) is not null);

update public.employees e set designation=v.canonical,updated_at=now()
from (values ('Sale Advisor','Sales Advisor'),('Sales Adviser','Sales Advisor'),
 ('Sale Executive','Sales Executive'),('Sales Man','Salesman')) v(old_title,canonical)
where btrim(e.designation)=v.old_title;
update public.positions p set title=v.canonical
from (values ('Sale Advisor','Sales Advisor'),('Sales Adviser','Sales Advisor'),
 ('Sale Executive','Sales Executive'),('Sales Man','Salesman')) v(old_title,canonical)
where btrim(p.title)=v.old_title;

insert into public.approved_designations(title)
select min(btrim(designation)) from public.employees
where nullif(btrim(designation),'') is not null and lower(btrim(designation))<>'assitant manager'
group by lower(btrim(designation));

create function hrms_private.register_bulk_designation(p_title text)
returns text language plpgsql set search_path='' as $$
declare canonical text;
begin
  select title into canonical from public.approved_designations where lower(title)=lower(btrim(p_title));
  if found then return canonical; end if;
  canonical:=case lower(btrim(p_title))
   when 'sale advisor' then 'Sales Advisor'
   when 'sales adviser' then 'Sales Advisor'
   when 'sale executive' then 'Sales Executive'
   when 'sales man' then 'Salesman'
   when 'manager merchandiser' then 'Manager Merchandising'
   when 'admin manager' then 'Manager Administration'
   when 'hod it/erp' then 'Manager IT'
   when 'hr head' then 'Manager HR'
   when 'human resources' then 'Manager Human Resources'
   when 'store manager' then 'Branch Manager'
   else btrim(p_title) end;
  if canonical is null or canonical='' or lower(canonical)='assitant manager' then
   raise exception 'Enter an approved or correctly spelled designation';
  end if;
  insert into public.approved_designations(title) values(canonical) on conflict do nothing;
  select title into strict canonical from public.approved_designations where lower(title)=lower(canonical);
  return canonical;
end;
$$;
revoke all on function hrms_private.register_bulk_designation(text) from public,anon,authenticated;
grant usage on schema hrms_private to service_role;
grant execute on function hrms_private.register_bulk_designation(text) to service_role;

create function hrms_private.require_approved_designation()
returns trigger language plpgsql security definer set search_path='' as $$
declare proposed text; canonical text; previous text;
begin
  if tg_table_name='employees' then
    proposed:=new.designation;
    if tg_op='UPDATE' then previous:=old.designation; end if;
  else
    proposed:=new.profile->>'previous_designation';
    if tg_op='UPDATE' then previous:=old.profile->>'previous_designation'; end if;
  end if;
  if proposed is not distinct from previous or nullif(btrim(proposed),'') is null then return new; end if;
  select title into canonical from public.approved_designations where lower(title)=lower(btrim(proposed));
  if not found then
    raise exception 'Choose an approved designation. New designations can only be added by bulk uploading a new employee.' using errcode='22023';
  end if;
  if tg_table_name='employees' then new.designation:=canonical;
  else new.profile:=jsonb_set(new.profile,'{previous_designation}',to_jsonb(canonical)); end if;
  return new;
end;
$$;
revoke all on function hrms_private.require_approved_designation() from public,anon,authenticated;
create trigger employees_require_approved_designation before insert or update of designation on public.employees
for each row execute function hrms_private.require_approved_designation();
create trigger details_require_approved_previous_designation before insert or update of profile on public.employee_details
for each row execute function hrms_private.require_approved_designation();

CREATE OR REPLACE FUNCTION public.apply_september_employee_bulk_upload_v2(p_rows jsonb, p_actor uuid, p_file_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare item jsonb; normalized jsonb:='[]'::jsonb; created jsonb:='[]'::jsonb; code text; eid uuid; stamp timestamptz; result jsonb; marker text; name_key text; cnic_key text;
begin
 if p_actor is null or not exists(select 1 from public.user_roles where user_id=p_actor and role='hr_admin') then raise exception 'HR administrator required';end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>1000 or p_file_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid upload';end if;
 -- Serializes imports with normal inserts while checking duplicates again at commit.
 lock table public.employees in share row exclusive mode;
 for item in select value from jsonb_array_elements(p_rows) loop
  if coalesce(item->>'action','UPDATE') not in ('NEW','UPDATE') then raise exception 'Invalid action';end if;
  if item->>'action'='NEW' then
   if nullif(item->>'employee_no','') is not null then raise exception 'NEW employee ID must be blank';end if;
   if nullif(btrim(item->'core'->>'full_name'),'') is null or nullif(btrim(item->'core'->>'department'),'') is null or nullif(btrim(item->'core'->>'designation'),'') is null then raise exception 'New employee name, department and designation required';end if;
   if jsonb_typeof(item->'core')<>'object' or jsonb_typeof(item->'profile')<>'object' or jsonb_typeof(item->'payroll')<>'object' then raise exception 'Invalid field groups';end if;
   name_key:=regexp_replace(lower(item->'core'->>'full_name'),'[^a-z0-9]','','g');
   cnic_key:=regexp_replace(lower(coalesce(item->'profile'->>'cnic_passport','')),'[^a-z0-9]','','g');
   if exists(select 1 from public.employees e left join public.employee_details d on d.employee_id=e.id
     where regexp_replace(lower(e.full_name),'[^a-z0-9]','','g')=name_key
     or (cnic_key<>'' and regexp_replace(lower(coalesce(d.profile->>'cnic_passport','')),'[^a-z0-9]','','g')=cnic_key)
     or exists(select 1 from jsonb_each_text(coalesce(item->'profile','{}'::jsonb)) incoming
      where incoming.key in ('email','personal_email') and btrim(incoming.value)<>'' and lower(btrim(incoming.value)) in (lower(btrim(d.profile->>'email')),lower(btrim(d.profile->>'personal_email'))))
   ) then raise exception 'Possible duplicate for NEW %; review name, CNIC and emails',item->'core'->>'full_name';end if;
   code:=nextval('public.employee_number_sequence')::text;
   item:=jsonb_set(item,'{core,designation}',to_jsonb(hrms_private.register_bulk_designation(item->'core'->>'designation')));
   insert into public.employees(employee_no,full_name,department,designation,location,reports_to_text,employment_state)
   values(code,btrim(item->'core'->>'full_name'),btrim(item->'core'->>'department'),btrim(item->'core'->>'designation'),item->'core'->>'location',item->'core'->>'reports_to_text','active') returning id,updated_at into eid,stamp;
   insert into public.employee_details(employee_id,profile,payroll_sep_2026) values(eid,'{}'::jsonb,'{}'::jsonb);
   created:=created||jsonb_build_array(jsonb_build_object('reference',item->>'reference','employee_no',code,'name',item->'core'->>'full_name'));
   -- Existing import validators apply all profile, payroll and family fields.
   item:=item||jsonb_build_object('employee_no',code,'expected_core_updated_at',stamp,'expected_details_updated_at',(select updated_at from public.employee_details where employee_id=eid),'expected_family_updated_at',null,'replace',true);
  end if;
  normalized:=normalized||jsonb_build_array(item);
 end loop;
 result:=public.apply_september_employee_bulk_upload(normalized,p_actor,p_file_hash);
 return result||jsonb_build_object('created',created);
end $function$;

CREATE OR REPLACE FUNCTION public.apply_payroll_cycle(p_month date, p_actor uuid, p_employees jsonb, p_new jsonb, p_changes jsonb, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    item:=jsonb_set(item,'{designation}',to_jsonb(hrms_private.register_bulk_designation(item->>'designation')));
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
        where (mp.fields-'new_card'::text) is distinct from ((s.value->'fields')-'new_card'::text)) then
      raise exception 'Workbook pay figures differ from published payroll';
    end if;
    published := 0;
  else
    published := public.publish_monthly_payroll(p_month,slips,p_actor);
  end if;
  return jsonb_build_object('published',published,'changed',changed,'created',generated);
end;
$function$;

CREATE OR REPLACE FUNCTION hrms_private.my_profile_options()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not exists(select 1 from public.employee_accounts a join public.employees e on e.id=a.employee_id
  where a.user_id=auth.uid() and a.is_active and not a.must_change_password and e.employment_state<>'inactive') then
  raise exception 'Active employee sign-in required' using errcode='42501';
 end if;
 return (with candidates as (
   select approved.title as designation,e.employee_no,e.full_name,e.location
   from public.employees e join public.approved_designations approved on lower(approved.title)=lower(btrim(e.designation))
   where e.employment_state='active' and nullif(btrim(e.designation),'') is not null
   and not exists(select 1 from public.employee_accounts a where a.employee_id=e.id and a.user_id=auth.uid())
 ) select jsonb_build_object(
  'department',coalesce((select jsonb_agg(value order by value) from(select distinct department as value from public.employees where nullif(btrim(department),'') is not null)s),'[]'::jsonb),
  'location',coalesce((select jsonb_agg(value order by value) from(select distinct location as value from public.employees where nullif(btrim(location),'') is not null)s),'[]'::jsonb),
  'reports_to_text',coalesce((select jsonb_agg(value order by value) from (
   select title as value from public.approved_designations
  ) s),'[]'::jsonb),
  'line_managers',coalesce((select jsonb_agg(jsonb_build_object('designation',designation,'employee_no',employee_no,'name',full_name,'location',location) order by full_name,employee_no) from candidates),'[]'::jsonb),
  'employment_type',(select jsonb_agg(value order by value) from(select unnest(array['Permanent','Contractual','Consultant','Daily wages','Fixed-term']) as value union select distinct profile->>'employment_type' from public.employee_details where nullif(btrim(profile->>'employment_type'),'') is not null)s),
  'work_location_mobility',coalesce((select jsonb_agg(value order by value) from(select unnest(array['remote','on-site','hybrid','Wherever required as deemed appropriate by the company as per role']) as value union select distinct profile->>'work_location_mobility' as value from public.employee_details where nullif(btrim(profile->>'work_location_mobility'),'') is not null)s),'[]'::jsonb)
 ));
end $function$;
