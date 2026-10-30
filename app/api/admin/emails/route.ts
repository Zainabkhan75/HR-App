import {NextResponse} from 'next/server'
import {sameOriginRequest} from '../../../../lib/signin-server'
import {uploadContext,serviceDb} from '../../../../lib/bulk-upload-server'
import {loadEmailRecipients} from '../../../../lib/employee-emails-server'
import {validateMessage,sendEmailBatch} from '../../../../lib/employee-emails'
import type {Recipient} from '../../../../lib/employee-emails'
export const dynamic='force-dynamic'
export const maxDuration=60
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'}
const json=(data:object,status=200)=>NextResponse.json(data,{status,headers})
export async function POST(request:Request){
 if(!sameOriginRequest(request))return json({error:'Request not allowed'},403)
 const ctx=await uploadContext();if(ctx.status!==200)return json({error:'HR administrator sign-in required'},ctx.status)
 try{
  const input=await request.json(),admin=serviceDb()
  if(input.action==='preview'||input.action==='test'){
   const message=validateMessage(input.subject,input.body)
   let recipients:Recipient[]
   if(input.action==='test'){
    if(!ctx.user.email)throw Error('Your admin account needs an email for the test')
    recipients=[{id:ctx.user.id,employee_no:'ADMIN TEST',name:'HR administrator',email:ctx.user.email,department:'',source:'Admin email',reason:'',test:true}]
    message.subject=('[TEST] '+message.subject).slice(0,200)
   }else{
    if(!Array.isArray(input.employee_ids)||input.employee_ids.length<1||input.employee_ids.length>100||new Set(input.employee_ids).size!==input.employee_ids.length)throw Error('Select 1 to 100 employees without duplicates')
    const current=await loadEmailRecipients(ctx.db),byId=new Map(current.map(r=>[r.id,r]))
    recipients=input.employee_ids.map((id:string)=>{const r=byId.get(id);if(!r?.email)throw Error('Selected employee has no unique valid email. Refresh the recipient list.');return r})
   }
   const {data,error}=await admin.rpc('prepare_admin_email',{p_actor:ctx.user.id,p_subject:message.subject,p_body:message.body,p_recipients:recipients,p_reply_to:ctx.user.email})
   if(error||!data)throw Error('Could not prepare email preview')
   return json({campaign:data})
  }
  if(input.action==='resume'&&typeof input.campaign_id==='string'){
   const {data,error}=await admin.rpc('read_admin_email',{p_actor:ctx.user.id,p_campaign:input.campaign_id});if(error||!data)throw Error('Could not reload preview');return json({campaign:data})
  }
  if(input.action!=='send'||typeof input.campaign_id!=='string'||!/^[0-9a-f-]{36}$/i.test(input.campaign_id))return json({error:'Prepare a preview first'},400)
  const key=process.env.RESEND_API_KEY?.trim();if(!key)return json({error:'Email is not connected. Add RESEND_API_KEY in Vercel.'},503)
  const {data:c,error:claim}=await admin.rpc('claim_admin_email',{p_actor:ctx.user.id,p_campaign:input.campaign_id})
  if(claim||!c)throw Error(claim?.message??'Could not open the email preview')
  if(c.status==='accepted')return json({campaign:c})
  let outcome:{status:string;result:unknown;error:string|null}
  try{
   const current=await loadEmailRecipients(ctx.db),byId=new Map(current.map(r=>[r.id,r]))
   const changed=c.recipients.some((r:Recipient)=>r.test?(r.email!==ctx.user.email||r.id!==ctx.user.id):(!byId.get(r.id)?.email||byId.get(r.id)?.email!==r.email||byId.get(r.id)?.name!==r.name))
   if(changed)outcome={status:'failed',result:null,error:'Employee details changed since preview. Refresh and prepare a new preview.'}
   else outcome=await sendEmailBatch(c,key)
  }catch{outcome={status:'uncertain',result:null,error:'Could not confirm sending. Retry this same preview to avoid duplicates.'}}
  const {data:finished,error:finish}=await admin.rpc('finish_admin_email',{p_actor:ctx.user.id,p_campaign:c.id,p_status:outcome.status,p_result:outcome.result,p_error:outcome.error})
  if(finish||!finished)return json({error:'Sending outcome needs checking. Do not prepare a new send; retry this same preview.'},409)
  return json({campaign:finished})
 }catch(e){return json({error:e instanceof Error?e.message:'Email request failed'},400)}
}
