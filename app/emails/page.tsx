import {redirect} from 'next/navigation'
import {uploadContext,serviceDb} from '../../lib/bulk-upload-server'
import {loadEmailRecipients} from '../../lib/employee-emails-server'
import Emails from './view'
export const dynamic='force-dynamic'
export default async function EmailPage({searchParams}:{searchParams:Promise<{invite?:string}>}){
 const ctx=await uploadContext();if(ctx.status===401)redirect('/login');if(ctx.status!==200)redirect('/employees')
 try{
  const admin=serviceDb()
  const [recipients,{data:history},accounts]=await Promise.all([
   loadEmailRecipients(ctx.db),
   admin.rpc('admin_email_history',{p_actor:ctx.user.id}),
   admin.from('employee_accounts').select('employee_id,login_email,is_active').limit(2000),
  ])
  if(accounts.error)throw accounts.error
  const linked=new Set(accounts.data.map(account=>account.employee_id))
  const active=recipients.filter(recipient=>recipient.reason!=='Inactive employee')
  const counts={
   active:active.length,
   withoutLogin:active.filter(recipient=>recipient.email&&!linked.has(recipient.id)).length,
   withoutEmail:active.filter(recipient=>!recipient.email).length,
  }
  const {invite}=await searchParams
  const recipient=invite ? active.find(row=>row.employee_no===invite&&row.email) : undefined
  const account=recipient && accounts.data.find(row=>row.employee_id===recipient.id&&row.is_active)
  const invitation=recipient&&account ? {id:recipient.id,employeeNo:recipient.employee_no,loginEmail:account.login_email} : undefined
  return <Emails key={invite??""} recipients={invitation&&recipient?[recipient]:recipients} counts={counts} adminEmail={ctx.user.email??''} configured={!!process.env.RESEND_API_KEY?.trim()} history={history??[]} invitation={invitation} invitationUnavailable={!!invite&&!invitation}/>
 }
 catch{return <main className="shell"><h1>Email employees</h1><p>Could not load employee emails. Please refresh.</p><a href="/employees">Employee directory</a></main>}
}
