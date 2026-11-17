import {timingSafeEqual} from 'node:crypto'
import {serviceDb} from '../../../../lib/bulk-upload-server'
import {sendMsgBoxAlert,type MsgBoxAlert} from '../../../../lib/msgbox-alert'

const json=(body:object,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})

export async function POST(request:Request){
 const secret=process.env.MSGBOX_ALERT_SECRET?.trim()
 const key=process.env.RESEND_API_KEY?.trim()
 if(!secret||!key||!process.env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'MsgBox alerts are not configured'},503)
 const received=Buffer.from(request.headers.get('authorization')??'')
 const expected=Buffer.from('Bearer '+secret)
 if(received.length!==expected.length||!timingSafeEqual(received,expected))return json({error:'Unauthorized'},401)

 const db=serviceDb()
 const {data,error}=await db.rpc('claim_msgbox_alerts')
 if(error)return json({error:'Could not claim MsgBox alerts'},500)
 const results=await Promise.all((data as MsgBoxAlert[]).map(async item=>{
  let result
  try{
   const providerId=await sendMsgBoxAlert(item,key)
   result={status:'sent',provider_id:providerId,sent_at:new Date().toISOString(),last_error:null}
  }catch(error){
   const message=error instanceof Error&&/^Resend returned HTTP \d+$/.test(error.message)
    ?error.message:'Could not confirm acceptance with Resend'
   result={status:'failed',last_error:message}
  }
  const {data:saved,error:saveError}=await db.from('workflow_email_outbox').update(result)
   .eq('id',item.id).eq('automatic',true).eq('status','sending').eq('attempts',item.attempts)
   .select('id').maybeSingle()
  return saveError||!saved?'uncertain':result.status
 }))
 return json({
  accepted:results.filter(result=>result==='sent').length,
  failed:results.filter(result=>result==='failed').length,
  uncertain:results.filter(result=>result==='uncertain').length,
 },results.includes('uncertain')?500:200)
}
