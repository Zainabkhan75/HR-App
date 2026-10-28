-- Extend the atomic bulk upload transaction to spouse and child fields.
create or replace function hrms_private.apply_employee_bulk_family(p_rows jsonb,p_actor uuid,p_file_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 item jsonb;
 member_item jsonb;
 e public.employees%rowtype;
 f public.employee_family_details%rowtype;
 previous_family jsonb;
 spouse_value jsonb;
 children_value jsonb;
 old_member jsonb;
 new_member jsonb;
 member_type text;
 child_number integer;
 key_name text;
 value_text text;
 previous_value text;
 replace_existing boolean;
 member_changed boolean;
 family_changed boolean;
 age_value integer;
 cnic_value text;
 employee_count integer := 0;
 field_count integer := 0;
begin
 for item in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(item->'family') <> 'array' then raise exception 'Invalid family rows'; end if;
  if jsonb_array_length(item->'family') = 0 then continue; end if;
  select * into e from public.employees where employee_no=item->>'employee_no' for update;
  if not found then raise exception 'Employee ID missing for family'; end if;
  select * into f from public.employee_family_details where employee_id=e.id for update;
  if found then
   if f.updated_at is distinct from (item->>'expected_family_updated_at')::timestamptz then raise exception 'Family data changed: %',e.employee_no; end if;
   spouse_value := f.spouse;children_value := coalesce(f.children,'[]'::jsonb);
  else
   if item->>'expected_family_updated_at' is not null then raise exception 'Family data changed: %',e.employee_no; end if;
   spouse_value := null;children_value := '[]'::jsonb;
  end if;
  previous_family := jsonb_build_object('spouse',spouse_value,'children',children_value);
  family_changed := false;
  for member_item in select value from jsonb_array_elements(item->'family') loop
   member_type := member_item->>'type';child_number := coalesce((member_item->>'childNumber')::integer,0);
   if member_type not in ('Spouse','Child') then raise exception 'Invalid family member type'; end if;
   if member_type='Spouse' then old_member := spouse_value;
   else
    if child_number < 1 or child_number > 20 or child_number > jsonb_array_length(children_value)+1 then raise exception 'Invalid child number for %',e.employee_no; end if;
    old_member := children_value->(child_number-1);
   end if;
   new_member := coalesce(old_member,'{}'::jsonb);
   replace_existing := coalesce((member_item->>'replace')::boolean,false);
   member_changed := false;
   if jsonb_typeof(member_item->'values') <> 'object' then raise exception 'Invalid family fields'; end if;
   for key_name,value_text in select key,value from jsonb_each_text(member_item->'values') loop
    if key_name not in ('full_name','age','pre_existing_conditions','cnic') then raise exception 'Invalid family field'; end if;
    if nullif(btrim(value_text),'') is not null then
     previous_value := new_member->>key_name;
     if (nullif(btrim(coalesce(previous_value,'')),'') is null or replace_existing) and previous_value is distinct from value_text then
      new_member := new_member || jsonb_build_object(key_name,value_text);member_changed := true;field_count := field_count+1;
     end if;
    end if;
   end loop;
   if member_changed then
    if nullif(btrim(coalesce(new_member->>'full_name','')),'') is null or (new_member->>'age') !~ '^[0-9]+$' then raise exception 'Family member name and age required for %',e.employee_no; end if;
    age_value := (new_member->>'age')::integer;
    cnic_value := regexp_replace(coalesce(new_member->>'cnic',''),'[-[:space:]]','','g');
    if (member_type='Spouse' or age_value>=18) and cnic_value='' then raise exception 'Family CNIC required for %',e.employee_no; end if;
    if cnic_value<>'' and cnic_value !~ '^[0-9]{13}$' then raise exception 'Invalid family CNIC for %',e.employee_no; end if;
    new_member := jsonb_build_object('full_name',btrim(new_member->>'full_name'),'age',age_value,'pre_existing_conditions',coalesce(new_member->>'pre_existing_conditions',''),'cnic',cnic_value);
    if member_type='Spouse' then spouse_value := new_member;
    elsif old_member is null then children_value := children_value || jsonb_build_array(new_member);
    else children_value := jsonb_set(children_value,array[(child_number-1)::text],new_member);end if;
    family_changed := true;
   end if;
  end loop;
  if family_changed then
   insert into public.employee_family_details(employee_id,spouse,children,updated_at) values(e.id,spouse_value,children_value,now())
   on conflict (employee_id) do update set spouse=excluded.spouse,children=excluded.children,updated_at=now();
   insert into hrms_private.employee_bulk_upload_audit(employee_id,employee_no,actor_id,file_hash,before_snapshot,after_snapshot)
   values(e.id,e.employee_no,p_actor,p_file_hash,jsonb_build_object('family',previous_family),jsonb_build_object('family',jsonb_build_object('spouse',spouse_value,'children',children_value)));
   employee_count := employee_count+1;
  end if;
 end loop;
 return jsonb_build_object('employees',employee_count,'fields',field_count);
end;
$$;
revoke all on function hrms_private.apply_employee_bulk_family(jsonb,uuid,text) from public,anon,authenticated;
grant execute on function hrms_private.apply_employee_bulk_family(jsonb,uuid,text) to service_role;

create or replace function public.apply_employee_bulk_upload(p_rows jsonb,p_actor uuid,p_file_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare core_result jsonb;family_result jsonb;
begin
 core_result := hrms_private.apply_employee_bulk_upload(p_rows,p_actor,p_file_hash);
 family_result := hrms_private.apply_employee_bulk_family(p_rows,p_actor,p_file_hash);
 return jsonb_build_object('fields',coalesce((core_result->>'fields')::integer,0)+coalesce((family_result->>'fields')::integer,0));
end;
$$;
revoke all on function public.apply_employee_bulk_upload(jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.apply_employee_bulk_upload(jsonb,uuid,text) to service_role;
