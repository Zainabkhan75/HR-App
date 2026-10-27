import {NextResponse} from 'next/server'
import {serverSupabase} from '../../../../lib/server'
import {resolveSigninEmail,sameOriginRequest} from '../../../../lib/signin-server'
import {validLoginEmail} from '../../../../lib/login-email'
import {safeWorkspaceNext} from '../../../../lib/leave'
export async function POST(request:Request){
 if(!sameOriginRequest(request))return NextResponse.json({error:'Request not allowed.'},{status:403})
 let input:{email?:unknown;password?:unknown;next?:unknown}
 try{input=await request.json()}catch{return NextResponse.json({error:'Enter your email and password.'},{status:400})}
 if(!validLoginEmail(input.email)||typeof input.password!=='string'||!input.password||input.password.length>1024)return NextResponse.json({error:'Enter a valid work or personal email and password.'},{status:400})
 try{
  const canonical=await resolveSigninEmail(input.email)
  if(!canonical)return NextResponse.json({error:'Invalid email or password. Use your unique registered work or personal email.'},{status:401})
  const db=await serverSupabase()
  const {data,error}=await db.auth.signInWithPassword({email:canonical,password:input.password})
  if(error||!data.user)return NextResponse.json({error:error?.status===429?'Too many attempts. Please wait before trying again.':'Invalid email or password.'},{status:error?.status===429?429:401})
  const {data:roles}=await db.from('user_roles').select('role').eq('user_id',data.user.id)
  return NextResponse.json({redirect:safeWorkspaceNext(typeof input.next==='string'?input.next:null)??(roles?.some(r=>r.role==='hr_admin')?'/employees':'/portal')})
 }catch{return NextResponse.json({error:'Sign-in is temporarily unavailable. Please try again.'},{status:503})}
}
