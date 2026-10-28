import ExcelJS from 'exceljs'
import {createHash} from 'node:crypto'
import {fieldKey,sections,payrollKeys} from '../app/employees/field-config'

export type Bucket='core'|'profile'|'payroll'
export type Field={header:string;bucket:Bucket;key:string}
export type EmployeeRow={id:string;employee_no:string;full_name:string;designation:string|null;department:string|null;reports_to_text:string|null;location:string|null;record_status:string|null;source_note:string|null;updated_at:string}
export type DetailRow={employee_id:string;profile:Record<string,unknown>|null;payroll_aug_2026:Record<string,unknown>|null;updated_at:string}
export type FamilyMember={full_name:string;age:number;pre_existing_conditions:string;cnic:string}
export type FamilyRecord={employee_id:string;spouse:FamilyMember|null;children:FamilyMember[]|null;updated_at:string}
export type Snapshot={employees:EmployeeRow[];details:DetailRow[];families?:FamilyRecord[]}
export type FamilyInput={type:'Spouse'|'Child';childNumber:number;replace:boolean;values:Record<string,string>}
export type UploadRow={employeeNo:string;name:string;replace:boolean;core:Record<string,string>;profile:Record<string,string>;payroll:Record<string,string>;family:FamilyInput[]}
export type PlannedRow={employeeNo:string;name:string;replace:boolean;expectedCoreUpdatedAt:string;expectedDetailsUpdatedAt:string;expectedFamilyUpdatedAt:string|null;core:Record<string,string>;profile:Record<string,string>;payroll:Record<string,string>;family:FamilyInput[];fill:number;overwrite:number;skipped:number;unchanged:number;changes:{field:string;before:string;after:string;action:'fill'|'replace'|'skip'}[]}

