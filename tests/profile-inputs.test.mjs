import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const source=readFileSync(new URL('../lib/profile-inputs.ts',import.meta.url),'utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const exported={}
new Function('exports',compiled)(exported)
const {employmentChoice,validJoiningDate,validProbation,selectChoices}=exported
test('Permanent sets three months and switching away clears its default',()=>{
 assert.equal(employmentChoice({probation:'na',employment_type:'Contractual'},'Permanent').probation,'3')
 assert.equal(employmentChoice({probation:'3',employment_type:'Permanent'},'Contractual').probation,'')
 assert.equal(employmentChoice({probation:'6',employment_type:'Contractual'},'Fixed-term').probation,'6')
})
test('probation permits blank or whole months zero through six',()=>{
 for(const value of ['', '0','3','6'])assert.equal(validProbation(value),true)
 for(const value of ['-1','7','1.5','na','03'])assert.equal(validProbation(value),false)
})
test('joining dates require unambiguous real calendar dates',()=>{
 for(const value of ['', '27/10/2026','29/02/2024'])assert.equal(validJoiningDate(value),true)
 for(const value of ['101026','31/02/2026','29/02/2026','27/13/2026','1/1/2026'])assert.equal(validJoiningDate(value),false)
})
test('options preserve an existing recorded value and remove duplicates',()=>{
 assert.deepEqual(selectChoices(['A','B','A'],'Legacy'),['A','B','Legacy'])
 assert.deepEqual(selectChoices(['A','B'],'A'),['A','B'])
})

test('reporting choices show role text without names or chart notes',()=>{
 assert.equal(exported.reportingTitle('Synthetic Person - HR Manager (chart spelling)'),'HR Manager')
 assert.equal(exported.reportingTitle('Store Manager, Example - Synthetic Person'),'Store Manager, Example')
 assert.equal(exported.reportingTitle('Finance Manager (identity unconfirmed)'),'Finance Manager')
 assert.equal(exported.reportingTitle('CEO'),'CEO')
})
