import {NextResponse} from 'next/server'
import {sameOriginRequest} from '../../../../lib/signin-server'
import {uploadContext,serviceDb} from '../../../../lib/bulk-upload-server'
import {loadEmailRecipients} from '../../../../lib/employee-emails-server'
import {MAX_ATTACHMENT_BYTES,validateMessage,sendEmailBatch} from '../../../../lib/employee-emails'
import type {Recipient} from '../../../../lib/employee-emails'
export const dynamic='force-dynamic'
export const maxDuration=60
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'}
const json=(data:object,status=200)=>NextResponse.json(data,{status,headers})
function campaignResponse(campaign:{recipients:Recipient[]}){
 return json({campaign:{...campaign,recipients:campaign.recipients.map(({attachment,...recipient})=>({
  ...recipient,attachmentName:attachment?.filename,
 }))}})
}
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
   if(input.attachment!=null){
    const {filename,content}=input.attachment
    if(recipients.length!==1)throw Error('Select one recipient when attaching a file')
    if(typeof filename!=='string'||!filename.trim()||filename.length>200||/[\\/\x00-\x1f\x7f]/.test(filename)||
     typeof content!=='string'||!content||content.length>4*Math.ceil(MAX_ATTACHMENT_BYTES/3)||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(content))throw Error('Choose a valid attachment up to 2 MiB')
    const bytes=Buffer.from(content,'base64')
    if(bytes.length>MAX_ATTACHMENT_BYTES||bytes.toString('base64')!==content)throw Error('Choose a valid attachment up to 2 MiB')
    recipients[0]={...recipients[0],attachment:{filename,content}}
   }
   const {data,error}=await admin.rpc('prepare_admin_email',{p_actor:ctx.user.id,p_subject:message.subject,p_body:message.body,p_recipients:recipients,p_reply_to:ctx.user.email})
   if(error||!data)throw Error('Could not prepare email preview')
   return campaignResponse(data)
  }
  if(input.action==='resume'&&typeof input.campaign_id==='string'){
   const {data,error}=await admin.rpc('read_admin_email',{p_actor:ctx.user.id,p_campaign:input.campaign_id});if(error||!data)throw Error('Could not reload preview');return campaignResponse(data)
  }
  if(input.action!=='send'||typeof input.campaign_id!=='string'||!/^[0-9a-f-]{36}$/i.test(input.campaign_id))return json({error:'Prepare a preview first'},400)
  const key=process.env.RESEND_API_KEY?.trim();if(!key)return json({error:'Email is not connected. Add RESEND_API_KEY in Vercel.'},503)
  const {data:c,error:claim}=await admin.rpc('claim_admin_email',{p_actor:ctx.user.id,p_campaign:input.campaign_id})
  if(claim||!c)throw Error(claim?.message??'Could not open the email preview')
  if(c.status==='accepted')return campaignResponse(c)
  let outcome:{status:string;result:unknown;error:string|null}
  try{
   const current=await loadEmailRecipients(ctx.db),byId=new Map(current.map(r=>[r.id,r]))
   const changed=c.recipients.some((r:Recipient)=>r.test?(r.email!==ctx.user.email||r.id!==ctx.user.id):(!byId.get(r.id)?.email||byId.get(r.id)?.email!==r.email||byId.get(r.id)?.name!==r.name))
   if(changed)outcome={status:'failed',result:null,error:'Employee details changed since preview. Refresh and prepare a new preview.'}
   else outcome=await sendEmailBatch(c,key)
  }catch{outcome={status:'uncertain',result:null,error:'Could not confirm sending. Retry this same preview to avoid duplicates.'}}
  const {data:finished,error:finish}=await admin.rpc('finish_admin_email',{p_actor:ctx.user.id,p_campaign:c.id,p_status:outcome.status,p_result:outcome.result,p_error:outcome.error})
  if(finish||!finished)return json({error:'Sending outcome needs checking. Do not prepare a new send; retry this same preview.'},409)
  return campaignResponse(finished)
 }catch(e){return json({error:e instanceof Error?e.message:'Email request failed'},400)}
}
