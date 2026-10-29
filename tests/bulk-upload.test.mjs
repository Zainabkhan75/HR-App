import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import ts from 'typescript'

const nodeRequire=createRequire(import.meta.url)
function load(path,overrides={}){const source=readFileSync(new URL(path,import.meta.url),'utf8'),compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,module={exports:{}};new Function('require','module','exports',compiled)((name)=>overrides[name]??nodeRequire(name),module,module.exports);return module.exports}
const config=load('../app/employees/field-config.ts')
const bulk=load('../lib/bulk-upload.ts',{'../app/employees/field-config':config})
const snapshot={employees:[{id:'e1',employee_no:'100001',full_name:'Existing Person',designation:'Advisor',department:null,reports_to_text:null,location:null,record_status:null,source_note:null,updated_at:'2026-10-28T10:00:00Z'}],details:[{employee_id:'e1',profile:{mobile:'03000000000',bank_account_number:'000123'},payroll_aug_2026:{payroll_fixed_salary_aug_2026_pkr:'80000'},updated_at:'2026-10-28T10:00:00Z'}]}

test('composite template prefills latest values and keeps current-data reference sheets',async()=>{
 const bytes=await bulk.template(snapshot),ExcelJS=nodeRequire('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.load(bytes)
 const upload=book.getWorksheet('Employees'),current=book.getWorksheet('Current data')
 assert.equal(upload.getCell('A3').value,'100001')
 assert.equal(upload.getCell('B3').value,'NO')
 const headers=upload.getRow(2).values
 const bankColumn=headers.indexOf('Profile | Bank Account Number')
 assert.ok(bankColumn>0)
 assert.equal(upload.getRow(3).getCell(bankColumn).value,'000123')
 assert.equal(current.getRow(3).getCell(bankColumn).value,'000123')
 const parsed=await bulk.parseWorkbook(Buffer.from(bytes),bulk.fieldsFor(snapshot))
 const planned=bulk.planUpload(parsed,snapshot,bulk.fieldsFor(snapshot))[0]
 assert.equal(planned.fill+planned.overwrite+planned.skipped,0)
})
test('NO fills blanks and skips existing values; YES replaces only entered fields',()=>{
 const fields=bulk.fieldsFor(snapshot)
 const row={employeeNo:'100001',name:'Existing Person',replace:false,core:{full_name:'Existing Person',department:'Retail'},profile:{mobile:'03111111111'},payroll:{},family:[]}
 const no=bulk.planUpload([row],snapshot,fields)[0]
 assert.equal(no.fill,1);assert.equal(no.overwrite,0);assert.equal(no.skipped,1)
 assert.deepEqual(no.core,{department:'Retail'});assert.deepEqual(no.profile,{})
 const yes=bulk.planUpload([{...row,replace:true}],snapshot,fields)[0]
 assert.equal(yes.fill,1);assert.equal(yes.overwrite,1);assert.equal(yes.profile.mobile,'03111111111')
})
test('parser rejects formula cells and duplicate employee IDs',async()=>{
 const ExcelJS=nodeRequire('exceljs'),book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Employees')
 sheet.addRow(['Instruction']);sheet.addRow(['Employee ID','Replace existing values? (YES/NO)','Employee Name','Designation'])
 sheet.addRow(['100001','NO','Existing Person',{formula:'1+1',result:2}])
 const first=Buffer.from(await book.xlsx.writeBuffer());await assert.rejects(()=>bulk.parseWorkbook(first,bulk.fieldsFor(snapshot)),/Unsupported cell/)
 sheet.getCell('D3').value='Advisor';sheet.addRow(['100001','NO','Existing Person',''])
 const second=Buffer.from(await book.xlsx.writeBuffer());await assert.rejects(()=>bulk.parseWorkbook(second,bulk.fieldsFor(snapshot)),/appears more than once/)
})
test('family additions require complete spouse details and consecutive child numbers',()=>{
 const base={employeeNo:'100001',name:'Existing Person',replace:false,core:{full_name:'Existing Person'},profile:{},payroll:{},family:[{type:'Spouse',childNumber:0,replace:false,values:{full_name:'Partner',age:'30',cnic:'1234567890123'}}]}
 const spouse=bulk.planUpload([base],snapshot,bulk.fieldsFor(snapshot))[0]
 assert.equal(spouse.family.length,1);assert.equal(spouse.fill,3)
 assert.throws(()=>bulk.planUpload([{...base,family:[{type:'Child',childNumber:2,replace:false,values:{full_name:'Child',age:'5'}}]}],snapshot,bulk.fieldsFor(snapshot)),/consecutive/)
 assert.throws(()=>bulk.planUpload([{...base,family:[{type:'Spouse',childNumber:0,replace:false,values:{full_name:'Partner',age:'30'}}]}],snapshot,bulk.fieldsFor(snapshot)),/CNIC/)
})
test('family worksheet rows match employee ID and parse into the same upload',async()=>{
 const ExcelJS=nodeRequire('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.load(await bulk.template(snapshot))
 const family=book.getWorksheet('Family');family.getRow(3).values=['100001','Existing Person','Child',1,'NO','Young Person',5,'','']
 const rows=await bulk.parseWorkbook(Buffer.from(await book.xlsx.writeBuffer()),bulk.fieldsFor(snapshot))
 assert.equal(rows[0].family.length,1)
 assert.equal(rows[0].family[0].values.full_name,'Young Person')
})
test('data without an employee ID is rejected instead of silently skipped',async()=>{
 const ExcelJS=nodeRequire('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.load(await bulk.template(snapshot))
 const sheet=book.getWorksheet('Employees'),row=sheet.addRow([]);row.getCell(2).value='NO';row.getCell(3).value='UPDATE';row.getCell(5).value='New Person'
 const bytes=Buffer.from(await book.xlsx.writeBuffer())
 await assert.rejects(()=>bulk.parseWorkbook(bytes,bulk.fieldsFor(snapshot)),/Employee ID is required/)
})

test('NEW rows keep ID blank, link family by reference and ignore replacement flag',async()=>{
 const ExcelJS=nodeRequire('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.load(await bulk.template(snapshot))
 const sheet=book.getWorksheet('Employees'),headers=sheet.getRow(2).values,row=sheet.addRow([])
 const put=(name,value)=>{row.getCell(headers.indexOf(name)).value=value}
 put('Employee ID','');put('Action (NEW/UPDATE)','NEW');put('Upload reference','NEW-01')
 put('Employee Name','Entirely New Person');put('Designation','Sales Executive');put('Department','Retail Ops')
 book.getWorksheet('Family').addRow(['','Entirely New Person','Child',1,'','Child',5,'','','NEW-01'])
 const parsed=await bulk.parseWorkbook(Buffer.from(await book.xlsx.writeBuffer()),bulk.fieldsFor(snapshot))
 const added=parsed.find(r=>r.action==='NEW');assert.equal(added.reference,'NEW-01');assert.equal(added.employeeNo,'');assert.equal(added.family.length,1)
 const planned=bulk.planUpload(parsed,snapshot,bulk.fieldsFor(snapshot));assert.equal(planned.at(-1).action,'NEW');assert.ok(planned.at(-1).fill>=3)
})
test('NEW duplicate name, CNIC and email are held, including duplicates within the upload',()=>{
 const fields=bulk.fieldsFor(snapshot),fresh={action:'NEW',reference:'NEW-01',employeeNo:'',name:'New Person',replace:true,core:{full_name:'New Person',designation:'Advisor',department:'Retail'},profile:{},payroll:{},family:[]}
 assert.throws(()=>bulk.planUpload([{...fresh,name:'Existing Person',core:{...fresh.core,full_name:'Existing Person'}}],snapshot,fields),/Possible duplicate/)
 const identity={...snapshot,details:[{...snapshot.details[0],profile:{email:'staff@example.com',cnic_passport:'1234567890123'}}]}
 for(const profile of [{personal_email:'staff@example.com'},{cnic_passport:'12345-6789012-3'}])assert.throws(()=>bulk.planUpload([{...fresh,profile}],identity,fields),/Possible duplicate/)
 assert.throws(()=>bulk.planUpload([fresh,{...fresh,reference:'NEW-02'}],snapshot,fields),/Possible duplicate/)
 assert.throws(()=>bulk.planUpload([{...fresh,core:{full_name:'New Person'}}],snapshot,fields),/required/)
})
test('NEW rows reject supplied IDs and UPDATE keeps mandatory YES/NO',async()=>{
 const ExcelJS=nodeRequire('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.load(await bulk.template(snapshot))
 const sheet=book.getWorksheet('Employees');sheet.getCell('C3').value='NEW'
 await assert.rejects(()=>bulk.parseWorkbook(Buffer.from(await book.xlsx.writeBuffer()),bulk.fieldsFor(snapshot)),/leave Employee ID blank/)
 sheet.getCell('C3').value='UPDATE';sheet.getCell('B3').value=''
 await assert.rejects(()=>bulk.parseWorkbook(Buffer.from(await book.xlsx.writeBuffer()),bulk.fieldsFor(snapshot)),/choose YES or NO/)
})
