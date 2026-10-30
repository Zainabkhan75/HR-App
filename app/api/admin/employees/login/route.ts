import {NextResponse} from 'next/server'
import {sameOriginRequest} from '../../../../../lib/signin-server'
import {uploadContext,serviceDb} from '../../../../../lib/bulk-upload-server'
import {provisionEmployeeLogin} from '../../../../../lib/employee-login-server'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'}
export async function POST(request:Request){
 if(!sameOriginRequest(request))return NextResponse.json({error:'Request not allowed'},{status:403,headers})
 const ctx=await uploadContext()
 if(ctx.status!==200)return NextResponse.json({error:ctx.status===401?'Sign in required':'HR administrator access required'},{status:ctx.status,headers})
 try{
  const input=await request.json()
  if(typeof input.employee_id!=='string'||!/^[0-9a-f-]{36}$/i.test(input.employee_id))return NextResponse.json({error:'Select a valid employee'},{status:400,headers})
  const result=await provisionEmployeeLogin(serviceDb(),input.employee_id,ctx.user.id)
  return NextResponse.json(result,{headers})
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Login creation failed'},{status:409,headers})}
}
