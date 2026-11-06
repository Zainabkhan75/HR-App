'use client'

import {useEffect,useState} from 'react'
import {displayShortDate} from '../../lib/date-input'
import type {FamilyDetails} from '../../lib/family-profile'
import {browserDb} from '../../lib/supabase'

export default function FamilyView({employeeId}:{employeeId:string}){
 const [family,setFamily]=useState<FamilyDetails|null>(null)
 const [error,setError]=useState(false)

 useEffect(()=>{
  let current=true
  async function load(){
   try{
    const {data,error}=await browserDb().from('employee_family_details')
     .select('spouse,children,updated_at').eq('employee_id',employeeId).maybeSingle()
    if(error)throw error
    if(current)setFamily((data as FamilyDetails|null)??{spouse:null,children:[],updated_at:null})
   }catch{
    if(current)setError(true)
   }
  }
  void load()
  return ()=>{current=false}
 },[employeeId])

 if(error)return <p className="error" role="alert">Family details could not be loaded. Reopen the tab to try again.</p>
 if(!family)return <p role="status">Loading family details…</p>

 const members=[
  ...(family.spouse?[{role:'Spouse',person:family.spouse}]:[]),
  ...family.children.map((person,index)=>({role:'Child '+(index+1),person})),
 ]
 if(!members.length)return <p>No family details recorded.</p>

 return <section aria-label="Family & Dependants">
  <p className="muted">Family details recorded for insurance. View only.</p>
  {members.map(({role,person})=><fieldset key={role}>
   <legend>{role}</legend>
   <dl>
    <dt>Full Name</dt><dd>{person.full_name||'Not recorded'}</dd>
    <dt>Date of Birth</dt><dd>{displayShortDate(person.date_of_birth)||'Not recorded'}</dd>
    <dt>Age (Years)</dt><dd>{person.age??'Not recorded'}</dd>
    <dt>CNIC</dt><dd>{person.cnic||'Not recorded'}</dd>
    <dt>Pre-existing Conditions</dt><dd>{person.pre_existing_conditions||'Not recorded'}</dd>
   </dl>
  </fieldset>)}
 </section>
}
