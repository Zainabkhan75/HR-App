create or replace function public.apply_employee_bulk_upload_v2(p_rows jsonb,p_actor uuid,p_file_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $f$
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
   insert into public.employees(employee_no,full_name,department,designation,location,reports_to_text,employment_state)
   values(code,btrim(item->'core'->>'full_name'),btrim(item->'core'->>'department'),btrim(item->'core'->>'designation'),item->'core'->>'location',item->'core'->>'reports_to_text','active') returning id,updated_at into eid,stamp;
   insert into public.employee_details(employee_id,profile,payroll_aug_2026) values(eid,'{}'::jsonb,'{}'::jsonb);
   created:=created||jsonb_build_array(jsonb_build_object('reference',item->>'reference','employee_no',code,'name',item->'core'->>'full_name'));
   -- Existing import validators apply all profile, payroll and family fields.
   item:=item||jsonb_build_object('employee_no',code,'expected_core_updated_at',stamp,'expected_details_updated_at',(select updated_at from public.employee_details where employee_id=eid),'expected_family_updated_at',null,'replace',true);
  end if;
  normalized:=normalized||jsonb_build_array(item);
 end loop;
 result:=public.apply_employee_bulk_upload(normalized,p_actor,p_file_hash);
 return result||jsonb_build_object('created',created);
end $f$;
revoke all on function public.apply_employee_bulk_upload_v2(jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.apply_employee_bulk_upload_v2(jsonb,uuid,text) to service_role;