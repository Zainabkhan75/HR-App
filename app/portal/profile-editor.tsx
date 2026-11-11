'use client'
import {useEffect,useState} from 'react'
import type {FormEvent} from 'react'
import {browserDb} from '../../lib/supabase'
import {editableProfileSections,profileDraft,profilePatch} from '../../lib/ess-profile'
import DateInput from '../date-input'
import DesignationSelect from '../designation-select'
import {isIsoDate,isProfileDateField} from '../../lib/date-input'
import type {EmployeeProfile} from '../../lib/ess-profile'
import {isDropdown,employmentChoice,validProbation,selectChoices,qualificationLevels,designationTitles,departmentNames} from '../../lib/profile-inputs'
import type {ProfileOptions} from '../../lib/profile-inputs'
export default function ProfileEditor({active,initialProfile,onSaved,onDirtyChange,onBusyChange}:{active:boolean;initialProfile:EmployeeProfile;onSaved:(value:EmployeeProfile)=>void;onDirtyChange:(value:boolean)=>void;onBusyChange:(value:boolean)=>void}){
 const [base,setBase]=useState(initialProfile),[draft,setDraft]=useState(()=>profileDraft(initialProfile))
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[conflict,setConflict]=useState(false)
 const [options,setOptions]=useState<ProfileOptions|null>(null),[optionsError,setOptionsError]=useState(''),[optionsBusy,setOptionsBusy]=useState(false)
 async function loadOptions(){
  setOptionsBusy(true);setOptionsError('')
  try{
   const {data,error:optionsFailure}=await browserDb().rpc('my_profile_options')
   if(optionsFailure||!data){setOptionsError('Dropdown lists could not be loaded. Please retry.');return}
   setOptions(data as ProfileOptions)
  }catch{setOptionsError('Dropdown lists could not be loaded. Please check your connection.')}
  finally{setOptionsBusy(false)}
 }
 useEffect(()=>{void loadOptions()},[])
 const patch=profilePatch(base,draft),dirty=Object.keys(patch).length>0
 const reportingTitles=options?.line_managers?options.reports_to_text:[]
 const managers=(options?.line_managers??[]).filter(manager=>manager.designation===draft.reports_to_text)
 const selectedManager=managers.some(manager=>manager.employee_no===draft.line_manager_employee_no)
 useEffect(()=>{if(!dirty){setBase(initialProfile);setDraft(profileDraft(initialProfile))}},[initialProfile,dirty])
 useEffect(()=>{onDirtyChange(dirty)},[dirty,onDirtyChange])
 useEffect(()=>{onBusyChange(busy)},[busy,onBusyChange])
 function populate(value:EmployeeProfile){setBase(value);setDraft(profileDraft(value));onSaved(value);setConflict(false)}
 async function reload(){
  setBusy(true);setError('');setNotice('')
  try{
   const {data,error:loadError}=await browserDb().rpc('my_employee_profile')
   if(loadError||!data){setError('Could not reload your profile.');return}
   populate(data as EmployeeProfile);setNotice('Latest profile loaded; unsaved profile edits cleared.')
  }catch{setError('Could not reload. Please check your connection.')}
  finally{setBusy(false)}
 }
 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault()
  if(busy||!dirty||conflict)return
  setError('');setNotice('')
  if((patch.reports_to_text!==undefined||patch.line_manager_employee_no!==undefined)&&
     ((draft.reports_to_text&&!selectedManager)||(!draft.reports_to_text&&draft.line_manager_employee_no))){
   setError('Choose a line manager with the selected designation.');return
  }
  if(Object.entries(patch).some(([key,value])=>isProfileDateField(key)&&value&&!isIsoDate(value))){
   setError('Enter a valid date in DD/MM/YY or DD/MM/YYYY, for example 27/10/2026.');return
  }
  if(patch.probation!==undefined&&!validProbation(patch.probation)){
   setError('Probation must be a whole number from 0 to 6 months.');return
  }
  setBusy(true)
  try{
   const {data,error:saveError}=await browserDb().rpc('update_my_employee_profile',{p_patch:patch,p_expected_core_updated_at:base.core_updated_at,p_expected_profile_updated_at:base.profile_updated_at})
   if(saveError||!data){
    setConflict(saveError?.code==='40001'||!data)
    setError(saveError?.code==='40001'?'Your profile changed elsewhere. Reload before saving.':saveError?.code==='22023'?'Check the dropdown selections, dates, probation (0–6 months), name and work email.':'Could not confirm the save. Reload before trying again.')
    return
   }
   populate(data as EmployeeProfile);setNotice('Profile details saved.')
  }catch{setError('Could not confirm the save. Check your connection and reload before trying again.');setConflict(true)}
  finally{setBusy(false)}
 }
 return <section className="panel" hidden={!active}>
  <h2>My profile</h2><p>You can update the details below directly.</p><p className="mono">Employee ID: {base.employee.employee_no} (fixed) · Employment Status: {base.employee.employment_state}</p>
  {error?<p role="alert" className="error">{error}</p>:null}{notice?<p role="status" className="notice">{notice}</p>:null}
  {conflict?<div><p>Reloading clears unsaved profile edits.</p><button type="button" disabled={busy} onClick={()=>void reload()}>Reload latest profile</button></div>:null}
  {optionsError?<p role="alert" className="error">{optionsError}</p>:null}
  <button type="button" className="link" disabled={busy||optionsBusy} onClick={()=>void loadOptions()}>{optionsBusy?'Loading dropdowns...':'Refresh dropdown lists'}</button>
  <form onSubmit={save}>
   {editableProfileSections.map(section=><div key={section.title}><h3>{section.title}</h3><div className="family-fields">{section.fields.map(([key,label])=><label key={key} className={key==="permanent_address"?"field-label-exact":undefined}>
    {key==='probation'?'Probation (months)':label}
    {key==='reports_to_text'?<>
     <select value={reportingTitles.includes(draft[key])?draft[key]:''} disabled={busy||!options?.line_managers} onChange={event=>{
      const designation=event.target.value
      const choices=options?.line_managers?.filter(manager=>manager.designation===designation)??[]
      setDraft(old=>({...old,reports_to_text:designation,line_manager_employee_no:choices.length===1?choices[0].employee_no:''}))
     }}>
      <option value="">Select a designation</option>
      {reportingTitles.map(title=><option key={title} value={title}>{title}</option>)}
     </select>
     {options?.line_managers&&draft[key]&&!reportingTitles.includes(draft[key])&&<span className="field-hint">Previously recorded: {draft[key]}</span>}
    </>:key==='line_manager_employee_no'?<select value={selectedManager?draft[key]:''} disabled={busy||!managers.length} onChange={event=>setDraft(old=>({...old,[key]:event.target.value}))}>
     <option value="">{managers.length?'Select a line manager':'Select a designation first'}</option>
     {managers.map(manager=><option key={manager.employee_no} value={manager.employee_no}>{manager.name}{manager.location?' · '+manager.location:''}{managers.some(other=>other.employee_no!==manager.employee_no&&other.name===manager.name&&other.location===manager.location)?' · '+manager.employee_no:''}</option>)}
    </select>:key==='designation'?<DesignationSelect titles={options?designationTitles(options,draft.department??''):null} value={draft[key]} disabled={busy} onChange={value=>setDraft(old=>({...old,[key]:value}))}/>:key==='highest_qualification_level'?<select value={draft[key]} disabled={busy} onChange={event=>setDraft(old=>({...old,[key]:event.target.value}))}>
     <option value="">Select a qualification level</option>
     {selectChoices(qualificationLevels,draft[key]).map(level=><option key={level} value={level}>{level}</option>)}
    </select>:isDropdown(key)?<select value={draft[key]} disabled={busy||!options} onChange={event=>setDraft(old=>key==='employment_type'?employmentChoice(old,event.target.value):({...old,[key]:event.target.value,...(key==='department'&&!designationTitles(options,event.target.value).includes(old.designation)?{designation:''}:{})}))}>
     <option value="">{options?'Select an option':'Loading options...'}</option>
     {selectChoices(key==='department'?departmentNames(options):options?.[key]??[],draft[key]).map(option=><option key={option} value={option}>{option}</option>)}
    </select>:key==='probation'?<>
     <input type="number" min={0} max={6} step={1} inputMode="numeric" value={validProbation(draft.probation)?draft.probation:''} readOnly={draft.employment_type==='Permanent'} disabled={busy} placeholder="0 to 6" aria-describedby="probation-help" onChange={event=>setDraft(old=>({...old,probation:event.target.value}))}/>
     <span id="probation-help" className="field-hint">{draft.employment_type==='Permanent'?'Permanent: 3 months.':!validProbation(draft.probation)?'Current recorded text: '+draft.probation+'. Enter 0–6 months to replace it.':'Enter a whole number from 0 to 6 months.'}</span>
    </>:isProfileDateField(key)?<DateInput birthDate={key==='date_of_birth'} value={draft[key]} disabled={busy} onChange={value=>setDraft(old=>({...old,[key]:value}))}/>:<input type={key==='email'?'email':'text'} required={key==='full_name'} maxLength={key==='email'?254:1000} value={draft[key]} disabled={busy} onChange={event=>setDraft(old=>({...old,[key]:event.target.value}))}/>}
   </label>)}</div></div>)}
   <p className="muted">Changing the work email does not change your sign-in email. Editing reporting-line text does not change manager permissions or team access.</p>
   <div className="ess-form-actions"><button type="submit" disabled={busy||!dirty||conflict}>{busy?'Saving...':'Save profile details'}</button><button type="button" className="secondary" disabled={busy||!dirty} onClick={()=>{setDraft(profileDraft(base));setError('');setNotice('Unsaved profile edits cleared.')}}>Cancel changes</button></div>
  </form>
 </section>
}
