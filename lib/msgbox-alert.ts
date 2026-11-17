import {EMAIL_FROM,LOGIN_URL} from './employee-emails'

export type MsgBoxAlert={id:string;recipient_email:string;link_path:string;attempts:number;title:string;body:string}

const messageLink=/^\/portal\?section=msgbox&message=[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
const leaveDecisions=new Set(['Leave request approved','Leave request rejected','Leave request cancelled','Approved leave cancelled'])

export async function sendMsgBoxAlert(item:MsgBoxAlert,key:string,fetcher:typeof fetch=fetch){
 const target=messageLink.test(item.link_path)?item.link_path:'/portal?section=msgbox'
 const link=new URL(target,LOGIN_URL)
 const response=await fetcher('https://api.resend.com/emails',{
  method:'POST',
  headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':'bandana-msgbox/'+item.id},
  body:JSON.stringify({
   from:EMAIL_FROM,
   to:[item.recipient_email],
   subject:leaveDecisions.has(item.title)?item.title:'You have a new message',
   text:[item.title,item.body,'Open this message in Bandana HR My Msgs:\n'+link.href].filter(Boolean).join('\n\n'),
  }),
  signal:AbortSignal.timeout(15000),
 })
 if(!response.ok)throw Error('Resend returned HTTP '+response.status)
 const result=await response.json()
 if(typeof result?.id!=='string'||!result.id)throw Error('Resend acceptance could not be confirmed')
 return result.id as string
}
