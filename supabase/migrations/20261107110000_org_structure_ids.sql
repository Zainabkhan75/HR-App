create table public.departments (
  id bigint generated always as identity primary key,
  name text not null check (btrim(name) <> '')
);
create unique index departments_normalized_name_idx on public.departments (lower(btrim(name)));

create table public.positions (
  id bigint generated always as identity primary key,
  department_id bigint not null references public.departments(id) on delete restrict,
  title text not null check (btrim(title) <> ''),
  location text,
  reports_to_position_id bigint references public.positions(id) on delete restrict,
  check (reports_to_position_id is distinct from id)
);
create index positions_department_idx on public.positions(department_id);
create index positions_reports_to_idx on public.positions(reports_to_position_id);
alter table public.employees add column position_id bigint references public.positions(id) on delete restrict;
create unique index employees_active_position_idx on public.employees(position_id)
  where employment_state='active' and position_id is not null;

alter table public.departments enable row level security;
alter table public.positions enable row level security;
revoke all on public.departments,public.positions from public,anon,authenticated;
grant select on public.departments,public.positions to authenticated;
grant select,insert,update on public.departments,public.positions to service_role;
grant usage on sequence public.departments_id_seq,public.positions_id_seq to service_role;
create policy "HR reads departments" on public.departments for select to authenticated using ((select public.is_hr_admin()));
create policy "HR reads positions" on public.positions for select to authenticated using ((select public.is_hr_admin()));

create function hrms_private.check_position_reporting_cycle()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.reports_to_position_id is null then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(260611, 20261107);
  if exists (
    with recursive ancestors(id) as (
      select new.reports_to_position_id
      union
      select p.reports_to_position_id from public.positions p
      join ancestors a on a.id=p.id where p.reports_to_position_id is not null
    )
    select 1 from ancestors where id=new.id
  ) then
    raise exception 'Position reporting lines cannot form a cycle' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function hrms_private.check_position_reporting_cycle() from public,anon,authenticated;
create trigger check_position_reporting_cycle
before insert or update of reports_to_position_id on public.positions
for each row execute function hrms_private.check_position_reporting_cycle();

insert into public.departments(name)
select min(btrim(department)) from public.employees
where nullif(btrim(department),'') is not null
group by lower(btrim(department)) order by lower(btrim(department));

-- One independently numbered seat per active employee at initialization.
-- Confirm position-to-position reporting links in the org-chart workflow.
do $$
declare occupant record; seat bigint;
begin
  for occupant in
    select e.id,btrim(e.designation) as title,e.location,d.id as department_id
    from public.employees e join public.departments d on lower(btrim(d.name))=lower(btrim(e.department))
    where e.employment_state='active' and nullif(btrim(e.designation),'') is not null
    order by e.employee_no
  loop
    insert into public.positions(department_id,title,location)
      values(occupant.department_id,occupant.title,occupant.location) returning id into seat;
    update public.employees set position_id=seat where id=occupant.id;
  end loop;
end;
$$;

CREATE OR REPLACE FUNCTION hrms_private.my_employee_profile()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_employee public.employees%rowtype; v_detail public.employee_details%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 select e.* into v_employee from public.employee_accounts a
 join public.employees e on e.id=a.employee_id
 where a.user_id=auth.uid() and a.is_active and not a.must_change_password
 and e.employment_state<>'inactive';
 if not found then raise exception 'An active employee account and completed password setup are required' using errcode='42501'; end if;
 select * into v_detail from public.employee_details where employee_id=v_employee.id;
 return jsonb_build_object(
  'employee',jsonb_build_object('employee_no',v_employee.employee_no,'full_name',v_employee.full_name,
   'designation',v_employee.designation,'department',v_employee.department,'location',v_employee.location,
   'reports_to_text',v_employee.reports_to_text,'employment_state',v_employee.employment_state,'leaving_date',v_employee.leaving_date,'source_note',v_employee.source_note),
  'contacts',coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(v_detail.profile,'{}'::jsonb))
   where key=any(array['mobile','personal_mobile','personal_email','personal_address'])),'{}'::jsonb),
  'personal',coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(v_detail.profile,'{}'::jsonb))
   where key=any(array['cnic_passport','email','date_of_birth','permanent_address','emergency_contact_full_name','emergency_contact_relationship','primary_emergency_contact_number','alternative_emergency_number','previous_employer_company_name','previous_designation','previous_employment_start','previous_employment_end','highest_qualification_level','latest_education','education_start','education_end'])),'{}'::jsonb),
  'employment',coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(v_detail.profile,'{}'::jsonb))
   where key=any(array['line_manager_employee_no','employment_type','date_of_joining','work_location_mobility','probation','offer_date','acceptance_joining_confirmation_due'])),'{}'::jsonb),
  'rewards',coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(v_detail.profile,'{}'::jsonb))
   where key=any(array['medical_hospitalisation_limit_person_year_pkr','life_insurance','car_entitlement','salary_transfer_method','bank_name','bank_branch','bank_account_title','bank_account_number','iban'])),'{}'::jsonb),
  'payroll_sep_2026',coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(v_detail.payroll_sep_2026,'{}'::jsonb))
   where key=any(array['new_card','no_days','gross_fixed_salary_rs','salary_earned_rs','over_time_minutes','over_time_incentive_variable_pay','bonus_others','deductions_loans_others','salary_arrears_others','fuel_allowance_vehicle_allow','total_compensation_rs','wht_tax_deductions_rs','lease_instalment_other_deduction','provident_fund_deductions','payable_salary_rs'])), '{}'::jsonb),
  'core_updated_at',v_employee.updated_at, 'profile_updated_at',v_detail.updated_at
 );
end $function$;

