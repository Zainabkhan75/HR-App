import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

const exports={}
const source=readFileSync(new URL('../lib/leave-pilot-email.ts',import.meta.url),'utf8')
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}})
new Function('exports','require',outputText)(exports,()=>({
 EMAIL_FROM:'Bandana HR <hr@example.invalid>',
 LOGIN_URL:'https://app.example.invalid/login',
}))
const item={id:'queue-id',kind:'leave_request',request_id:'request-id',request_year:2026}

test('pilot delivery fixes the recipient and keeps the request link and retry key',async()=>{
 const attempts=[]
 const fetcher=async(url,options)=>{
  assert.equal(url,'https://api.resend.com/emails')
  attempts.push(options.headers['Idempotency-Key'])
  const payload=JSON.parse(options.body)
  assert.deepEqual(payload.to,['zainabsaadkhan75@gmail.com'])
  assert.match(payload.text,/workspace\?section=approvals&year=2026&request=request-id/)
  return Response.json({id:'provider-id'})
 }
 assert.equal(await exports.sendLeavePilotEmail(item,'test-key',fetcher),'provider-id')
 await exports.sendLeavePilotEmail(item,'test-key',fetcher)
 assert.deepEqual(attempts,['bandana-leave-pilot/queue-id','bandana-leave-pilot/queue-id'])
})

test('rejections and incomplete provider responses cannot mark a message sent',async()=>{
 await assert.rejects(exports.sendLeavePilotEmail(item,'key',async()=>Response.json({}, {status:429})),/HTTP 429/)
 await assert.rejects(exports.sendLeavePilotEmail(item,'key',async()=>Response.json({})),/could not be confirmed/)
})
