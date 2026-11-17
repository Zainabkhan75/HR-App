import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

const exports={}
const source=readFileSync(new URL('../lib/msgbox-alert.ts',import.meta.url),'utf8')
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}})
new Function('exports','require',outputText)(exports,()=>({
 EMAIL_FROM:'Bandana HR <hr@example.invalid>',
 LOGIN_URL:'https://app.example.invalid/login',
}))
const {sendMsgBoxAlert}=exports
const item={
 id:'queue-id',recipient_email:'employee@example.invalid',attempts:1,
 link_path:'/portal?section=msgbox&message=12345678-1234-1234-1234-123456789abc',
 title:'Leave approved',body:'Your leave has been approved.',
}

test('sends the message text and exact MsgBox link to the selected employee address',async()=>{
 const keys=[]
 const fetcher=async(url,options)=>{
  assert.equal(url,'https://api.resend.com/emails')
  keys.push(options.headers['Idempotency-Key'])
  const payload=JSON.parse(options.body)
  assert.deepEqual(payload.to,[item.recipient_email])
  assert.equal(payload.subject,'You have a new message')
  assert.equal(payload.text,item.title+'\n\n'+item.body+'\n\nOpen this message in Bandana HR MsgBox:\nhttps://app.example.invalid'+item.link_path)
  return Response.json({id:'accepted-id'})
 }
 assert.equal(await sendMsgBoxAlert(item,'key',fetcher),'accepted-id')
 await sendMsgBoxAlert({...item,attempts:2},'key',fetcher)
 assert.deepEqual(keys,['bandana-msgbox/queue-id','bandana-msgbox/queue-id'])
})

test('uses a safe MsgBox link and requires confirmed provider acceptance',async()=>{
 await assert.rejects(sendMsgBoxAlert({...item,link_path:'https://elsewhere.invalid'},'key',async(_url,options)=>{
  assert.match(JSON.parse(options.body).text,/https:\/\/app\.example\.invalid\/portal\?section=msgbox$/)
  return Response.json({})
 }),/could not be confirmed/)
 await assert.rejects(sendMsgBoxAlert(item,'key',async()=>new Response(null,{status:429})),/HTTP 429/)
})
