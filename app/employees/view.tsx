'use client'
import DateInput from '../date-input'
import FamilyEditor from '../portal/family-editor'
import DesignationSelect from '../designation-select'
import {confirmationDate,paymentMethods,employmentChoice,isDropdown,qualificationLevels,selectChoices,designationTitles,departmentNames} from '../../lib/profile-inputs'
import type {ProfileOptions} from '../../lib/profile-inputs'
import {employmentFields} from '../../lib/ess-profile'
import {displayShortDate,isIsoDate,isProfileDateField} from '../../lib/date-input'
import {useTableSort} from '../sortable-table'
import {useEffect,useMemo,useState} from 'react'
import {browserDb} from '../../lib/supabase'
import MoneyInput from '../money-input'
import {formatMoneyField,isMoneyField} from '../../lib/money'
import {sections,fieldKey,payrollFields,payrollProfileFields,payrollPeriodLabel} from './field-config'
type Employee={employee_details?:{manager_no:string|null}|null;id:string;employee_no:string;full_name:string;designation:string|null;department:string|null;reports_to_text:string|null;location:string|null;record_status:string|null;source_note:string|null;leaving_date:string|null;employment_state:'active'|'inactive'}
type Detail={payroll_sep_2026:Record<string,string>;profile:Record<string,string>}
const baseFields:[Exclude<keyof Employee,'employee_details'>,string][]=[['full_name','Full name'],['department','Department'],['designation','Designation'],['reports_to_text','Reports To'],['location','Location'],['record_status','Source record status'],['source_note','Source / verification note']]
type Credentials={employee_no:string;full_name:string;username:string;initial_password:string}
export default function Directory({email}:{email:string}) {
 const [credentials,setCredentials]=useState<Credentials|null>(null),[accounts,setAccounts]=useState<Record<string,string>>({})
 const [rows,setRows]=useState<Employee[]>([]),[q,setQ]=useState(''),[filter,setFilter]=useState('all'),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [selected,setSelected]=useState<Employee|null>(null),[adding,setAdding]=useState(false),[tab,setTab]=useState('core'),[values,setValues]=useState<Record<string,string>>({}),[detail,setDetail]=useState<Detail>({profile:{},payroll_sep_2026:{}}),[busy,setBusy]=useState(false)
 const [originalProfile,setOriginalProfile]=useState<Detail['profile']>({})
 const [detailsReady,setDetailsReady]=useState(false)
 const [profileOptions,setProfileOptions]=useState<ProfileOptions|null>(null)
 const [designations,setDesignations]=useState<string[]|null>(null)
 const [showDesignationEditor,setShowDesignationEditor]=useState(false)
 const [newDesignation,setNewDesignation]=useState(''),[designationFeedback,setDesignationFeedback]=useState(''),[designationBusy,setDesignationBusy]=useState(false)
 const [action,setAction]=useState<{type:'deactivate'|'reactivate'|'delete';row:Employee}|null>(null),[reason,setReason]=useState(''),[confirm,setConfirm]=useState(''),[leavingDate,setLeavingDate]=useState('')
 async function refresh(){setLoading(true);const {data,error}=await browserDb().from('employees').select('id,employee_no,full_name,designation,department,reports_to_text,location,record_status,source_note,employment_state,leaving_date,employee_details(manager_no:profile->>line_manager_employee_no)').order('employee_no',{ascending:true}).limit(2000);setRows((data??[]) as unknown as Employee[]);setError(error?.message??'');setLoading(false)}
 useEffect(()=>{void refresh();void loadDesignations()},[])
 async function refreshAccounts(){const {data}=await browserDb().from('employee_accounts').select('employee_id,username');setAccounts(Object.fromEntries((data??[]).map(a=>[a.employee_id,a.username])))}
 useEffect(()=>{void refreshAccounts()},[rows])
 async function createLogin(employeeId:string){setBusy(true);setError('');try{const response=await fetch('/api/admin/employees/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({employee_id:employeeId})});const result=await response.json();if(!response.ok)throw Error(result.error??'Login creation failed');setCredentials(result);await refreshAccounts();return true}catch(e){setError(e instanceof Error?e.message:'Login creation failed');return false}finally{setBusy(false)}}
 const employeesByNumber=useMemo(()=>new Map(rows.map(row=>[row.employee_no,row])),[rows])
 const reportingTitles=useMemo(()=>new Map([...(designations??[]),'BOD','COO'].map(title=>[title.toLowerCase(),title])),[designations])
 function reportingDesignation(row:Employee){
  return employeesByNumber.get(row.employee_details?.manager_no??'')?.designation
   ??reportingTitles.get(row.reports_to_text?.trim().toLowerCase()??'')
   ??''
 }
 const managerChoices=rows.filter(row=>row.id!==selected?.id&&row.designation?.trim().toLowerCase()===values.reports_to_text?.toLowerCase()&&row.employment_state==='active')
 const savedManagerNumber=detail.profile.line_manager_employee_no??''
 const showRecordedManager=savedManagerNumber&&!managerChoices.some(row=>row.employee_no===savedManagerNumber)
 const directorySort=useTableSort('employee_no')
 const matches=useMemo(()=>rows.filter(x=>(filter==='all'||x.employment_state===filter)&&[x.employee_no,x.full_name,x.designation,x.department,x.location].some(v=>(v??'').toLowerCase().includes(q.toLowerCase()))),[rows,q,filter])
 const activeRows=rows.filter(row=>row.employment_state==='active')
 async function loadDesignations(){
  const {data,error}=await browserDb().rpc('my_profile_options')
  if(error||!data){setError('Could not load the profile dropdown lists.');return}
  const options=data as ProfileOptions
  setProfileOptions(options)
  setDesignations(options.reports_to_text)
 }
 async function addDesignation(){
  const title=newDesignation.trim()
  if(!title||designationBusy)return
  setDesignationBusy(true);setDesignationFeedback('')
  try{
   const departmentId=profileOptions?.department_options?.find(item=>item.name===values.department)?.id
   if(!departmentId){setDesignationFeedback('Choose a department before adding a designation.');return}
   const {error}=await browserDb().rpc('add_department_designation',{p_department_id:departmentId,p_title:title})
   if(error){setDesignationFeedback(error.code==='23505'?'That designation is already in the list.':'Could not add this title. Check that it is a new, approved spelling.');return}
   await loadDesignations()
   setNewDesignation('');setDesignationFeedback('Added '+title+' to the shared dropdown.')
  }catch{setDesignationFeedback('Could not add the designation. Reopen this form to check the list.')}
  finally{setDesignationBusy(false)}
 }
 async function edit(row:Employee|null){setShowDesignationEditor(false);setNewDesignation('');setDesignationFeedback('');void loadDesignations();setError('');setNotice('');setSelected(row);setDetailsReady(!row);setAdding(!row);setTab('core');setValues(Object.fromEntries(baseFields.map(([k])=>[k,row?.[k]??''])));setDetail({profile:{},payroll_sep_2026:{}});setOriginalProfile({});if(row){const {data,error}=await browserDb().from('employee_details').select('profile,payroll_sep_2026').eq('employee_id',row.id).maybeSingle();if(error){setError('Could not load extended details: '+error.message)}else{setDetailsReady(true);if(data){setOriginalProfile(data.profile??{});setDetail({profile:data.profile??{},payroll_sep_2026:data.payroll_sep_2026??{}})}}}}
 function close(){setSelected(null);setAdding(false);setAction(null)}
 async function save(e:React.FormEvent){e.preventDefault();if(!detailsReady)return;setBusy(true);setError('');const db=browserDb();const payload=Object.fromEntries(baseFields.map(([k])=>[k,values[k]?.trim()||null]));let resultId=selected?.id
 if(selected){if(values.leaving_date!==undefined)payload.leaving_date=values.leaving_date||null;const r=await db.from('employees').update(payload).eq('id',selected.id);if(r.error){setBusy(false);setError(r.error.message);return}}
 else {const r=await db.rpc('create_employee',{p_full_name:values.full_name?.trim(),p_designation:values.designation?.trim()||null,p_department:values.department?.trim()||null,p_reports_to_text:values.reports_to_text?.trim()||null,p_location:values.location?.trim()||null,p_record_status:values.record_status?.trim()||null,p_source_note:values.source_note?.trim()||null});if(r.error){setBusy(false);setError(r.error.message);return}const id=await db.from('employees').select('id').eq('employee_no',r.data).single();if(id.error){setBusy(false);setError('Employee created, but could not retrieve details: '+id.error.message);return}resultId=id.data.id}
 const profile=detail.profile.date_of_joining!==originalProfile.date_of_joining||detail.profile.probation!==originalProfile.probation
  ?{...detail.profile,offer_date:calculatedConfirmationDate}:detail.profile
 const d=await db.from('employee_details').upsert({employee_id:resultId,profile,payroll_sep_2026:detail.payroll_sep_2026},{onConflict:'employee_id'});setBusy(false);if(d.error){setError('Core record saved, but extended details failed: '+d.error.message);return}const isNew=adding;close();setNotice('Employee saved');await refresh();if(isNew&&resultId){const ok=await createLogin(resultId);setNotice(ok?'Employee saved and login created.':'Employee saved. Login pending: see the reason above.')}}
 async function execute(){if(!action)return;setBusy(true);setError('');const db=browserDb();const r=action.type==='delete'?await db.rpc('delete_employee_error',{p_employee_id:action.row.id,p_confirmation:confirm,p_reason:reason}):await db.rpc('set_employee_state_with_date',{p_employee_id:action.row.id,p_new_state:action.type==='deactivate'?'inactive':'active',p_reason:reason,p_leaving_date:action.type==='deactivate'?leavingDate:null});setBusy(false);if(r.error){setError(r.error.message);return}setNotice(action.type==='delete'?'Employee deleted with audit record':'Status updated');close();await refresh()}
 async function logout(){await browserDb().auth.signOut();window.location.href='/login'}
 const calculatedConfirmationDate=confirmationDate(detail.profile.date_of_joining??'',detail.profile.probation??'')
 const editField=(key:string,value:string,group:keyof Detail)=>setDetail(old=>({...old,[group]:{...old[group],[key]:value}}))
 return <main className="shell"><header><div className="bandana-heading"><img src="/bandana-logo.png" alt="" width={44} height={44}/><div><div className="eyebrow">SEIDOHR / BANDANA · RELEASE 1</div><h1>Employee Directory</h1><p>Manage employee records and employment status.</p></div></div><div className="head-actions"><a href="/portal">My employee portal</a><a href="/reports">Reports</a><a href="/organisation">Departments & Designations</a><a href="/activity">Activity</a><a href="/credentials">Credentials</a><a href="/emails">Email employees</a><a href="/bulk-upload">Bulk upload</a><a href="/workspace?section=settings">Leave & Inbox</a><span className="account">{email}</span><button className="secondary" onClick={logout}>Sign out</button></div></header>
 <section className="metrics" aria-label="Active employee counters"><article><span>Active employees</span><strong>{activeRows.length}</strong></article><article><span>Missing department (active)</span><strong>{activeRows.filter(x=>!x.department).length}</strong></article><article><span>Missing reporting line (active)</span><strong>{activeRows.filter(x=>!reportingDesignation(x)).length}</strong></article></section>
 <section className="panel"><div className="bar"><input aria-label="Search employees" placeholder="Search by name, ID, designation, department…" value={q} onChange={e=>setQ(e.target.value)}/><select aria-label="Employment status" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select><button onClick={()=>void edit(null)}>+ Add employee</button></div>{error&&<p className="error" role="alert">{error}</p>}{notice&&<p role="status" className="notice">{notice}</p>}{loading?<p>Loading employees…</p>:<><p className="muted">Showing {matches.length} of {rows.length} records</p><div className="tablewrap"><table><thead><tr>{directorySort.heading('employee_no', 'Employee ID')}{directorySort.heading('full_name', 'Name')}{directorySort.heading('designation', 'Designation')}{directorySort.heading('department', 'Department')}{directorySort.heading('reports_to_designation', 'Reports To (Designation)')}{directorySort.heading('employment_state', 'Status')}{directorySort.heading('leaving_date', 'Leaving date')}<th>Actions</th></tr></thead><tbody>{directorySort.sortRows(matches,(row,column)=>column==='reports_to_designation'?reportingDesignation(row):row[column as Exclude<keyof Employee,'employee_details'>]).map(x=><tr key={x.id}><td className="mono">{x.employee_no}</td><td><strong>{x.full_name}</strong></td><td>{x.designation||'—'}</td><td>{x.department||'—'}</td><td>{reportingDesignation(x)||'—'}</td><td><span className={'status '+x.employment_state}>{x.employment_state}</span></td><td>{displayShortDate(x.leaving_date)||"—"}</td><td className="actions"><button className="link inactive-disabled" disabled={x.employment_state==='inactive'} title={x.employment_state==='inactive'?'Reactivate employee before editing':undefined} onClick={()=>void edit(x)}>Edit</button>{accounts[x.id]?<span className="muted">Login ready</span>:<button className="link inactive-disabled" disabled={busy||x.employment_state==='inactive'} title={x.employment_state==='inactive'?'Reactivate employee before creating a login':undefined} onClick={()=>void createLogin(x.id)}>Create login</button>}<button className="link" onClick={()=>{setAction({type:x.employment_state==='inactive'?'reactivate':'deactivate',row:x});setReason('');setConfirm('');setLeavingDate('')}}>{x.employment_state==='inactive'?'Reactivate':'Deactivate'}</button><button className="link danger" onClick={()=>{setAction({type:'delete',row:x});setReason('');setConfirm('');setLeavingDate('')}}>Delete</button></td></tr>)}</tbody></table></div></>}</section>
 {(selected||adding)&&<div className="overlay"><div className="dialog wide" role="dialog" aria-modal="true" aria-label={selected?'Edit employee':'Add employee'}><div className="bar"><h2>{selected?'Employee Profile':'New employee'}</h2><button className="secondary" type="button" onClick={close}>Close</button></div>{selected?<p className="mono">{selected.employee_no} · {selected.employment_state}</p>:<p className="muted">A new employee number is assigned on save.</p>}
 <div className="bar"><button type="button" className="secondary" aria-expanded={showDesignationEditor} onClick={()=>setShowDesignationEditor(open=>!open)}>{showDesignationEditor?'Close designation editor':'Add new designation'}</button></div>
 {showDesignationEditor&&<div className="panel">
  <label>New designation<input value={newDesignation} maxLength={120} disabled={designationBusy} onChange={event=>setNewDesignation(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void addDesignation()}}}/></label>
  <button type="button" disabled={designationBusy||!newDesignation.trim()} onClick={()=>void addDesignation()}>{designationBusy?'Adding…':'Add to dropdown'}</button>
  {designationFeedback&&<p role="status">{designationFeedback}</p>}
 </div>}
 <div className="tabs">{[{key:'core',title:'Core record'},...(selected?[{key:'family',title:'Family & Dependants'}]:[]),...sections].map(s=><button key={s.key} className={tab===s.key?'tab active-tab':'tab'} type="button" onClick={()=>setTab(s.key)}>{s.title}</button>)}</div>
 {selected&&<FamilyEditor key={selected.id} employeeId={selected.id} active={tab==='family'}/>}
 {tab!=='family'&&<form onSubmit={save}>{tab==='salary'&&<>
 <h3>Salary Slip · {payrollPeriodLabel}</h3>
 <fieldset>
 <legend>Payroll Details</legend>
 {payrollFields.filter(label=>!payrollProfileFields.has(label)&&label!=='New Card #').map(label=>{
  const key=fieldKey(label)
  return <label key={key}>{label}<input readOnly value={formatMoneyField(key,detail.payroll_sep_2026[key])}/></label>
 })}
 </fieldset></>}{tab==='core'&&selected&&<label>Leaving date<DateInput value={values.leaving_date??selected.leaving_date??''} onChange={value=>setValues(v=>({...v,leaving_date:value}))}/></label>}{tab==='core'?baseFields.flatMap(([key,label])=>[<label key={key}>{label}{key==='designation'||key==='reports_to_text'?<DesignationSelect titles={key==='designation'?designationTitles(profileOptions,values.department??''):designations} value={values[key]??''} disabled={busy} onChange={value=>{setValues(v=>({...v,[key]:value}));if(key==='reports_to_text')editField('line_manager_employee_no','','profile')}}/>:isDropdown(key)?<select value={values[key]??''} disabled={busy||!profileOptions} onChange={e=>{const value=e.target.value;setValues(v=>({...v,[key]:value,...(key==='department'&&!designationTitles(profileOptions,value).includes(v.designation)?{designation:''}:{})}))}}><option value="">Select an option</option>{selectChoices(key==='department'?departmentNames(profileOptions):profileOptions?.[key]??[],values[key]??'').map(option=><option key={option} value={option}>{option}</option>)}</select>:<input required={key==='full_name'} value={values[key]??''} onChange={e=>setValues(v=>({...v,[key]:e.target.value}))}/>}</label>,key==='reports_to_text'&&<label key="line-manager">Line Manager Name<select value={savedManagerNumber} disabled={busy||!detailsReady} onChange={e=>editField('line_manager_employee_no',e.target.value,'profile')}><option value="">Select a line manager</option>{showRecordedManager&&<option value={savedManagerNumber}>{employeesByNumber.get(savedManagerNumber)?.full_name??savedManagerNumber} (Recorded)</option>}{managerChoices.map(row=><option key={row.id} value={row.employee_no}>{row.full_name} · {row.employee_no}</option>)}</select></label>]):(tab==='employment'
 ? employmentFields.map(([key,label])=>({key,label:key==='work_location_mobility'?'Work Location':label}))
 : sections.filter(s=>s.key===tab).flatMap(s=>s.key==='background'?[...s.labels,'Highest Qualification Level']:[...s.labels]).map(label=>({key:fieldKey(label),label}))
 ).map(({key,label})=>{const group=tab==='current-payroll'?'payroll_sep_2026':'profile';if(group==='payroll_sep_2026'&&payrollProfileFields.has(label)){
 const value=label==='Employee ID#'?selected?.employee_no:label==='Full Name'?values.full_name:label==='Designation'?values.designation:detail.profile.date_of_joining
 return <label key={key}>{label}<input readOnly value={isProfileDateField(key)?displayShortDate(value):value??''}/></label>
 }return <label key={key} className={key==="permanent_address"?"field-label-exact":undefined}>{key==='probation'?'Probation (Months)':key==='salary_transfer_method'?'Method of Payment':label}{key==='offer_date'?<>
  <input readOnly value={displayShortDate(calculatedConfirmationDate)} placeholder="Calculated from joining date and probation"/>
  {!calculatedConfirmationDate&&<span className="field-hint">Enter Date of Joining and Probation (months) to calculate this date.</span>}
 </>:key==='salary_transfer_method'?<select value={detail.profile[key]??''} disabled={busy||!detailsReady} onChange={event=>editField(key,event.target.value,'profile')}>
  <option value="">Select a payment method</option>
  {detail.profile[key]&&!paymentMethods.includes(detail.profile[key])&&<option value={detail.profile[key]} disabled>{detail.profile[key]} (previously recorded)</option>}
  {paymentMethods.map(method=><option key={method} value={method}>{method}</option>)}
 </select>:group==='profile'&&(key==='highest_qualification_level'||isDropdown(key))?<select value={detail.profile[key]??''} disabled={busy||(key!=='highest_qualification_level'&&!profileOptions)} onChange={e=>{const value=e.target.value;if(key==='employment_type'){setDetail(d=>({...d,profile:employmentChoice(d.profile,value)}))}else editField(key,value,'profile')}}><option value="">Select an option</option>{selectChoices(key==='highest_qualification_level'?qualificationLevels:isDropdown(key)?profileOptions?.[key]??[]:[],detail.profile[key]??'').map(option=><option key={option} value={option}>{option}</option>)}</select>:isMoneyField(key)?<MoneyInput value={detail[group][key]??''} onChange={value=>editField(key,value,group)}/>:isProfileDateField(key)?<DateInput birthDate={key==='date_of_birth'} value={detail[group][key]??''} onChange={value=>editField(key,value,group)}/>:key==='probation'?<input type="number" min={0} max={6} step={1} readOnly={detail.profile.employment_type==='Permanent'} value={detail.profile.probation??''} onChange={e=>editField(key,e.target.value,'profile')}/>:<input value={detail[group][key]??''} onChange={e=>editField(key,e.target.value,group)}/>}</label>})}<div className="savebar"><button disabled={busy||!detailsReady} type="submit">{busy?'Saving…':'Save employee'}</button><span className="muted">Blank values are retained as blank.</span></div></form>}</div></div>}
 {action&&<div className="overlay"><div className="dialog" role="dialog" aria-modal="true" aria-label={`${action.type} employee`}><h2>{action.type==='delete'?'Permanently delete record':action.type==='deactivate'?'Deactivate employee':'Reactivate employee'}</h2><p><strong>{action.row.employee_no} · {action.row.full_name}</strong></p>{action.type==='delete'&&<><p className="error">Delete only for records created in error. Employee exits should use Deactivate. Deletion cannot be undone through the app and may be blocked by linked data.</p><label>Type the exact employee ID to confirm<input value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder={action.row.employee_no}/></label></>}{action.type==='deactivate'&&<label>Leaving date (required)<DateInput required value={leavingDate} onChange={setLeavingDate}/></label>}<label>Reason (required)<textarea rows={3} value={reason} onChange={e=>setReason(e.target.value)}/></label>{error&&<p className="error" role="alert">{error}</p>}<div className="bar"><button className="secondary" onClick={close}>Cancel</button><button disabled={busy||(action.type==='deactivate'&&!isIsoDate(leavingDate))||(action.type==='delete'&&confirm!==action.row.employee_no)||reason.trim().length<(action.type==='delete'?10:5)} onClick={()=>void execute()}>{busy?'Processing…':'Confirm '+action.type}</button></div></div></div>}
 {credentials&&<div className="overlay"><div className="dialog" role="dialog" aria-modal="true" aria-label="New employee login"><h2>Login created</h2><p>{credentials.employee_no} · {credentials.full_name}</p><p>Username: <strong>{credentials.username}</strong></p><p>Initial password: <strong>{credentials.initial_password}</strong></p><p>The employee must change this password at first login. No email has been sent. Copy these details before closing.</p><button onClick={()=>setCredentials(null)}>Close</button></div></div>}
 </main>
}
