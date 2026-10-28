export type ReportRow=Record<string,string>
export type ReportTable={columns:string[];rows:ReportRow[]}
type RecordData=Record<string,unknown>
export type ReportSources={employees:RecordData[];details:RecordData[];accounts:RecordData[];families:RecordData[]}
export function text(value:unknown):string{return value==null?'':typeof value==='object'?JSON.stringify(value):String(value)}
const record=(v:unknown):RecordData=>v&&typeof v==='object'&&!Array.isArray(v)?v as RecordData:{}
const title=(key:string)=>key.replace(/_/g,' ').replace(/^./,c=>c.toUpperCase())
function flatten(value:RecordData,prefix=''):ReportRow{
 const result:ReportRow={}
 for(const [key,v]of Object.entries(value)){const name=prefix+title(key);if(v&&typeof v==='object'&&!Array.isArray(v))Object.assign(result,flatten(v as RecordData,name+' / '));else result[name]=text(v)}
 return result
}
export function buildReports(source:ReportSources):{full:ReportTable;payroll:ReportTable}{
 const details=new Map(source.details.map(d=>[text(d.employee_id),d])),accounts=new Map(source.accounts.map(a=>[text(a.employee_id),a])),families=new Map(source.families.map(f=>[text(f.employee_id),f]))
 const fullRows:ReportRow[]=[],payRows:ReportRow[]=[]
 const salary:{[key:string]:string}={gross_salary_month_pkr:'Monthly gross salary (PKR)',total_package_month_pkr:'Monthly total package (PKR)',fuel_month_pkr:'Monthly fuel allowance (PKR)',car_allowance_month_pkr:'Monthly car allowance (PKR)',vehicle_maintenance_month_pkr:'Monthly vehicle maintenance (PKR)',provident_fund_month_pkr:'Monthly provident fund (PKR)',medical_hospitalisation_limit_person_year_pkr:'Annual hospitalisation limit (PKR)',life_insurance:'Life insurance',car_entitlement:'Car entitlement'}
 const payments:{[key:string]:string}={salary_transfer_method:'Transfer method',bank_name:'Bank name',bank_branch:'Bank branch',bank_account_title:'Account title',bank_account_number:'Account number',iban:'IBAN'}
 for(const e of source.employees){
  const id=text(e.id),d=details.get(id)??{},p=record(d.profile),history=record(d.payroll_aug_2026)
  const base={'Employee ID':text(e.employee_no),'Employee name':text(e.full_name),'Department':text(e.department)}
  fullRows.push({...base,...flatten(e,'Employee / '),...flatten(d,'Details / '),...flatten(accounts.get(id)??{},'Login / '),...flatten(families.get(id)??{},'Family / ')})
  const pay:ReportRow={...base,'CNIC / passport':text(p.cnic_passport),'Designation':text(e.designation),'Location':text(e.location),'Employment status':text(e.employment_state)}
  for(const [key,label]of Object.entries(salary))pay[label]=text(p[key])
  for(const [key,label]of Object.entries(payments))pay[label]=text(p[key])
  // Payroll identifiers and historical figures are never substituted for bank details or current salary.
  for(const [key,value]of Object.entries(history))if(key.endsWith('_pkr')||key==='payroll_days_aug_2026')pay['Historical Aug 2026 / '+title(key.replace(/^payroll_/,'').replace(/_aug_2026/g,''))]=text(value)
  payRows.push(pay)
 }
 const columns=(rows:ReportRow[],first:string[])=>[...first,...[...new Set(rows.flatMap(Object.keys))].filter(k=>!first.includes(k)).sort()]
 return{full:{columns:columns(fullRows,['Employee ID','Employee name','Department']),rows:fullRows},payroll:{columns:columns(payRows,['Employee ID','Employee name','CNIC / passport','Department','Designation','Location','Employment status',...Object.values(salary),...Object.values(payments)]),rows:payRows}}
}
export function reportCsv(table:ReportTable,rows=table.rows):string{
 const escape=(value:string)=>'"'+(/^[\s]*[=+@\-\t\r]/.test(value)?"'"+value:value).replace(/"/g,'""')+'"'
 return '\uFEFF'+[table.columns,...rows.map(r=>table.columns.map(c=>r[c]??''))].map(row=>row.map(escape).join(',')).join('\r\n')
}
