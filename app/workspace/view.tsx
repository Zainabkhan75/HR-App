'use client'
import DateInput from '../date-input'
import {displayShortDate} from '../../lib/date-input'
import {useRef,useState} from 'react'
import type {FormEvent} from 'react'
import type {EmployeeProfile} from '../../lib/ess-profile'
import {browserDb} from '../../lib/supabase'
import {availableDays,countLeaveDays,employeeLeaveData,leaveTypes,titleCase} from '../../lib/leave'
import {fyLabel,previewHeadOfficeLeave} from '../../lib/head-office-leave'
import type {WorkspaceData,LeaveRequest,LeaveType,ApplicationLeaveType} from '../../lib/leave'
type Section='leave'|'inbox'|'approvals'|'settings'
type Payload=Record<string,unknown>
export default function Workspace({initialData,initialSection,focusedRequest,embedded=false,employee}:{employee?:EmployeeProfile['employee'];embedded?:boolean;initialData:WorkspaceData;initialSection:string;focusedRequest?:string}){
 const [data,setData]=useState(initialData),[section,setSection]=useState<Section>(initialSection==='settings'&&!initialData.is_hr?'leave':initialSection as Section)
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(false)
 const lock=useRef(false)
 const [year,setYear]=useState(String(initialData.year))
 const [form,setForm]=useState({leave_type:'annual' as ApplicationLeaveType,start_date:'',end_date:'',reason:'',hours:undefined as 2|4|undefined})
 const [notes,setNotes]=useState<Record<string,string>>({})
 const [policy,setPolicy]=useState(()=>({annual:String(initialData.policy?.annual??10),sick:String(initialData.policy?.sick??10),casual:String(initialData.policy?.casual??10),weekdays_only:initialData.policy?.weekdays_only??true,holidays:initialData.policy?.holidays.map(displayShortDate).join('\n')??''}))
 const [opening,setOpening]=useState({employee_id:'',leave_type:'annual' as LeaveType,entitlement:'10',taken:''})
 const [assignment,setAssignment]=useState({employee_id:''})
 const [task,setTask]=useState({recipient_user_id:'',title:'',body:''})
 const [holiday,setHoliday]=useState({name:'',from:'',to:'',expected:false})
 const holidays=data.holiday_list??[]
 const [managerTask,setManagerTask]=useState({recipient_user_id:'',title:'',body:''})
 const unread=data.inbox.filter(i=>!i.read_at).length
 const pending=data.approvals.filter(r=>r.status==='pending').length
 const balance=data.balances.find(b=>b.type===form.leave_type)
 // July–June rules now apply to every applicant; pilot_applicant only decides who sees the application form.
 const pilot=true
 const minDate=data.year+(pilot?'-07-01':'-01-01')
 const maxDate=pilot?(data.year+1)+'-06-30':data.year+'-12-31'
 const partial=pilot&&form.leave_type==='casual'&&form.hours!==undefined
 const lastDate=partial?form.start_date:form.end_date
 const needsBalance=form.leave_type!=='maternity'&&form.leave_type!=='unpaid'
 const estimate=data.policy && form.start_date>=minDate && lastDate<=maxDate
  ? pilot ? previewHeadOfficeLeave(form.start_date,lastDate,form.leave_type,form.hours??'full-day',data.policy)
   : countLeaveDays(form.start_date,lastDate,data.policy)
  : null
 const employees=data.employees??[]
 const currentOpening=data.openings?.find(o=>o.employee_id===opening.employee_id&&o.leave_type===opening.leave_type)
 const currentManager=data.links?.find(l=>l.member_employee_id===assignment.employee_id)
 function selectOpeningEmployee(employeeId:string){
  openingEmployee(employeeId)
  setAssignment({employee_id:employeeId})
 }
 const canSubmit=!!data.employee_id&&!!data.policy&&!!data.manager?.ready&&(!needsBalance||!!balance?.verified)&&!busy&&!uncertain
 async function refresh(selectedYear=data.year){
  const {data:loaded,error:failure}=await browserDb().rpc('leave_workspace',{p_year:selectedYear})
  if(failure||!loaded)throw Error('Could not reload leave and inbox details. Please try Refresh again.')
  const result=embedded?employeeLeaveData(loaded as WorkspaceData):loaded as WorkspaceData
  setData(result);setYear(String(result.year));setUncertain(false)
  return result
 }
 async function run(rpc:'leave_action'|'leave_admin',action:string,payload:Payload,success:string,clear?:()=>void){
  if(lock.current||uncertain)return
  lock.current=true;setBusy(true);setError('');setNotice('')
  try{
   const {data:result,error:failure}=await browserDb().rpc(rpc,{p_action:action,p_payload:payload})
   if(failure){
    const expected=['22023','40001','42501','23514','23503','22P02','22007','22008'].includes(failure.code)
    if(!expected)setUncertain(true)
    setError(expected?failure.code==='23503'?'Configure the leave year and employee account first.':failure.code==='23514'?'Check that numbers are whole, non-negative days and opening usage does not exceed entitlement.':failure.code.startsWith('22')&&failure.code!=='22023'?'Check the dates and numeric fields.':failure.message:'Could not confirm the result. Refresh before trying again.')
    return
   }
   if(!result){setUncertain(true);setError('Could not confirm the result. Refresh before trying again.');return}
   clear?.();setNotice(success)
   try{await refresh()}catch(e){setUncertain(true);setError(e instanceof Error?e.message:'Refresh failed.')}
  }catch{setUncertain(true);setError('Connection interrupted. Refresh to check whether your action was saved before trying again.')}
  finally{lock.current=false;setBusy(false)}
 }
 async function sendPilotEmail(id:string){
  if(lock.current||uncertain)return
  lock.current=true;setBusy(true);setError('');setNotice('')
  try{
   const response=await fetch('/api/admin/leave-pilot-email',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id}),
   })
   const result=await response.json()
   if(!response.ok)setError(result.error??'Could not send the pilot notification.')
   else setNotice('Resend accepted the pilot notification.')
   await refresh()
  }catch{
   setUncertain(true)
   setError('Could not confirm the latest email status. Refresh before retrying.')
  }finally{lock.current=false;setBusy(false)}
 }
 async function reload(selectedYear=data.year){
  if(lock.current)return
  lock.current=true;setBusy(true);setError('')
  try{const loaded=await refresh(selectedYear);if(selectedYear!==data.year){setForm({leave_type:'annual',start_date:'',end_date:'',reason:'',hours:undefined});setOpening(old=>({...old,taken:''}));setPolicy({annual:String(loaded.policy?.annual??10),sick:String(loaded.policy?.sick??10),casual:String(loaded.policy?.casual??10),weekdays_only:loaded.policy?.weekdays_only??true,holidays:loaded.policy?.holidays.map(displayShortDate).join('\n')??''})}}
  catch(e){setError(e instanceof Error?e.message:'Could not reload.')}
  finally{lock.current=false;setBusy(false)}
 }
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault()
  if(!canSubmit)return
  if(!form.reason.trim()){setError('Enter a reason for your leave request.');return}
  if(estimate===null||estimate===0){setError('Choose dates with at least one chargeable day, within the selected year.');return}
  if(needsBalance&&(!balance||(availableDays(balance)??0)<estimate)){setError('This request exceeds your available balance.');return}
  const element=e.currentTarget
  const fields=new FormData(element)
  const application={...Object.fromEntries(fields),declaration:fields.has('declaration'),medical_certificate:fields.has('medical_certificate')}
  await run('leave_action','submit',{...form,end_date:lastDate,application},'Leave request submitted to your line manager.',()=>{
   element.reset()
   setForm(old=>({...old,start_date:'',end_date:'',reason:'',hours:undefined}))
  })
 }
 function openingEmployee(value:string,type:LeaveType=opening.leave_type){const row=data.openings?.find(o=>o.employee_id===value&&o.leave_type===type);setOpening({employee_id:value,leave_type:type,entitlement:String(row?.entitlement??data.policy?.[type]??10),taken:row?String(row.taken):''})}
 function requests(rows:LeaveRequest[],approvals=false){return rows.length===0?<p>No {approvals?'team requests':'leave applications'} for {fyLabel(data.year)}.</p>:<div className="request-list">{rows.map(r=><article className={'request-card'+(focusedRequest===r.id?' request-focus':'')} key={r.id} id={'request-'+r.id}>
  <div className="ess-section-heading"><h3>{approvals?r.employee_name:titleCase(r.leave_type)+' leave'}{approvals?<span className="muted"> · {r.employee_no}</span>:null}</h3><span className={'status '+r.status}>{titleCase(r.status)}</span></div>
  <p>{displayShortDate(r.start_date)} to {displayShortDate(r.end_date)} · <strong>{r.days} day{r.days===1?'':'s'}</strong>{approvals?' · '+titleCase(r.leave_type):''}</p>
  <p className="request-text">{r.reason}</p>{r.manager_name?<p className="muted">Line manager: {r.manager_name}</p>:null}
  {r.decision_note?<p className="request-text"><strong>Decision note:</strong> {r.decision_note}</p>:null}
  {r.status==='pending'&&approvals&&(r.can_decide??r.manager_employee_id===data.employee_id)?<div>
   <label>Decision note (required to reject)<textarea maxLength={2000} rows={2} value={notes[r.id]??''} disabled={busy} onChange={e=>setNotes(old=>({...old,[r.id]:e.target.value}))}/></label>
   <div className="ess-form-actions"><button disabled={busy||uncertain} onClick={()=>void run('leave_action','decide',{id:r.id,decision:'approved',note:notes[r.id]??''},'Approval recorded.')}>Approve</button><button className="secondary" disabled={busy||uncertain||!notes[r.id]?.trim()} onClick={()=>void run('leave_action','decide',{id:r.id,decision:'rejected',note:notes[r.id]},'Leave request rejected.')}>Reject</button></div>
  </div>:r.status==='pending'&&!approvals?<button className="secondary" disabled={busy||uncertain} onClick={()=>{if(window.confirm('Withdraw this pending leave request?'))void run('leave_action','cancel',{id:r.id},'Leave request withdrawn. Reserved days released.')}}>Withdraw request</button>:null}
 </article>)}</div>}
 const content=<div className={embedded?undefined:"work-content"}>

   {(!embedded||section==='leave')&&<div className="workspace-toolbar"><form onSubmit={e=>{e.preventDefault();const selected=Number(year);if(selected<2020||selected>2100)return;if((form.reason||form.start_date||form.end_date)&&!window.confirm('Change year and clear your unsaved leave application?'))return;void reload(selected)}}><label>Fiscal year starting (July)<input type="number" min={2020} max={2100} required value={year} disabled={busy} onChange={e=>setYear(e.target.value)}/></label><button className="secondary" disabled={busy}>Load year</button></form><button className="secondary" disabled={busy} onClick={()=>void reload()}>{busy?'Please wait...':'Refresh'}</button></div>}
   {error?<p role="alert" className="error">{error}</p>:null}{notice?<p role="status" className="notice">{notice}</p>:null}
   <section hidden={section!=='leave'}><div className="ess-section-heading">
     <h2>My leave · {fyLabel(data.year)}</h2>
    </div>
    {!data.employee_id?<p className="panel">This HR account is not linked to an employee record. Use HR setup to configure leave and Leave overview to monitor requests.</p>:<>
    <p className="muted">You can enter leave you already took. To enter dates in an earlier fiscal year, load the year in which the leave began.</p>
    {!data.policy?<p className="error">HR has not configured this leave year yet.</p>:<p className="muted">{pilot?'July–June':'January–December'} · {data.policy.weekdays_only?'Monday–Friday; weekends excluded':'Calendar days'} · {data.policy.holidays.length} company holiday(s) excluded.</p>}
    {holidays.length>0&&<details className="panel"><summary>Company holidays · {fyLabel(data.year)}</summary><ul>{holidays.map(h=><li key={h.date}>{displayShortDate(h.date)} · {h.name}{h.needs_review?' (expected; date to be confirmed)':''}</li>)}</ul></details>}
    <div className="leave-balances">{data.balances.map(b=><article className="panel" key={b.type}><h3>{titleCase(b.type)}</h3><strong className="balance-number">{b.entitlement??'—'} <small>days entitled</small></strong><dl><div><dt>Taken to date</dt><dd>{b.verified?b.taken:'HR verification needed'}</dd></div><div><dt>Approved, upcoming</dt><dd>{b.approved-Math.max(0,b.taken-(b.opening_taken??0))}</dd></div><div><dt>Pending approval</dt><dd>{b.pending}</dd></div><div><dt>Available leave</dt><dd>{availableDays(b)??'HR verification needed'}</dd></div></dl>{!b.verified?<p className="muted">No historical usage has been assumed. Ask HR to confirm your opening balance.</p>:null}</article>)}</div>
    {data.pilot_applicant!==false&&<div className="panel"><h3>Leave Application Form</h3><p className="muted">Form BND-HR-LVF-001 · Issued under the Head Office Leave Policy (BND-HR-LVP-001) · Rev 0</p><p>Line manager: {data.manager?data.manager.name+(data.manager.designation?' · '+data.manager.designation:''):'Not yet verified by HR'}</p>{!data.manager?.ready?<p className="muted">Set the Line Manager Name in the employee profile and make sure that manager has an active sign-in account.</p>:null}
     <form onSubmit={submit}>
      <h4>A &nbsp; EMPLOYEE DETAILS</h4>
      <div className="family-fields">
       {employee&&<>
        <label>Employee Name<input readOnly value={employee.full_name}/></label>
        <label>Employee ID<input readOnly value={employee.employee_no}/></label>
        <label>Department<input readOnly value={employee.department??''}/></label>
        <label>Designation<input readOnly value={employee.designation??''}/></label>
       </>}
       <label>On Probation?<select name="on_probation" defaultValue="" required disabled={busy}><option value="" disabled>Choose an item</option><option value="yes">Yes</option><option value="no">No</option><option value="unsure">Unsure</option></select></label>
      </div>
      <h4>B &nbsp; LEAVE DETAILS</h4>
      <div className="family-fields"><label>Leave type<select value={form.leave_type} disabled={busy} onChange={e=>setForm(old=>({...old,leave_type:e.target.value as ApplicationLeaveType,hours:undefined}))}>{(pilot?[...leaveTypes,'maternity','unpaid']:leaveTypes).map(t=><option key={t} value={t}>{titleCase(t)}</option>)}</select></label><label>Available to request<input readOnly value={balance?availableDays(balance)??'Awaiting HR verification':needsBalance?'Not configured':'No paid balance applies'}/></label>{pilot&&form.leave_type==='casual'&&<label>Duration<select value={form.hours??''} disabled={busy} onChange={e=>setForm(old=>({...old,hours:e.target.value==='2'?2:e.target.value==='4'?4:undefined}))}><option value="">Full day</option><option value="2">Short leave · 2 hours (0.25 day)</option><option value="4">Half day · 4 hours (0.5 day)</option></select></label>}<label>From<DateInput required referenceYear={data.year} min={minDate} max={maxDate} value={form.start_date} disabled={busy} onChange={value=>setForm(old=>({...old,start_date:value}))}/></label>{!partial&&<label>To<DateInput required referenceYear={data.year} min={/^\d{4}-\d{2}-\d{2}$/.test(form.start_date)?form.start_date:minDate} max={maxDate} value={form.end_date} disabled={busy} onChange={value=>setForm(old=>({...old,end_date:value}))}/></label>}{partial&&<label>Short Leave Time<input name="short_leave_time" required maxLength={80} placeholder="e.g. 10:00 – 12:00" disabled={busy}/></label>}
      {form.leave_type==='maternity'&&<label>Date of Childbirth<input type="date" name="childbirth" required disabled={busy}/></label>}
      <label>Contact During Leave<input name="contact" type="tel" required maxLength={80} disabled={busy} placeholder="Phone number"/></label>
      <label>Work Handed Over To<input name="handover" maxLength={150} disabled={busy} placeholder="Name of colleague"/></label>
      </div><label>Reason for Leave<textarea required maxLength={2000} rows={3} value={form.reason} disabled={busy} onChange={e=>setForm(old=>({...old,reason:e.target.value}))}/></label><p aria-live="polite">{estimate===null
      ? form.leave_type==='maternity'?'Select 84 consecutive calendar days.':'Choose dates to preview the leave charge.'
      : estimate===0?'No working days fall within these dates.':(form.leave_type==='maternity'||form.leave_type==='unpaid'?'No. of Calendar Days: ':'No. of Working Days: ')+estimate}</p>
     {needsBalance&&balance&&!balance.verified&&<p className="muted">HR must confirm your opening balance before you can submit this leave type.</p>}<fieldset disabled={busy}>
      <legend>Documents Attached</legend>
      <label><input type="checkbox" name="medical_certificate"/> Medical certificate</label>
      <label>Other: specify<input name="other_document" maxLength={200}/></label>
      <p className="muted">This records which documents you have. Share the documents separately with HR if requested.</p>
     </fieldset>
     <fieldset disabled={busy}>
      <legend>EMPLOYEE DECLARATION</legend>
      <label><input type="checkbox" name="declaration" required/> I confirm that the information above is correct and that I have read the Leave Policy. I understand that false information or misuse of leave may lead to disciplinary action.</label>
      <label>Employee Signature<input name="signature" required maxLength={150} placeholder="Type name or sign"/></label>
      <p className="muted">The application and signature date are recorded when you submit.</p>
     </fieldset>
     <button disabled={!canSubmit}>Submit leave application</button></form>
    </div>}<h3>My Leave Requests</h3>{requests(data.requests)}</>}
   </section>
   {!embedded&&<><section hidden={section!=='inbox'}><h2>Inbox</h2><p>Leave requests, decisions and assigned tasks. {unread} unread.</p>{data.inbox.length===0?<div className="panel"><p>Your inbox is empty.</p></div>:<div className="request-list">{data.inbox.map(item=><article className={'request-card'+(!item.read_at?' inbox-unread':'')} key={item.id}><div className="ess-section-heading"><h3>{item.title}</h3><span className="status">{item.completed_at?'Completed':!item.read_at?'Unread':'Read'}</span></div><p className="request-text">{item.body}</p><p className="muted">{item.created_at.slice(0,10)} · {item.kind.replaceAll('_',' ')}</p><div className="ess-form-actions">{item.request_id?<a className="recovery-action" href={'/workspace?section='+(item.kind==='leave_request'?'approvals':'leave')+'&year='+(item.request_year??data.year)+'&request='+item.request_id}>Open request</a>:null}{!item.read_at?<button className="secondary" disabled={busy||uncertain} onClick={()=>void run('leave_action','read',{id:item.id},'Marked as read.')}>Mark as read</button>:null}{item.kind==='task'&&!item.completed_at?<button disabled={busy||uncertain} onClick={()=>void run('leave_action','complete',{id:item.id},'Task marked complete.')}>Mark task complete</button>:null}</div></article>)}</div>}<p className="muted">Showing the latest 200 inbox items.</p></section>
   <section hidden={section!=='approvals'}><h2>{data.is_hr?'Leave overview':'Manager approvals'}</h2><p>{data.is_hr?'HR can monitor all requests. Decisions are made by the line manager and the Head of Department.':'Only requests assigned to you through a verified reporting relationship appear here.'}</p>{requests(data.approvals,true)}{(data.team?.length??0)>0?<div className="panel"><h3>Assign a team task</h3><form onSubmit={e=>{e.preventDefault();void run('leave_action','task',managerTask,'Task added to your team member’s Inbox.',()=>setManagerTask(old=>({...old,title:'',body:''})))}}><label>Team member<select required value={managerTask.recipient_user_id} disabled={busy} onChange={e=>setManagerTask(old=>({...old,recipient_user_id:e.target.value}))}><option value="">Select direct report</option>{data.team?.filter(e=>e.account_active&&e.user_id).map(e=><option key={e.id} value={e.user_id!}>{e.employee_no} · {e.name}</option>)}</select></label><label>Title<input required maxLength={200} disabled={busy} value={managerTask.title} onChange={e=>setManagerTask(old=>({...old,title:e.target.value}))}/></label><label>Task details<textarea maxLength={2000} rows={3} disabled={busy} value={managerTask.body} onChange={e=>setManagerTask(old=>({...old,body:e.target.value}))}/></label><button disabled={busy||uncertain}>Assign task</button></form></div>:null}</section>
   {data.is_hr?<section hidden={section!=='settings'}><h2>HR setup</h2>
    <div className="panel"><h3>Leave policy · {fyLabel(data.year)}</h3><p>Default entitlements for the fiscal year, 1 July to 30 June. These defaults and the day-counting rule are locked once the year has requests; individual balances can still be corrected below. Public holidays are managed separately in the next panel.</p><form onSubmit={e=>{e.preventDefault();void run('leave_admin','policy',{year:data.year,annual:Number(policy.annual),sick:Number(policy.sick),casual:Number(policy.casual),weekdays_only:policy.weekdays_only},'Leave policy saved.')}}><div className="family-fields">{leaveTypes.map(t=><label key={t}>{titleCase(t)} entitlement<input type="number" required min={0} step={1} value={policy[t]} disabled={busy} onChange={e=>setPolicy(old=>({...old,[t]:e.target.value}))}/></label>)}<label>Count days<select value={policy.weekdays_only?'weekdays':'calendar'} disabled={busy} onChange={e=>setPolicy(old=>({...old,weekdays_only:e.target.value==='weekdays'}))}><option value="weekdays">Monday–Friday only</option><option value="calendar">All calendar days</option></select></label></div><button disabled={busy||uncertain}>Save policy</button></form></div>
    <div className="panel"><h3>Public holidays · {fyLabel(data.year)}</h3><p>Holidays are excluded from working-day leave. Add or delete dates at any time. Leave from today onwards is re-counted automatically and affected employees are told in their Inbox. If nothing is saved for a fiscal year, the previous year’s dates carry forward on the same day and month and are marked for review.</p>
     {holidays.length===0?<p>No holidays recorded for this fiscal year.</p>:<div className="tablewrap"><table><thead><tr><th scope="col">Date</th><th scope="col">Holiday</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody>{holidays.map(h=><tr key={h.date}><td>{displayShortDate(h.date)}</td><td>{h.name}</td><td>{h.carried_forward?'Carried forward · review':h.needs_review?'Expected · review':'Confirmed'}</td><td className="actions">{h.needs_review&&<button type="button" className="secondary" disabled={busy||uncertain} onClick={()=>void run('leave_admin','holiday_confirm',{year:data.year,date:h.date},'Holiday confirmed.')}>Confirm</button>} <button type="button" className="secondary" disabled={busy||uncertain} onClick={()=>{if(window.confirm('Delete '+h.name+' on '+displayShortDate(h.date)+'? Leave covering this date will be re-counted.'))void run('leave_admin','holiday_delete',{year:data.year,date:h.date},'Holiday deleted. Affected leave re-counted.')}}>Delete</button></td></tr>)}</tbody></table></div>}
     <form onSubmit={e=>{e.preventDefault();void run('leave_admin','holiday_add',{year:data.year,name:holiday.name,from:holiday.from,to:holiday.to||holiday.from,needs_review:holiday.expected},'Holiday saved. Affected leave re-counted.',()=>setHoliday({name:'',from:'',to:'',expected:false}))}}><div className="family-fields"><label>Holiday name<input required maxLength={80} value={holiday.name} disabled={busy} onChange={e=>setHoliday(old=>({...old,name:e.target.value}))}/></label><label>Date<DateInput required referenceYear={data.year} min={minDate} max={maxDate} value={holiday.from} disabled={busy} onChange={value=>setHoliday(old=>({...old,from:value}))}/></label><label>Last day (only for a holiday of several days)<DateInput referenceYear={data.year} min={/^\d{4}-\d{2}-\d{2}$/.test(holiday.from)?holiday.from:minDate} max={maxDate} value={holiday.to} disabled={busy} onChange={value=>setHoliday(old=>({...old,to:value}))}/></label></div><label><input type="checkbox" checked={holiday.expected} disabled={busy} onChange={e=>setHoliday(old=>({...old,expected:e.target.checked}))}/> Expected date, subject to moon sighting</label><button disabled={busy||uncertain}>Add holiday</button></form></div>
    <div className="panel"><h3>Verify opening balance</h3><p>Enter leave already taken before using this app. Do not include approved requests already listed in the app. Confirm each leave type for each employee; no employee history is created automatically.</p><form onSubmit={e=>{e.preventDefault();void run('leave_admin','opening',{year:data.year,...opening,entitlement:Number(opening.entitlement),taken:Number(opening.taken)},'Opening balance verified.')}}><label>Employee<select required value={opening.employee_id} disabled={busy} onChange={e=>selectOpeningEmployee(e.target.value)}><option value="">Select employee</option>{employees.map(e=><option key={e.id} value={e.id}>{e.employee_no} · {e.name}</option>)}</select></label><div className="family-fields"><label>Leave type<select value={opening.leave_type} disabled={busy} onChange={e=>openingEmployee(opening.employee_id,e.target.value as LeaveType)}>{leaveTypes.map(t=><option key={t} value={t}>{titleCase(t)}</option>)}</select></label><label>Total entitlement<input type="number" min={0} step={1} required disabled={busy} value={opening.entitlement} onChange={e=>setOpening(old=>({...old,entitlement:e.target.value}))}/></label><label>Opening days already taken<input type="number" min={0} step={1} required disabled={busy} value={opening.taken} placeholder="Enter verified usage, including 0" onChange={e=>setOpening(old=>({...old,taken:e.target.value}))}/></label></div>{currentOpening?<p className="muted">Last confirmed: {currentOpening.confirmed_at.slice(0,10)}. Current opening usage: {currentOpening.taken}.</p>:null}<button disabled={busy||uncertain||!data.policy}>Confirm opening balance</button></form></div>
    <div className="panel"><h3>Reporting manager</h3>
     <p>New leave requests use the Line Manager Name in the employee profile. To change it, edit Core Information in the employee directory.</p>
     <label>Employee<select value={assignment.employee_id} onChange={e=>setAssignment({employee_id:e.target.value})}><option value="">Select employee</option>{employees.map(e=><option key={e.id} value={e.id}>{e.employee_no} · {e.name}</option>)}</select></label>
     {assignment.employee_id&&<p>Current: {currentManager?employees.find(e=>e.id===currentManager.manager_employee_id)?.name??'Recorded manager':'No manager assigned'}</p>}
    </div>
    <div className="panel"><h3>Assign an Inbox task</h3><form onSubmit={e=>{e.preventDefault();void run('leave_admin','task',task,'Task added to the employee’s Inbox. Email is waiting for setup.',()=>setTask(old=>({...old,title:'',body:''})))}}><label>Employee<select required value={task.recipient_user_id} disabled={busy} onChange={e=>setTask(old=>({...old,recipient_user_id:e.target.value}))}><option value="">Select active employee</option>{employees.filter(e=>e.account_active&&e.user_id).map(e=><option key={e.id} value={e.user_id!}>{e.employee_no} · {e.name}</option>)}</select></label><label>Title<input required maxLength={200} disabled={busy} value={task.title} onChange={e=>setTask(old=>({...old,title:e.target.value}))}/></label><label>Task details<textarea maxLength={2000} rows={3} disabled={busy} value={task.body} onChange={e=>setTask(old=>({...old,body:e.target.value}))}/></label><button disabled={busy||uncertain}>Assign task</button></form></div>
    <div className="panel"><h3>Email notifications</h3><p>HR can send pilot notifications to the agreed test inbox. In-app approvals work independently of email.</p>
     <ul>{data.email_queue?.filter(item=>item.pilot).map(item=><li key={item.id}>
      {item.subject} · {item.status.replaceAll('_',' ')}
      {['waiting_for_setup','failed','sending'].includes(item.status)&&<button type="button" className="secondary" disabled={busy||uncertain} onClick={()=>void sendPilotEmail(item.id)}>{item.status==='waiting_for_setup'?'Send pilot email':'Retry pilot email'}</button>}
     </li>)}</ul></div>
   </section>:null}</>}
  </div>
 if(embedded)return content
 if(!data.is_hr)return <main className="mobile-shell ess-shell">
  <p><a href="/portal">Back to my employee portal</a></p>
  {content}
 </main>
 return <main className="work-shell">
  <header className="work-header"><div><div className="eyebrow">BANDANA / SEIDOHR</div><h1>Leave & Inbox</h1><p>Requests, decisions and tasks in one place.</p></div><a href={data.is_hr?'/employees':'/portal'}>Back to {data.is_hr?'HR directory':'my profile'}</a></header>
  <aside className="work-sidebar"><nav aria-label="Employee workspace"><a href={data.is_hr?'/employees':'/portal'}>{data.is_hr?'Employee directory':'My profile'}</a>{(['leave','inbox','approvals',...(data.is_hr?['settings']:[])] as Section[]).map(key=><button key={key} type="button" aria-current={section===key?'page':undefined} className={section===key?'selected':''} onClick={()=>setSection(key)}>{key==='leave'?'Leave application':key==='inbox'?'Inbox'+(unread?' ('+unread+')':''):key==='approvals'?(data.is_hr?'Leave overview':'Manager approvals')+(pending?' ('+pending+')':''):'HR setup'}</button>)}</nav>{data.is_hr&&<p><a href="/leave-report">Leave summary report</a></p>}<p className="muted">Requests and decisions appear in your Inbox.</p></aside>
  {content}
 </main>
}
