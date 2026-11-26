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
 const [employees,details,families,accounts,positions,designations]=await Promise.all([db.from('employees').select('id,employee_no,position_id,full_name,designation,department,reports_to_text,location,record_status,source_note,employment_state,leaving_date,updated_at').order('employee_no').limit(2000),db.from('employee_details').select('employee_id,profile,payroll_sep_2026,updated_at').limit(2000),db.from('employee_family_details').select('employee_id,spouse,children,marital_status,updated_at').limit(2000),db.from('employee_accounts').select('employee_id,user_id,username,login_email,is_active,must_change_password').order('employee_id').limit(2000),db.from('position_records').select('id,position_title,designation_id').order('id'),db.from('designations').select('id,title').order('id')])
 if(designations.error||!designations.data||positions.error||!positions.data||employees.error||details.error||families.error||accounts.error||!employees.data||!details.data||!families.data||!accounts.data)throw Error('Employee data unavailable')
 const titles=new Map(designations.data.map(d=>[d.id,d.title]))
 const assignments=positions.data.map(p=>({id:Number(p.id),position:p.position_title,designation:titles.get(p.designation_id)??''}))
 return{assignments,positionIds:positions.data.map(position=>Number(position.id)),employees:employees.data as Snapshot['employees'],details:details.data as Snapshot['details'],families:families.data as Snapshot['families'],accounts:accounts.data as Snapshot['accounts']}
}
export function serviceDb(){const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!key)throw Error('Bulk upload service unavailable');return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,key,{auth:{persistSession:false,autoRefreshToken:false}})}
type TokenPayload={hash:string;expires:number;timestamps:{reference?:string;action?:'NEW'|'UPDATE';employeeNo:string;core:string;details:string;family:string|null;account?:string}[]}
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
