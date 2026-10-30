import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const compiled=ts.transpileModule(readFileSync(new URL('../lib/employee-login-server.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const m={exports:{}};new Function('module','exports',compiled)(m,m.exports)
const {provisionEmployeeLogin}=m.exports
function mock(options={}){
 const calls=[]
 const plan={job:'job',employee_no:'200001',full_name:'Test Person',username:'test@example.com',initial_password:'Test1234'}
 const db={rpc:async(name,args)=>{calls.push(name);if(name==='prepare_employee_login')return options.prepareError?{error:{message:options.prepareError}}:{data:plan};if(name==='commit_employee_provision')return{error:options.commitError?{message:'changed'}:null};return{data:null}},
 auth:{admin:{createUser:async(attrs)=>{calls.push(['create',attrs]);return options.authError?{error:{code:'exists'}}:{data:{user:{id:'new-user'}}}},deleteUser:async(id)=>{calls.push(['delete',id]);return{error:null}}}},
 from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:options.linked?{employee_id:'employee'}:null,error:options.checkError?{message:'unknown'}:null})})})})}
 return{db,calls}
}
test('eligible login uses agreed credentials and forces first-login password change',async()=>{
 const {db,calls}=mock();const r=await provisionEmployeeLogin(db,'employee','admin')
 assert.equal(r.username,'test@example.com');assert.equal(r.initial_password,'Test1234');assert.equal(r.must_change_password,true);assert.equal(r.email_sent,false)
 assert.ok(calls.includes('commit_employee_provision'));assert.ok(calls.includes('finish_employee_login'));assert.equal(calls.find(x=>Array.isArray(x)&&x[0]==='create')[1].app_metadata.employee_provision_job,'job')
})
test('missing data or existing login stops before Auth creation',async()=>{
 const {db,calls}=mock({prepareError:'Employee already has a login'});await assert.rejects(()=>provisionEmployeeLogin(db,'employee','admin'),/already has/)
 assert.ok(!calls.some(x=>Array.isArray(x)&&x[0]==='create'))
})
test('Auth email conflict never resets or deletes an existing user',async()=>{
 const {db,calls}=mock({authError:true});await assert.rejects(()=>provisionEmployeeLogin(db,'employee','admin'),/Could not create/)
 assert.ok(!calls.some(x=>Array.isArray(x)&&x[0]==='delete'));assert.ok(calls.includes('finish_employee_login'))
})
test('unlinked newly created account is cleaned up if commit fails',async()=>{
 const {db,calls}=mock({commitError:true});await assert.rejects(()=>provisionEmployeeLogin(db,'employee','admin'),/changed/)
 assert.deepEqual(calls.find(x=>Array.isArray(x)&&x[0]==='delete'),['delete','new-user'])
})
test('uncertain commit preserves a confirmed linked account',async()=>{
 const {db,calls}=mock({commitError:true,linked:true});const r=await provisionEmployeeLogin(db,'employee','admin');assert.equal(r.username,'test@example.com')
 assert.ok(!calls.some(x=>Array.isArray(x)&&x[0]==='delete'))
})
test('unknown linkage outcome does not delete an account',async()=>{
 const {db,calls}=mock({commitError:true,checkError:true});await assert.rejects(()=>provisionEmployeeLogin(db,'employee','admin'),/technical review/)
 assert.ok(!calls.some(x=>Array.isArray(x)&&x[0]==='delete'))
})
