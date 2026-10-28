import {randomBytes} from 'node:crypto'
import {NextResponse} from 'next/server'
import {createClient} from '@supabase/supabase-js'
import {serverSupabase} from '../../../../lib/server'
import {sameOriginRequest} from '../../../../lib/signin-server'

export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'}
type Employee={id:string;employee_no:string;full_name:string}
type Account={employee_id:string;user_id:string;login_email:string;is_active:boolean}

async function context(){
 const db=await serverSupabase()
 const {data:{user},error}=await db.auth.getUser()
 if(error||!user)return{status:401 as const}
 const {data:role,error:roleError}=await db.from('user_roles').select('role').eq('user_id',user.id).eq('role','hr_admin').maybeSingle()
 if(roleError||!role)return{status:403 as const}
 return{status:200 as const,db,user}
}
function response(body:object,status=200){return NextResponse.json(body,{status,headers})}
async function readRegister(db:Awaited<ReturnType<typeof serverSupabase>>){
 const [employees,accounts]=await Promise.all([db.from('employees').select('id,employee_no,full_name').order('employee_no'),db.from('employee_accounts').select('employee_id,user_id,login_email,is_active')])
 if(employees.error||accounts.error)throw Error('Register unavailable')
 const links=new Map((accounts.data as Account[]).map(a=>[a.employee_id,a]))
 return (employees.data as Employee[]).map(e=>({employeeId:e.employee_no,name:e.full_name,username:links.get(e.id)?.login_email??'',linked:!!links.get(e.id)?.is_active}))
}
export async function GET(){
 const ctx=await context()
 if(ctx.status!==200)return response({error:ctx.status===401?'Sign in required':'HR administrator access required'},ctx.status)
 try{return response({rows:await readRegister(ctx.db)})}catch{return response({error:'Register unavailable'},503)}
}
export async function POST(request:Request){
 if(!sameOriginRequest(request))return response({error:'Request not allowed'},403)
 const ctx=await context()
 if(ctx.status!==200)return response({error:ctx.status===401?'Sign in required':'HR administrator access required'},ctx.status)
 let input:unknown
 try{input=await request.json()}catch{return response({error:'Invalid request'},400)}
 const ids=(input as {employeeIds?:unknown})?.employeeIds
 if(!Array.isArray(ids)||ids.length<1||ids.length>100||ids.some(id=>typeof id!=='string'||!/^\d{6}$/.test(id))||new Set(ids).size!==ids.length)return response({error:'Choose 1 to 100 unique employee IDs'},400)
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY
 if(!key)return response({error:'Credential service unavailable'},503)
 const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,key,{auth:{persistSession:false,autoRefreshToken:false}})
 const {data:employees,error:employeeError}=await admin.from('employees').select('id,employee_no,full_name').in('employee_no',ids)
 if(employeeError||!employees||employees.length!==ids.length)return response({error:'Employee list changed. Refresh and try again'},409)
 const employeeByNo=new Map((employees as Employee[]).map(e=>[e.employee_no,e]))
 const {data:accounts,error:accountError}=await admin.from('employee_accounts').select('employee_id,user_id,login_email,is_active').in('employee_id',employees.map(e=>e.id))
 if(accountError||!accounts)return response({error:'Account list unavailable'},503)
 const accountByEmployee=new Map((accounts as Account[]).map(a=>[a.employee_id,a]))
 if(ids.some(id=>!accountByEmployee.get(employeeByNo.get(id)!.id)?.is_active))return response({error:'A selected employee has no active linked account. Refresh and try again'},409)
 const userIds=accounts.map(a=>a.user_id)
 const {data:roles,error:roleError}=await admin.from('user_roles').select('user_id,role').in('user_id',userIds)
 if(roleError||!roles)return response({error:'Role check unavailable'},503)
 if(roles.some(r=>r.role==='hr_admin'))return response({error:'Administrator credentials cannot be generated here'},403)
 const results:{employeeId:string;name:string;username:string;password:string}[]=[]
 const auditWarnings:string[]=[]
 for(const id of ids as string[]){
  const employee=employeeByNo.get(id)!,account=accountByEmployee.get(employee.id)!
  const {data:auth,error:authError}=await admin.auth.admin.getUserById(account.user_id)
  if(authError||!auth.user||auth.user.email?.toLowerCase()!==account.login_email.toLowerCase())return response({error:'Authentication identity mismatch. No further passwords were generated.',results},409)
  const password=randomBytes(24).toString('base64url')
  const {error:flagError}=await admin.from('employee_accounts').update({must_change_password:true}).eq('employee_id',employee.id).eq('user_id',account.user_id).eq('is_active',true).select('employee_id').single()
  if(flagError)return response({error:'Could not require password change. No further passwords were generated.',results},503)
  const {error:passwordError}=await admin.auth.admin.updateUserById(account.user_id,{password})
  if(passwordError)return response({error:'Password generation stopped. No further passwords were generated.',results},503)
  const {error:auditError}=await admin.from('employee_action_audit').insert({employee_id:employee.id,employee_no:id,action:'admin_password_generated',actor_id:ctx.user.id,reason:'HR administrator generated a temporary password',record_snapshot:{login_email:account.login_email}})
  if(auditError){console.error('Credential action audit failed for employee',id);auditWarnings.push(id)}
  results.push({employeeId:id,name:employee.full_name,username:account.login_email,password})
 }
 return response({results,auditWarnings})
}
