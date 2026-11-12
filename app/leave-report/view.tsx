'use client'
import {useMemo, useState} from 'react'
import DateInput from '../date-input'
import {useTableSort} from '../sortable-table'
import {browserDb} from '../../lib/supabase'
import {
  applyFilter, detailCells, detailColumns, emptyFilter, fiscalYearLabel, fiscalYearOf, fiscalYearPeriod,
  leaveTypeLabel, leaveTypeOptions, summaryCells, summaryColumns, uniqueSorted, validPeriod,
} from '../../lib/leave-report'
import type {Cell, LeaveReport, ReportFilter} from '../../lib/leave-report'

const displayDate = (value: string) => value.slice(8, 10) + '/' + value.slice(5, 7) + '/' + value.slice(0, 4)

export default function LeaveReportView({initialReport, today}: {initialReport: LeaveReport; today: string}) {
  const [report, setReport] = useState(initialReport)
  const [from, setFrom] = useState(initialReport.from), [to, setTo] = useState(initialReport.to)
  const [filter, setFilter] = useState<ReportFilter>(emptyFilter)
  const [tab, setTab] = useState<'summary' | 'detail'>('summary')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const summarySort = useTableSort(), detailSort = useTableSort()

  const people = useMemo(() => {
    const seen = new Map<string, string>()
    for (const row of [...report.summary, ...report.detail]) seen.set(row.employee_no, row.name)
    return [...seen].sort((a, b) => a[0].localeCompare(b[0]))
  }, [report])
  const departments = useMemo(() => uniqueSorted([...report.summary, ...report.detail].map(row => row.department)), [report])
  const designations = useMemo(() => uniqueSorted([...report.summary, ...report.detail].map(row => row.designation)), [report])
  const filtered = useMemo(() => applyFilter(report, filter), [report, filter])
  const summaryRows = useMemo(() => filtered.summary.map(summaryCells), [filtered])
  const detailRows = useMemo(() => filtered.detail.map(detailCells), [filtered])
  const stale = from !== report.from || to !== report.to
  const periodOk = validPeriod(from, to)
  const thisYear = fiscalYearOf(today)

  async function load(nextFrom = from, nextTo = to) {
    if (busy || !validPeriod(nextFrom, nextTo)) return
    setBusy(true); setError('')
    try {
      const {data, error: failure} = await browserDb().rpc('leave_report', {p_from: nextFrom, p_to: nextTo})
      if (failure || !data) setError(failure?.code === '42501' ? 'HR administrator access is required.' : failure?.code === '22023' ? failure.message : 'Could not load the report. Please try again.')
      else { setReport(data as LeaveReport); setFrom(nextFrom); setTo(nextTo) }
    } catch { setError('Connection interrupted. Please try again.') }
    finally { setBusy(false) }
  }
  function fiscalYear(year: number) {
    const period = fiscalYearPeriod(year)
    setFrom(period.from); setTo(period.to)
    void load(period.from, period.to)
  }
  async function download() {
    if (busy || stale) return
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/admin/leave-report', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({from: report.from, to: report.to, filter}),
      })
      if (!response.ok) { setError((await response.json().catch(() => null))?.error ?? 'Could not create the Excel file.'); return }
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a')
      link.href = url; link.download = 'Bandana_Leave_Summary_' + report.from + '_to_' + report.to + '.xlsx'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch { setError('Could not create the Excel file. Please try again.') }
    finally { setBusy(false) }
  }
  const table = (caption: string, columns: readonly string[], rows: Cell[][], sort: ReturnType<typeof useTableSort>) => {
    const sorted = sort.sortRows(rows, (row, column) => row[columns.indexOf(column)])
    return <div className="tablewrap report-table" tabIndex={0} aria-label={'Scrollable ' + caption}>
      <table><caption className="report-caption">{caption}</caption>
        <thead><tr>{columns.map(column => sort.heading(column))}</tr></thead>
        <tbody>{sorted.map((row, index) => <tr key={index}>{row.map((cell, position) => <td key={position}>{cell === null || cell === '' ? <span className="muted">—</span> : cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  }

  return <main className="shell">
    <header><div><div className="eyebrow">SEIDOHR / BANDANA · HR ADMINISTRATION</div><h1>Leave summary report</h1>
      <p>Showing {displayDate(report.from)} to {displayDate(report.to)}. Balances are for the fiscal year, 1 July to 30 June.</p></div>
      <nav className="head-actions" aria-label="Admin navigation"><a href="/employees">Employee directory</a><a href="/reports">Employee reports</a><a href="/workspace?section=settings">Leave & Inbox</a></nav>
    </header>
    <section className="panel">
      <form className="bar" onSubmit={event => { event.preventDefault(); void load() }}>
        <label>From<DateInput required value={from} disabled={busy} onChange={setFrom}/></label>
        <label>To<DateInput required value={to} min={/^\d{4}-\d{2}-\d{2}$/.test(from) ? from : undefined} disabled={busy} onChange={setTo}/></label>
        <button disabled={busy || !periodOk}>{busy ? 'Please wait...' : 'Run report'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => fiscalYear(thisYear)}>{fiscalYearLabel(thisYear)}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => fiscalYear(thisYear - 1)}>{fiscalYearLabel(thisYear - 1)}</button>
      </form>
      {!periodOk && <p className="error" role="alert">Enter a valid period of up to three years, with the To date on or after the From date.</p>}
      {stale && periodOk && <p className="notice" role="status">The dates have changed. Select Run report to update the figures.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="bar">
        <label>Search ID or name<input value={filter.search} onChange={event => setFilter(old => ({...old, search: event.target.value}))} placeholder="Employee ID or name"/></label>
        <label>Department<select value={filter.department} onChange={event => setFilter(old => ({...old, department: event.target.value}))}><option value="">All departments</option>{departments.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>Designation<select value={filter.designation} onChange={event => setFilter(old => ({...old, designation: event.target.value}))}><option value="">All designations</option>{designations.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>Leave type<select value={filter.leaveType} onChange={event => setFilter(old => ({...old, leaveType: event.target.value}))}><option value="">All leave types</option>{leaveTypeOptions.map(item => <option key={item} value={item}>{leaveTypeLabel(item)}</option>)}</select></label>
      </div>
      <label>Employees (leave empty for all; hold Ctrl or Cmd to choose several)
        <select multiple size={6} value={filter.employees} onChange={event => setFilter(old => ({...old, employees: Array.from(event.target.selectedOptions as HTMLCollectionOf<HTMLOptionElement>, option => option.value)}))}>
          {people.map(([id, name]) => <option key={id} value={id}>{id} · {name}</option>)}
        </select>
      </label>
      <div className="bar">
        <button type="button" className="secondary" onClick={() => setFilter(emptyFilter)}>Clear filters</button>
        <button type="button" onClick={() => void download()} disabled={busy || stale || (!summaryRows.length && !detailRows.length)}>Download Excel</button>
      </div>
      <div className="tabs" aria-label="Choose view">
        <button aria-pressed={tab === 'summary'} className={tab === 'summary' ? 'tab active-tab' : 'tab'} onClick={() => setTab('summary')}>Summary ({summaryRows.length})</button>
        <button aria-pressed={tab === 'detail'} className={tab === 'detail' ? 'tab active-tab' : 'tab'} onClick={() => setTab('detail')}>Requests in period ({detailRows.length})</button>
      </div>
      {tab === 'summary' ? <>
        <p className="muted">One row per employee, fiscal year and leave type. “In Period” counts leave days falling inside the chosen dates. Balance is entitlement less opening days taken, approved days and pending days for the whole fiscal year. Leave Without Pay and Maternity Leave have no balance.</p>
        {summaryRows.length ? table('Leave summary', summaryColumns, summaryRows, summarySort) : <p>No balances or leave match these filters.</p>}
      </> : <>
        <p className="muted">Every leave request that overlaps the chosen dates, including rejected and withdrawn requests.</p>
        {detailRows.length ? table('Leave requests in period', detailColumns, detailRows, detailSort) : <p>No leave requests match these filters.</p>}
      </>}
    </section>
  </main>
}
