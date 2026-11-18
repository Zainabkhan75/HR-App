begin;

create function hrms_private.default_employee_gender()
returns trigger language plpgsql set search_path=''
as $$
begin
 new.profile:=coalesce(new.profile,'{}'::jsonb);
 if coalesce(new.profile->>'gender','')='' then
  new.profile:=jsonb_set(new.profile,'{gender}','"Male"');
 end if;
 if new.profile->>'gender' not in ('Male','Female') then
  raise exception 'Gender must be Male or Female' using errcode='22023';
 end if;
 return new;
end;
$$;
revoke all on function hrms_private.default_employee_gender() from public,anon,authenticated;
create trigger employee_gender_default before insert or update of profile on public.employee_details
for each row execute function hrms_private.default_employee_gender();
update public.employee_details set profile=jsonb_set(coalesce(profile,'{}'::jsonb),'{gender}','"Male"'),updated_at=clock_timestamp()
where coalesce(profile->>'gender','')='';

-- Retain the existing profile authorization and validation functions.
do $$
declare name text; definition text;
begin
 foreach name in array array['hrms_private.my_employee_profile()','hrms_private.update_my_employee_profile(jsonb,timestamptz,timestamptz)'] loop
  definition:=pg_get_functiondef(name::regprocedure);
  if position('''cnic_passport'',''email''' in definition)=0 then
   raise exception 'Profile field list changed. Review before adding Gender.';
  end if;
  definition:=replace(definition,'''cnic_passport'',''email''','''gender'',''cnic_passport'',''email''');
  execute definition;
 end loop;
end;
$$;

alter table public.employee_family_details add column marital_status text
check(marital_status in ('Single','Married'));
update public.employee_family_details set marital_status='Married',updated_at=clock_timestamp()
where spouse is not null or jsonb_array_length(coalesce(children,'[]'::jsonb))>0;

create or replace function hrms_private.my_family_details()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare employee uuid; family public.employee_family_details%rowtype;
begin
 select e.id into employee from public.employee_accounts a join public.employees e on e.id=a.employee_id
 where a.user_id=auth.uid() and a.is_active and not a.must_change_password and e.employment_state<>'inactive';
 if employee is null then raise exception 'Active employee sign-in required' using errcode='42501'; end if;
 select * into family from public.employee_family_details where employee_id=employee;
 return jsonb_build_object('spouse',family.spouse,'children',coalesce(family.children,'[]'::jsonb),
  'marital_status',family.marital_status,'updated_at',family.updated_at);
end;
$$;

create function public.save_family_with_marital_status(
 p_employee_id uuid,p_marital_status text,p_spouse jsonb,p_children jsonb,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare employee uuid; family public.employee_family_details%rowtype; saved jsonb;
begin
 if p_marital_status is null or p_marital_status not in ('Single','Married') then
  raise exception 'Choose Single or Married' using errcode='22023';
 end if;
 if p_employee_id is not null then
  if not coalesce(public.is_hr_admin(),false) then raise exception 'HR administrator access required' using errcode='42501'; end if;
  select id into employee from public.employees where id=p_employee_id and employment_state='active' for update;
 else
  select e.id into employee from public.employee_accounts a join public.employees e on e.id=a.employee_id
  where a.user_id=auth.uid() and a.is_active and not a.must_change_password and e.employment_state='active'
  for share of a for update of e;
 end if;
 if employee is null then raise exception 'Active employee access required' using errcode='42501'; end if;
 select * into family from public.employee_family_details where employee_id=employee for update;
 if family.updated_at is distinct from p_expected_updated_at then
  raise exception 'Family details changed elsewhere. Reload before saving.' using errcode='40001';
 end if;
 if p_marital_status='Married' then
  saved:=hrms_private.save_family_details(employee,p_spouse,p_children,p_expected_updated_at);
 else
  -- Existing dependants remain available if the marital status is corrected later.
  if family.employee_id is null then
   insert into public.employee_family_details(employee_id,spouse,children) values(employee,null,'[]'::jsonb);
  end if;
 end if;
 update public.employee_family_details set marital_status=p_marital_status,updated_at=clock_timestamp()
 where employee_id=employee returning * into family;
 return jsonb_build_object('spouse',family.spouse,'children',family.children,
  'marital_status',family.marital_status,'updated_at',family.updated_at);
end;
$$;
revoke all on function public.save_family_with_marital_status(uuid,text,jsonb,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.save_family_with_marital_status(uuid,text,jsonb,jsonb,timestamptz) to authenticated;

commit;
