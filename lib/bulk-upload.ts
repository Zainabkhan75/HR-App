import ExcelJS from 'exceljs'
import {createHash} from 'node:crypto'
import {fieldKey,sections,payrollFields,retiredSalaryKeys,payrollProfileFields} from '../app/employees/field-config'
import {normalizeSpreadsheetXml} from './monthly-payroll'

export type Bucket='core'|'profile'|'payroll'|'control'
export type Field={header:string;bucket:Bucket;key:string}
export type EmployeeRow={id:string;position_id?:number|null;employee_no:string;full_name:string;designation:string|null;department:string|null;reports_to_text:string|null;location:string|null;record_status:string|null;source_note:string|null;employment_state?:string;leaving_date?:string|null;updated_at:string}
export type DetailRow={employee_id:string;profile:Record<string,unknown>|null;payroll_sep_2026:Record<string,unknown>|null;updated_at:string}
export type FamilyMember={full_name:string;age:number;date_of_birth?:string;pre_existing_conditions:string;cnic:string}
export type FamilyRecord={employee_id:string;spouse:FamilyMember|null;children:FamilyMember[]|null;marital_status?:string|null;updated_at:string}
export type AccountRecord={employee_id:string;user_id:string;username:string;login_email:string;is_active:boolean;must_change_password:boolean}
export type Snapshot={employees:EmployeeRow[];details:DetailRow[];families?:FamilyRecord[];accounts?:AccountRecord[]}
export type FamilyInput={type:'Spouse'|'Child';childNumber:number;replace:boolean;values:Record<string,string>}
export type UploadRow={action?:'NEW'|'UPDATE';reference?:string;employeeNo:string;name:string;replace:boolean;core:Record<string,string>;profile:Record<string,string>;payroll:Record<string,string>;control?:Record<string,string>;family:FamilyInput[]}
export type PlannedRow={action:'NEW'|'UPDATE';reference:string;employeeNo:string;name:string;replace:boolean;expectedCoreUpdatedAt:string;expectedDetailsUpdatedAt:string;expectedFamilyUpdatedAt:string|null;core:Record<string,string>;profile:Record<string,string>;payroll:Record<string,string>;control:Record<string,string>;expectedAccount:string;family:FamilyInput[];fill:number;overwrite:number;skipped:number;unchanged:number;changes:{field:string;before:string;after:string;action:'fill'|'replace'|'skip'}[]}

