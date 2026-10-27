'use client'
import {useEffect,useState} from 'react'
import type {FormEvent} from 'react'
import {browserDb} from '../../lib/supabase'
import {editableProfileSections,profileDraft,profilePatch} from '../../lib/ess-profile'
import type {EmployeeProfile} from '../../lib/ess-profile'
export default function ProfileEditor({active,initialProfile,onSaved,onDirtyChange,onBusyChange}:{active:boolean;initialProfile:EmployeeProfile;onSaved:(value:EmployeeProfile)=>void;onDirtyChange:(value:boolean)=>void;onBusyChange:(value:boolean)=>void}){
 const [base,setBase]=useState(initialProfile),[draft,setDraft]=useState(()=>profileDraft(initialProfile))
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[conflict,setConflict]=useState(false)
 const patch=profilePatch(base,draft),dirty=Object.keys(patch).length>0
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
  setBusy(true);setError('');setNotice('')
  try{
   const {data,error:saveError}=await browserDb().rpc('update_my_employee_profile',{p_patch:patch,p_expected_core_updated_at:base.core_updated_at,p_expected_profile_updated_at:base.profile_updated_at})
   if(saveError||!data){
    setConflict(saveError?.code==='40001'||!data)
    setError(saveError?.code==='40001'?'Your profile changed elsewhere. Reload before saving.':saveError?.code==='22023'?'Check your name, work email and field lengths.':'Could not confirm the save. Reload before trying again.')
    return
   }
   populate(data as EmployeeProfile);setNotice('Profile details saved.')
  }catch{setError('Could not confirm the save. Check your connection and reload before trying again.');setConflict(true)}
  finally{setBusy(false)}
 }
 return <section className="panel" hidden={!active}>
  <h2>My profile</h2><p>You can update the details below directly.</p><p className="mono">Employee ID: {base.employee.employee_no} (fixed)</p>
  {error?<p role="alert" className="error">{error}</p>:null}{notice?<p role="status" className="notice">{notice}</p>:null}
  {conflict?<div><p>Reloading clears unsaved profile edits.</p><button type="button" disabled={busy} onClick={()=>void reload()}>Reload latest profile</button></div>:null}
  <form onSubmit={save}>
   {editableProfileSections.map(section=><div key={section.title}><h3>{section.title}</h3><div className="family-fields">{section.fields.map(([key,label])=><label key={key}>{label}<input type={key==='email'?'email':'text'} required={key==='full_name'} maxLength={key==='email'?254:1000} value={draft[key]} disabled={busy} onChange={e=>setDraft(old=>({...old,[key]:e.target.value}))}/></label>)}</div></div>)}
   <p className="muted">Changing the work email does not change your sign-in email. Editing reporting-line text does not change manager permissions or team access.</p>
   <div className="ess-form-actions"><button type="submit" disabled={busy||!dirty||conflict}>{busy?'Saving...':'Save profile details'}</button><button type="button" className="secondary" disabled={busy||!dirty} onClick={()=>{setDraft(profileDraft(base));setError('');setNotice('Unsaved profile edits cleared.')}}>Cancel changes</button></div>
  </form>
 </section>
}
