import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const load=name=>{const compiled=ts.transpileModule(readFileSync(new URL('../lib/'+name,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const out={};new Function('exports',compiled)(out);return out}
const report=load('leave-report.ts'),headOffice=load('head-office-leave.ts')
const person={employee_no:'200023',name:'Zainab Khan',designation:'HR Consultant',department:'Human Resources'}
const summary=[
 {...person,active:true,fy:2026,leave_type:'annual',entitlement:15,opening_taken:0,approved_period:1,pending_period:0.5,approved_fy:2,pending_fy:1,balance:12},
 {...person,active:true,fy:2026,leave_type:'unpaid',entitlement:null,opening_taken:null,approved_period:0,pending_period:17,approved_fy:0,pending_fy:17,balance:null},
 {employee_no:'200084',name:'Mahvesh Zafar',designation:'Manager Human Resources',department:'Human Resources',active:true,fy:2026,leave_type:'casual',entitlement:10,opening_taken:0,approved_period:0.25,pending_period:0,approved_fy:0.25,pending_fy:0,balance:9.75},
 {employee_no:'200012',name:'Hassan Farooq',designation:'CFO',department:'Finance',active:true,fy:2026,leave_type:'annual',entitlement:15,opening_taken:0,approved_period:0,pending_period:0,approved_fy:0,pending_fy:0,balance:15},
]
const detail=[{...person,fy:2026,leave_type:'annual',start_date:'2026-12-24',end_date:'2026-12-28',days:2,days_in_period:1,status:'approved',reason:'=SUM(A1)',applied_at:'2026-11-12T10:00:00+00:00',decided_at:'2026-11-13T09:00:00+00:00',decided_by:'Huzaifa Siddiqi'},
 {...person,fy:2026,leave_type:'sick',start_date:'2026-12-01',end_date:'2026-12-01',days:1,days_in_period:1,status:'rejected',reason:'x',applied_at:'2026-11-12T10:00:00+00:00',decided_at:null,decided_by:null}]
const data={from:'2026-07-01',to:'2027-06-30',summary,detail}
test('fiscal years run July to June and are labelled by both years',()=>{
 assert.equal(report.fiscalYearOf('2026-06-30'),2025)
 assert.equal(report.fiscalYearOf('2026-07-01'),2026)
 assert.equal(report.fiscalYearLabel(2026),'FY 26-27')
 assert.equal(report.fiscalYearLabel(2099),'FY 99-00')
 assert.equal(headOffice.fyLabel(2026),'FY 26-27')
 assert.deepEqual(report.fiscalYearPeriod(2026),{from:'2026-07-01',to:'2027-06-30'})
})
test('report period must be valid dates in order and at most three years',()=>{
 assert.equal(report.validPeriod('2026-07-01','2027-06-30'),true)
 assert.equal(report.validPeriod('2026-07-01','2026-07-01'),true)
 for(const [a,b] of [['2027-06-30','2026-07-01'],['2026-02-30','2026-03-01'],['','2026-07-01'],['2026-07-01','2030-07-01'],[null,undefined]])assert.equal(report.validPeriod(a,b),false)
})
test('filters select one, several or all employees and combine with department, designation, type and search',()=>{
 const f=report.emptyFilter
 assert.equal(report.applyFilter(data,f).summary.length,4)
 assert.equal(report.applyFilter(data,{...f,employees:['200023']}).summary.length,2)
 assert.equal(report.applyFilter(data,{...f,employees:['200023','200012']}).summary.length,3)
 assert.equal(report.applyFilter(data,{...f,department:'Human Resources'}).summary.length,3)
 assert.equal(report.applyFilter(data,{...f,designation:'CFO'}).summary.length,1)
 assert.equal(report.applyFilter(data,{...f,leaveType:'annual'}).summary.length,2)
 assert.equal(report.applyFilter(data,{...f,search:' mahvesh '}).summary.length,1)
 assert.equal(report.applyFilter(data,{...f,search:'20001'}).summary.length,1)
 assert.equal(report.applyFilter(data,{...f,department:'Finance',employees:['200023']}).summary.length,0)
 assert.equal(report.applyFilter(data,{...f,leaveType:'sick'}).detail.length,1)
})
test('summary and detail rows follow their column order',()=>{
 assert.equal(report.summaryCells(summary[0]).length,report.summaryColumns.length)
 assert.deepEqual(report.summaryCells(summary[0]),['200023','Zainab Khan','HR Consultant','Human Resources','FY 26-27','Annual Leave',15,0,1,0.5,2,1,12])
 assert.deepEqual(report.summaryCells(summary[1]).slice(5),['Leave Without Pay',null,null,0,17,0,17,null])
 assert.equal(report.detailCells(detail[0]).length,report.detailColumns.length)
 assert.deepEqual(report.detailCells(detail[0]).slice(6,11),['24/12/2026','28/12/2026',2,1,'Approved'])
 assert.equal(report.detailCells(detail[1])[9],null)
 assert.equal(report.summaryCells({...summary[0],approved_period:0.3333333}).at(8),0.33)
})
test('download filter input is reduced to known text fields',()=>{
 assert.deepEqual(report.cleanFilter(null),report.emptyFilter)
 assert.deepEqual(report.cleanFilter({employees:['200023',5,null],department:7,search:'a',extra:'x'}),{employees:['200023'],department:'',designation:'',leaveType:'',search:'a'})
})