const coreFields:Field[]=[
 {header:'Employee Name',bucket:'core',key:'full_name'},
 {header:'Designation',bucket:'core',key:'designation'},
 {header:'Department',bucket:'core',key:'department'},
 {header:'Reports To',bucket:'core',key:'reports_to_text'},
 {header:'Location',bucket:'core',key:'location'},
 {header:'Record Status',bucket:'core',key:'record_status'},
 {header:'Source / Verification Note',bucket:'core',key:'source_note'},
]
export const ID_HEADER='Employee ID'
export const MODE_HEADER='Replace existing values? (YES/NO)'
const familyHeaders=[ID_HEADER,'Employee Name','Member Type (Spouse/Child)','Child Number',MODE_HEADER,'Member Full Name','Age','Pre-existing Conditions','CNIC']
const reserved=new Set([ID_HEADER,MODE_HEADER])
export function fieldsFor(snapshot:Snapshot):Field[]{
 const profile=new Map<string,string>(),payroll=new Map<string,string>()
 for(const section of sections)for(const label of section.labels){const key=fieldKey(label);(payrollKeys.has(label)?payroll:profile).set(key,label)}
 for(const detail of snapshot.details){for(const key of Object.keys(detail.profile??{}))if(!profile.has(key))profile.set(key,key.replaceAll('_',' '));for(const key of Object.keys(detail.payroll_aug_2026??{}))if(!payroll.has(key))payroll.set(key,key.replaceAll('_',' '))}
 return [...coreFields,...[...profile].map(([key,label])=>({header:`Profile | ${label}`,bucket:'profile' as const,key})),...[...payroll].map(([key,label])=>({header:`August 2026 Payroll | ${label}`,bucket:'payroll' as const,key}))]
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
  'Match rows by the six-digit Employee ID. Employee Name is included for review and may be corrected.',
  'Put new values in the relevant columns. Blank upload cells do not erase stored values.',
  'Set Replace existing values? to YES for an employee only when differing populated values should be overwritten. NO fills empty fields only.',
  'Upload the file in Employee Directory > Bulk upload. Review every proposed change before applying.',
  'For spouse and children, use the Family sheet. Identify children by Child Number; blanks do not erase existing values.',
  'Keep CNIC, account numbers and other identifiers as text. Editing a profile email does not change the linked sign-in email.',
  'Employee status, account login, passwords, leave settings and audit records use separate workflows.',
 ])guide.addRow([line])
 guide.getColumn(1).width=115;guide.getRow(1).font={bold:true,size:16,color:{argb:'FF15568E'}}
 const fields=fieldsFor(snapshot),headers=[ID_HEADER,MODE_HEADER,...fields.map(f=>f.header)]
 sheet.addRow(['Edit this copy, then upload it. Row 2 contains column headings; data starts on row 3. Leave a cell blank to leave that field unchanged.'])
 sheet.addRow(headers);reference.addRow(['Reference only. Current values at download time; edits on this sheet are not uploaded.']);reference.addRow(headers)
 const details=new Map(snapshot.details.map(d=>[d.employee_id,d]))
 for(const employee of snapshot.employees){const detail=details.get(employee.id),profile=detail?.profile??{},payroll=detail?.payroll_aug_2026??{}
  const row=sheet.addRow([employee.employee_no,'NO',employee.full_name,...fields.slice(1).map(()=>'')])
  row.getCell(1).numFmt='@';row.getCell(1).alignment={horizontal:'left'}
  reference.addRow([employee.employee_no,'',...fields.map(f=>cellText(f.bucket==='core'?employee[f.key as keyof EmployeeRow]:f.bucket==='profile'?profile[f.key]:payroll[f.key]))])
 }
 sheet.views=[{state:'frozen',xSplit:2,ySplit:2}]
 sheet.getRow(1).font={bold:true,color:{argb:'FF15568E'}};sheet.getRow(1).height=28
 sheet.getRow(2).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(2).height=32
 sheet.getRow(2).eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF15568E'}};cell.alignment={vertical:'middle',wrapText:true}})
 sheet.getColumn(1).width=17;sheet.getColumn(2).width=32
 for(let c=3;c<=headers.length;c++)sheet.getColumn(c).width=c===3?28:25
 for(let r=3;r<=Math.max(1000,sheet.rowCount);r++)sheet.getCell(r,2).dataValidation={type:'list',allowBlank:false,formulae:['"NO,YES"'],showErrorMessage:true,error:'Choose NO or YES'}
 sheet.autoFilter={from:{row:2,column:1},to:{row:sheet.rowCount,column:headers.length}}
 reference.views=[{state:'frozen',xSplit:2,ySplit:2}];reference.getRow(2).font={bold:true,color:{argb:'FFFFFFFF'}};reference.getRow(2).eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF607488'}};cell.alignment={wrapText:true}});reference.getColumn(1).width=17;reference.getColumn(2).width=15;for(let c=3;c<=headers.length;c++)reference.getColumn(c).width=c===3?28:25
 familySheet.addRow(['Add a spouse or child on a new row. Use Child Number 1, 2, 3... in order. Existing members appear below with data cells blank.']);familySheet.addRow(familyHeaders)
 familyReference.addRow(['Reference only. Current family values at download time; edits here are not uploaded.']);familyReference.addRow(familyHeaders)
 const employeesById=new Map(snapshot.employees.map(e=>[e.id,e]))
 for(const family of snapshot.families??[]){const employee=employeesById.get(family.employee_id);if(!employee)continue
  const members=[...(family.spouse?[{type:'Spouse',number:0,member:family.spouse}]:[]),...(family.children??[]).map((member,index)=>({type:'Child',number:index+1,member}))]
  for(const {type,number,member} of members){familySheet.addRow([employee.employee_no,employee.full_name,type,number||'', 'NO','','','','']);familyReference.addRow([employee.employee_no,employee.full_name,type,number||'','',member.full_name,member.age,member.pre_existing_conditions,member.cnic])}
 }
 for(const tab of [familySheet,familyReference]){tab.views=[{state:'frozen',xSplit:2,ySplit:2}];tab.getRow(2).font={bold:true,color:{argb:'FFFFFFFF'}};tab.getRow(2).eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:tab===familySheet?'FF15568E':'FF607488'}};cell.alignment={wrapText:true}});for(let c=1;c<=familyHeaders.length;c++)tab.getColumn(c).width=c===2||c===6?30:22}
 for(let r=3;r<=Math.max(300,familySheet.rowCount);r++)familySheet.getCell(r,5).dataValidation={type:'list',allowBlank:false,formulae:['"NO,YES"']}
 const bytes=await book.xlsx.writeBuffer();return Buffer.from(bytes)
}
export async function parseWorkbook(bytes:Buffer,fields:Field[]):Promise<UploadRow[]>{
 const book=new ExcelJS.Workbook();await book.xlsx.load(bytes as unknown as ExcelJS.Buffer)
 const sheet=book.getWorksheet('Employees');if(!sheet)throw Error('The Employees sheet is missing')
 if(sheet.rowCount>1002)throw Error('Maximum 1,000 employee rows per upload')
 const known=new Map(fields.map(f=>[f.header,f]));const headers=new Map<string,number>()
 sheet.getRow(2).eachCell({includeEmpty:false},(cell,col)=>{const header=inputText(cell);if(headers.has(header))throw Error(`Duplicate column: ${header}`);if(header&&!known.has(header)&&!reserved.has(header))throw Error(`Unknown column: ${header}`);headers.set(header,col)})
 if(!headers.has(ID_HEADER)||!headers.has('Employee Name')||!headers.has(MODE_HEADER))throw Error('Employee ID, Employee Name and replacement choice columns are required')
 const result:UploadRow[]=[],seen=new Set<string>()
 for(let r=3;r<=sheet.rowCount;r++){const row=sheet.getRow(r),employeeNo=inputText(row.getCell(headers.get(ID_HEADER)!));if(!employeeNo){if(hasData(row))throw Error(`Row ${r}: Employee ID is required`);continue}
  if(!/^\d{6}$/.test(employeeNo))throw Error(`Row ${r}: Employee ID must be six digits`)
  if(seen.has(employeeNo))throw Error(`Employee ID ${employeeNo} appears more than once`);seen.add(employeeNo)
  const name=inputText(row.getCell(headers.get('Employee Name')!));if(!name)throw Error(`Row ${r}: Employee Name is required`)
  const mode=inputText(row.getCell(headers.get(MODE_HEADER)!)).toUpperCase();if(mode!=='YES'&&mode!=='NO')throw Error(`Row ${r}: choose YES or NO for replacement`)
  const item:UploadRow={employeeNo,name,replace:mode==='YES',core:{},profile:{},payroll:{},family:[]}
  for(const [header,col]of headers){const field=known.get(header);if(!field)continue;const value=inputText(row.getCell(col));if(value){if(value.length>5000)throw Error(`Row ${r}: ${header} is too long`);item[field.bucket][field.key]=value}}
  result.push(item)
 }
 if(!result.length)throw Error('No employee rows found')
 const familySheet=book.getWorksheet('Family')
 if(familySheet){if(familySheet.rowCount>1002)throw Error('Maximum 1,000 family rows per upload')
  const familyColumns=new Map<string,number>();familySheet.getRow(2).eachCell({includeEmpty:false},(cell,col)=>{const header=inputText(cell);if(familyColumns.has(header))throw Error(`Duplicate family column: ${header}`);if(!familyHeaders.includes(header))throw Error(`Unknown family column: ${header}`);familyColumns.set(header,col)})
  if(familyHeaders.some(h=>!familyColumns.has(h)))throw Error('Family sheet columns are incomplete')
  const byId=new Map(result.map(r=>[r.employeeNo,r])),seenFamily=new Set<string>()
  for(let r=3;r<=familySheet.rowCount;r++){const line=familySheet.getRow(r),get=(h:string)=>inputText(line.getCell(familyColumns.get(h)!)),id=get(ID_HEADER);if(!id){if(hasData(line))throw Error(`Family row ${r}: Employee ID is required`);continue}
   const owner=byId.get(id);if(!owner)throw Error(`Family row ${r}: Employee ID must also appear on Employees sheet`)
   if(get('Employee Name')!==owner.name)throw Error(`Family row ${r}: Employee Name does not match Employees sheet`)
   const type=get('Member Type (Spouse/Child)');if(type!=='Spouse'&&type!=='Child')throw Error(`Family row ${r}: choose Spouse or Child`)
   const number=type==='Spouse'?0:Number(get('Child Number'));if(type==='Child'&&(!Number.isInteger(number)||number<1||number>20))throw Error(`Family row ${r}: Child Number must be 1 to 20`)
   const identifier=`${id}:${type}:${number}`;if(seenFamily.has(identifier))throw Error(`Family member ${identifier} appears more than once`);seenFamily.add(identifier)
   const mode=get(MODE_HEADER).toUpperCase();if(mode!=='YES'&&mode!=='NO')throw Error(`Family row ${r}: choose YES or NO`)
   const values:Record<string,string>={};for(const [header,key]of [['Member Full Name','full_name'],['Age','age'],['Pre-existing Conditions','pre_existing_conditions'],['CNIC','cnic']]){const value=get(header);if(value)values[key]=value}
   owner.family.push({type,childNumber:number,replace:mode==='YES',values})
  }
 }
 return result
}
export function planUpload(rows:UploadRow[],snapshot:Snapshot,fields:Field[]):PlannedRow[]{
 const employees=new Map(snapshot.employees.map(e=>[e.employee_no,e])),details=new Map(snapshot.details.map(d=>[d.employee_id,d])),families=new Map((snapshot.families??[]).map(f=>[f.employee_id,f])),labels=new Map(fields.map(f=>[`${f.bucket}.${f.key}`,f.header]))
 return rows.map(row=>{const employee=employees.get(row.employeeNo);if(!employee)throw Error(`Employee ID ${row.employeeNo} does not exist`)
  const detail=details.get(employee.id);if(!detail)throw Error(`Employee details missing for ${row.employeeNo}`)
  const family=families.get(employee.id),children=[...(family?.children??[])],planned:PlannedRow={employeeNo:row.employeeNo,name:row.name,replace:row.replace,expectedCoreUpdatedAt:employee.updated_at,expectedDetailsUpdatedAt:detail.updated_at,expectedFamilyUpdatedAt:family?.updated_at??null,core:{},profile:{},payroll:{},family:[],fill:0,overwrite:0,skipped:0,unchanged:0,changes:[]}
  for(const bucket of ['core','profile','payroll'] as const)for(const [key,after]of Object.entries(row[bucket])){const before=cellText(bucket==='core'?employee[key as keyof EmployeeRow]:bucket==='profile'?(detail.profile??{})[key]:(detail.payroll_aug_2026??{})[key]);if(before===after){planned.unchanged++;continue}
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
