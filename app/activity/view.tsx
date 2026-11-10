'use client'

import {useState} from 'react'
import {useTableSort} from '../sortable-table'

type ActivityRow = {
 employee_no: string
 full_name: string
 login_linked: boolean
 last_sign_in_at: string | null
 employment_state?: string
}

const karachiTime = new Intl.DateTimeFormat('en-GB', {
 dateStyle: 'medium',
 timeStyle: 'medium',
 timeZone: 'Asia/Karachi',
})

export default function Activity({rows, unavailable}: {rows: ActivityRow[]; unavailable: boolean}) {
 const sort = useTableSort('last_sign_in_at', false)
 const [status, setStatus] = useState('active')
 const visible = status === 'all' ? rows : rows.filter(row => row.employment_state === status)
 const sorted = sort.sortRows(visible, (row, column) => {
  if (column === 'last_sign_in_at') return row.last_sign_in_at ? Date.parse(row.last_sign_in_at) : null
  return column === 'employee_no' ? row.employee_no : row.full_name
 })

 return <main className="shell">
  <header>
   <div><div className="eyebrow">SEIDOHR / BANDANA · HR ADMINISTRATION</div><h1>Activity</h1><p>Latest sign-in per employee · Karachi time (PKT)</p></div>
   <nav className="head-actions" aria-label="Admin Navigation"><a href="/employees">Employee Directory</a><a href="/emails">Email Employees</a><a href="/activity">Refresh Activity</a></nav>
  </header>
  <section className="panel">
   {unavailable ? <p role="alert" className="error">Could not load sign-in activity. Please refresh.</p> : <>
    <div className="bar">
     <label>Employment status<select value={status} onChange={event => setStatus(event.target.value)}>
      <option value="active">Active employees only</option>
      <option value="inactive">Inactive employees only</option>
      <option value="all">All employees</option>
     </select></label>
     <p className="muted" role="status">Showing {visible.length} of {rows.length} employees</p>
    </div>
    {sorted.length === 0 ? <p>No employees match this filter.</p> : <div className="tablewrap">
    <table>
     <thead><tr>{sort.heading('employee_no','Employee ID')}{sort.heading('full_name','Name')}{sort.heading('last_sign_in_at','Last Sign-In (PKT)')}</tr></thead>
     <tbody>{sorted.map(row => <tr key={row.employee_no}>
      <td className="mono">{row.employee_no}</td><td>{row.full_name}</td>
      <td>{row.last_sign_in_at ? <time dateTime={row.last_sign_in_at}>{karachiTime.format(new Date(row.last_sign_in_at))}</time> : row.login_linked ? 'Never signed in' : 'No login'}</td>
     </tr>)}</tbody>
    </table>
   </div>}</>}
  </section>
 </main>
}
