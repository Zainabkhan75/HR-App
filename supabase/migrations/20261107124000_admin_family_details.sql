create function hrms_private.save_family_details(p_employee_id uuid,p_spouse jsonb,p_children jsonb,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare v_id uuid:=p_employee_id; v_row public.employee_family_details%rowtype; v_spouse jsonb;
 v_children jsonb:='[]'::jsonb; v_child jsonb;
begin
 if p_spouse is not null and p_spouse<>'null'::jsonb then
  v_spouse=hrms_private.validate_family_member(p_spouse);
  if v_spouse->>'cnic'='' then raise exception 'CNIC is required for every spouse' using errcode='22023'; end if;
 end if;
 if p_children is null or jsonb_typeof(p_children)<>'array' then raise exception 'Children must be a list' using errcode='22023'; end if;
 for v_child in select value from jsonb_array_elements(p_children) loop
  v_children=v_children||jsonb_build_array(hrms_private.validate_family_member(v_child));
 end loop;
 select * into v_row from public.employee_family_details where employee_id=v_id for update;
 if v_row.updated_at is distinct from p_expected_updated_at then raise exception 'Family details changed elsewhere. Reload before saving.' using errcode='40001'; end if;
 if v_row.employee_id is not null and v_row.spouse is not distinct from v_spouse and v_row.children=v_children then return jsonb_build_object('spouse',v_row.spouse,'children',v_row.children,'updated_at',v_row.updated_at); end if;
 insert into public.employee_family_details(employee_id,spouse,children,updated_at)
 values(v_id,v_spouse,v_children,clock_timestamp())
 on conflict(employee_id) do update set spouse=excluded.spouse,children=excluded.children,updated_at=clock_timestamp() returning * into v_row;
 insert into public.employee_family_updates(employee_id,actor_id,spouse_recorded,children_count)
 values(v_id,auth.uid(),v_spouse is not null,jsonb_array_length(v_children));
 return jsonb_build_object('spouse',v_row.spouse,'children',v_row.children,'updated_at',v_row.updated_at);
end $function$;
revoke all on function hrms_private.save_family_details(uuid,jsonb,jsonb,timestamptz) from public,anon,authenticated;

create or replace function hrms_private.save_my_family_details(p_spouse jsonb,p_children jsonb,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_id uuid;
begin
 select e.id into v_id from public.employee_accounts a join public.employees e on e.id=a.employee_id
 where a.user_id=auth.uid() and a.is_active and not a.must_change_password and e.employment_state<>'inactive'
 for share of a for update of e;
 if v_id is null then raise exception 'Active employee sign-in required' using errcode='42501'; end if;
 return hrms_private.save_family_details(v_id,p_spouse,p_children,p_expected_updated_at);
end $function$;

create function public.save_employee_family_details(p_employee_id uuid,p_spouse jsonb,p_children jsonb,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
 if not coalesce(public.is_hr_admin(),false) then
  raise exception 'HR administrator access required' using errcode='42501';
 end if;
 perform 1 from public.employees where id=p_employee_id and employment_state='active' for update;
 if not found then raise exception 'Select an active employee' using errcode='22023'; end if;
 return hrms_private.save_family_details(p_employee_id,p_spouse,p_children,p_expected_updated_at);
end $function$;
revoke all on function public.save_employee_family_details(uuid,jsonb,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.save_employee_family_details(uuid,jsonb,jsonb,timestamptz) to authenticated;