const coreFields:Field[]=[
 {header:'Employee Name',bucket:'core',key:'full_name'},
 {header:'Position ID',bucket:'core',key:'position_id'},
 {header:'Designation',bucket:'core',key:'designation'},
 {header:'Department',bucket:'core',key:'department'},
 {header:'Reports To',bucket:'core',key:'reports_to_text'},
 {header:'Location',bucket:'core',key:'location'},
]
const controlFields:Field[]=[
 {header:'Employment Status',bucket:'control',key:'employment_state'},
 {header:'Leaving Date',bucket:'control',key:'leaving_date'},
 {header:'Status Change Reason',bucket:'control',key:'status_reason'},
 {header:'Marital Status',bucket:'control',key:'marital_status'},
 {header:'Credentials | Sign-in Email / Username',bucket:'control',key:'login_email'},
 {header:'Credentials | Email Ownership Confirmed (YES/NO)',bucket:'control',key:'email_verified'},
 {header:'Credentials | Account Active (YES/NO)',bucket:'control',key:'account_active'},
 {header:'Credentials | Require Password Change (YES/NO)',bucket:'control',key:'must_change_password'},
 {header:'Credentials | Action (CREATE/RESET)',bucket:'control',key:'credential_action'},
]
export function controlValues(employee:EmployeeRow,family?:FamilyRecord,account?:AccountRecord):Record<string,string>{
 return {employment_state:employee.employment_state??'active',leaving_date:employee.leaving_date??'',marital_status:family?.marital_status??'',
  login_email:account?.login_email??'',account_active:account?(account.is_active?'YES':'NO'):'',
  must_change_password:account?(account.must_change_password?'YES':'NO'):''}
}
export const ID_HEADER='Employee ID'
export const MODE_HEADER='Replace existing values? (YES/NO)'
export const ACTION_HEADER='Action (NEW/UPDATE)'
export const REF_HEADER='Upload reference'
const familyHeaders=[ID_HEADER,'Employee Name','Member Type (Spouse/Child)','Child Number',MODE_HEADER,'Member Full Name','Age','Pre-existing Conditions','CNIC',REF_HEADER,'Date of Birth']
const reserved=new Set([ID_HEADER,MODE_HEADER,ACTION_HEADER,REF_HEADER,'Profile | Reporting to'])
const legacyProfileHeaders: Record<string,string> = {
 'Profile | Offer Date':'Profile | Date of Confirmation',
 'Profile | line manager employee no':'Profile | Line Manager Employee ID',
 'Profile | Mobile': 'Profile | Work Mobile Number',
 'Profile | Mobile number': 'Profile | Work Mobile Number',
 'Profile | Personal Mobile': 'Profile | Personal Mobile Number',
 'Profile | Personal Address': 'Profile | Current Address',
 'Profile | Permanent Address': 'Profile | Permanent Address (as per ID card)',
}
export function fieldsFor(snapshot:Snapshot):Field[]{
 const profile=new Map<string,string>()
 for(const section of sections)if(section.key!=='current-payroll'){
  for(const label of section.labels)if(label!=='Reporting to')profile.set(fieldKey(label),label==='Offer Date'?'Date of Confirmation':label)
  if(section.key==='background')profile.set('highest_qualification_level','Highest Qualification Level')
 }
 for(const detail of snapshot.details){for(const key of Object.keys(detail.profile??{}))if(!profile.has(key)&&!retiredSalaryKeys.has(key)&&!['reporting_line_basis','reporting_line_source','as_is_reports_to','reporting_line_gap'].includes(key))profile.set(key,key.replaceAll('_',' '))}
 profile.set('line_manager_employee_no','Line Manager Employee ID')
 profile.set('highest_qualification_level','Highest Qualification Level')
 profile.set('gender','Gender')
 const managerField={header:'Profile | Line Manager Employee ID',bucket:'profile' as const,key:'line_manager_employee_no'}
 const fields=[...coreFields,{header:'Record Status',bucket:'core' as const,key:'record_status'},{header:'Source / verification note',bucket:'core' as const,key:'source_note'},
  ...[...profile].filter(([key])=>key!=='line_manager_employee_no').map(([key,label])=>({header:`Profile | ${label}`,bucket:'profile' as const,key})),
  ...payrollFields.map(label=>({header:`Employees Payroll Details | ${label}`,bucket:'payroll' as const,key:fieldKey(label)}))]
 return [...fields.slice(0,4),managerField,fields[4],...controlFields.slice(0,3),...fields.slice(5),controlFields[3],...controlFields.slice(4)]
}
export function cellText(value:unknown):string{
 if(value==null)return''
 if(value instanceof Date)return value.toISOString().slice(0,10)
 if(typeof value==='number'||typeof value==='boolean')return String(value)
 if(typeof value==='string')return value.trim()
 if(typeof value==='object')return JSON.stringify(value)
 return''
}
function inputText(cell:ExcelJS.Cell):string{
 const value=cell.value
 if(value==null)return''
 if(value instanceof Date)return value.toISOString().slice(0,10)
 if(typeof value==='number'||typeof value==='boolean')return String(value)
 if(typeof value==='string')return value.trim()
 throw Error(`Unsupported cell at ${cell.address}. Use plain text, number or date; formulas and links are not accepted.`)
}
function hasData(row:ExcelJS.Row):boolean{let found=false;row.eachCell({includeEmpty:false},cell=>{if(cell.value!=null&&cell.value!=='')found=true});return found}
export async function template(snapshot:Snapshot):Promise<Buffer>{
 const book=new ExcelJS.Workbook(),guide=book.addWorksheet('Instructions'),sheet=book.addWorksheet('Employees'),reference=book.addWorksheet('Current data'),familySheet=book.addWorksheet('Family'),familyReference=book.addWorksheet('Current family')
 guide.addRow(['Bandana employee bulk upload'])
 for(const line of [
  'Choose UPDATE for an existing employee and enter their six-digit Employee ID. YES/NO keeps its existing replacement behaviour.',
  'Choose NEW for a new employee, leave Employee ID and YES/NO blank, and enter name and Position ID. Department and Designation are derived from the position. An Active employee ID is assigned only when you apply.',
  'Give each NEW row a unique Upload reference such as NEW-01 if adding family rows; repeat that reference on the Family sheet with Employee ID blank.',
  'Potential duplicates by name, CNIC or email must be resolved before applying. Credential actions run after the profile is saved.',
  'The Employees sheet starts with saved values. Family details are normally submitted by employees in the portal.',
  'Blank upload cells do not erase stored values. The Current data and Current family sheets preserve a download-time reference.',
  'Set Replace existing values? to YES for an employee only when differing populated values should be overwritten. NO fills empty fields only.',
  'Upload the file in Employee Directory > Bulk upload. Review every proposed change before applying.',
  'For spouse and children, use the Family sheet. Identify children by Child Number; blanks do not erase existing values.',
  'Keep CNIC, account numbers and other identifiers as text. Editing a profile email does not change the linked sign-in email.',
  'Employment Status uses active/inactive. Deactivation requires Leaving Date and Status Change Reason. Set YES to replace existing values.',
  'Credentials changes require YES. Confirm email ownership with YES when changing a sign-in email. CREATE makes a login and RESET generates the standard temporary password.',
  'Marital Status uses Single/Married. Enter Married to add family members. Existing family records are retained when changing to Single.',
 ])guide.addRow([line])
 guide.getColumn(1).width=115;guide.getRow(1).font={bold:true,size:16,color:{argb:'FF15568E'}}
 const fields=fieldsFor(snapshot),headers=[ID_HEADER,MODE_HEADER,ACTION_HEADER,REF_HEADER,...fields.map(f=>f.header)]
 sheet.addRow(['Latest saved values are prefilled. Edit this copy, then upload it. Row 2 contains column headings; data starts on row 3.'])
 sheet.addRow(headers);reference.addRow(['Reference only. Current values at download time; edits on this sheet are not uploaded.']);reference.addRow(headers)
 const details=new Map(snapshot.details.map(d=>[d.employee_id,d])),accounts=new Map((snapshot.accounts??[]).map(a=>[a.employee_id,a])),families=new Map((snapshot.families??[]).map(f=>[f.employee_id,f]))
 for(const employee of snapshot.employees){const detail=details.get(employee.id),profile=detail?.profile??{},payroll=detail?.payroll_sep_2026??{}
    const controls=controlValues(employee,families.get(employee.id),accounts.get(employee.id))
    const values=fields.map(f=>{
   if(f.bucket==='control')return controls[f.key]??''
   if(f.bucket==='core')return cellText(employee[f.key as keyof EmployeeRow])
   if(f.bucket==='profile')return f.key==='notes'?'':f.key==='gender'?cellText(profile.gender)||'Male':cellText(profile[f.key])
   if(f.key==='employee_id')return employee.employee_no
   if(f.key==='full_name')return employee.full_name
   if(f.key==='designation')return cellText(employee.designation)
   if(f.key==='date_of_joining')return cellText(profile.date_of_joining)
   return cellText(payroll[f.key])
  })
  const row=sheet.addRow([employee.employee_no,'NO','UPDATE','',...values])
  row.getCell(1).numFmt='@';row.getCell(1).alignment={horizontal:'left'}
  reference.addRow([employee.employee_no,'','UPDATE','',...values])
 }
 sheet.views=[{state:'frozen',xSplit:2,ySplit:2}]
 sheet.getRow(1).font={bold:true,color:{argb:'FF15568E'}};sheet.getRow(1).height=28
 sheet.getRow(2).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(2).height=32
 sheet.getRow(2).eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF15568E'}};cell.alignment={vertical:'middle',wrapText:true}})
 sheet.getColumn(1).width=17;sheet.getColumn(2).width=32
 for(let c=3;c<=headers.length;c++)sheet.getColumn(c).width=c===3?28:25
 sheet.getColumn(3).width=24;sheet.getColumn(4).width=24;sheet.getColumn(5).width=30
 for(let r=3;r<=Math.max(1000,sheet.rowCount);r++){
  sheet.getCell(r,2).dataValidation={type:'list',allowBlank:true,formulae:['"NO,YES"'],showErrorMessage:true,error:'UPDATE: choose NO or YES. NEW: leave blank.'}
  sheet.getCell(r,3).dataValidation={type:'list',allowBlank:true,formulae:['"NEW,UPDATE"'],showErrorMessage:true,error:'Choose NEW or UPDATE'}
 }
 sheet.autoFilter={from:{row:2,column:1},to:{row:sheet.rowCount,column:headers.length}}
 reference.views=[{state:'frozen',xSplit:2,ySplit:2}];reference.getRow(2).font={bold:true,color:{argb:'FFFFFFFF'}};reference.getRow(2).eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF607488'}};cell.alignment={wrapText:true}});reference.getColumn(1).width=17;reference.getColumn(2).width=15;for(let c=3;c<=headers.length;c++)reference.getColumn(c).width=c===3?28:25
 familySheet.addRow(['Employees normally fill family details in the portal. If HR needs to add a record, use Child Number 1, 2, 3... in order.']);familySheet.addRow(familyHeaders)
 familyReference.addRow(['Reference only. Current family values at download time; edits here are not uploaded.']);familyReference.addRow(familyHeaders)
 const employeesById=new Map(snapshot.employees.map(e=>[e.id,e]))
 for(const family of snapshot.families??[]){const employee=employeesById.get(family.employee_id);if(!employee)continue
  const members=[...(family.spouse?[{type:'Spouse',number:0,member:family.spouse}]:[]),...(family.children??[]).map((member,index)=>({type:'Child',number:index+1,member}))]
  for(const {type,number,member} of members){
   const values=[employee.employee_no,employee.full_name,type,number||'','NO',member.full_name,member.age,member.pre_existing_conditions,member.cnic,'',member.date_of_birth]
   familySheet.addRow(values);familyReference.addRow(values)
  }
 }
 for(const tab of [familySheet,familyReference]){tab.views=[{state:'frozen',xSplit:2,ySplit:2}];tab.getRow(2).font={bold:true,color:{argb:'FFFFFFFF'}};tab.getRow(2).eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:tab===familySheet?'FF15568E':'FF607488'}};cell.alignment={wrapText:true}});for(let c=1;c<=familyHeaders.length;c++)tab.getColumn(c).width=c===2||c===6?30:22}
 for(let r=3;r<=Math.max(300,familySheet.rowCount);r++)familySheet.getCell(r,5).dataValidation={type:'list',allowBlank:false,formulae:['"NO,YES"']}
 const monthly=book.addWorksheet('Payroll')
 monthly.addRow(['Monthly payroll upload'])
 monthly.addRow(['Enter one payroll month as YYYY-MM. Upload this sheet through Monthly payroll upload.'])
 monthly.getRow(5).values=['Payroll Month',...payrollFields]
 monthly.views=[{state:'frozen',xSplit:3,ySplit:5}]
 monthly.getRow(5).height=60
 monthly.getRow(5).eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF15568E'}};cell.font={bold:true,color:{argb:'FFFFFFFF'}};cell.alignment={wrapText:true,vertical:'middle'}})
 for(let c=1;c<=payrollFields.length+1;c++){monthly.getColumn(c).width=25;monthly.getColumn(c).numFmt=c<7?'@':'#,##0.00'}
 const dictionary=book.addWorksheet('Field guide')
 dictionary.addRow(['Column','App field','Section','How to update'])
 for(const field of fields)dictionary.addRow([field.header,field.key,field.bucket,field.bucket==='control'?'Reviewed administration change':field.bucket==='payroll'?'September 2026 payroll':'Employee upload'])
 dictionary.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};dictionary.getRow(1).eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF15568E'}}})
 for(const [column,width] of [[1,64],[2,54],[3,16],[4,40]])dictionary.getColumn(column).width=width
 dictionary.views=[{state:'frozen',ySplit:1}]
 for(const [index,field] of fields.entries()){
  const values=field.key==='gender'?['Male','Female']:field.bucket==='control'?({
   employment_state:['active','inactive'],marital_status:['Single','Married'],email_verified:['YES','NO'],
   account_active:['YES','NO'],must_change_password:['YES','NO'],credential_action:['CREATE','RESET'],
  } as Record<string,string[]>)[field.key]:undefined
  if(values)for(let row=3;row<=1000;row++)sheet.getCell(row,index+5).dataValidation={type:'list',allowBlank:true,formulae:['"'+values.join(',')+'"']}
 }
 const bytes=await book.xlsx.writeBuffer();return Buffer.from(bytes)
}
export async function parseWorkbook(bytes:Buffer,fields:Field[]):Promise<UploadRow[]>{
 const book=new ExcelJS.Workbook();await book.xlsx.load(await normalizeSpreadsheetXml(bytes) as unknown as ExcelJS.Buffer)
 const sheet=book.getWorksheet('Employees');if(!sheet)throw Error('The Employees sheet is missing')
 if(sheet.rowCount>1002)throw Error('Maximum 1,000 employee rows per upload')
 const known=new Map(fields.map(f=>[f.header,f]));const headers=new Map<string,number>()
 sheet.getRow(2).eachCell({includeEmpty:false},(cell,col)=>{const label=inputText(cell),header=legacyProfileHeaders[label]??label;if(headers.has(header))throw Error(`Duplicate column: ${header}`);if(header&&!known.has(header)&&!reserved.has(header))throw Error(`Unknown column: ${header}`);headers.set(header,col)})
 if(!headers.has(ID_HEADER)||!headers.has('Employee Name')||!headers.has(MODE_HEADER))throw Error('Employee ID, Employee Name and replacement choice columns are required')
 const result:UploadRow[]=[],seen=new Set<string>(),references=new Set<string>()
 for(let r=3;r<=sheet.rowCount;r++){
  const row=sheet.getRow(r);if(!hasData(row))continue
  const employeeNo=inputText(row.getCell(headers.get(ID_HEADER)!))
  const action=(headers.has(ACTION_HEADER)?inputText(row.getCell(headers.get(ACTION_HEADER)!)).toUpperCase():'UPDATE')||'UPDATE'
  if(action!=='NEW'&&action!=='UPDATE')throw Error(`Row ${r}: choose NEW or UPDATE`)
  if(action==='NEW'&&employeeNo)throw Error(`Row ${r}: leave Employee ID blank for NEW`)
  if(action==='UPDATE'&&!employeeNo)throw Error(`Row ${r}: Employee ID is required`)
  if(action==='UPDATE'&&!/^\d{6}$/.test(employeeNo))throw Error(`Row ${r}: Employee ID must be six digits`)
  if(employeeNo&&seen.has(employeeNo))throw Error(`Employee ID ${employeeNo} appears more than once`);if(employeeNo)seen.add(employeeNo)
  const providedRef=headers.has(REF_HEADER)?inputText(row.getCell(headers.get(REF_HEADER)!)).toUpperCase():''
  const reference=action==='NEW'?(providedRef||`NEW-ROW-${r}`):employeeNo
  if(action==='NEW'&&!/^NEW[-_][A-Z0-9_-]{1,60}$/.test(reference))throw Error(`Row ${r}: Upload reference must start NEW- and be unique`)
  if(references.has(reference))throw Error(`Upload reference ${reference} appears more than once`);references.add(reference)
  const name=inputText(row.getCell(headers.get('Employee Name')!));if(!name)throw Error(`Row ${r}: Employee Name is required`)
  const mode=inputText(row.getCell(headers.get(MODE_HEADER)!)).toUpperCase();if(action==='UPDATE'&&mode!=='YES'&&mode!=='NO')throw Error(`Row ${r}: choose YES or NO for replacement`)
  if(action==='NEW'&&mode&&!['YES','NO'].includes(mode))throw Error(`Row ${r}: NEW replacement choice must be blank, YES or NO`)
  const item:UploadRow={action,reference,employeeNo,name,replace:action==='NEW'||mode==='YES',core:{},profile:{},payroll:{},control:{},family:[]}
  for(const [header,col]of headers){const field=known.get(header);if(!field)continue;if(field.bucket==='payroll'&&[...payrollProfileFields].some(label=>field.key===fieldKey(label)))continue;const value=inputText(row.getCell(col));if(value){if(value.length>5000)throw Error(`Row ${r}: ${header} is too long`);(item[field.bucket]??={})[field.key]=value}}
  result.push(item)
 }
 if(!result.length)throw Error('No employee rows found')
 const familySheet=book.getWorksheet('Family')
 if(familySheet){if(familySheet.rowCount>1002)throw Error('Maximum 1,000 family rows per upload')
  const familyColumns=new Map<string,number>();familySheet.getRow(2).eachCell({includeEmpty:false},(cell,col)=>{const header=inputText(cell);if(familyColumns.has(header))throw Error(`Duplicate family column: ${header}`);if(!familyHeaders.includes(header))throw Error(`Unknown family column: ${header}`);familyColumns.set(header,col)})
  if(familyHeaders.filter(h=>h!==REF_HEADER&&h!=='Date of Birth').some(h=>!familyColumns.has(h)))throw Error('Family sheet columns are incomplete')
  const byId=new Map(result.filter(r=>r.employeeNo).map(r=>[r.employeeNo,r])),byRef=new Map(result.filter(r=>r.action==='NEW').map(r=>[r.reference!,r])),seenFamily=new Set<string>()
  for(let r=3;r<=familySheet.rowCount;r++){const line=familySheet.getRow(r),get=(h:string)=>familyColumns.has(h)?inputText(line.getCell(familyColumns.get(h)!)):'',id=get(ID_HEADER),ref=familyColumns.has(REF_HEADER)?get(REF_HEADER).toUpperCase():'';if(!hasData(line))continue
   if(id&&ref)throw Error(`Family row ${r}: use Employee ID or NEW Upload reference, not both`)
   if(!id&&!ref)throw Error(`Family row ${r}: Employee ID or NEW Upload reference is required`)
   const owner=id?byId.get(id):byRef.get(ref);if(!owner)throw Error(`Family row ${r}: Employee ID must also appear on Employees sheet`)
   if(get('Employee Name')!==owner.name)throw Error(`Family row ${r}: Employee Name does not match Employees sheet`)
   const type=get('Member Type (Spouse/Child)');if(type!=='Spouse'&&type!=='Child')throw Error(`Family row ${r}: choose Spouse or Child`)
   const number=type==='Spouse'?0:Number(get('Child Number'));if(type==='Child'&&(!Number.isInteger(number)||number<1||number>20))throw Error(`Family row ${r}: Child Number must be 1 to 20`)
   const identifier=`${id||ref}:${type}:${number}`;if(seenFamily.has(identifier))throw Error(`Family member ${identifier} appears more than once`);seenFamily.add(identifier)
   const mode=get(MODE_HEADER).toUpperCase();if(owner.action!=='NEW'&&mode!=='YES'&&mode!=='NO')throw Error(`Family row ${r}: choose YES or NO`)
   const values:Record<string,string>={};for(const [header,key]of [['Member Full Name','full_name'],['Age','age'],['Date of Birth','date_of_birth'],['Pre-existing Conditions','pre_existing_conditions'],['CNIC','cnic']]){const value=get(header);if(value)values[key]=value}
   owner.family.push({type,childNumber:number,replace:owner.action==='NEW'||mode==='YES',values})
  }
 }
 return result
}
export function planUpload(rows:UploadRow[],snapshot:Snapshot,fields:Field[]):PlannedRow[]{
 const employees=new Map(snapshot.employees.map(e=>[e.employee_no,e])),details=new Map(snapshot.details.map(d=>[d.employee_id,d])),families=new Map((snapshot.families??[]).map(f=>[f.employee_id,f])),labels=new Map(fields.map(f=>[`${f.bucket}.${f.key}`,f.header]))
 const normalize=(value:unknown)=>cellText(value).toLowerCase().replace(/[^a-z0-9]/g,'')
 const claimed:UploadRow[]=[]
 for(const row of rows.filter(r=>r.action==='NEW')){
  if(!row.core.full_name?.trim()||!row.core.position_id?.trim())throw Error(`NEW ${row.name}: name and Position ID are required`)
  if(row.core.position_id?.trim()&&!/^[0-9]+$/.test(row.core.position_id.trim()))throw Error(`NEW ${row.name}: Position ID must be numeric`)
  const cnic=normalize(row.profile.cnic_passport),emails=[row.profile.email,row.profile.personal_email].map(normalize).filter(Boolean)
  const duplicate=(name:string,p:Record<string,unknown>)=>normalize(name)===normalize(row.name)||(!!cnic&&normalize(p.cnic_passport)===cnic)||emails.some(x=>[p.email,p.personal_email].map(normalize).includes(x))
  if(snapshot.employees.some(e=>duplicate(e.full_name,snapshot.details.find(d=>d.employee_id===e.id)?.profile??{}))||claimed.some(r=>duplicate(r.name,r.profile)))throw Error(`Possible duplicate for NEW ${row.name}: matching name, CNIC or email. Review before adding.`)
  claimed.push(row)
 }
 return rows.map(row=>{
  const isNew=row.action==='NEW',reference=row.reference||row.employeeNo
  const employee=isNew?{id:reference,employee_no:'',full_name:'',designation:null,department:null,reports_to_text:null,location:null,record_status:null,source_note:null,updated_at:''}:employees.get(row.employeeNo)
  if(!employee)throw Error(`Employee ID ${row.employeeNo} does not exist`)
  const detail=isNew?{employee_id:reference,profile:{},payroll_sep_2026:{},updated_at:''}:details.get(employee.id)
  if(!detail)throw Error(`Employee details missing for ${row.employeeNo}`)
  const family=families.get(employee.id),children=[...(family?.children??[])],planned:PlannedRow={action:isNew?'NEW':'UPDATE',reference,employeeNo:row.employeeNo,name:row.name,replace:row.replace,expectedCoreUpdatedAt:employee.updated_at,expectedDetailsUpdatedAt:detail.updated_at,expectedFamilyUpdatedAt:family?.updated_at??null,core:{},profile:{},payroll:{},control:{},expectedAccount:JSON.stringify((snapshot.accounts??[]).find(a=>a.employee_id===employee.id)??null),family:[],fill:0,overwrite:0,skipped:0,unchanged:0,changes:[]}
  const controlBefore=controlValues(employee,family,(snapshot.accounts??[]).find(a=>a.employee_id===employee.id))
  for(const [key,after] of Object.entries(row.control??{})){
   if(!after||key==='email_verified')continue
   if(controlBefore[key]===after)continue
   if(['account_active','must_change_password'].includes(key)&&!['YES','NO'].includes(after))throw Error('Credential flags must be YES or NO')
   if(key==='employment_state'&&!['active','inactive'].includes(after))throw Error('Employment Status must be active or inactive')
   if(key==='marital_status'&&!['Single','Married'].includes(after))throw Error('Marital Status must be Single or Married')
   if(key==='credential_action'&&!['CREATE','RESET'].includes(after))throw Error('Credential action must be CREATE or RESET')
   const allowed=isNew||row.replace||!controlBefore[key]
   if(allowed){planned.control[key]=after;planned.overwrite++}else planned.skipped++
   planned.changes.push({field:labels.get('control.'+key)??key,before:controlBefore[key]??'',after,action:allowed?'replace':'skip'})
  }
  if(planned.control.login_email&&row.control?.email_verified!=='YES')throw Error('Confirm ownership of the new sign-in email with YES')
  if(planned.control.login_email&&!isNew&&!(snapshot.accounts??[]).some(a=>a.employee_id===employee.id)&&planned.control.credential_action!=='CREATE')throw Error('Choose CREATE to set the sign-in email for an employee without an account')
  if(planned.control.login_email)planned.control.email_verified='YES'
  if(planned.control.credential_action==='RESET'){
   if(planned.control.must_change_password==='NO')throw Error('RESET requires a password change at next sign-in')
   if(controlBefore.must_change_password!=='YES'&&!planned.control.must_change_password){
    planned.control.must_change_password='YES';planned.overwrite++
    planned.changes.push({field:'Credentials | Require Password Change (YES/NO)',before:controlBefore.must_change_password??'',after:'YES',action:'replace'})
   }
  }
  if(planned.control.employment_state==='inactive'&&(!/^\d{4}-\d{2}-\d{2}$/.test(row.control?.leaving_date??'')||(row.control?.status_reason??'').trim().length<5))throw Error('Deactivation requires Leaving Date and a reason of at least five characters')
  if(row.family.length&&(planned.control.marital_status??family?.marital_status)!=='Married'&&('marital_status' in (row.control??{})))throw Error('Select Married before adding family members')
  for(const bucket of ['core','profile','payroll'] as const)for(const [key,after]of Object.entries(row[bucket])){const before=cellText(bucket==='core'?employee[key as keyof EmployeeRow]:bucket==='profile'?(key==='gender'?(detail.profile?.gender||'Male'):(detail.profile??{})[key]):(detail.payroll_sep_2026??{})[key]);if(before===after){planned.unchanged++;continue}
   const action: 'fill'|'replace'|'skip'=before?'replace':'fill';const allowed=action==='fill'||row.replace
   if(allowed){planned[bucket][key]=after;if(action==='fill')planned.fill++;else planned.overwrite++}else planned.skipped++
   planned.changes.push({field:labels.get(`${bucket}.${key}`)??key,before,after,action:allowed?action:'skip'})
  }
  for(const member of [...(row.family??[])].sort((a,b)=>a.childNumber-b.childNumber)){
   const existing=member.type==='Spouse'?family?.spouse:children[member.childNumber-1]
   if(member.type==='Child'&&member.childNumber>children.length+1)throw Error(`Child numbers for ${row.employeeNo} must be consecutive`)
   const proposed:Record<string,string>={...existing,age:existing?String(existing.age):'',...member.values}
   for(const [key,value]of Object.entries(member.values)){const before=cellText(existing?.[key as keyof FamilyMember]);if(before===value){planned.unchanged++;continue}
    const action:'fill'|'replace'|'skip'=before?'replace':'fill',allowed=action==='fill'||member.replace
    if(allowed){if(action==='fill')planned.fill++;else planned.overwrite++}else{planned.skipped++;proposed[key]=before}
    planned.changes.push({field:`Family | ${member.type}${member.type==='Child'?' '+member.childNumber:''} | ${key.replaceAll('_',' ')}`,before,after:value,action:allowed?action:'skip'})
   }
   if(!existing||Object.keys(member.values).some(key=>proposed[key]!==cellText(existing?.[key as keyof FamilyMember]))){
    const age=Number(proposed.age),cnic=(proposed.cnic??'').replace(/[-\s]/g,'')
    if(!proposed.full_name?.trim()||!Number.isInteger(age)||age<0)throw Error(`Family member for ${row.employeeNo} needs a name and whole-number age`)
    if((member.type==='Spouse'||age>=18)&&!cnic)throw Error(`CNIC is required for spouse and adult children of ${row.employeeNo}`)
    if(cnic&&!/^\d{13}$/.test(cnic))throw Error(`Family CNIC for ${row.employeeNo} must be 13 digits`)
    planned.family.push({...member,values:member.values})
    if(member.type==='Child'&&!existing)children.push({full_name:proposed.full_name,age,pre_existing_conditions:proposed.pre_existing_conditions??'',cnic})
   }
  }
  return planned
 })
}
export const fileHash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
