import {redirect} from 'next/navigation'
import {uploadContext} from '../../lib/bulk-upload-server'
import Activity from './view'

export const dynamic = 'force-dynamic'

export default async function ActivityPage() {
 const ctx = await uploadContext()
 if (ctx.status === 401) redirect('/login')
 if (ctx.status !== 200) redirect('/employees')

 const [activity, employees] = await Promise.all([
  ctx.db.rpc('employee_signin_activity'),
  ctx.db.from('employees').select('employee_no,employment_state').limit(2000),
 ])
 const statusByEmployee = new Map((employees.data ?? []).map(row => [row.employee_no, row.employment_state]))
 const rows = (activity.data ?? []).map((row: {employee_no: string; full_name: string; login_linked: boolean; last_sign_in_at: string | null}) => ({
  ...row,
  employment_state: statusByEmployee.get(row.employee_no),
 }))
 return <Activity rows={rows} unavailable={Boolean(activity.error || employees.error || rows.some((row: {employment_state?: string}) => !row.employment_state))}/>
}
