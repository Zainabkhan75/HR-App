import {NextResponse} from 'next/server'
import {serverSupabase} from '../../../../lib/server'
import {resolveSigninEmail,sameOriginRequest} from '../../../../lib/signin-server'
import {validLoginEmail} from '../../../../lib/login-email'
import {RECOVERY_ORIGIN} from '../../../../lib/recovery-url'
export async function POST(request:Request){
 if(!sameOriginRequest(request))return NextResponse.json({error:'Request not allowed.'},{status:403})
 let input:{email?:unknown}
 try{input=await request.json()}catch{return NextResponse.json({error:'Enter a valid email.'},{status:400})}
 if(!validLoginEmail(input.email))return NextResponse.json({error:'Enter a valid work or personal email.'},{status:400})
 try{
  const canonical=await resolveSigninEmail(input.email)
  if(canonical){
   const db=await serverSupabase()
   const {error}=await db.auth.resetPasswordForEmail(canonical,{redirectTo:new URL('/reset-password',RECOVERY_ORIGIN).href})
   if(error)return NextResponse.json({error:error.status===429?'Too many requests. Please wait before trying again.':'We could not process the request. Try again later or contact HR.'},{status:error.status===429?429:503})
  }
  return NextResponse.json({ok:true})
 }catch{return NextResponse.json({error:'Recovery is temporarily unavailable. Please try again.'},{status:503})}
}
