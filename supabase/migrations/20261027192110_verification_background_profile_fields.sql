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
   'reports_to_text',v_employee.reports_to_text,'employment_state',v_employee.employment_state),
  'contacts',coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(v_detail.profile,'{}'::jsonb))
   where key=any(array['mobile','personal_mobile','personal_email','personal_address'])),'{}'::jsonb),
  'personal',coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(v_detail.profile,'{}'::jsonb))
   where key=any(array['cnic_passport','email','date_of_birth','permanent_address','emergency_contact_full_name','emergency_contact_relationship','primary_emergency_contact_number','alternative_emergency_number','previous_employer_company_name','previous_designation','previous_employment_start','previous_employment_end','latest_education','education_start','education_end'])),'{}'::jsonb),
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
  'core_updated_at',v_employee.updated_at, 'profile_updated_at',v_detail.updated_at
 );
end $function$
;
