import {redirect} from 'next/navigation'
import {serverSupabase} from '../../lib/server'
import Directory from './view'
export default async function Employees(){const db=await serverSupabase();const {data:{user}}=await db.auth.getUser();if(!user)redirect('/login');const {data:role}=await db.from('user_roles').select('role').eq('user_id',user.id).eq('role','hr_admin').maybeSingle();if(!role)return <main className="shell"><h1>Access restricted</h1><p>Ask an authorised HR administrator to grant access.</p></main>;return <Directory email={user.email??''}/>}



