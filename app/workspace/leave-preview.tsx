'use client'

import {useState} from 'react'
import {leaveYear, previewHeadOfficeLeave} from '../../lib/head-office-leave'

type LeaveType = Parameters<typeof previewHeadOfficeLeave>[2]
type Duration = Parameters<typeof previewHeadOfficeLeave>[3]

export default function LeavePreview() {
  const [type, setType] = useState<LeaveType>('annual')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [duration, setDuration] = useState<Duration>('full-day')
  const withinYear = start && end && leaveYear(start) === 2026 && leaveYear(end) === 2026
  const charge = withinYear ? previewHeadOfficeLeave(start, end, type, duration) : null

  return <section className="panel" aria-label="Draft Head Office leave form">
    <h2>Head Office leave application preview</h2>
    <p>Draft form for HR review. Entries here are for preview only.</p>
    <label>Leave type<select value={type} onChange={event => setType(event.target.value as LeaveType)}>
      <option value="annual">Annual Leave</option>
      <option value="casual">Casual Leave</option>
      <option value="sick">Sick Leave</option>
      <option value="maternity">Maternity Leave</option>
      <option value="unpaid">Leave Without Pay</option>
    </select></label>
    <label>First day<input type="date" min="2026-07-01" max="2027-06-30" value={start} onChange={event => setStart(event.target.value)}/></label>
    <label>Last day<input type="date" min={start || '2026-07-01'} max="2027-06-30" value={end} onChange={event => setEnd(event.target.value)}/></label>
    {type === 'casual' && <label>Duration<select value={duration} onChange={event => {
      const value = event.target.value
      setDuration(value === '2' ? 2 : value === '4' ? 4 : 'full-day')
    }}>
      <option value="full-day">Full day</option>
      <option value="2">Two hours</option>
      <option value="4">Four hours</option>
    </select></label>}
    <label>Reason<textarea maxLength={2000} rows={3}/></label>
    <p role="status">{charge === null
      ? 'Choose valid dates in FY 2026–2027. Maternity requires 84 consecutive days. Partial days require one date.'
      : `Leave charge: ${charge} ${type === 'maternity' || type === 'unpaid' ? 'calendar' : 'working'} day(s).`}</p>
    <p>Preview uses the supplied confirmed and expected holidays.</p>
  </section>
}
