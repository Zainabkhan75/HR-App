import {redirect} from 'next/navigation'
import {serverSupabase} from '../../lib/server'
import Workspace from './view'
import LeavePreview from './leave-preview'
import type {WorkspaceData} from '../../lib/leave'
export default async function WorkspacePage({searchParams}:{searchParams:Promise<{section?:string;request?:string;year?:string}>}){
 const params=await searchParams
 const section=['leave','inbox','approvals','settings','leave-preview'].includes(params.section??'')?params.section!:'leave'
 const request=/^[0-9a-f-]{36}$/i.test(params.request??'')?params.request:undefined
 const dateParts=new Intl.DateTimeFormat('en',{year:'numeric',month:'numeric',timeZone:'Asia/Karachi'}).formatToParts(new Date())
 const thisYear=Number(dateParts.find(part=>part.type==='year')?.value)
 const month=Number(dateParts.find(part=>part.type==='month')?.value)
 const year=Number(params.year)||thisYear
 const selectedYear=Number.isInteger(year)&&year>=2020&&year<=2100?year:thisYear
 const next='/workspace?section='+section+(params.year?'&year='+selectedYear:'')+(request?'&request='+request:'')
 const db=await serverSupabase();const {data:{user}}=await db.auth.getUser()
 if(!user)redirect('/login?next='+encodeURIComponent(next))
 let {data,error}=await db.rpc('leave_workspace',{p_year:selectedYear})
 if(!params.year&&data?.pilot_applicant&&month<7){
  ({data,error}=await db.rpc('leave_workspace',{p_year:thisYear-1}))
 }
 if(section==='leave-preview'&&data?.is_hr)return <main className="mobile-shell"><LeavePreview/><a href="/workspace?section=settings">Back to leave settings</a></main>
 if(error||!data)return <main className="mobile-shell"><h1>Leave & Inbox unavailable</h1><p>{error?.code==='42501'?'An active employee account with password setup complete, or HR administrator access, is required.':'We could not load leave details. Please try again.'}</p><a href="/portal">Back to employee portal</a></main>
 return <>
  {section==='settings' && data.is_hr && <div className="mobile-shell"><a href="/workspace?section=leave-preview">Preview the Head Office leave form</a></div>}
  <Workspace initialData={data as WorkspaceData} initialSection={section==='leave-preview'?'leave':section} focusedRequest={request}/>
 </>
}
