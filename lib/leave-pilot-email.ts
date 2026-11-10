import {EMAIL_FROM,LOGIN_URL} from './employee-emails'

type PilotEmail={id:string;kind:'leave_request'|'leave_decision';request_id:string;request_year:number}

export async function sendLeavePilotEmail(item:PilotEmail,key:string,fetcher:typeof fetch=fetch){
 const approval=item.kind==='leave_request'
 const link=new URL('/workspace',LOGIN_URL)
 link.search=new URLSearchParams({
  section:approval?'approvals':'leave',
  year:String(item.request_year),
  request:item.request_id,
 }).toString()
 const subject=approval?'[PILOT] Leave request ready for review':'[PILOT] Leave request status updated'
 const response=await fetcher('https://api.resend.com/emails',{
  method:'POST',
  headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':'bandana-leave-pilot/'+item.id},
  body:JSON.stringify({
   from:EMAIL_FROM,
   to:['zainabsaadkhan75@gmail.com'],
   subject,
   text:'Sign in with the assigned pilot account to open this request.\n\n'+link.href,
  }),
  signal:AbortSignal.timeout(20000),
 })
 if(!response.ok)throw Error('Resend returned HTTP '+response.status)
 const result=await response.json()
 if(typeof result?.id!=='string'||!result.id)throw Error('Resend acceptance could not be confirmed')
 return result.id as string
}
