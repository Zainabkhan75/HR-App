import {redirect} from 'next/navigation'
import {uploadContext,serviceDb} from '../../lib/bulk-upload-server'
import {loadEmailRecipients} from '../../lib/employee-emails-server'
import Emails from './view'
export const dynamic='force-dynamic'
export default async function EmailPage(){
 const ctx=await uploadContext();if(ctx.status===401)redirect('/login');if(ctx.status!==200)redirect('/employees')
 try{const recipients=await loadEmailRecipients(ctx.db),{data:history}=await serviceDb().rpc('admin_email_history',{p_actor:ctx.user.id});return <Emails recipients={recipients} adminEmail={ctx.user.email??''} configured={!!process.env.RESEND_API_KEY?.trim()} history={history??[]}/>}
 catch{return <main className="shell"><h1>Email employees</h1><p>Could not load employee emails. Please refresh.</p><a href="/employees">Employee directory</a></main>}
}
