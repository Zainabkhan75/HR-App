'use client'
import {useState} from 'react'

type Preview={month:string;token:string;netCents:number;rows:{employeeNo:string;name:string;sourceName:string;netCents:number}[]}
const money=new Intl.NumberFormat('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2})

export default function MonthlyPayrollUpload(){
 const [month,setMonth]=useState('')
 const [file,setFile]=useState<File|null>(null)
 const [preview,setPreview]=useState<Preview|null>(null)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 async function send(action:'preview'|'publish'){
  if(!file||!month||busy)return
  setBusy(true);setError('');setNotice('')
  if(action==='preview')setPreview(null)
  try{
   const form=new FormData()
   form.set('file',file);form.set('month',month);form.set('action',action)
   if(action==='publish'&&preview)form.set('token',preview.token)
   const response=await fetch('/api/admin/monthly-payroll',{method:'POST',body:form})
   const result=await response.json()
   if(!response.ok)throw Error(result.error??'Payroll upload failed.')
   if(action==='preview')setPreview(result as Preview)
   else{setPreview(null);setNotice('Published '+result.published+' payslips for '+result.month+'.')}
  }catch(error){setError(error instanceof Error?error.message:'Payroll upload failed.')}
  finally{setBusy(false)}
 }
 return <section className="panel">
  <h2>Monthly payroll</h2>
  <p>Choose a month from October 2026 onward and upload the approved Payroll workbook. Match every row to an existing HR App employee ID.</p>
  <label>Payroll month<input type="month" min="2026-10" value={month} disabled={busy} onChange={event=>{setMonth(event.target.value);setPreview(null)}}/></label>
  <label>Approved payroll workbook<input type="file" accept=".xlsx" disabled={busy} onChange={event=>{setFile(event.target.files?.[0]??null);setPreview(null)}}/></label>
  <button type="button" disabled={!month||!file||busy} onClick={()=>void send('preview')}>Preview payroll</button>
  {error&&<p className="error" role="alert">{error}</p>}
  {notice&&<p className="notice" role="status">{notice}</p>}
  {preview&&<>
   <h3>Review {preview.month} payroll</h3>
   <p>{preview.rows.length} employees · PKR {money.format(preview.netCents/100)} total net pay</p>
   <div className="tablewrap"><table><thead><tr><th>Employee ID</th><th>HR App name</th><th>Workbook name</th><th>Net pay (PKR)</th></tr></thead><tbody>
    {preview.rows.map(row=><tr key={row.employeeNo}><td>{row.employeeNo}</td><td>{row.name}</td><td>{row.sourceName}</td><td>{money.format(row.netCents/100)}</td></tr>)}
   </tbody></table></div>
   <button type="button" disabled={busy} onClick={()=>void send('publish')}>Publish {preview.month} payslips</button>
  </>}
 </section>
}
