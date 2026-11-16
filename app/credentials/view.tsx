'use client'
import {validLoginEmail} from '../../lib/login-email'
import {useTableSort} from '../sortable-table'
import {useEffect,useMemo,useState} from 'react'

type Row={employeeId:string;name:string;username:string;linked:boolean;isAdmin:boolean;emailStatus:string;designation:string|null;employmentStatus:'active'|'inactive'}
type Generated={employeeId:string;name:string;username:string;password:string}
export default function Credentials(){
 const [rows,setRows]=useState<Row[]>([]),[generated,setGenerated]=useState<Record<string,string>>({}),[selected,setSelected]=useState<string[]>([]),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [status,setStatus]=useState<'all'|Row['employmentStatus']>('all')
 const [emailEmployee,setEmailEmployee]=useState('')
 const [emailFeedback,setEmailFeedback]=useState<{message:string;failed:boolean}|null>(null)
 const [employeeQuery,setEmployeeQuery]=useState('')
 const [employeeListOpen,setEmployeeListOpen]=useState(false)
 const [activeEmployeeIndex,setActiveEmployeeIndex]=useState(0)
 const selectedEmailAccount=rows.find(row=>row.employeeId===emailEmployee)
 const employeeMatches=rows.filter(row=>row.linked&&row.employmentStatus==='active'&&
  (row.name+' '+row.employeeId+' '+row.username).toLowerCase().includes(employeeQuery.trim().toLowerCase()))
  .sort((a,b)=>a.name.localeCompare(b.name))
 const employeeListVisible=employeeListOpen&&!busy
 function chooseEmailEmployee(row:Row){
  setEmailEmployee(row.employeeId)
  setEmployeeQuery(row.name)
  setNewEmail('')
  setEmailFeedback(null)
  setEmployeeListOpen(false)
 }
 useEffect(()=>{
  if(employeeListVisible)document.getElementById('email-employee-option-'+activeEmployeeIndex)?.scrollIntoView({block:'nearest'})
 },[employeeListVisible,activeEmployeeIndex])
 const [newEmail,setNewEmail]=useState('')
 const requestedEmail=newEmail.trim().toLowerCase()
 const alreadyCurrent=!!requestedEmail&&requestedEmail===selectedEmailAccount?.username.toLowerCase()
 const [canChangeAdminEmail,setCanChangeAdminEmail]=useState(false)
 const canEdit=!!selectedEmailAccount&&(!selectedEmailAccount.isAdmin||canChangeAdminEmail)
 const canChange=canEdit&&validLoginEmail(requestedEmail)&&!alreadyCurrent&&!busy
 async function requestEmailChange(event:React.FormEvent){
  event.preventDefault()
  if(!canChange)return
  if(!window.confirm(`Change ${selectedEmailAccount?.name}'s sign-in email to ${requestedEmail}? Confirm only if the employee controls this mailbox.`))return
  setBusy(true);setEmailFeedback(null)
  try{
   const response=await fetch('/api/admin/credentials/email',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'confirm',employeeId:emailEmployee,email:requestedEmail,verified:true}),
   })
   const {message,email}=await response.json()
   if(!response.ok)throw Error(message)
   setRows(old=>old.map(row=>row.employeeId===emailEmployee?{...row,username:email}:row))
   setNewEmail('')
   setEmailFeedback({message:`Sign-in email changed to ${email}.`,failed:false})
  }catch(error){setEmailFeedback({message:error instanceof Error?error.message:'Email change request failed.',failed:true})}
  finally{setBusy(false)}
 }
 useEffect(()=>{fetch('/api/admin/credentials',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('Could not load employee accounts');return r.json()}).then(d=>{setRows(d.rows);setCanChangeAdminEmail(d.canChangeAdminEmail===true)}).catch(e=>setError(e.message))},[])
 const credentialsSort=useTableSort()
 const shown=useMemo(()=>rows.filter(r=>(status==='all'||r.employmentStatus===status)&&(r.employeeId+' '+r.name+' '+r.username).toLowerCase().includes(search.toLowerCase().trim())),[rows,search,status])
 function toggle(id:string){setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id])}
 async function generate(){
  if(!selected.length)return
  setBusy(true);setError('');setNotice('')
  try{
   const response=await fetch('/api/admin/credentials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({employeeIds:selected})})
   const data=await response.json()
   const completed=(data.results??[]) as Generated[]
   if(completed.length)setGenerated(old=>({...old,...Object.fromEntries(completed.map(r=>[r.employeeId,r.password]))}))
   if(!response.ok)throw Error(data.error??'Password generation failed')
   setNotice(`${completed.length} temporary password${completed.length===1?'':'s'} generated. Save the register now; passwords will disappear when you leave this page.${data.auditWarnings?.length?' Audit logging failed for employee IDs: '+data.auditWarnings.join(', ')+'.':''}`)
   setSelected([])
  }catch(e){setError(e instanceof Error?e.message:'Password generation failed')}
  finally{setBusy(false)}
 }
 function download(){
  const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"'
  const values=[['Employee ID','Name','Designation','Employment Status','Username','Email Status','Password'],...rows.map(r=>[r.employeeId,r.name,r.designation??'',r.employmentStatus,r.username,r.emailStatus,generated[r.employeeId]??''])]
  const csv='\uFEFF'+values.map(row=>row.map(v=>quote(/^[\s]*[=+@\-\t\r]/.test(v)?"'"+v:v)).join(',')).join('\r\n')
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
  const anchor=document.createElement('a');anchor.href=url;anchor.download=`Bandana_Employee_Credentials_${new Date().toISOString().slice(0,10)}.csv`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
 }
 return <main className="shell"><header><div><div className="eyebrow">SEIDOHR / BANDANA · HR ADMINISTRATION</div><h1>Employee credentials</h1><p>Linked usernames and newly generated temporary passwords</p></div><nav className="head-actions"><a href="/employees">Employee directory</a><a href="/reports">Reports</a></nav></header>
 <section className="panel"><h2>Change sign-in email</h2>
  <p>Select an employee and enter the new sign-in email.</p>
  <form className="credentials-email-form" onSubmit={requestEmailChange}>
   <div className="credentials-email-picker">
    <label>Employee<input role="combobox" aria-autocomplete="list"
     aria-expanded={employeeListVisible} aria-controls="email-employee-options"
     aria-activedescendant={employeeListVisible&&employeeMatches[activeEmployeeIndex]?'email-employee-option-'+activeEmployeeIndex:undefined}
     autoComplete="off" placeholder="Type a name, employee ID or email"
     value={employeeQuery} disabled={busy}
     onFocus={()=>{setEmployeeListOpen(true);setActiveEmployeeIndex(0)}}
     onBlur={()=>setEmployeeListOpen(false)}
     onChange={event=>{setEmployeeQuery(event.target.value);setEmailEmployee('');setNewEmail('');setEmailFeedback(null);setActiveEmployeeIndex(0);setEmployeeListOpen(true)}}
     onKeyDown={event=>{
      if(event.key==='Escape'){setEmployeeListOpen(false);return}
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
       event.preventDefault()
       setEmployeeListOpen(true)
       setActiveEmployeeIndex(index=>employeeListVisible
        ?Math.max(0,Math.min(employeeMatches.length-1,index+(event.key==='ArrowDown'?1:-1)))
        :event.key==='ArrowUp'?Math.max(0,employeeMatches.length-1):0)
      }
      if(event.key==='Enter'&&employeeListVisible){
       event.preventDefault()
       const match=employeeMatches[activeEmployeeIndex]
       if(match)chooseEmailEmployee(match)
      }
     }}/></label>
    <div hidden={!employeeListVisible} style={{position:'absolute',top:'100%',left:0,right:0,zIndex:5,background:'white',border:'1px solid #c8d5e4',borderRadius:6}}>
     <ul id="email-employee-options" role="listbox" aria-label="Matching employees" style={{maxHeight:240,overflowY:'auto',margin:0,padding:0,listStyle:'none'}}>
      {employeeMatches.map((row,index)=><li key={row.employeeId} id={'email-employee-option-'+index} role="option" aria-selected={index===activeEmployeeIndex}
       style={{padding:'8px 10px',cursor:'pointer',overflowWrap:'anywhere',background:index===activeEmployeeIndex?'#e5eef8':undefined}}
       onMouseDown={event=>event.preventDefault()} onClick={()=>chooseEmailEmployee(row)}>
       <strong>{row.name}</strong><br/>{row.employeeId} · {row.username}
      </li>)}
     </ul>
     {!employeeMatches.length&&<p role="status" style={{padding:'0 10px'}}>No matching employees.</p>}
    </div>
   </div>
   {selectedEmailAccount&&<div className="credentials-email-details">
    <label>Current sign-in email<input readOnly value={selectedEmailAccount.username}/></label>
    {canEdit&&<label>New sign-in email<input type="email" maxLength={254} value={newEmail} disabled={busy} onChange={event=>setNewEmail(event.target.value)}/></label>}
    {alreadyCurrent&&<p className="error" role="status">This is already the current sign-in email.</p>}
   </div>}
   <button disabled={!canChange}>Confirm and change sign-in email</button>
  </form>
  {emailFeedback&&<p className={emailFeedback.failed?'error':'notice'} role={emailFeedback.failed?'alert':'status'}>{emailFeedback.message}</p>}
  {selectedEmailAccount?.isAdmin&&!canChangeAdminEmail&&<p className="error" role="status">Only the Super Admin can change this HR Admin’s sign-in email.</p>}
 </section>
 <section className="panel"><p className="error">Existing passwords cannot be displayed. Generating a temporary password replaces that employee’s current password and requires them to change it at next sign-in. Passwords appear only in this session.</p>
 <div className="bar credentials-toolbar"><label>Find employee<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ID, name or username"/></label><label>Employment Status<select value={status} disabled={busy} onChange={e=>{setStatus(e.target.value as typeof status);setSelected([])}}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label><button className="secondary" disabled={busy||!shown.some(r=>r.linked)} onClick={()=>setSelected(shown.filter(r=>r.linked).map(r=>r.employeeId))}>Select all linked shown</button><button disabled={busy||!selected.length} onClick={generate}>Generate for selected ({selected.length})</button><button className="secondary" onClick={download}>Download table CSV</button></div>
 {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
 <p className="muted">Showing {shown.length} of {rows.length} employees · {rows.filter(r=>r.linked).length} active linked accounts · {Object.keys(generated).length} passwords shown</p>
 <div className="tablewrap report-table credentials-table" tabIndex={0}><table><thead><tr><th scope="col">Select</th>{credentialsSort.heading('employeeId','Emp ID')}{credentialsSort.heading('name','Name')}{credentialsSort.heading('designation','Designation')}{credentialsSort.heading('employmentStatus','Status')}{credentialsSort.heading('username','Username')}{credentialsSort.heading('emailStatus','Email Status')}{credentialsSort.heading('password','Password')}</tr></thead><tbody>{credentialsSort.sortRows(shown,(row,column)=>column==='password'?generated[row.employeeId]:row[column as 'employeeId'|'name'|'username'|'emailStatus'|'designation'|'employmentStatus']).map(r=><tr key={r.employeeId}><td><input aria-label={`Select ${r.name}`} type="checkbox" disabled={!r.linked||busy} checked={selected.includes(r.employeeId)} onChange={()=>toggle(r.employeeId)}/></td><td>{r.employeeId}</td><td>{r.name}</td><td>{r.designation??'—'}</td><td><span className={'status '+r.employmentStatus}>{r.employmentStatus}</span></td><td>{r.username||<span className="muted">No linked account</span>}</td><td>{r.emailStatus}</td><td className="mono">{generated[r.employeeId]??<span className="muted">Not available</span>}</td></tr>)}</tbody></table></div>
 </section></main>
}
