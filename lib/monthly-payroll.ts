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

export async function readMonthlyPayroll(bytes:Buffer,month:string){
 const workbook=new ExcelJS.Workbook()
 const compatibleBytes=await normalizeSpreadsheetXml(bytes)
 await workbook.xlsx.load(compatibleBytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
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
  if(!employeeNo||!sourceName)throw Error('Employee ID and name are required on row '+i+(sourceName?' ('+sourceName+')':''))
  if(ids.has(employeeNo))throw Error('Duplicate employee ID '+employeeNo)
  ids.add(employeeNo)
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
