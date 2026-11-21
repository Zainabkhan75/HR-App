CREATE OR REPLACE FUNCTION hrms_private.apply_september_employee_bulk_upload(p_rows jsonb, p_actor uuid, p_file_hash text)
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
  new_payroll := coalesce(d.payroll_sep_2026,'{}'::jsonb);
  before_value := jsonb_build_object('core',to_jsonb(e),'profile',d.profile,'payroll',d.payroll_sep_2026);
  for key_name,value_text in select key,value from jsonb_each_text(item->'core') loop
   if key_name not in ('full_name','position_id','designation','department','reports_to_text','location','record_status','source_note') then raise exception 'Invalid core field'; end if;
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
  if new_core <> '{}'::jsonb or new_profile is distinct from coalesce(d.profile,'{}'::jsonb) or new_payroll is distinct from coalesce(d.payroll_sep_2026,'{}'::jsonb) then
   update public.employees set
    full_name=coalesce(new_core->>'full_name',full_name),position_id=coalesce((new_core->>'position_id')::bigint,position_id),designation=coalesce(new_core->>'designation',designation),
    department=coalesce(new_core->>'department',department),reports_to_text=coalesce(new_core->>'reports_to_text',reports_to_text),
    location=coalesce(new_core->>'location',location),record_status=coalesce(new_core->>'record_status',record_status),
    source_note=coalesce(new_core->>'source_note',source_note),updated_at=now()
   where id=e.id;
   update public.employee_details set profile=new_profile,payroll_sep_2026=new_payroll,updated_at=now() where employee_id=e.id;
   insert into hrms_private.employee_bulk_upload_audit(employee_id,employee_no,actor_id,file_hash,before_snapshot,after_snapshot)
   values(e.id,e.employee_no,p_actor,p_file_hash,before_value,jsonb_build_object('core',new_core,'profile',new_profile,'payroll',new_payroll));
   employee_count := employee_count+1;
  end if;
 end loop;
 return jsonb_build_object('employees',employee_count,'fields',field_count);
end;
$function$

