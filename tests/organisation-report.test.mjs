import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const code=ts.transpileModule(readFileSync(new URL('../lib/organisation-report.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
const exports={};new Function('exports',code)(exports)
const {buildOrganisationReport}=exports
const source={employees:[{id:'ceo',employee_no:'200001',full_name:'CEO',position_id:1,employment_state:'active'},{id:'e',employee_no:'200002',full_name:'Employee',position_id:3,employment_state:'active'}],positions:[{id:1,position_code:'P1',position_title:'CEO',department_id:1,designation_id:1,is_reporting_root:true},{id:2,position_code:'P2',position_title:'Vacant manager',department_id:1,designation_id:1,reports_to_position_id:1},{id:3,position_code:'P3',position_title:'Employee',department_id:1,designation_id:1,reports_to_position_id:2}],subDepartments:[{id:1,name:'Sub',parent_department_id:'DPT 1'}],departments:[{id:'DPT 1',name:'Dept'}],designations:[{id:1,title:'Executive'}],details:[]}
test('valid root excluded, vacancy fallback retained with organisation IDs',()=>{
 const report=buildOrganisationReport(source)
 assert.equal(report.rows.length,1)
 assert.equal(report.rows[0].Issue,'Vacant parent: fallback required')
 assert.equal(report.rows[0]['Position ID'],'P3')
 assert.equal(report.rows[0]['Department ID'],'DPT 1')
})
test('flags missing assignments and legacy manager conflicts, excludes inactive employees',()=>{
 const rows=buildOrganisationReport({...source,employees:[...source.employees,{id:'bad',employee_no:'3',employment_state:'active'},{id:'inactive',employment_state:'inactive'}],details:[{employee_id:'e',profile:{line_manager_employee_no:'999'}}]}).rows
 assert.equal(rows.filter(r=>r.Issue==='Employee without valid position').length,1)
 assert.equal(rows.filter(r=>r.Issue==='Legacy manager conflicts with hierarchy').length,1)
})
test('detects missing mappings, designation and circular reporting without looping',()=>{
 const rows=buildOrganisationReport({...source,employees:[],positions:[{id:4,reports_to_position_id:5},{id:5,reports_to_position_id:4}],subDepartments:[{id:2}]}).rows
 for(const issue of ['Circular reporting chain','Position without valid designation','Position without valid sub-department','Sub-department without valid department'])assert.ok(rows.some(r=>r.Issue===issue))
})
