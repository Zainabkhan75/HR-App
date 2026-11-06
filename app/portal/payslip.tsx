'use client'
import {useEffect,useState} from 'react'
import {browserDb} from '../../lib/supabase'
import {formatMoneyField} from '../../lib/money'
import type {Values} from '../../lib/ess-profile'
import {fieldKey,payrollFields} from '../employees/field-config'

const september='2026-09-01'
const label=(month:string)=>new Intl.DateTimeFormat('en-PK',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(month))

export default function Payslip({legacy,identity}:{legacy:Values;identity:Values}){
 const [months,setMonths]=useState<string[]|null>(null)
 const [month,setMonth]=useState('')
 const [slip,setSlip]=useState<{month:string;values:Values}|null>(null)
 const [error,setError]=useState('')
 const hasSeptember=Object.values(legacy).some(value=>value!=null&&value!=='')
 useEffect(()=>{
  let current=true
  void (async()=>{
   const {data,error}=await browserDb().from('monthly_payroll').select('payroll_month').order('payroll_month',{ascending:false})
   if(!current)return
   if(error)setError('Could not load monthly payslips. Open this tab again to retry.')
   const available=[...new Set([...(data??[]).map(row=>row.payroll_month),...(hasSeptember?[september]:[])])]
   setMonths(available)
   setMonth(available[0]??'')
  })()
  return ()=>{current=false}
 },[hasSeptember])
 useEffect(()=>{
  if(!month||month===september)return
  let current=true
  void (async()=>{
   const {data,error}=await browserDb().from('monthly_payroll').select('fields').eq('payroll_month',month).maybeSingle()
   if(!current)return
   if(error||!data){setError('Could not load this payslip. Select the month again or reopen this tab.');return}
   setSlip({month,values:data.fields as Values})
  })()
  return ()=>{current=false}
 },[month])
 const values=month===september?legacy:slip?.month===month?slip.values:null
 return <section className="panel">
  <div className="ess-section-heading"><h2>My Payslip</h2><span className="ess-readonly">View Only</span></div>
  {error&&<p className="error" role="alert">{error}</p>}
  {months===null?<p role="status">Loading payroll months…</p>:months.length===0&&!error?<p>No payslips have been published for you yet.</p>:null}
  {!!months?.length&&<label>Payroll month<select value={month} onChange={event=>{setError('');setMonth(event.target.value)}}>{months.map(period=><option key={period} value={period}>{label(period)}</option>)}</select></label>}
  {month&&!values&&!error&&<p role="status">Loading payslip…</p>}
  {values&&<dl className="profile-grid">{payrollFields.map(field=>{
   const key=fieldKey(field)
   return <div className="ess-field" key={key}><dt>{field}</dt><dd>{formatMoneyField(key,key in identity?identity[key]:values[key])?.trim()||'Not recorded'}</dd></div>
  })}</dl>}
 </section>
}
