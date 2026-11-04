alter table public.employees
 add column if not exists record_status text,
 add column if not exists source_note text,
 add column leaving_date date;

create function public.set_employee_state_with_date(
 p_employee_id uuid, p_new_state text, p_reason text, p_leaving_date date
) returns text language plpgsql security invoker set search_path='' as $$
declare employee_number text;
begin
 if p_new_state='inactive' and (p_leaving_date is null or p_leaving_date > (now() at time zone 'Asia/Karachi')::date) then
  raise exception 'Enter a leaving date on or before today';
 end if;
 employee_number := public.set_employee_state(p_employee_id,p_new_state,p_reason);
 update public.employees set leaving_date=case when p_new_state='inactive' then p_leaving_date end
 where id=p_employee_id;
 if not found then raise exception 'Could not save leaving date'; end if;
 return employee_number;
end;
$$;
revoke all on function public.set_employee_state_with_date(uuid,text,text,date) from public;
grant execute on function public.set_employee_state_with_date(uuid,text,text,date) to authenticated;

CREATE OR REPLACE FUNCTION hrms_private.validate_family_member(p_member jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare v_name text; v_cnic text; v_age numeric; v_conditions text; v_birth_date text;
begin
 if p_member is null or jsonb_typeof(p_member)<>'object' then raise exception 'A dependant must be a single person' using errcode='22023'; end if;
 if exists(select 1 from jsonb_object_keys(p_member) k where k<>all(array['full_name','age','pre_existing_conditions','cnic','date_of_birth'])) then raise exception 'Unsupported dependant field' using errcode='22023'; end if;
 if jsonb_typeof(p_member->'full_name') is distinct from 'string' then raise exception 'Name is required' using errcode='22023'; end if;
 v_name=btrim(p_member->>'full_name');
 if v_name='' or length(v_name)>200 then raise exception 'Name must contain 1 to 200 characters' using errcode='22023'; end if;
 if jsonb_typeof(p_member->'age') is distinct from 'number' then raise exception 'Age in whole years is required' using errcode='22023'; end if;
 v_age=(p_member->>'age')::numeric;
 if v_age<0 or mod(v_age,1)<>0 then raise exception 'Age must be a non-negative whole number' using errcode='22023'; end if;
 if p_member?'cnic' and jsonb_typeof(p_member->'cnic') not in ('string','null') then raise exception 'CNIC must be text' using errcode='22023'; end if;
 v_cnic=regexp_replace(coalesce(p_member->>'cnic',''),'[-[:space:]]','','g');
 if v_age>=18 and v_cnic='' then raise exception 'CNIC is required for children aged 18 or older' using errcode='22023'; end if;
 if v_cnic<>'' and v_cnic!~'^[0-9]{13}$' then raise exception 'CNIC must contain 13 digits' using errcode='22023'; end if;
 if p_member?'pre_existing_conditions' and jsonb_typeof(p_member->'pre_existing_conditions') not in ('string','null') then raise exception 'Pre-existing conditions must be text' using errcode='22023'; end if;
 v_conditions=btrim(coalesce(p_member->>'pre_existing_conditions',''));
 if length(v_conditions)>4000 then raise exception 'Pre-existing conditions must be at most 4000 characters' using errcode='22023'; end if;
 v_birth_date := p_member->>'date_of_birth';
 if v_birth_date is not null then
  begin
   if v_birth_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or v_birth_date::date > (now() at time zone 'Asia/Karachi')::date then
    raise exception 'Enter a valid date of birth on or before today' using errcode='22023';
   end if;
  exception when invalid_datetime_format or datetime_field_overflow then
   raise exception 'Enter a valid date of birth' using errcode='22023';
  end;
 end if;
 return jsonb_build_object('full_name',v_name,'age',v_age,'pre_existing_conditions',v_conditions,'cnic',v_cnic) || case when v_birth_date is null then '{}'::jsonb else jsonb_build_object('date_of_birth',v_birth_date) end;
end $function$;
