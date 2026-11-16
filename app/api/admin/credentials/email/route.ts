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
 if(input.action!=='confirm'||input.verified!==true||!validLoginEmail(input.email))return reply({message:'Enter a valid new sign-in email and confirm the employee controls it.'},400)
 const {data,error:failure}=await db.rpc('confirm_employee_login_email',{p_employee:employee.id,p_actor:context.user.id,p_confirmed:input.email.trim().toLowerCase()})
 if(failure?.code==='23505')return reply({message:'That email is already used or unavailable for sign-in.'},409)
 if(failure?.code==='42501')return reply({message:'Only the Super Admin can change an HR Admin sign-in email.'},403)
 if(failure||!data)return reply({message:'The email change could not be completed. Refresh Credentials and check that the employee has an active login.'},409)
 return reply({email:data,message:'Sign-in email changed.'})
}
