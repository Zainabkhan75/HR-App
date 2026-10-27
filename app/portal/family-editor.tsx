'use client'
import {useEffect,useState} from 'react'
import type {FormEvent} from 'react'
import {browserDb} from '../../lib/supabase'
import {memberDraft,memberValue,memberError,familySnapshot} from '../../lib/family-profile'
import type {FamilyDetails,MemberDraft} from '../../lib/family-profile'

function PersonFields({person,onChange,disabled,isSpouse=false}:{isSpouse?:boolean;person:MemberDraft;onChange:(value:MemberDraft)=>void;disabled:boolean}){
 const adult=isSpouse||(person.age.trim()!==''&&Number(person.age)>=18)
 return <div className="family-fields">
  <label>Full name<input required maxLength={200} value={person.full_name} disabled={disabled} onChange={e=>onChange({...person,full_name:e.target.value})}/></label>
  <label>Age (years)<input type="number" required min={0} step={1} value={person.age} disabled={disabled} onChange={e=>onChange({...person,age:e.target.value})}/></label>
  <label>CNIC {adult?'(required)':'(optional)'}<input required={adult} inputMode="numeric" maxLength={32} placeholder="13 digits, with or without hyphens" value={person.cnic} disabled={disabled} onChange={e=>onChange({...person,cnic:e.target.value})}/></label>
  <label className="family-wide">Pre-existing conditions<textarea rows={3} maxLength={4000} placeholder="Enter None if none, or describe any conditions" value={person.pre_existing_conditions} disabled={disabled} onChange={e=>onChange({...person,pre_existing_conditions:e.target.value})}/></label>
 </div>
}
export default function FamilyEditor({active,onDirtyChange,onBusyChange}:{active:boolean;onDirtyChange:(value:boolean)=>void;onBusyChange:(value:boolean)=>void}){
 const [base,setBase]=useState<FamilyDetails|null>(null)
 const [spouse,setSpouse]=useState<MemberDraft|null>(null)
 const [children,setChildren]=useState<MemberDraft[]>([])
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[conflict,setConflict]=useState(false)
 const draft={spouse:spouse?memberValue(spouse):null,children:children.map(memberValue)}
 const dirty=!!base&&familySnapshot(draft)!==familySnapshot(base)
 function populate(value:FamilyDetails){
  setBase(value);setSpouse(value.spouse?memberDraft(value.spouse):null);setChildren(value.children.map(memberDraft));setConflict(false)
 }
 async function load(){
  setLoading(true);setError('');setNotice('')
  try{
   const {data,error:loadError}=await browserDb().rpc('my_family_details')
   if(loadError||!data){setError('Could not load family details. Please try again.');return}
   populate(data as FamilyDetails)
  }catch{setError('Could not load family details. Please check your connection.')}
  finally{setLoading(false)}
 }
 useEffect(()=>{if(active&&!base&&!loading)void load()},[active])
 useEffect(()=>{onDirtyChange(dirty)},[dirty,onDirtyChange])
 useEffect(()=>{onBusyChange(busy||loading)},[busy,loading,onBusyChange])

 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault()
  if(!base||busy||conflict||!dirty)return
  setError('');setNotice('')
  for(const person of [...(spouse?[spouse]:[]),...children]){
   const validation=memberError(person,person===spouse)
   if(validation){setError(validation);return}
  }
  setBusy(true)
  try{
   const {data,error:saveError}=await browserDb().rpc('save_my_family_details',{p_spouse:draft.spouse,p_children:draft.children,p_expected_updated_at:base.updated_at})
   if(saveError||!data){
    setConflict(saveError?.code==='40001'||!data)
    setError(saveError?.code==='40001'?'Family details changed elsewhere. Reload before saving.':saveError?.code==='22023'?'Check each dependant’s name, age and CNIC. CNIC is required for every spouse and children aged 18 or older.':'Could not confirm the save. Reload before trying again.')
    return
   }
   populate(data as FamilyDetails);setNotice('Family and dependant details saved.')
  }catch{setError('Could not confirm the save. Check your connection and reload before trying again.');setConflict(true)}
  finally{setBusy(false)}
 }
 return <section className="panel" hidden={!active}>
  <h2>Family & dependants</h2><p>Details for health insurance. You may record one spouse and add children individually.</p>
  <p className="muted">CNIC is required for every spouse and children aged 18 or older. It is optional for children under 18. These details are visible only to you and HR.</p>
  {loading?<p role="status">Loading family details...</p>:null}
  {error?<p role="alert" className="error">{error}</p>:null}
  {notice?<p role="status" className="notice">{notice}</p>:null}
  {!base&&!loading?<button type="button" onClick={()=>void load()}>Try loading again</button>:null}
  {conflict?<div><p>Reloading clears unsaved family changes.</p><button type="button" disabled={busy||loading} onClick={()=>void load()}>Reload family details</button></div>:null}
  {base?<form onSubmit={save}>
   <h3>Spouse</h3>
   {spouse?<fieldset className="family-person"><legend>Spouse</legend><PersonFields isSpouse person={spouse} disabled={busy||loading} onChange={setSpouse}/><button type="button" className="secondary" disabled={busy||loading} onClick={()=>setSpouse(null)}>Remove spouse</button></fieldset>:<><p>No spouse recorded.</p><button type="button" className="secondary" disabled={busy||loading} onClick={()=>setSpouse(memberDraft())}>Add spouse</button></>}
   <h3>Children</h3>
   {children.length===0?<p>No children recorded.</p>:null}
   {children.map((child,index)=><fieldset className="family-person" key={child.key}><legend>Child {index+1}</legend><PersonFields person={child} disabled={busy||loading} onChange={updated=>setChildren(old=>old.map(row=>row.key===child.key?updated:row))}/><button type="button" className="secondary" disabled={busy||loading} onClick={()=>setChildren(old=>old.filter(row=>row.key!==child.key))}>Remove child {index+1}</button></fieldset>)}
   <button type="button" className="secondary" disabled={busy||loading} onClick={()=>setChildren(old=>[...old,memberDraft()])}>Add child</button>
   <div className="ess-form-actions"><button type="submit" disabled={busy||loading||!dirty||conflict}>{busy?'Saving...':'Save family details'}</button><button type="button" className="secondary" disabled={busy||loading||!dirty} onClick={()=>{populate(base);setError('');setNotice('Unsaved family changes cleared.')}}>Cancel changes</button></div>
  </form>:null}
 </section>
}
