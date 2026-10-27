-- ESS profile access: additive objects only; no existing records are changed.
begin;
create schema hrms_private;
revoke all on schema hrms_private from public, anon;
grant usage on schema hrms_private to authenticated;

create table public.employee_contact_audit (
 id uuid primary key default gen_random_uuid(),
 employee_id uuid not null references public.employees(id) on delete restrict,
 actor_id uuid not null,
 changes_before jsonb not null,
 changes_after jsonb not null,
 occurred_at timestamptz not null default now()
);
alter table public.employee_contact_audit enable row level security;
revoke all on public.employee_contact_audit from public, anon, authenticated;
grant select on public.employee_contact_audit to authenticated;
create index employee_contact_audit_employee_time_idx on public.employee_contact_audit(employee_id,occurred_at desc);
create policy "HR or owner reads contact history" on public.employee_contact_audit
for select to authenticated using (
 public.is_hr_admin() or exists (
  select 1 from public.employee_accounts a
  where a.employee_id=employee_contact_audit.employee_id
   and a.user_id=(select auth.uid()) and a.is_active and not a.must_change_password
 )
);

create function hrms_private.my_employee_profile()
returns jsonb language plpgsql stable security definer set search_path='' as $f$
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
   'reports_to_text',v_employee.reports_to_text,'employment_state',v_employee.employment_state),
  'contacts',coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(v_detail.profile,'{}'::jsonb))
   where key=any(array['mobile','personal_mobile','personal_email','personal_address'])),'{}'::jsonb),
  'personal',coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(v_detail.profile,'{}'::jsonb))
   where key=any(array['cnic_passport','email'])),'{}'::jsonb),
  'employment',coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(v_detail.profile,'{}'::jsonb))
   where key=any(array['employment_type','date_of_joining','work_location_mobility','probation'])),'{}'::jsonb),
  'rewards',coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(v_detail.profile,'{}'::jsonb))
   where key=any(array['gross_salary_month_pkr','fuel_month_pkr','car_allowance_month_pkr','total_package_month_pkr',
    'vehicle_maintenance_month_pkr','provident_fund_month_pkr','medical_hospitalisation_limit_person_year_pkr',
    'life_insurance','car_entitlement'])),'{}'::jsonb),
  'payroll_aug_2026',coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(v_detail.payroll_aug_2026,'{}'::jsonb))
   where key=any(array['payroll_month','payroll_days_aug_2026','payroll_fixed_salary_aug_2026_pkr',
    'payroll_salary_earned_aug_2026_pkr','payroll_overtime_incentive_aug_2026_pkr','payroll_deduction_aug_2026_pkr',
    'payroll_total_earned_salary_aug_2026_pkr','payroll_wht_tax_aug_2026_pkr','payroll_lease_other_pf_deduction_aug_2026_pkr',
    'payroll_payable_salary_aug_2026_pkr','payroll_fuel_vehicle_allowance_aug_2026_pkr','payroll_total_compensation_aug_2026_pkr'])),'{}'::jsonb),
  'profile_updated_at',v_detail.updated_at
 );
end $f$;
revoke all on function hrms_private.my_employee_profile() from public, anon, authenticated;
grant execute on function hrms_private.my_employee_profile() to authenticated;

create function hrms_private.update_my_contact_details(p_patch jsonb,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare v_id uuid; v_detail public.employee_details%rowtype; v_key text; v_value jsonb;
 v_patch jsonb:='{}'::jsonb; v_before jsonb:='{}'::jsonb; v_after jsonb:='{}'::jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'Contact changes must be an object' using errcode='22023'; end if;
 for v_key,v_value in select key,value from jsonb_each(p_patch) loop
  if not(v_key=any(array['mobile','personal_mobile','personal_email','personal_address'])) then
   raise exception 'This field cannot be edited through self-service' using errcode='42501';
  end if;
  if jsonb_typeof(v_value) not in ('string','null') then raise exception 'Contact values must be text' using errcode='22023'; end if;
  v_value=to_jsonb(btrim(coalesce(v_value#>>'{}','')));
  if length(v_value#>>'{}')>(case when v_key='personal_address' then 1000 when v_key='personal_email' then 254 else 64 end) then
   raise exception 'Contact value is too long' using errcode='22023';
  end if;
  if v_key='personal_email' and (v_value#>>'{}')<>'' and (v_value#>>'{}')!~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
   raise exception 'Enter a valid personal email address' using errcode='22023';
  end if;
  v_patch=v_patch||jsonb_build_object(v_key,v_value);
 end loop;
 select e.id into v_id from public.employee_accounts a join public.employees e on e.id=a.employee_id
 where a.user_id=auth.uid() and a.is_active and not a.must_change_password and e.employment_state<>'inactive'
 for share of a for update of e;
 if not found then raise exception 'An active employee account and completed password setup are required' using errcode='42501'; end if;
 select * into v_detail from public.employee_details where employee_id=v_id for update;
 if v_detail.updated_at is distinct from p_expected_updated_at then
  raise exception 'Your profile changed since you opened it. Reload before saving.' using errcode='40001';
 end if;
 for v_key,v_value in select key,value from jsonb_each(v_patch) loop
  if coalesce(v_detail.profile->>v_key,'') is distinct from (v_value#>>'{}') then
   v_before=v_before||jsonb_build_object(v_key,v_detail.profile->v_key);
   v_after=v_after||jsonb_build_object(v_key,v_value);
  end if;
 end loop;
 if v_after='{}'::jsonb then return hrms_private.my_employee_profile(); end if;
 insert into public.employee_details(employee_id,profile,updated_at)
 values(v_id,v_after,clock_timestamp())
 on conflict(employee_id) do update
 set profile=public.employee_details.profile||excluded.profile,updated_at=clock_timestamp();
 insert into public.employee_contact_audit(employee_id,actor_id,changes_before,changes_after)
 values(v_id,auth.uid(),v_before,v_after);
 return hrms_private.my_employee_profile();
end $f$;
revoke all on function hrms_private.update_my_contact_details(jsonb,timestamptz) from public, anon, authenticated;
grant execute on function hrms_private.update_my_contact_details(jsonb,timestamptz) to authenticated;

create function public.my_employee_profile()
returns jsonb language sql stable security invoker set search_path='' as $f$
 select hrms_private.my_employee_profile();
$f$;
revoke all on function public.my_employee_profile() from public, anon, authenticated;
grant execute on function public.my_employee_profile() to authenticated;

create function public.update_my_contact_details(p_patch jsonb,p_expected_updated_at timestamptz)
returns jsonb language sql security invoker set search_path='' as $f$
 select hrms_private.update_my_contact_details(p_patch,p_expected_updated_at);
$f$;
revoke all on function public.update_my_contact_details(jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.update_my_contact_details(jsonb,timestamptz) to authenticated;
commit;
