import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

const source=readFileSync(new URL('../lib/ess-profile.ts',import.meta.url),'utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const exported={}
new Function('exports',compiled)(exported)
const {contactDraft,contactPatch}=exported

test('missing contacts remain blank rather than invented',()=>{
 assert.deepEqual(contactDraft({}),{mobile:'',personal_mobile:'',personal_email:'',personal_address:''})
 assert.deepEqual(contactPatch({},contactDraft({})),{})
})
test('contact patch cannot include payroll, identity, employment or target IDs',()=>{
 const draft={...contactDraft({}),personal_address:'New address',gross_salary_month_pkr:'999',employee_id:'another',full_name:'Changed',department:'Changed'}
 assert.deepEqual(contactPatch({},draft),{personal_address:'New address'})
})
test('changing one contact preserves all untouched values',()=>{
 const original={mobile:'+92 300 0000000',personal_email:'person@example.org'}
 const draft={...contactDraft(original),personal_address:' New address '}
 assert.deepEqual(contactPatch(original,draft),{personal_address:'New address'})
 assert.equal(original.personal_email,'person@example.org')
})
test('clearing an existing contact is an explicit change',()=>{
 const original={personal_address:'Old address'}
 assert.deepEqual(contactPatch(original,{...contactDraft(original),personal_address:''}),{personal_address:''})
})
test('source whitespace does not mark an untouched form as edited',()=>{
 const original={personal_email:' person@example.org '}
 assert.deepEqual(contactPatch(original,contactDraft(original)),{})
})
