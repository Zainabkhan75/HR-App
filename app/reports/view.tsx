'use client'
import {useTableSort} from '../sortable-table'
import {useMemo,useState} from 'react'
import type {ReportTable} from '../../lib/admin-reports'
import {reportCsv} from '../../lib/admin-reports'
import {formatMoneyField} from '../../lib/money'
export default function Reports({data,generatedAt}:{data:{full:ReportTable;payroll:ReportTable};generatedAt:string}){
 const [kind,setKind]=useState<'full'|'payroll'>('full'),[search,setSearch]=useState(''),[department,setDepartment]=useState(''),[page,setPage]=useState(0)
 const table=data[kind],departments=useMemo(()=>[...new Set(data.full.rows.map(r=>r.Department).filter(Boolean))].sort(),[data])
 const filtered=useMemo(()=>{const q=search.trim().toLowerCase();return table.rows.filter(r=>(!department||r.Department===department)&&(!q||Object.values(r).some(v=>v.toLowerCase().includes(q))))},[table,search,department])
 const reportSort=useTableSort()
 const sorted=reportSort.sortRows(filtered,(row,column)=>row[column])
 const lastPage=Math.max(0,Math.ceil(filtered.length/25)-1),current=Math.min(page,lastPage),visible=sorted.slice(current*25,current*25+25)
 function download(){const blob=new Blob([reportCsv(table,[...sorted])],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Bandana_'+(kind==='full'?'Employee_Profile_Report':'Payroll_and_Salary_Report')+'_'+generatedAt.slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 return <main className="shell"><header><div><div className="eyebrow">SEIDOHR / BANDANA · HR ADMINISTRATION</div><h1>Employee reports</h1><p>Live employee data · generated {new Date(generatedAt).toLocaleString('en-GB',{timeZone:'Asia/Karachi'})} PKT</p></div><nav className="head-actions" aria-label="Admin navigation"><a href="/employees">Employee directory</a><a href="/credentials">Employee credentials</a><a href="/emails">Email employees</a><a href="/activity">Activity</a><a href="/workspace?section=settings">Leave & Inbox</a></nav></header>
 <section className="panel"><div className="tabs" aria-label="Choose report"><button aria-pressed={kind==='full'} className={kind==='full'?'tab active-tab':'tab'} onClick={()=>{setKind('full');setSearch('');setPage(0)}}>Employee Profiles</button><button aria-pressed={kind==='payroll'} className={kind==='payroll'?'tab active-tab':'tab'} onClick={()=>{setKind('payroll');setSearch('');setPage(0)}}>Payroll & Salary</button></div>
 <h2>{kind==='full'?'Employee Profile Report':'Payroll & Salary Report'}</h2><p>{kind==='full'?'Current employee profile, payroll, dependant and login status fields.':'Saved September payroll values, benefits and bank details.'}</p>
 {kind==='payroll'&&<p className="notice">Transfer and bank details are shown only where explicitly recorded. “Not recorded” means no value is stored. HR can enter these in Employee Directory → Edit → Salary Slip.</p>}
 <div className="bar"><label>Search report<input value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}} placeholder="Name, employee ID, CNIC or any value"/></label><label>Department<select value={department} onChange={e=>{setDepartment(e.target.value);setPage(0)}}><option value="">All departments</option>{departments.map(d=><option key={d}>{d}</option>)}</select></label><button onClick={download} disabled={!filtered.length}>Download CSV ({filtered.length} rows)</button><button className="secondary" onClick={()=>window.location.reload()}>Refresh data</button></div>
 <p className="muted" role="status">{filtered.length} of {table.rows.length} employees · {table.columns.length} columns · CSV includes all matching rows</p>
 <div className="tablewrap report-table" tabIndex={0} aria-label="Scrollable employee report"><table><caption className="report-caption">{kind==='full'?'Employee Profiles':'Payroll & Salary'}</caption><thead><tr>{table.columns.map(c=>reportSort.heading(c,c,()=>setPage(0)))}</tr></thead><tbody>{visible.map((r,i)=><tr key={r['Employee ID']||i}>{table.columns.map(c=><td key={c}>{r[c]!==undefined&&r[c]!==''?formatMoneyField(c,r[c]):<span className="muted">Not recorded</span>}</td>)}</tr>)}</tbody></table></div>
 {!filtered.length&&<p>No employees match these filters.</p>}<div className="bar report-pager"><button className="secondary" disabled={current===0} onClick={()=>setPage(current-1)}>Previous</button><span>Page {current+1} of {lastPage+1}</span><button className="secondary" disabled={current>=lastPage} onClick={()=>setPage(current+1)}>Next</button></div>
 </section></main>
}
