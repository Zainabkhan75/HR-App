begin;
-- Validate dropdown/date/probation input through the API wrapper; keep the existing
-- privileged own-record save implementation and its isolation/locking unchanged.
create function hrms_private.prepare_profile_patch(p_patch jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $f$
declare v_patch jsonb; v_options jsonb; v_current jsonb; v_type text; v_key text; v_value jsonb;
begin
 if p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'Profile changes must be an object' using errcode='22023'; end if;
 v_patch=p_patch;
 v_options=hrms_private.my_profile_options();
 if lower(btrim(v_patch->>'employment_type'))='permanent' then v_patch=v_patch||'{"probation":"3"}'::jsonb; end if;
 for v_key,v_value in select key,value from jsonb_each(v_patch) loop
  if v_key=any(array['department','location','reports_to_text','employment_type','work_location_mobility'])
   and coalesce(v_value#>>'{}','')<>'' and not((v_options->v_key)?(v_value#>>'{}')) then
   raise exception 'Choose a value from the available dropdown list' using errcode='22023';
  end if;
 end loop;
 if v_patch?'probation' then
  v_current=hrms_private.my_employee_profile();
  v_type=lower(btrim(case when v_patch?'employment_type' then v_patch->>'employment_type' else coalesce(v_current->'employment'->>'employment_type','') end));
  if v_type='permanent' and v_patch->>'probation'<>'3' then raise exception 'Permanent employment uses 3 months probation' using errcode='22023'; end if;
  if v_type<>'permanent' and coalesce(v_patch->>'probation','')<>'' and v_patch->>'probation'!~'^[0-6]$' then raise exception 'Probation must be a whole number from 0 to 6 months' using errcode='22023'; end if;
 end if;
 if v_patch?'date_of_joining' and coalesce(v_patch->>'date_of_joining','')<>'' then
  if v_patch->>'date_of_joining'!~'^[0-9]{2}/[0-9]{2}/[0-9]{4}$' then raise exception 'Use DD/MM/YYYY for date of joining' using errcode='22023'; end if;
  begin
   perform make_date(split_part(v_patch->>'date_of_joining','/',3)::integer,split_part(v_patch->>'date_of_joining','/',2)::integer,split_part(v_patch->>'date_of_joining','/',1)::integer);
  exception when others then raise exception 'Enter a valid joining date in DD/MM/YYYY format' using errcode='22023';
  end;
 end if;
 return v_patch;
end $f$;
revoke all on function hrms_private.prepare_profile_patch(jsonb) from public,anon,authenticated;
grant execute on function hrms_private.prepare_profile_patch(jsonb) to authenticated;
create or replace function public.update_my_employee_profile(p_patch jsonb,p_expected_core_updated_at timestamptz,p_expected_profile_updated_at timestamptz)
returns jsonb language sql security invoker set search_path='' as $f$
 select hrms_private.update_my_employee_profile(hrms_private.prepare_profile_patch(p_patch),p_expected_core_updated_at,p_expected_profile_updated_at);
$f$;
revoke all on function public.update_my_employee_profile(jsonb,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.update_my_employee_profile(jsonb,timestamptz,timestamptz) to authenticated;
commit;
