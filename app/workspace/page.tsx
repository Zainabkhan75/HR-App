import {redirect} from 'next/navigation'
import {serverSupabase} from '../../lib/server'
import Workspace from './view'
import type {WorkspaceData} from '../../lib/leave'
export default async function WorkspacePage({searchParams}:{searchParams:Promise<{section?:string;request?:string;year?:string}>}){
 const params=await searchParams
 const section=['leave','inbox','approvals','settings'].includes(params.section??'')?params.section!:'leave'
 const request=/^[0-9a-f-]{36}$/i.test(params.request??'')?params.request:undefined
 const thisYear=new Date().getFullYear()
 const year=Number(params.year)||thisYear
 const selectedYear=Number.isInteger(year)&&year>=2020&&year<=2100?year:thisYear
 const next='/workspace?section='+section+'&year='+selectedYear+(request?'&request='+request:'')
 const db=await serverSupabase();const {data:{user}}=await db.auth.getUser()
 if(!user)redirect('/login?next='+encodeURIComponent(next))
 const {data:role}=await db.from('user_roles').select('role').eq('user_id',user.id).eq('role','hr_admin').maybeSingle()
 if(!role)return <main className="mobile-shell"><h1>Coming in Phase 2</h1><p>Leave applications and Inbox will be available in Phase 2. Please complete your employee profile for Phase 1.</p><a href="/portal">Back to my employee portal</a></main>
 const {data,error}=await db.rpc('leave_workspace',{p_year:selectedYear})
 if(error||!data)return <main className="mobile-shell"><h1>Leave & Inbox unavailable</h1><p>{error?.code==='42501'?'An active employee account with password setup complete, or HR administrator access, is required.':'We could not load leave details. Please try again.'}</p><a href="/portal">Back to employee portal</a></main>
 return <Workspace initialData={data as WorkspaceData} initialSection={section} focusedRequest={request}/>
}
