import {NextResponse} from 'next/server'
import {serviceDb,uploadContext} from '../../../../lib/bulk-upload-server'
import {sameOriginRequest} from '../../../../lib/signin-server'
import {sendLeavePilotEmail} from '../../../../lib/leave-pilot-email'

const json=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}})

export async function POST(request:Request){
 if(!sameOriginRequest(request))return json({error:'Request not allowed'},403)
 const context=await uploadContext()
 if(context.status!==200)return json({error:'HR administrator sign-in required'},context.status)
 const input=await request.json().catch(()=>null)
 if(typeof input?.id!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.id)){
  return json({error:'Select a valid queued notification'},400)
 }
 const key=process.env.RESEND_API_KEY?.trim()
 if(!key||!process.env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'Pilot email is not configured'},503)

 const db=serviceDb()
 const {data:item,error:claimError}=await db.rpc('claim_leave_pilot_email',{p_id:input.id}).maybeSingle()
 if(claimError)return json({error:'Could not claim the pilot notification'},500)
 if(!item)return json({error:'This notification is not eligible for pilot delivery or retry'},409)

 let providerId:string
 try{
  providerId=await sendLeavePilotEmail(item as Parameters<typeof sendLeavePilotEmail>[0],key)
 }catch(error){
  const message=error instanceof Error&&/^Resend (returned HTTP \d+|acceptance could not be confirmed)$/.test(error.message)
   ?error.message:'Could not confirm delivery with Resend'
  const {error:saveError}=await db.from('workflow_email_outbox').update({status:'failed',last_error:message})
   .eq('id',input.id).eq('status','sending').eq('attempts',(item as {attempts:number}).attempts)
  return json({error:saveError?'Could not record the send attempt. Refresh before retrying.':message},502)
 }
 const {data:saved,error:saveError}=await db.from('workflow_email_outbox')
  .update({status:'sent',provider_id:providerId,sent_at:new Date().toISOString(),last_error:null})
  .eq('id',input.id).eq('status','sending').eq('attempts',(item as {attempts:number}).attempts)
  .select('id').maybeSingle()
 if(saveError||!saved)return json({error:'Resend accepted the email, but the queue update could not be confirmed'},500)
 return json({ok:true})
}
