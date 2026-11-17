import {redirect} from 'next/navigation'
import {serverSupabase} from '../../lib/server'
import Portal from './view'
import AccountStatus from './account-status'
import type {EmployeeProfile} from '../../lib/ess-profile'

export default async function PortalPage({searchParams}:{searchParams:Promise<{section?:string;message?:string}>}){
 const params=await searchParams
 const showMsgBox=params.section==='msgbox'
 const message=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(params.message??'')?params.message:undefined
 const msgboxPath='/portal?section=msgbox'+(message?'&message='+message:'')
 const db=await serverSupabase()
 const {data:{user}}=await db.auth.getUser()
 if(!user)redirect(showMsgBox?'/login?next='+encodeURIComponent(msgboxPath):'/login')

 const {data:roles,error:roleError}=await db.from('user_roles').select('role').eq('user_id',user.id)
 if(roleError)return <AccountStatus email={user.email} title="Portal unavailable" message="We could not check your account permissions. Please try again or contact HR."/>
 const isAdmin=roles?.some(r=>r.role==='hr_admin')??false

 const {data,error}=await db.rpc('my_employee_summary')
 if(error)return <AccountStatus email={user.email} title="Portal unavailable" message="We could not load your employee profile. Please try again or contact HR."/>
 const summary=Array.isArray(data)?data[0]:undefined
 if(!summary&&isAdmin)redirect(showMsgBox?'/workspace?section=inbox'+(message?'&message='+message:''):'/employees')
 if(!summary)return <AccountStatus email={user.email} title="Employee account unavailable" message="The account shown below has no active employee profile linked to it. If you intended to use a different account, sign out and sign in with your HR-approved username or email. Otherwise, contact HR."/>
 if(summary.must_change_password)redirect(showMsgBox?'/change-password?next='+encodeURIComponent(msgboxPath):'/change-password')

 const {data:profile,error:profileError}=await db.rpc('my_employee_profile')
 if(profileError||!profile)return <AccountStatus email={user.email} title="Profile unavailable" message="We could not load your self-service profile. Please try again or contact HR."/>

 const isManager=roles?.some(r=>r.role==='manager')??false
 const {data:team,error:teamError}=isManager?await db.rpc('my_team_summary'):{data:[],error:null}
 const date=new Intl.DateTimeFormat('en',{year:'numeric',month:'numeric',timeZone:'Asia/Karachi'}).formatToParts(new Date())
 const year=Number(date.find(part=>part.type==='year')?.value)
 const month=Number(date.find(part=>part.type==='month')?.value)
 const fiscalYear=month<7?year-1:year
 const {data:msgbox}=await db.rpc('msgbox_workspace',{p_year:fiscalYear})
 return <Portal msgboxData={msgbox??undefined} showMsgBox={showMsgBox} focusedMessage={message} isAdmin={isAdmin} initialProfile={profile as EmployeeProfile} team={team??[]} isManager={isManager} teamUnavailable={!!teamError}/>
}
