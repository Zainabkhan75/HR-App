import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import {fieldKey,payrollFields} from '../app/employees/field-config'

// ExcelJS expects unprefixed SpreadsheetML element names. The Bandana
// template exporter writes the same elements with the x: prefix.
async function normalizeSpreadsheetXml(bytes:Buffer){
 const zip=await JSZip.loadAsync(bytes)
 const declaration='xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
 let changed=false
 for(const [path,entry] of Object.entries(zip.files)){
  if(!/^xl\/(?:workbook|styles|sharedStrings|worksheets\/sheet\d+|tables\/table\d+)\.xml$/.test(path))continue
  const xml=await entry.async('string')
  if(!xml.includes(declaration))continue
  zip.file(path,xml.replace(/<x:tableParts\b[^>]*>[\s\S]*?<\/x:tableParts>/g,'')
   .replace(declaration,declaration.replace('xmlns:x','xmlns')).replace(/(<\/?)(x:)(?=[A-Za-z])/g,'$1'))
  changed=true
 }
 return changed?zip.generateAsync({type:'nodebuffer'}):bytes
}

async function openWorkbook(bytes:Buffer){
 const workbook=new ExcelJS.Workbook()
 const compatibleBytes=await normalizeSpreadsheetXml(bytes)
 await workbook.xlsx.load(compatibleBytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
 return workbook
}

function payrollRows(workbook:ExcelJS.Workbook,month:string,approvedNew:Set<string>){
 const sheet=workbook.getWorksheet('Payroll')
 if(!sheet||sheet.rowCount>2005)throw Error('Use the standard Payroll sheet with up to 2,000 rows.')
 const headings=['Payroll Month',...payrollFields]
 if(headings.some((label,i)=>sheet.getRow(5).getCell(i+1).text.trim()!==label)){
  throw Error('Payroll headers on row 5 do not match the standard template.')
 }
 const rows:{employeeNo:string;sourceName:string;fields:Record<string,string>;netCents:number}[]=[]
 const ids=new Set<string>()
 for(let i=6;i<=sheet.rowCount;i++){
  const row=sheet.getRow(i)
  if(!headings.some((_,col)=>row.getCell(col+1).text.trim()))continue
  const employeeNo=row.getCell(2).text.trim(),sourceName=row.getCell(3).text.trim()
  if(row.getCell(1).text.trim()!==month)throw Error('Payroll month differs from the selected month on row '+i)
  if(!sourceName||(!employeeNo&&!approvedNew.has(payrollName(sourceName))))throw Error('Employee ID and name are required on row '+i+(sourceName?' ('+sourceName+')':''))
  const key=employeeNo||payrollName(sourceName)
  if(ids.has(key))throw Error('Duplicate payroll employee '+key)
  ids.add(key)
  const fields:Record<string,string>={}
  for(let col=4;col<=headings.length;col++){
   if(col===5||col===6)continue
   const cell=row.getCell(col),value=cell.value
   if(value==null||value==='')continue
   if(col===4){fields[fieldKey(headings[col-1])]=cell.text.trim();continue}
   if(typeof value!=='number'||!Number.isFinite(value))throw Error('Enter a numeric '+headings[col-1]+' on row '+i)
   fields[fieldKey(headings[col-1])]=String(value)
  }
  if(fields.payable_salary_rs===undefined)throw Error('Payable Salary is required on row '+i)
  const netCents=Math.round(Number(fields.payable_salary_rs)*100)
  if(!Number.isSafeInteger(netCents))throw Error('Payable Salary is outside the supported range on row '+i)
  rows.push({employeeNo,sourceName,fields,netCents})
 }
 if(!rows.length)throw Error('No payroll rows found.')
 return rows
}

export async function readMonthlyPayroll(bytes:Buffer,month:string){
 return payrollRows(await openWorkbook(bytes),month,new Set())
}

export const payrollName=(value:string)=>value.trim().toLowerCase().replace(/\s+/g,' ')
type ReviewChange={name:string;employeeNo:string;field:string;value:string;row:number}

function reviewDate(value:string,row:number){
 const normalized=value.trim().replace(/\s+/g,' ')
 const iso=normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/)
 const written=normalized.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+) (\d{2}|\d{4})$/i)
 const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
 const parts=iso?[Number(iso[1]),Number(iso[2]),Number(iso[3])]:written?
  [Number(written[3])+(written[3].length===2?2000:0),months.indexOf(written[2].slice(0,3).toLowerCase())+1,Number(written[1])]:[]
 const [year,month,day]=parts
 const date=new Date(Date.UTC(year,month-1,day))
 if(!year||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw Error('Invalid approved date on Review row '+row)
 return date.toISOString().slice(0,10)
}

