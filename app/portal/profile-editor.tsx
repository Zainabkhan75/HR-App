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

const dateError='Enter a valid date in DD/MM/YY or DD/MM/YYYY.'
const managerError='Select an active line manager who matches the designation chosen under Reports To.'
const probationError='Enter a whole number from 0 to 6.'
const nameError='Enter your full name before saving.'
const emailError='Enter a valid work email address, such as name@company.com.'
const serverFieldErrors:Record<string,[string,string]>={
 'Full name is required':['full_name',nameError],
 'Enter a valid work email address':['email',emailError],
 'Choose an active line manager with the selected designation':['line_manager_employee_no',managerError],
 'Choose a valid highest qualification level':['highest_qualification_level','Choose a qualification from the list.'],
 'Choose an approved designation':['designation','Choose an approved designation from the list.'],
 'Choose an approved designation. Ask HR to add a missing designation.':['designation','Choose an approved designation from the list.'],
 'Choose a designation assigned to this department':['designation','Choose a designation for the selected department.'],
}

function profileSaveFieldError(error:{message:string;code:string;details?:string|null}):[string,string]|undefined{
 if(error.code==='22023'){
  const field=error.details??''
  if(isDropdown(field))return [field,'Choose a value from the dropdown list. Refresh the list if your selection is missing.']
  if(field==='date_of_joining')return [field,dateError]
  if(field==='probation')return [field,error.message==='Permanent employment uses 3 months probation'?'Permanent employment uses 3 months of probation.':probationError]
 }
 if(error.code==='22023'||error.code==='42501')return Object.hasOwn(serverFieldErrors,error.message)?serverFieldErrors[error.message]:undefined
}
export default function ProfileEditor({active,initialProfile,onSaved,onDirtyChange,onBusyChange}:{active:boolean;initialProfile:EmployeeProfile;onSaved:(value:EmployeeProfile)=>void;onDirtyChange:(value:boolean)=>void;onBusyChange:(value:boolean)=>void}){
 const [base,setBase]=useState(initialProfile),[draft,setDraft]=useState(()=>profileDraft(initialProfile))
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[conflict,setConflict]=useState(false)
 const [fieldErrors,setFieldErrors]=useState<Record<string,string>>({})
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
 function populate(value:EmployeeProfile){setBase(value);setDraft(profileDraft(value));onSaved(value);setConflict(false);setFieldErrors({})}
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
  const form=event.currentTarget
  function showFieldErrors(errors:Record<string,string>){
   setFieldErrors(errors)
   setError('Your profile was not saved. Check the highlighted fields below.')
   requestAnimationFrame(()=>{
    const label=form.querySelector('[data-profile-error]')
    const control=label?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled)')
    if(control)control.focus()
    else label?.scrollIntoView({block:'center'})
   })
  }
  setError('');setNotice('');setFieldErrors({})
  const errors:Record<string,string>={}
  if((patch.reports_to_text!==undefined||patch.line_manager_employee_no!==undefined)&&
     ((draft.reports_to_text&&!selectedManager)||(!draft.reports_to_text&&draft.line_manager_employee_no))){
   errors.line_manager_employee_no=managerError
  }
  for(const [key,value] of Object.entries(patch)){
   if(isProfileDateField(key)&&value&&!isIsoDate(value))errors[key]=key==='date_of_birth'?'Enter a valid date of birth on or before today. Use DD/MM/YY or DD/MM/YYYY.':dateError
  }
  if(patch.probation!==undefined&&!validProbation(patch.probation))errors.probation=probationError
  if(patch.full_name==='')errors.full_name=nameError
  if(patch.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email))errors.email=emailError
  if(Object.keys(errors).length){showFieldErrors(errors);return}
  setBusy(true)
  try{
   const {data,error:saveError}=await browserDb().rpc('update_my_employee_profile',{p_patch:patch,p_expected_core_updated_at:base.core_updated_at,p_expected_profile_updated_at:base.profile_updated_at})
   if(saveError||!data){
    if(saveError?.code==='40001'){
     setConflict(true)
     setError('Your profile changed elsewhere. Copy any edits you want to keep, then reload the latest profile.')
    }else{
     const fieldError=saveError?profileSaveFieldError(saveError):undefined
     if(fieldError)showFieldErrors({[fieldError[0]]:fieldError[1]})
     else setError('Could not save your profile. Your edits are still here. Try again or contact HR if the problem continues.')
    }
    return
   }
   populate(data as EmployeeProfile);setNotice('Profile details saved.')
  }catch{setError('Could not confirm the save. Check your connection and try again. Your edits are still here.')}
  finally{setBusy(false)}
 }
 return <section className="panel" hidden={!active}>
  <h2>My profile</h2><p>You can update the details below directly.</p><p className="mono">Employee ID: {base.employee.employee_no} (fixed) · Employment Status: {base.employee.employment_state}</p>
  {error?<p role="alert" className="error">{error}</p>:null}{notice?<p role="status" className="notice">{notice}</p>:null}
  {conflict?<div><p>Reloading clears unsaved profile edits.</p><button type="button" disabled={busy} onClick={()=>void reload()}>Reload latest profile</button></div>:null}
  {optionsError?<p role="alert" className="error">{optionsError}</p>:null}
  <button type="button" className="link" disabled={busy||optionsBusy} onClick={()=>void loadOptions()}>{optionsBusy?'Loading dropdowns...':'Refresh dropdown lists'}</button>
  <form noValidate onSubmit={save} onChange={event=>{
   const key=(event.target as HTMLElement).closest<HTMLElement>('[data-profile-field]')?.dataset.profileField
   if(!key)return
   setFieldErrors(current=>Object.fromEntries(Object.entries(current).filter(([field])=>field!==key&&!(key==='reports_to_text'&&field==='line_manager_employee_no')&&!(key==='department'&&field==='designation')&&!(key==='employment_type'&&field==='probation'))))
  }}>
   {editableProfileSections.map(section=><div key={section.title}><h3>{section.title}</h3><div className="family-fields">{section.fields.map(([key,label])=><label key={key} data-profile-field={key} data-profile-error={fieldErrors[key]?true:undefined} className={key==="permanent_address"?"field-label-exact":undefined}>
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
    {fieldErrors[key]&&<span className="field-hint" style={{color:'#a12626'}} role="alert">{fieldErrors[key]}</span>}
   </label>)}</div></div>)}
   <p className="muted">Changing the work email does not change your sign-in email. Editing reporting-line text does not change manager permissions or team access.</p>
   <div className="ess-form-actions"><button type="submit" disabled={busy||!dirty||conflict}>{busy?'Saving...':'Save profile details'}</button><button type="button" className="secondary" disabled={busy||!dirty} onClick={()=>{setDraft(profileDraft(base));setError('');setFieldErrors({});setNotice('Unsaved profile edits cleared.')}}>Cancel changes</button></div>
  </form>
 </section>
}
