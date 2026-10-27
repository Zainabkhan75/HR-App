'use client'
import {useState} from 'react'
import type {FormEvent} from 'react'
import {browserDb} from '../../lib/supabase'
import FamilyEditor from './family-editor'
import ProfileEditor from './profile-editor'
import {backgroundSections,contactFields,employmentFields,rewardFields,payrollFields,contactDraft,contactPatch} from '../../lib/ess-profile'
import type {EmployeeProfile,Values} from '../../lib/ess-profile'

type Team={employee_no:string;full_name:string;designation:string|null;department:string|null}
const tabs=[['profile','My profile'],['contact','Contact details'],['family','Family & dependants'],['background','Emergency & background'],['pay','Salary & benefits'],['payroll','Historical payroll']] as const
type Tab=typeof tabs[number][0]
const display=(value:string|null|undefined)=>value?.trim()||'Not recorded'

function FieldList({fields,values}:{fields:readonly (readonly [string,string])[];values:Values}){
 return <dl className="profile-grid">{fields.map(([key,label])=><div className="ess-field" key={key}><dt>{label}</dt><dd>{display(values[key])}</dd></div>)}</dl>
}

export default function Portal({initialProfile,team,isManager,teamUnavailable=false}:{initialProfile:EmployeeProfile;team:Team[];isManager:boolean;teamUnavailable?:boolean}){
 const [profile,setProfile]=useState(initialProfile)
 const [tab,setTab]=useState<Tab>('profile')
 const [draft,setDraft]=useState(()=>contactDraft(initialProfile.contacts))
 const [contactVersion,setContactVersion]=useState(initialProfile.profile_updated_at)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [conflict,setConflict]=useState(false)
 const [familyDirty,setFamilyDirty]=useState(false),[familyBusy,setFamilyBusy]=useState(false)
 const [profileDirty,setProfileDirty]=useState(false),[profileBusy,setProfileBusy]=useState(false)
 const employee=profile.employee
 const changes=contactPatch(profile.contacts,draft)
 const dirty=Object.keys(changes).length>0

 async function saveContact(event:FormEvent<HTMLFormElement>){
  event.preventDefault()
  if(busy||!dirty||conflict)return
  setBusy(true);setError('');setNotice('')
  try{
   const {data,error:saveError}=await browserDb().rpc('update_my_contact_details',{
    p_patch:changes,p_expected_updated_at:contactVersion
   })
   if(saveError){
    const stale=saveError.code==='40001'
    setConflict(stale)
    setError(stale?'Your profile was changed elsewhere. Reload the latest profile before saving. Your changes have not been saved.':saveError.code==='22023'?'Please check your contact details, including the email address and field lengths.':'Your changes could not be saved. Reload your profile or contact HR.')
    return
   }
   if(!data){setError('We could not confirm the save. Reload your profile before trying again.');setConflict(true);return}
   const updated=data as EmployeeProfile
   setProfile(updated);setDraft(contactDraft(updated.contacts));setContactVersion(updated.profile_updated_at)
   setNotice('Contact details saved. The HR record has been updated.')
  }catch{
   setError('We could not confirm the save. Check your connection and reload your profile before trying again.')
   setConflict(true)
  }finally{setBusy(false)}
 }

 async function reloadProfile(){
  if(busy)return
  setBusy(true);setError('');setNotice('')
  try{
   const {data,error:loadError}=await browserDb().rpc('my_employee_profile')
   if(loadError||!data){setError('Could not reload your profile. Please try again.');return}
   const updated=data as EmployeeProfile
   setProfile(updated);setDraft(contactDraft(updated.contacts));setContactVersion(updated.profile_updated_at);setConflict(false)
   setNotice('Latest profile loaded. Unsaved contact changes were cleared.')
  }catch{setError('Could not reload your profile. Please check your connection.')}
  finally{setBusy(false)}
 }

 async function logOut(){
  if(busy||familyBusy||profileBusy)return
  if((dirty||familyDirty||profileDirty)&&!window.confirm('Sign out without saving your changes?'))return
  setBusy(true);setError('')
  try{
   const {error:signOutError}=await browserDb().auth.signOut({scope:'local'})
   if(signOutError){setError('Could not sign out. Please try again.');setBusy(false);return}
   window.location.replace('/login')
  }catch{setError('Could not sign out. Please check your connection.');setBusy(false)}
 }

 return <main className="mobile-shell ess-shell">
  <header className="ess-header"><div><div className="eyebrow">BANDANA / SEIDOHR</div><h1>Welcome, {employee.full_name}</h1><p>{employee.employee_no} · {display(employee.designation)}</p></div><button type="button" className="secondary" disabled={busy||familyBusy||profileBusy} onClick={()=>void logOut()}>Sign out</button></header>
  <nav className="ess-nav" aria-label="Self-service sections">{tabs.map(([key,label])=><button key={key} type="button" aria-pressed={tab===key} className={tab===key?'ess-nav-active':''} onClick={()=>setTab(key)}>{label}{((key==='contact'&&dirty)||(key==='family'&&familyDirty)||(key==='profile'&&profileDirty))?' *':''}</button>)}{[['leave','Leave application'],['inbox','Inbox'],...(isManager?[['approvals','Manager approvals']]:[])].map(([section,label])=><button key={section} type="button" disabled={busy||familyBusy||profileBusy} onClick={()=>{if((dirty||familyDirty||profileDirty)&&!window.confirm('Leave this page without saving your changes?'))return;window.location.assign('/workspace?section='+section)}}>{label}</button>)}</nav>
  {error?<p role="alert" className="error">{error}</p>:null}
  {notice?<p role="status" className="notice">{notice}</p>:null}
  {conflict?<div className="panel"><p>Reloading will clear your unsaved contact changes.</p><button type="button" disabled={busy} onClick={()=>void reloadProfile()}>Reload latest profile</button></div>:null}

  <ProfileEditor active={tab==='profile'} initialProfile={profile} onDirtyChange={setProfileDirty} onBusyChange={setProfileBusy} onSaved={updated=>{setProfile(updated);if(!dirty){setDraft(contactDraft(updated.contacts));setContactVersion(updated.profile_updated_at)}}}/>
  <FamilyEditor active={tab==='family'} onDirtyChange={setFamilyDirty} onBusyChange={setFamilyBusy}/>
  {tab==='background'?<section className="panel"><h2>Emergency & background</h2><p>Details submitted through the employee verification form. Contact HR if these need correction.</p>{backgroundSections.map(section=><div key={section.title}><h3>{section.title}</h3><FieldList fields={section.fields} values={profile.personal}/></div>)}</section>:null}

  {tab==='contact'?<section className="panel"><h2>My contact details</h2><p>You can update these details directly. Changes are saved to your HR record.</p>
   <form onSubmit={saveContact} className="ess-contact-form">
    {contactFields.map(field=><label key={field.key}>{field.label}{field.type==='textarea'?<textarea rows={3} maxLength={field.maxLength} value={draft[field.key]} disabled={busy} onChange={event=>setDraft(old=>({...old,[field.key]:event.target.value}))} autoComplete="street-address"/>:<input type={field.type} maxLength={field.maxLength} value={draft[field.key]} disabled={busy} autoComplete={field.type==='email'?'email':'tel'} onChange={event=>setDraft(old=>({...old,[field.key]:event.target.value}))}/>}</label>)}
    <p className="muted">Changing a contact email does not change your sign-in email or username.</p>
    <div className="ess-form-actions"><button type="submit" disabled={busy||!dirty||conflict}>{busy?'Please wait...':'Save contact details'}</button><button type="button" className="secondary" disabled={busy||!dirty} onClick={()=>{setDraft(contactDraft(profile.contacts));setNotice('Unsaved contact changes cleared.')}}>Cancel changes</button></div>
   </form>
  </section>:null}

  {tab==='pay'?<section className="panel"><div className="ess-section-heading"><h2>My salary & benefits</h2><span className="ess-readonly">View only</span></div>
   <p>These are the values currently recorded in your employee profile. Missing information is shown as “Not recorded”. Contact HR if a value needs checking.</p>
   <FieldList fields={rewardFields} values={profile.rewards}/>
  </section>:null}

  {tab==='payroll'?<section className="panel"><div className="ess-section-heading"><h2>August 2026 payroll</h2><span className="ess-readonly">Historical · View only</span></div>
   <p>This is the imported August 2026 snapshot. It is not a current payslip or live payroll calculation.</p>
   <FieldList fields={payrollFields} values={profile.payroll_aug_2026}/>
  </section>:null}

  {isManager?<section className="panel"><h2>My team</h2>{teamUnavailable?<p role="alert">Your team could not be loaded. Please try again later.</p>:team.length===0?<p>No verified direct reports have been linked yet.</p>:<ul className="team-list">{team.map(member=><li key={member.employee_no}><strong>{member.full_name}</strong><span>{member.employee_no} · {display(member.designation)}</span></li>)}</ul>}</section>:null}
 </main>
}

