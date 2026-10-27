export type Values=Record<string,string|null>
export type EmployeeProfile={
 employee:{employee_no:string;full_name:string;designation:string|null;department:string|null;location:string|null;reports_to_text:string|null;employment_state:string}
 contacts:Values;personal:Values;employment:Values;rewards:Values;payroll_aug_2026:Values
 core_updated_at:string;profile_updated_at:string|null
}
export const contactFields=[
 {key:'mobile',label:'Mobile number',type:'tel',maxLength:64},
 {key:'personal_mobile',label:'Personal mobile number',type:'tel',maxLength:64},
 {key:'personal_email',label:'Personal email',type:'email',maxLength:254},
 {key:'personal_address',label:'Personal address',type:'textarea',maxLength:1000},
] as const
export const employmentFields=[
 ['employment_type','Employment type'],['date_of_joining','Date of joining'],
 ['work_location_mobility','Work location / mobility'],['probation','Probation'],
] as const
export const backgroundSections=[
 {title:'Personal information',fields:[['date_of_birth','Date of birth (as submitted)'],['permanent_address','Permanent address']]},
 {title:'Emergency contact',fields:[['emergency_contact_full_name','Full name'],['emergency_contact_relationship','Relationship'],['primary_emergency_contact_number','Primary number'],['alternative_emergency_number','Alternative number']]},
 {title:'Previous employment',fields:[['previous_employer_company_name','Employer / company'],['previous_designation','Designation'],['previous_employment_start','From (as submitted)'],['previous_employment_end','To (as submitted)']]},
 {title:'Education',fields:[['latest_education','Qualification and institution'],['education_start','From (as submitted)'],['education_end','To (as submitted)']]},
] as const
export const rewardFields=[
 ['gross_salary_month_pkr','Gross salary / month (PKR)'],['fuel_month_pkr','Fuel / month (PKR)'],
 ['car_allowance_month_pkr','Car allowance / month (PKR)'],['total_package_month_pkr','Total package / month (PKR)'],
 ['vehicle_maintenance_month_pkr','Vehicle maintenance / month (PKR)'],['provident_fund_month_pkr','Provident fund / month (PKR)'],
 ['medical_hospitalisation_limit_person_year_pkr','Medical hospitalisation limit / person / year (PKR)'],
 ['life_insurance','Life insurance'],['car_entitlement','Car entitlement'],
] as const
export const payrollFields=[
 ['payroll_month','Payroll month'],['payroll_days_aug_2026','Payroll days'],
 ['payroll_fixed_salary_aug_2026_pkr','Fixed salary (PKR)'],['payroll_salary_earned_aug_2026_pkr','Salary earned (PKR)'],
 ['payroll_overtime_incentive_aug_2026_pkr','Overtime / incentive (PKR)'],['payroll_deduction_aug_2026_pkr','Deduction (PKR)'],
 ['payroll_total_earned_salary_aug_2026_pkr','Total earned salary (PKR)'],['payroll_wht_tax_aug_2026_pkr','Withholding tax (PKR)'],
 ['payroll_lease_other_pf_deduction_aug_2026_pkr','Lease / other / PF deduction (PKR)'],['payroll_payable_salary_aug_2026_pkr','Payable salary (PKR)'],
 ['payroll_fuel_vehicle_allowance_aug_2026_pkr','Fuel + vehicle allowance (PKR)'],['payroll_total_compensation_aug_2026_pkr','Total compensation (PKR)'],
] as const
export const contactDraft=(values:Values):Record<string,string>=>Object.fromEntries(contactFields.map(field=>[field.key,values[field.key]??'']))
export const contactPatch=(values:Values,draft:Record<string,string>):Record<string,string>=>Object.fromEntries(
 contactFields.filter(field=>(draft[field.key]??'').trim()!==(values[field.key]??'').trim()).map(field=>[field.key,(draft[field.key]??'').trim()])
)

export const editableProfileSections=[
 {title:'Core information',fields:[['full_name','Full name'],['designation','Designation'],['department','Department'],['location','Location'],['reports_to_text','Reports to (recorded)']]},
 {title:'Personal information',fields:[['cnic_passport','CNIC / passport'],['email','Work email']]},
 {title:'Employment information',fields:[['employment_type','Employment type'],['date_of_joining','Date of joining'],['work_location_mobility','Work location / mobility'],['probation','Probation']]},
] as const
export const profileDraft=(profile:EmployeeProfile):Record<string,string>=>{
 const values={...profile.employee,...profile.personal,...profile.employment}
 return Object.fromEntries(editableProfileSections.flatMap(section=>section.fields.map(([key])=>[key,values[key as keyof typeof values]??''])))
}
export const profilePatch=(profile:EmployeeProfile,draft:Record<string,string>):Record<string,string>=>{
 const baseline=profileDraft(profile)
 return Object.fromEntries(editableProfileSections.flatMap(section=>section.fields.map(([key])=>key)).filter(key=>(draft[key]??'').trim()!==baseline[key].trim()).map(key=>[key,(draft[key]??'').trim()]))
}
