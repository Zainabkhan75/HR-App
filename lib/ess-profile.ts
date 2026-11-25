export type Values=Record<string,string|null>
export type Hierarchy={employee_id:string; department:string|null; manager_title:string|null; manager_name:string|null; status:'root'|'position_unassigned'|'parent_unassigned'|'vacant'|'occupied'}
export type EmployeeOrganisation={
 department_code:string|null;department:string|null
 subdepartment_code:string|null;subdepartment:string|null
 position_code:string|null;position_title:string|null
 designation_code:string|null;designation:string|null
 location:string|null
 reports_to_position_code:string|null;reports_to_position_title:string|null
 reports_to_employee_name:string|null
 reports_to_status:'top_position'|'unassigned'|'vacant'|'occupied'|null
 effective_manager_position_code:string|null;effective_manager_position_title:string|null
 effective_manager_name:string|null;reporting_fallback_used:boolean
}
export function reportingLabel(line?:Hierarchy){
 if(!line)return 'Hierarchy unavailable'
 if(line.status==='root')return 'Top position'
 if(line.status==='position_unassigned')return 'Employee position unassigned'
 return line.manager_title??'Reporting position unassigned'
}
export function occupantLabel(line?:Hierarchy){
 return line?.status==='vacant'?'Vacant':line?.manager_name??''
}
export type EmployeeProfile={
 hierarchy?:Hierarchy
 employee:{employee_no:string;full_name:string;designation:string|null;department:string|null;location:string|null;reports_to_text:string|null;employment_state:string;source_note?:string|null}
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
 ['employment_type','Employment type'],
 ['work_location_mobility','Work location / mobility'],['probation','Probation'],
 ['offer_date','Date of Confirmation'],['date_of_joining','Date of Joining'],
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
 {title:'Core Information',fields:[['full_name','Full Name']]},
 {title:'Personal Information',fields:[['gender','Gender'],['cnic_passport','CNIC / Passport'],['email','Work Email'],...backgroundSections[0].fields]},
 ...backgroundSections.slice(1),
 {title:'Employment Information',fields:[...employmentFields.slice(0,-2),employmentFields[4],employmentFields[3]]},
 {title:'Salary & Benefits (where applicable)',fields:rewardFields.filter(([key])=>key!=='medical_hospitalisation_limit_person_year_pkr'),readOnly:true},
 {title:'Salary Transfer & Bank Details',fields:[['salary_transfer_method','Salary Transfer Method'],['bank_name','Bank Name'],['bank_branch','Bank Branch'],['bank_account_title','Bank Account Title'],['bank_account_number','Bank Account Number'],['iban','IBAN']]},
] as const
export const profileDraft=(profile:EmployeeProfile):Record<string,string>=>{
 const values={...profile.employee,...profile.personal,...profile.employment,...profile.rewards}
 return Object.fromEntries(editableProfileSections.flatMap(section=>section.fields.map(([key])=>[key,String(values[key as keyof typeof values]??'')])))
}
export const profilePatch=(profile:EmployeeProfile,draft:Record<string,string>):Record<string,string>=>{
 const baseline=profileDraft(profile)
 return Object.fromEntries(editableProfileSections.filter(section=>!('readOnly' in section)).flatMap(section=>section.fields.map(([key])=>key)).filter(key=>(draft[key]??'').trim()!==baseline[key].trim()).map(key=>[key,(draft[key]??'').trim()]))
}

