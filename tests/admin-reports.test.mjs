import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

function load(path, imports = {}) {
 const source = readFileSync(new URL(path, import.meta.url),'utf8')
 const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const exports = {}
 new Function('require','exports',code)(name => imports[name],exports)
 return exports
}

const config = load('../app/employees/field-config.ts')
const reports = load('../lib/admin-reports.ts',{'../app/employees/field-config':config})
const input = {
 employees:[{id:'e',employee_no:'100006',full_name:'Test Person',designation:'Advisor',department:'Retail Operations'}],
 details:[{employee_id:'e',profile:{gross_salary_month_pkr:'90000',bank_account_number:'000123',date_of_joining:'2026-09-01'},payroll_aug_2026:{payroll_fixed_salary_aug_2026_pkr:'80000'},payroll_sep_2026:{payable_salary_rs:'70000',wht_tax_deductions_rs:0,full_name:'Old name'}}],
 accounts:[{employee_id:'e',username:'person@example.com',is_active:true,must_change_password:true,user_id:'private-id'}],
 families:[{employee_id:'e',children:[{full_name:'Child Example',date_of_birth:'2019-08-09'}]}],
}

test('reports use September pay and current profile identity, omit retired salary',()=>{
 const {full,payroll}=reports.buildReports(input)
 assert.equal(payroll.rows[0]['Payroll Period'],'September 2026')
 assert.equal(payroll.rows[0]['Payable Salary (Rs.)'],'70000')
 assert.equal(payroll.rows[0]['WHT Tax Deductions (Rs.)'],'0')
 assert.equal(payroll.rows[0]['Full Name'],'Test Person')
 assert.equal(payroll.rows[0]['Date of Joining'],'2026-09-01')
 assert.equal(payroll.rows[0]['Gross/ Fixed Salary (Rs.)'],'')
 assert.equal(payroll.rows[0]['Bank Account Number'],'000123')
 assert.equal(full.rows[0]['Login Status'],'Password change pending')
 assert.equal(full.rows[0]['Child 1 / Date of Birth'],'2019-08-09')
 assert.equal(full.columns.includes('Gross Salary / Month (PKR)'),false)
 assert.equal(Object.values(full.rows[0]).includes('private-id'),false)
 assert.equal(new Set(full.columns).size,full.columns.length)
})
test('employees without September payroll retain blank payroll fields',()=>{
 const {payroll}=reports.buildReports({...input,details:[{employee_id:'e',payroll_aug_2026:{payable_salary_rs:'80000'}}]})
 assert.equal(payroll.rows[0]['Payroll Period'],'')
 assert.equal(payroll.rows[0]['Payable Salary (Rs.)'],'')
})
test('CSV quotes fields and neutralises formula inputs',()=>{
 const csv=reports.reportCsv({columns:['Name','Account'],rows:[{Name:'=1+1',Account:'00123'},{Name:'Name, with "quotes"\nand line',Account:'+malicious'}]})
 assert.ok(csv.includes('"\'=1+1"'))
 assert.ok(csv.includes('"00123"'))
 assert.ok(csv.includes('"Name, with ""quotes""\nand line"'))
 assert.ok(csv.includes('"\'+malicious"'))
})
