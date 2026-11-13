import {NextResponse} from 'next/server'
import {serviceDb,uploadContext} from '../../../../../lib/bulk-upload-server'
import {EMAIL_FROM,LOGIN_URL} from '../../../../../lib/employee-emails'
import {validLoginEmail} from '../../../../../lib/login-email'
import {sameOriginRequest} from '../../../../../lib/signin-server'

const reply=(message:string,status=200)=>NextResponse.json({message},{status,headers:{'Cache-Control':'no-store'}})

export async function POST(request:Request){
 if(!sameOriginRequest(request))return reply('Request not allowed.',403)
 const context=await uploadContext()
 if(context.status!==200)return reply('HR administrator access required.',context.status)
 const input=await request.json().catch(()=>null)
 if(typeof input?.employeeId!=='string'||!/^\d{6}$/.test(input.employeeId)||!validLoginEmail(input?.email))return reply('Enter an employee ID and valid email.',400)
 const email=input.email.trim().toLowerCase()
 const key=process.env.RESEND_API_KEY?.trim()
 if(!key||!process.env.SUPABASE_SERVICE_ROLE_KEY)return reply('Email delivery is unavailable.',503)
 const db=serviceDb()
 const {data:employee}=await db.from('employees').select('id').eq('employee_no',input.employeeId).eq('employment_state','active').maybeSingle()
 if(!employee)return reply('Active employee not found.',404)
 const {data:account}=await db.from('employee_accounts').select('user_id,login_email').eq('employee_id',employee.id).eq('is_active',true).maybeSingle()
 if(!account)return reply('No active sign-in account.',409)
 const current=account.login_email.trim().toLowerCase()
 if(email===current)return reply('This is already the sign-in email.',400)
 const {data:eligible,error}=await db.rpc('can_change_employee_login_email',{p_user:account.user_id,p_email:email})
 if(error)return reply('Could not check the proposed address.',503)
 if(!eligible)return reply('The account or proposed address is unavailable for this change.',409)
 try{
  const links:string[]=[]
  for(const type of ['email_change_current','email_change_new'] as const){
   const result=await db.auth.admin.generateLink({type,email:current,newEmail:email,options:{redirectTo:LOGIN_URL}})
   if(result.error||result.data.user.id!==account.user_id)throw Error('Could not prepare email confirmation.')
   links.push(result.data.properties.action_link)
  }
  const response=await fetch('https://api.resend.com/emails/batch',{
   method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
   body:JSON.stringify([current,email].map((address,index)=>({
    from:EMAIL_FROM,to:[address],subject:'Confirm your Bandana HR App sign-in email change',
    text:'HR requested a change to your sign-in email. Confirm using this link. Both mailboxes must confirm before the address switches. If you did not expect this request, contact HR.\n\n'+links[index],
   }))),signal:AbortSignal.timeout(20000),
  })
  const result=await response.json()
  if(!response.ok||!Array.isArray(result.data)||result.data.length!==2)return reply('Email delivery could not be confirmed. Check with HR before retrying.',502)
  return reply('Confirmation emails were accepted for sending to both addresses.')
 }catch{return reply('Could not complete the confirmation request.',502)}
}
