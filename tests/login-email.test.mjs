import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const source=readFileSync(new URL('../lib/login-email.ts',import.meta.url),'utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const helpers={};new Function('exports',compiled)(helpers)
test('sign-in accepts email addresses and rejects employee IDs or names',()=>{
 for(const v of ['person@example.org',' Person@Example.org '])assert.equal(helpers.validLoginEmail(v),true)
 for(const v of ['BND-003','person','person @example.org','person@example','',null,{}])assert.equal(helpers.validLoginEmail(v),false)
})
