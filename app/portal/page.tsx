import {redirect} from 'next/navigation'
import {serverSupabase} from '../../lib/server'
import Portal from './view'
export default async function PortalPage(){
 const db=await serverSupabase()
 const {data:{user}}=await db.auth.getUser()
 if(!user)redirect('/login')
 const {data, error}=await db.rpc('my_employee_summary')
 if(error) return <main className="shell"><h1>Portal unavailable</h1><p>Ask HR to check the account configuration.</p></main>
 const summary=Array.isArray(data)?data[0]:undefined
 if(!summary)return <main className="shell"><h1>Account not yet activated</h1><p>HR must link and activate your employee account before self-service is available.</p></main>
 if(summary.must_change_password)redirect('/change-password')
 const {data:roles}=await db.from('user_roles').select('role').eq('user_id',user.id)
 const isManager=roles?.some(r=>r.role==='manager')??false
 const {data:team}=isManager?await db.rpc('my_team_summary'):{data:[]}
 return <Portal summary={summary} team={team??[]} isManager={isManager}/>
}
