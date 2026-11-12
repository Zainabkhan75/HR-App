import {redirect} from 'next/navigation'
import {loadLeaveReport} from '../../lib/leave-report-server'
import {fiscalYearOf, fiscalYearPeriod} from '../../lib/leave-report'
import LeaveReportView from './view'

export const dynamic = 'force-dynamic'

// HR leave summary report. Opens on the current fiscal year (1 July to 30 June).
export default async function LeaveReportPage() {
  const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Karachi'}).format(new Date())
  const period = fiscalYearPeriod(fiscalYearOf(today))
  const result = await loadLeaveReport(period.from, period.to)
  if (result.status === 401) redirect('/login?next=/leave-report')
  if (result.status !== 200) return <main className="shell">
    <h1>{result.status === 403 ? 'Access restricted' : 'Leave report unavailable'}</h1>
    <p>{result.status === 403 ? 'HR administrator access is required.' : 'Could not load the leave report. Please refresh to try again.'}</p>
    <a href="/employees">Back to directory</a>
  </main>
  return <LeaveReportView initialReport={result.report} today={today}/>
}
