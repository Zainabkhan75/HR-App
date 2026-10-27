import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const source=readFileSync(new URL('../lib/leave.ts',import.meta.url),'utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const helpers={};new Function('exports',compiled)(helpers)
const policy={year:2026,annual:10,sick:10,casual:10,weekdays_only:true,holidays:[]}
test('leave counts exclude weekends and configured holidays',()=>{
 assert.equal(helpers.countLeaveDays('2026-11-06','2026-11-09',policy),2)
 assert.equal(helpers.countLeaveDays('2026-11-02','2026-11-06',{...policy,holidays:['2026-11-04']}),4)
 assert.equal(helpers.countLeaveDays('2026-11-07','2026-11-08',policy),0)
 assert.equal(helpers.countLeaveDays('2026-11-07','2026-11-08',{...policy,weekdays_only:false}),2)
})
test('leave dates reject reversed, malformed and cross-year ranges',()=>{
 for(const [a,b] of [['2026-11-06','2026-11-02'],['2026-02-30','2026-03-03'],['2026-12-31','2027-01-01'],['','2026-11-02']])assert.equal(helpers.countLeaveDays(a,b,policy),null)
})
test('available leave deducts opening, approved and pending days once',()=>{
 const b={type:'annual',entitlement:10,opening_taken:2,approved:3,pending:1,verified:true,taken:4}
 assert.equal(helpers.availableDays(b),4)
 assert.equal(helpers.availableDays({...b,verified:false}),null)
 assert.equal(helpers.availableDays({...b,entitlement:null}),null)
})
test('approval sign-in return path cannot redirect outside the workspace',()=>{
 assert.equal(helpers.safeWorkspaceNext('/workspace?section=approvals&request=synthetic'),'/workspace?section=approvals&request=synthetic')
 for(const value of ['https://evil.invalid','//evil.invalid','/workspace-evil','/workspace/../employees','/employees','/workspace\\evil','/workspace\nfoo',null])assert.equal(helpers.safeWorkspaceNext(value),null)
})
