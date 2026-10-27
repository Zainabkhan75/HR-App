import {redirect} from 'next/navigation'
import {serverSupabase} from '../../lib/server'
import Portal from './view'
import AccountStatus from './account-status'
import type {EmployeeProfile} from '../../lib/ess-profile'

export default async function PortalPage(){
 const db=await serverSupabase()
 const {data:{user}}=await db.auth.getUser()
 if(!user)redirect('/login')

 const {data:roles,error:roleError}=await db.from('user_roles').select('role').eq('user_id',user.id)
 if(roleError)return <AccountStatus email={user.email} title="Portal unavailable" message="We could not check your account permissions. Please try again or contact HR."/>
 if(roles?.some(r=>r.role==='hr_admin'))redirect('/employees')

 const {data,error}=await db.rpc('my_employee_summary')
 if(error)return <AccountStatus email={user.email} title="Portal unavailable" message="We could not load your employee profile. Please try again or contact HR."/>
 const summary=Array.isArray(data)?data[0]:undefined
 if(!summary)return <AccountStatus email={user.email} title="Employee account unavailable" message="The account shown below has no active employee profile linked to it. If you intended to use a different account, sign out and sign in with your HR-approved username or email. Otherwise, contact HR."/>
 if(summary.must_change_password)redirect('/change-password')

 const {data:profile,error:profileError}=await db.rpc('my_employee_profile')
 if(profileError||!profile)return <AccountStatus email={user.email} title="Profile unavailable" message="We could not load your self-service profile. Please try again or contact HR."/>

 const isManager=roles?.some(r=>r.role==='manager')??false
 const {data:team,error:teamError}=isManager?await db.rpc('my_team_summary'):{data:[],error:null}
 return <Portal initialProfile={profile as EmployeeProfile} team={team??[]} isManager={isManager} teamUnavailable={!!teamError}/>
}
