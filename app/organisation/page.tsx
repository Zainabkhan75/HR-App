import {redirect} from 'next/navigation'
import {serverSupabase} from '../../lib/server'
import Organisation from './view'

export const dynamic='force-dynamic'

export default async function OrganisationPage(){
 const db=await serverSupabase()
 const {data:{user}}=await db.auth.getUser()
 if(!user)redirect('/login')
 const {data:role}=await db.from('user_roles').select('role').eq('user_id',user.id).eq('role','hr_admin').maybeSingle()
 if(!role)return <main className="shell"><h1>Access restricted</h1><p>HR administrator access is required.</p></main>
 return <Organisation/>
}
