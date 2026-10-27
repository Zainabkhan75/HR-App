CREATE OR REPLACE FUNCTION hrms_private.validate_family_member(p_member jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare v_name text; v_cnic text; v_age numeric; v_conditions text;
begin
 if p_member is null or jsonb_typeof(p_member)<>'object' then raise exception 'A dependant must be a single person' using errcode='22023'; end if;
 if exists(select 1 from jsonb_object_keys(p_member) k where k<>all(array['full_name','age','pre_existing_conditions','cnic'])) then raise exception 'Unsupported dependant field' using errcode='22023'; end if;
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
 return jsonb_build_object('full_name',v_name,'age',v_age,'pre_existing_conditions',v_conditions,'cnic',v_cnic);
end $function$
;
create or replace function public.save_my_family_details(p_spouse jsonb,p_children jsonb,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $f$
begin
 if p_spouse is not null and p_spouse<>'null'::jsonb then
  if coalesce(hrms_private.validate_family_member(p_spouse)->>'cnic','')='' then
   raise exception 'CNIC is required for every spouse' using errcode='22023';
  end if;
 end if;
 return hrms_private.save_my_family_details(p_spouse,p_children,p_expected_updated_at);
end $f$;
revoke all on function public.save_my_family_details(jsonb,jsonb,timestamptz) from public,anon;
grant execute on function public.save_my_family_details(jsonb,jsonb,timestamptz) to authenticated;