export async function readPayrollCycle(bytes:Buffer,month:string){
 const workbook=await openWorkbook(bytes)
 const period=new Intl.DateTimeFormat('en',{month:'long',timeZone:'UTC'}).format(new Date(month+'-01'))
 const reviewTabs=workbook.worksheets.filter(sheet=>/\breview$/i.test(sheet.name.trim()))
 if(reviewTabs.length>1)throw Error('Keep only one Review tab in the payroll workbook.')
 const review=reviewTabs[0]
 if(review&&![period.toLowerCase()+' review','review'].includes(review.name.trim().toLowerCase())){
  throw Error('Rename the review tab to '+period+' Review or Review before uploading.')
 }
 const changes:ReviewChange[]=[]
 const approvedNew=new Map<string,{name:string;designation:string}>()
 const aliases=new Map<string,string>()
 if(review){
  if(review.rowCount>2001||review.getRow(1).getCell(8).text.trim()!=='Your Decision')throw Error('Review tab layout does not match the payroll template.')
  review.eachRow((row,index)=>{
   if(index===1)return
   const decision=row.getCell(8).text.trim(),name=row.getCell(2).text.trim(),employeeNo=row.getCell(1).text.trim()
   const field=row.getCell(3).text.trim(),value=row.getCell(5).text.trim(),key=payrollName(name)
   if(!decision||/^(hr app$|hold\b|pending$|leave as is\b|close duplicate flag\b|ignore\b|random entry\b)/i.test(decision))return
   if(!name)throw Error('Employee name is missing on Review row '+index)
   const alias=decision.match(/^Same person:\s*(\d+)\b/i)
   if(alias){
    if((employeeNo&&employeeNo!==alias[1])||(aliases.has(key)&&aliases.get(key)!==alias[1]))throw Error('Conflicting employee ID on Review row '+index)
    aliases.set(key,alias[1]);return
   }
   if(/\bcreate (?:new )?employee\b/i.test(decision)&&/^(Employee Match|New Joiner)$/i.test(field)){
    const designation=row.getCell(7).text.match(/(?:^|;)\s*role:\s*([^;]+)/i)?.[1]?.trim()??''
    if(approvedNew.has(key))throw Error('Duplicate new employee decision on Review row '+index)
    approvedNew.set(key,{name,designation});return
   }
   if(/^make inactive\b/i.test(decision)&&/leaving date unknown/i.test(decision)){
    changes.push({name,employeeNo,field:'deactivate',value:'',row:index});return
   }
   const leaving=decision.match(/^Last Date (.+?)\s+-\s+to be entered/i)
   if(leaving){
    const date=leaving[1].replace(/^([a-z]+) (\d+(?:st|nd|rd|th)?) (\d{4})$/i,'$2 $1 $3')
    changes.push({name,employeeNo,field:'deactivate',value:reviewDate(date,index),row:index});return
   }
   if(/^add to card number field in hr app$/i.test(decision)&&/^\d+$/.test(value)){
    changes.push({name,employeeNo,field:'new_card',value,row:index});return
   }
   if(/^use oct(?:ober)? payroll$|^use payroll$/i.test(decision)){
    const fields:Record<string,string>={'Date of Joining':'date_of_joining',Designation:'designation',Department:'department',Location:'location','Card Number':'new_card','New Card #':'new_card',Notes:'notes'}
    if(fields[field]&&value){
     changes.push({name,employeeNo,field:fields[field],value:field==='Date of Joining'?reviewDate(value,index):value,row:index});return
    }
   }
   throw Error('Unrecognized decision on Review row '+index+': '+decision)
  })
 }
 const rows=payrollRows(workbook,month,new Set([...approvedNew.keys(),...aliases.keys()]))
 return {rows,changes,approvedNew,aliases}
}
