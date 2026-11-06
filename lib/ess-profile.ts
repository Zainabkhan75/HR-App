export type Values=Record<string,string|null>
export type EmployeeProfile={
 employee:{employee_no:string;full_name:string;designation:string|null;department:string|null;location:string|null;reports_to_text:string|null;employment_state:string;leaving_date?:string|null;record_status?:string|null;source_note?:string|null}
 contacts:Values;personal:Values;employment:Values;rewards:Values;payroll_sep_2026?:Values
 core_updated_at:string;profile_updated_at:string|null
}
export const contactFields=[
 {key:'mobile',label:'Work Mobile Number',type:'tel',maxLength:64},
 {key:'personal_mobile',label:'Personal Mobile Number',type:'tel',maxLength:64},
 {key:'personal_email',label:'Personal email',type:'email',maxLength:254},
 {key:'personal_address',label:'Current Address',type:'textarea',maxLength:1000},
] as const
export const employmentFields=[
 ['employment_type','Employment type'],['date_of_joining','Date of joining'],
 ['work_location_mobility','Work location / mobility'],['probation','Probation'],
 ['offer_date','Offer Date'],['acceptance_joining_confirmation_due','Acceptance / Joining Confirmation Due'],
] as const
export const backgroundSections=[
 {title:'Personal information',fields:[['date_of_birth','Date of birth (as submitted)'],['permanent_address','Permanent Address (as per ID card)']]},
 {title:'Emergency contact',fields:[['emergency_contact_full_name','Full name'],['emergency_contact_relationship','Relationship'],['primary_emergency_contact_number','Primary number'],['alternative_emergency_number','Alternative number']]},
 {title:'Previous employment',fields:[['previous_employer_company_name','Employer / company'],['previous_designation','Designation'],['previous_employment_start','From (as submitted)'],['previous_employment_end','To (as submitted)']]},
 {title:'Education',fields:[['highest_qualification_level','Highest Qualification Level'],['latest_education','Qualification and institution'],['education_start','From (as submitted)'],['education_end','To (as submitted)']]},
] as const
export const rewardFields=[
 ['medical_hospitalisation_limit_person_year_pkr','Medical hospitalisation limit / person / year (PKR)'],
 ['life_insurance','Life insurance'],['car_entitlement','Car entitlement'],
] as const
export const contactDraft=(values:Values):Record<string,string>=>Object.fromEntries(contactFields.map(field=>[field.key,values[field.key]??'']))
export const contactPatch=(values:Values,draft:Record<string,string>):Record<string,string>=>Object.fromEntries(
 contactFields.filter(field=>(draft[field.key]??'').trim()!==(values[field.key]??'').trim()).map(field=>[field.key,(draft[field.key]??'').trim()])
)

export const editableProfileSections=[
 {title:'Core Information',fields:[['full_name','Full Name'],['designation','Designation'],['department','Department'],['location','Location'],['reports_to_text','Reports To'],['leaving_date','Leaving Date'],['record_status','Source Record Status'],['source_note','Source / Verification Note']]},
 {title:'Personal Information',fields:[['cnic_passport','CNIC / Passport'],['email','Work Email'],...backgroundSections[0].fields]},
 ...backgroundSections.slice(1),
 {title:'Employment Information',fields:employmentFields},
 {title:'Salary & Benefits',fields:rewardFields.filter(([key])=>key!=='medical_hospitalisation_limit_person_year_pkr')},
 {title:'Salary Transfer & Bank Details',fields:[['salary_transfer_method','Salary Transfer Method'],['bank_name','Bank Name'],['bank_branch','Bank Branch'],['bank_account_title','Bank Account Title'],['bank_account_number','Bank Account Number'],['iban','IBAN']]},
] as const
export const profileDraft=(profile:EmployeeProfile):Record<string,string>=>{
 const values={...profile.employee,...profile.personal,...profile.employment,...profile.rewards}
 return Object.fromEntries(editableProfileSections.flatMap(section=>section.fields.map(([key])=>[key,String(values[key as keyof typeof values]??'')])))
}
export const profilePatch=(profile:EmployeeProfile,draft:Record<string,string>):Record<string,string>=>{
 const baseline=profileDraft(profile)
 return Object.fromEntries(editableProfileSections.flatMap(section=>section.fields.map(([key])=>key)).filter(key=>(draft[key]??'').trim()!==baseline[key].trim()).map(key=>[key,(draft[key]??'').trim()]))
}
