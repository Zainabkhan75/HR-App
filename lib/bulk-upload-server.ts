import {createHmac,timingSafeEqual} from 'node:crypto'
import {createClient} from '@supabase/supabase-js'
import {serverSupabase} from './server'
import type {Snapshot} from './bulk-upload'

export async function uploadContext(){
 const db=await serverSupabase(),{data:{user},error}=await db.auth.getUser()
 if(error||!user)return{status:401 as const}
 const {data:role,error:roleError}=await db.from('user_roles').select('role').eq('user_id',user.id).eq('role','hr_admin').maybeSingle()
 if(roleError||!role)return{status:403 as const}
 return{status:200 as const,db,user}
}
export async function readSnapshot(db:Awaited<ReturnType<typeof serverSupabase>>):Promise<Snapshot>{
 const [employees,details,families]=await Promise.all([db.from('employees').select('id,employee_no,full_name,designation,department,reports_to_text,location,updated_at').order('employee_no').limit(2000),db.from('employee_details').select('employee_id,profile,payroll_aug_2026,updated_at').limit(2000),db.from('employee_family_details').select('employee_id,spouse,children,updated_at').limit(2000)])
 if(employees.error||details.error||families.error||!employees.data||!details.data||!families.data)throw Error('Employee data unavailable')
 return{employees:employees.data as Snapshot['employees'],details:details.data as Snapshot['details'],families:families.data as Snapshot['families']}
}
export function serviceDb(){const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!key)throw Error('Bulk upload service unavailable');return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,key,{auth:{persistSession:false,autoRefreshToken:false}})}
type TokenPayload={hash:string;expires:number;timestamps:{employeeNo:string;core:string;details:string;family:string|null}[]}
function key(){const value=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!value)throw Error('Bulk upload service unavailable');return value}
export function signPreview(payload:TokenPayload):string{const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');const signature=createHmac('sha256',key()).update(encoded).digest('base64url');return `${encoded}.${signature}`}
export function verifyPreview(token:string,hash:string):TokenPayload{
 const [encoded,signature,...rest]=token.split('.');if(!encoded||!signature||rest.length)throw Error('Invalid preview token')
 const expected=createHmac('sha256',key()).update(encoded).digest('base64url')
 if(signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw Error('Invalid preview token')
 const payload=JSON.parse(Buffer.from(encoded,'base64url').toString()) as TokenPayload
 if(payload.hash!==hash||payload.expires<Date.now()||!Array.isArray(payload.timestamps))throw Error('Preview expired or file changed. Preview the upload again')
 return payload
}
