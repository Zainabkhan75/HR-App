import {NextResponse} from 'next/server'
import {serviceDb,uploadContext} from '../../../../../lib/bulk-upload-server'
import {sameOriginRequest} from '../../../../../lib/signin-server'
import {validLoginEmail} from '../../../../../lib/login-email'

const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}})

export async function POST(request:Request){
 if(!sameOriginRequest(request))return reply({message:'Request not allowed.'},403)
 const context=await uploadContext()
 if(context.status!==200)return reply({message:'HR administrator access required.'},context.status)
 const input=await request.json().catch(()=>null)
 if(typeof input?.employeeId!=='string'||!/^\d{6}$/.test(input.employeeId))return reply({message:'Select an employee.'},400)
 const db=serviceDb()
 const {data:employee,error}=await db.from('employees').select('id').eq('employee_no',input.employeeId).eq('employment_state','active').maybeSingle()
 if(error||!employee)return reply({message:'Active employee not found.'},404)
 if(input.action==='preview'){
  const {data,error}=await db.rpc('propose_employee_login_email',{p_employee:employee.id})
  return error?reply({message:'Could not check the proposed address.'},503):reply({proposal:data})
 }
 if(input.action!=='confirm'||input.verified!==true||!validLoginEmail(input.email))return reply({message:'Confirm the employee controls the proposed mailbox.'},400)
 const {data,error:failure}=await db.rpc('confirm_employee_login_email',{p_employee:employee.id,p_actor:context.user.id,p_confirmed:input.email})
 if(failure||!data)return reply({message:'The email change could not be completed. Review the current profile and account before retrying.'},409)
 return reply({email:data,message:'Sign-in email changed.'})
}
