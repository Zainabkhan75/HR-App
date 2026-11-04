export const payrollFields = [
 'Employee ID#', 'Full Name', 'New Card #', 'Date of Joining', 'Designation', 'No. Days',
 'Gross/ Fixed Salary (Rs.)', 'Salary Earned (Rs.)', 'Over Time Minutes',
 'Over Time / Incentive / Variable Pay', 'Bonus / Others', 'Deductions / Loans / Others',
 'Salary Arrears / Others', 'Fuel Allowance + Vehicle Allow.', 'Total Compensation (Rs.)',
 'WHT Tax Deductions (Rs.)', 'Lease Instalment / Other Deduction',
 'Provident Fund Deductions', 'Payable Salary (Rs.)',
] as const

export const sections = [
 {key:'current-payroll', title:'Employees Payroll Details', labels:payrollFields},
 {key:'personal', title:'Personal & Contact', labels:['CNIC / Passport','Mobile number','Work Email','Personal Email','Personal Mobile','Personal Address','Date of Birth','Permanent Address','Emergency Contact Full Name','Emergency Contact Relationship','Primary Emergency Contact Number','Alternative Emergency Number']},
 {key:'background', title:'Previous Employment & Education', labels:['Previous Employer Company Name','Previous Designation','Previous Employment Start','Previous Employment End','Latest Education','Education Start','Education End']},
 {key:'employment', title:'Employment & Organisation', labels:['Employment Type','Date of Joining','Work Location / Mobility','Probation','Offer Date','Acceptance / Joining Confirmation Due','Reporting to']},
 {key:'salary', title:'Salary (HR only)', labels:['Medical Hospitalisation Limit / Person / Year (PKR)','Life Insurance','Car Entitlement','Salary Transfer Method','Bank Name','Bank Branch','Bank Account Title','Bank Account Number','IBAN']},
 {key:'verification', title:'Source & Verification', labels:['Source','Reconciliation Status','Possible Existing Database Record ID','Notes']},
] as const
export const retiredSalaryKeys = new Set([
 'gross_salary_month_pkr','fuel_month_pkr','car_allowance_month_pkr',
 'total_package_month_pkr','vehicle_maintenance_month_pkr','provident_fund_month_pkr',
])
export const payrollProfileFields = new Set(['Employee ID#','Full Name','Date of Joining','Designation'])

export const originalHeaders = ['Database Record ID','Employee Name','Designation','Department / Function (source mapping)','Reports To','Location','Record Status', ...sections.flatMap(s=>[...s.labels])]
const savedFieldKeys: Record<string,string> = {'Mobile number':'mobile','Work Email':'email','Reporting to':'reporting_line_basis'}
export const fieldKey = (label:string)=>savedFieldKeys[label] ?? label.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')
