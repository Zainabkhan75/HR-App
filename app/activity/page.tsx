import {redirect} from 'next/navigation'
import {uploadContext} from '../../lib/bulk-upload-server'
import Activity from './view'

export const dynamic = 'force-dynamic'

export default async function ActivityPage() {
 const ctx = await uploadContext()
 if (ctx.status === 401) redirect('/login')
 if (ctx.status !== 200) redirect('/employees')

 const {data, error} = await ctx.db.rpc('employee_signin_activity')
 return <Activity rows={data ?? []} unavailable={Boolean(error)}/>
}
