begin;
alter table public.employees alter column employment_state set default 'active';
alter table public.employees drop constraint employees_employment_state_check;
alter table public.employees add constraint employees_employment_state_check check (employment_state in ('active','inactive'));
CREATE OR REPLACE FUNCTION public.apply_employee_bulk_upload(p_rows jsonb, p_actor uuid, p_file_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare core_result jsonb;family_result jsonb;
begin
 core_result := hrms_private.apply_employee_bulk_upload(p_rows,p_actor,p_file_hash);
 family_result := hrms_private.apply_employee_bulk_family(p_rows,p_actor,p_file_hash);
 return jsonb_build_object('fields',coalesce((core_result->>'fields')::integer,0)+coalesce((family_result->>'fields')::integer,0));
end;
$function$
;
CREATE OR REPLACE FUNCTION hrms_private.apply_employee_bulk_upload(p_rows jsonb, p_actor uuid, p_file_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 item jsonb;
 e public.employees%rowtype;
 d public.employee_details%rowtype;
 key_name text;
 value_text text;
 previous_value text;
 new_core jsonb;
 new_profile jsonb;
 new_payroll jsonb;
 before_value jsonb;
 employee_count integer := 0;
 field_count integer := 0;
 replace_existing boolean;
begin
 if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 1000 then
  raise exception 'Invalid upload row count';
 end if;
 if p_actor is null or p_file_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid upload metadata'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(item) <> 'object' then raise exception 'Invalid upload row'; end if;
  select * into e from public.employees where employee_no=item->>'employee_no' for update;
  if not found then raise exception 'Employee ID missing: %',item->>'employee_no'; end if;
  select * into d from public.employee_details where employee_id=e.id for update;
  if not found then raise exception 'Details missing for employee %',e.employee_no; end if;
  if e.updated_at is distinct from (item->>'expected_core_updated_at')::timestamptz
   or d.updated_at is distinct from (item->>'expected_details_updated_at')::timestamptz then
   raise exception 'Employee data changed: %',e.employee_no;
  end if;
  if jsonb_typeof(item->'core') <> 'object' or jsonb_typeof(item->'profile') <> 'object' or jsonb_typeof(item->'payroll') <> 'object' then
   raise exception 'Invalid field groups for %',e.employee_no;
  end if;
  replace_existing := coalesce((item->>'replace')::boolean,false);
  new_core := '{}'::jsonb;
  new_profile := coalesce(d.profile,'{}'::jsonb);
  new_payroll := coalesce(d.payroll_aug_2026,'{}'::jsonb);
  before_value := jsonb_build_object('core',to_jsonb(e),'profile',d.profile,'payroll',d.payroll_aug_2026);
  for key_name,value_text in select key,value from jsonb_each_text(item->'core') loop
   if key_name not in ('full_name','designation','department','reports_to_text','location') then raise exception 'Invalid core field'; end if;
   if nullif(btrim(value_text),'') is not null then
    previous_value := to_jsonb(e)->>key_name;
    if (nullif(btrim(coalesce(previous_value,'')),'') is null or replace_existing) and previous_value is distinct from value_text then
     new_core := new_core || jsonb_build_object(key_name,value_text);field_count := field_count+1;
    end if;
   end if;
  end loop;
  for key_name,value_text in select key,value from jsonb_each_text(item->'profile') loop
   if key_name !~ '^[a-z][a-z0-9_]{0,100}$' then raise exception 'Invalid profile field'; end if;
   if nullif(btrim(value_text),'') is not null then
    previous_value := new_profile->>key_name;
    if (nullif(btrim(coalesce(previous_value,'')),'') is null or replace_existing) and previous_value is distinct from value_text then
     new_profile := new_profile || jsonb_build_object(key_name,value_text);field_count := field_count+1;
    end if;
   end if;
  end loop;
  for key_name,value_text in select key,value from jsonb_each_text(item->'payroll') loop
   if key_name !~ '^[a-z][a-z0-9_]{0,100}$' then raise exception 'Invalid payroll field'; end if;
   if nullif(btrim(value_text),'') is not null then
    previous_value := new_payroll->>key_name;
    if (nullif(btrim(coalesce(previous_value,'')),'') is null or replace_existing) and previous_value is distinct from value_text then
     new_payroll := new_payroll || jsonb_build_object(key_name,value_text);field_count := field_count+1;
    end if;
   end if;
  end loop;
  if new_core <> '{}'::jsonb or new_profile is distinct from coalesce(d.profile,'{}'::jsonb) or new_payroll is distinct from coalesce(d.payroll_aug_2026,'{}'::jsonb) then
   update public.employees set
    full_name=coalesce(new_core->>'full_name',full_name),designation=coalesce(new_core->>'designation',designation),
    department=coalesce(new_core->>'department',department),reports_to_text=coalesce(new_core->>'reports_to_text',reports_to_text),
    location=coalesce(new_core->>'location',location),updated_at=now()
   where id=e.id;
   update public.employee_details set profile=new_profile,payroll_aug_2026=new_payroll,updated_at=now() where employee_id=e.id;
   insert into hrms_private.employee_bulk_upload_audit(employee_id,employee_no,actor_id,file_hash,before_snapshot,after_snapshot)
   values(e.id,e.employee_no,p_actor,p_file_hash,before_value,jsonb_build_object('core',new_core,'profile',new_profile,'payroll',new_payroll));
   employee_count := employee_count+1;
  end if;
 end loop;
 return jsonb_build_object('employees',employee_count,'fields',field_count);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_employee(p_full_name text, p_designation text DEFAULT NULL::text, p_department text DEFAULT NULL::text, p_reports_to_text text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_record_status text DEFAULT NULL::text, p_source_note text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n bigint;code text;
begin
if not public.is_hr_admin() then raise exception 'Not authorised';end if;
if nullif(btrim(p_full_name),'') is null then raise exception 'Employee name is required';end if;
n:=nextval('public.employee_number_sequence');code:=n::text;
insert into public.employees(employee_no,full_name,designation,department,reports_to_text,location)
values(code,btrim(p_full_name),nullif(btrim(p_designation),''),nullif(btrim(p_department),''),nullif(btrim(p_reports_to_text),''),nullif(btrim(p_location),''));
return code;
end $function$
;
alter table public.employees drop column record_status, drop column source_note;
commit;