import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const compiled=ts.transpileModule(readFileSync(new URL('../lib/employee-emails.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const m={exports:{}};new Function('module','exports',compiled)(m,m.exports)
const {emailRecipients,validateMessage,emailPayload,sendEmailBatch}=m.exports
const employee=(id,state='active')=>({id,employee_no:id,full_name:'Person '+id,department:'HR',employment_state:state})
test('unique work preferred; shared work falls back to unique personal',()=>{
 const rows=emailRecipients([employee('1'),employee('2'),employee('3')],[{employee_id:'1',profile:{email:'SHARED@example.com',personal_email:'one@example.com'}},{employee_id:'2',profile:{email:'shared@example.com'}},{employee_id:'3',profile:{email:'three@example.com',personal_email:'other@example.com'}}])
 assert.equal(rows[0].email,'one@example.com');assert.equal(rows[0].source,'Personal email');assert.equal(rows[1].email,null);assert.equal(rows[2].email,'three@example.com')
})
test('inactive, invalid and missing email are excluded',()=>{
 const rows=emailRecipients([employee('1','inactive'),employee('2'),employee('3')],[{employee_id:'1',profile:{email:'one@example.com'}},{employee_id:'2',profile:{email:'bad'}}])
 assert.ok(rows.every(r=>r.email===null))
})
test('shared across personal and work fields is excluded too',()=>{
 const rows=emailRecipients([employee('1'),employee('2')],[{employee_id:'1',profile:{email:'same@example.com'}},{employee_id:'2',profile:{personal_email:'same@example.com'}}])
 assert.ok(rows.every(r=>r.email===null))
})
test('message validation rejects header injection and unknown placeholders',()=>{
 assert.throws(()=>validateMessage('hi\nCC: bad','message'));assert.throws(()=>validateMessage('hi','{{password}}'));assert.throws(()=>validateMessage('','message'))
 assert.equal(validateMessage(' Hi ','Dear {{name}}').subject,'Hi')
})
const campaign={id:'campaign-1',subject:'Welcome',body:'Hi {{name}}, ID {{employee_id}}. {{login_url}}',reply_to:'hr@example.com',recipients:[{id:'1',employee_no:'200001',name:'Test $&',email:'one@example.com'},{id:'2',employee_no:'200002',name:'Two',email:'two@example.com'}]}
test('payload sends individually and preserves personalized names literally',()=>{
 const p=emailPayload(campaign);assert.deepEqual(p.map(x=>x.to),[['one@example.com'],['two@example.com']]);assert.match(p[0].text,/Test \$&/);assert.equal(p[0].from,'Bandana HR <bandanahr@seidohr.com>');assert.equal(p[0].reply_to,'hr@example.com')
})
test('retry uses same idempotency key and accepted is not delivered',async()=>{
 const keys=[];const mock=async(url,options)=>{keys.push(options.headers['Idempotency-Key']);assert.equal(url,'https://api.resend.com/emails/batch');return{ok:true,json:async()=>({data:[{id:'a'},{id:'b'}]})}}
 assert.equal((await sendEmailBatch(campaign,'test-key',mock)).status,'accepted');await sendEmailBatch(campaign,'test-key',mock);assert.deepEqual(keys,['bandana-email/campaign-1','bandana-email/campaign-1'])
})
test('provider failures and incomplete response are never accepted',async()=>{
 assert.equal((await sendEmailBatch(campaign,'key',async()=>({ok:false,status:500,json:async()=>({message:'Unavailable'})}))).status,'uncertain')
 assert.equal((await sendEmailBatch(campaign,'key',async()=>({ok:false,status:403,json:async()=>({message:'Domain not verified'})}))).status,'failed')
 assert.equal((await sendEmailBatch(campaign,'key',async()=>({ok:true,json:async()=>({data:[{id:'a'}]})}))).status,'uncertain')
})
test('missing key prevents any provider request',async()=>{let calls=0;await assert.rejects(()=>sendEmailBatch(campaign,'',async()=>{calls++}),/RESEND_API_KEY/);assert.equal(calls,0)})