CREATE OR REPLACE FUNCTION hrms_private.update_my_employee_profile(p_patch jsonb, p_expected_core_updated_at timestamp with time zone, p_expected_profile_updated_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_employee public.employees%rowtype; v_detail public.employee_details%rowtype;
 v_reporting_title text; v_manager_number text;
 v_key text; v_value jsonb; v_patch jsonb:='{}'::jsonb; v_details_patch jsonb:='{}'::jsonb; v_changed text[]:=array[]::text[];
 v_core_keys text[]:=array['full_name','designation','department','location','reports_to_text','leaving_date','source_note'];
 v_detail_keys text[]:=array['line_manager_employee_no','cnic_passport','email','employment_type','date_of_joining','work_location_mobility','probation','date_of_birth','permanent_address','emergency_contact_full_name','emergency_contact_relationship','primary_emergency_contact_number','alternative_emergency_number','previous_employer_company_name','previous_designation','previous_employment_start','previous_employment_end','highest_qualification_level','latest_education','education_start','education_end','offer_date','acceptance_joining_confirmation_due','life_insurance','car_entitlement','salary_transfer_method','bank_name','bank_branch','bank_account_title','bank_account_number','iban'];
begin
 if p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'Profile changes must be an object' using errcode='22023'; end if;
 for v_key,v_value in select key,value from jsonb_each(p_patch) loop
  if not(v_key=any(v_core_keys||v_detail_keys)) then raise exception 'This field cannot be edited' using errcode='42501'; end if;
  if jsonb_typeof(v_value) not in ('string','null') then raise exception 'Profile values must be text' using errcode='22023'; end if;
  v_value=to_jsonb(btrim(coalesce(v_value#>>'{}','')));
  if v_key='highest_qualification_level' and (v_value#>>'{}') not in ('','Matric','Intermediate','Diploma','Bachelor’s','Master’s','Other') then raise exception 'Choose a valid highest qualification level' using errcode='22023'; end if;
  if length(v_value#>>'{}')>1000 then raise exception 'Profile value is too long' using errcode='22023'; end if;
  if v_key='full_name' and (v_value#>>'{}')='' then raise exception 'Full name is required' using errcode='22023'; end if;
  if v_key='email' and (v_value#>>'{}')<>'' and (length(v_value#>>'{}')>254 or (v_value#>>'{}')!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then raise exception 'Enter a valid work email address' using errcode='22023'; end if;
  v_patch=v_patch||jsonb_build_object(v_key,v_value);
 end loop;
 select e.* into v_employee from public.employee_accounts a join public.employees e on e.id=a.employee_id
 where a.user_id=auth.uid() and a.is_active and not a.must_change_password and e.employment_state<>'inactive'
 for share of a for update of e;
 if not found then raise exception 'Active employee sign-in required' using errcode='42501'; end if;
 select * into v_detail from public.employee_details where employee_id=v_employee.id for update;
 if v_employee.updated_at is distinct from p_expected_core_updated_at or v_detail.updated_at is distinct from p_expected_profile_updated_at then
  raise exception 'Your profile changed elsewhere. Reload before saving.' using errcode='40001';
 end if;
 if v_patch ? 'reports_to_text' or v_patch ? 'line_manager_employee_no' then
  v_reporting_title:=coalesce(v_patch->>'reports_to_text',v_employee.reports_to_text,'');
  v_manager_number:=coalesce(v_patch->>'line_manager_employee_no',v_detail.profile->>'line_manager_employee_no','');
  if v_reporting_title='' and v_manager_number='' then
   null;
  elsif not exists (select 1 from public.employees e where e.employee_no=v_manager_number
    and e.id<>v_employee.id and e.employment_state='active' and btrim(e.designation)=v_reporting_title) then
   raise exception 'Choose an active line manager with the selected designation' using errcode='22023';
  end if;
 end if;
 for v_key,v_value in select key,value from jsonb_each(v_patch) loop
  if v_key=any(v_core_keys) then
   if coalesce(to_jsonb(v_employee)->>v_key,'') is distinct from (v_value#>>'{}') then v_changed=array_append(v_changed,v_key); end if;
  elsif coalesce(v_detail.profile->>v_key,'') is distinct from (v_value#>>'{}') then
   v_changed=array_append(v_changed,v_key);v_details_patch=v_details_patch||jsonb_build_object(v_key,v_value);
  end if;
 end loop;
 if cardinality(v_changed)=0 then return hrms_private.my_employee_profile(); end if;
 if v_changed&&v_core_keys then
  update public.employees set
   full_name=case when v_patch?'full_name' then v_patch->>'full_name' else full_name end,
   designation=case when v_patch?'designation' then nullif(v_patch->>'designation','') else designation end,
   department=case when v_patch?'department' then nullif(v_patch->>'department','') else department end,
   location=case when v_patch?'location' then nullif(v_patch->>'location','') else location end,
   reports_to_text=case when v_patch?'reports_to_text' then nullif(v_patch->>'reports_to_text','') else reports_to_text end,
   leaving_date=case when v_patch?'leaving_date' then nullif(v_patch->>'leaving_date','')::date else leaving_date end,
   source_note=case when v_patch?'source_note' then nullif(v_patch->>'source_note','') else source_note end,
   updated_at=clock_timestamp()
  where id=v_employee.id;
 end if;
 if v_details_patch<>'{}'::jsonb then
  insert into public.employee_details(employee_id,profile,updated_at)
  values(v_employee.id,v_details_patch,clock_timestamp())
  on conflict(employee_id) do update set profile=public.employee_details.profile||excluded.profile,updated_at=clock_timestamp();
 end if;
 insert into public.employee_profile_updates(employee_id,actor_id,changed_fields) values(v_employee.id,auth.uid(),v_changed);
 return hrms_private.my_employee_profile();
end $function$;
