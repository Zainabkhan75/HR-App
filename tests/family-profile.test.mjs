import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
function helpers(path){
 const output=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const result={};new Function('exports',output)(result);return result
}
const family=helpers('../lib/family-profile.ts')
const profile=helpers('../lib/ess-profile.ts')
const person=age=>({key:'synthetic-key',full_name:'Synthetic dependant',age:String(age),cnic:'',pre_existing_conditions:''})
test('CNIC optional at 18, mandatory strictly over 18',()=>{
 assert.equal(family.memberError(person(18)),'')
 assert.match(family.memberError(person(19)),/CNIC is required/)
 assert.equal(family.memberError(person(4)),'')
})
test('provided CNIC requires 13 digits and hyphens are normalised',()=>{
 assert.match(family.memberError({...person(4),cnic:'1'}),/13 digits/)
 assert.equal(family.memberError({...person(19),cnic:'00000-0000000-0'}),'')
 assert.equal(family.memberValue({...person(19),cnic:'00000-0000000-0'}).cnic,'0000000000000')
})
test('blank, negative and fractional ages are rejected',()=>{
 for(const age of ['',-1,1.5])assert.notEqual(family.memberError(person(age)),'')
})
test('loaded family field order does not produce unsaved edits',()=>{
 const first={spouse:{age:19,cnic:'0000000000000',full_name:'Synthetic',pre_existing_conditions:''},children:[]}
 const second={spouse:{full_name:'Synthetic',pre_existing_conditions:'',age:19,cnic:'0000000000000'},children:[]}
 assert.equal(family.familySnapshot(first),family.familySnapshot(second))
})
test('profile editor only submits the approved field allowlist',()=>{
 const initial={employee:{employee_no:'BND-TEST',full_name:'Synthetic',designation:null,department:null,location:null,reports_to_text:null,employment_state:'unverified'},personal:{},employment:{},contacts:{},rewards:{},payroll_aug_2026:{},profile_updated_at:null,core_updated_at:'synthetic'}
 const draft={...profile.profileDraft(initial),full_name:'Updated',employee_no:'changed',gross_salary_month_pkr:'1',role:'hr_admin'}
 assert.deepEqual(profile.profilePatch(initial,draft),{full_name:'Updated'})
})
