'use client'

import {useEffect,useState} from 'react'
import {browserDb} from '../../lib/supabase'

type Department={id:number;name:string}
type Designation={id:number;department_id:number;title:string}
type Assignment={designation_id:number|null}

export default function Organisation(){
 const [departments,setDepartments]=useState<Department[]>([])
 const [designations,setDesignations]=useState<Designation[]>([])
 const [assignments,setAssignments]=useState<Assignment[]>([])
 const [selected,setSelected]=useState('')
 const [editing,setEditing]=useState<{kind:'department'|'designation';id:number;previous:string}|null>(null)
 const [draft,setDraft]=useState('')
 const [newDepartment,setNewDepartment]=useState('')
 const [newTitle,setNewTitle]=useState('')
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')

 async function load(){
  const db=browserDb()
  const [depts,roles,people]=await Promise.all([
   db.from('departments').select('id,name').order('name'),
   db.from('designations').select('id,department_id,title').order('title'),
   db.from('employees').select('designation_id').eq('employment_state','active').limit(2000),
  ])
  if(depts.error||roles.error||people.error)throw Error('Could not load departments and designations.')
  setDepartments(depts.data);setDesignations(roles.data);setAssignments(people.data)
 }
 useEffect(()=>{void load().catch(failure=>setError(failure.message))},[])

 async function saveChange(){
  if(!editing||!draft.trim()||busy)return
  setBusy(true);setError('');setNotice('')
  try{
   const column=editing.kind==='department'?'name':'title'
   const table=editing.kind==='department'?'departments':'designations'
   const {error:saveError}=await browserDb().from(table).update({[column]:draft.trim()})
    .eq('id',editing.id).eq(column,editing.previous).select('id').single()
   if(saveError)throw Error('Could not save. Check for a duplicate name or refresh if someone else edited this record.')
   setEditing(null);await load();setNotice('Saved. Assigned employees now use the updated name.')
  }catch(failure){setError(failure instanceof Error?failure.message:'Could not save.')}
  finally{setBusy(false)}
 }
 async function add(kind:'department'|'designation'){
  if(busy)return
  setBusy(true);setError('');setNotice('')
  try{
   const db=browserDb()
   if(kind==='department'){
    if(!newDepartment.trim())throw Error('Enter a department name.')
    const result=await db.from('departments').insert({name:newDepartment.trim()})
    if(result.error)throw Error('Could not add this department. Check whether the name already exists.')
    setNewDepartment('')
   }else{
    if(!selected||!newTitle.trim())throw Error('Select a department and enter a designation.')
    const result=await db.rpc('add_department_designation',{p_department_id:Number(selected),p_title:newTitle.trim()})
    if(result.error)throw Error('Could not add this designation. Refresh and try again.')
    setNewTitle('')
   }
   await load();setNotice('Added to the shared organisation records.')
  }catch(failure){setError(failure instanceof Error?failure.message:'Could not add the record.')}
  finally{setBusy(false)}
 }
 const names=new Map(departments.map(item=>[item.id,item.name]))
 const counts=new Map<number,number>()
 for(const assignment of assignments){
  if(assignment.designation_id!==null)counts.set(assignment.designation_id,(counts.get(assignment.designation_id)??0)+1)
 }
 return <main className="shell">
  <header><div><div className="eyebrow">BANDANA / HR ADMINISTRATION</div><h1>Departments & Designations</h1>
   <p>Each designation belongs to one department. Employees assigned to it share its name and department.</p></div>
   <nav className="head-actions"><a href="/employees">Employee Directory</a><a href="/reports">Reports</a></nav></header>
  {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
  <section className="panel"><h2>Departments</h2>
   <div className="bar"><label>New Department<input value={newDepartment} disabled={busy} onChange={event=>setNewDepartment(event.target.value)}/></label>
    <button disabled={busy||!newDepartment.trim()} onClick={()=>void add('department')}>Add Department</button></div>
   <div className="tablewrap"><table><thead><tr><th>Department ID</th><th>Department</th><th>Designations</th><th>Actions</th></tr></thead>
    <tbody>{departments.map(department=><tr key={department.id}><td>{department.id}</td><td>{department.name}</td>
     <td>{designations.filter(role=>role.department_id===department.id).length}</td>
     <td><button className="link" disabled={busy} onClick={()=>{setEditing({kind:'department',id:department.id,previous:department.name});setDraft(department.name)}}>Rename</button></td></tr>)}</tbody></table></div>
  </section>
  <section className="panel"><h2>Designations</h2><div className="bar">
   <label>Department<select value={selected} disabled={busy} onChange={event=>setSelected(event.target.value)}><option value="">All Departments</option>
    {departments.map(department=><option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
   <label>New Designation<input value={newTitle} disabled={busy} onChange={event=>setNewTitle(event.target.value)}/></label>
   <button disabled={busy||!selected||!newTitle.trim()} onClick={()=>void add('designation')}>Add Designation</button></div>
   <div className="tablewrap"><table><thead><tr><th>Designation ID</th><th>Designation</th><th>Department</th><th>Active Employees</th><th>Actions</th></tr></thead>
    <tbody>{designations.filter(role=>!selected||role.department_id===Number(selected)).map(role=><tr key={role.id}><td>{role.id}</td><td>{role.title}</td>
     <td>{names.get(role.department_id)}</td><td>{counts.get(role.id)??0}</td><td><button className="link" disabled={busy}
      onClick={()=>{setEditing({kind:'designation',id:role.id,previous:role.title});setDraft(role.title)}}>Rename</button></td></tr>)}</tbody></table></div>
  </section>
  {editing&&<div className="overlay"><section className="dialog" role="dialog" aria-modal="true" aria-label="Rename shared record">
   <h2>Rename {editing.kind==='department'?'Department':'Designation'}</h2>
   <p>This changes the displayed name for every linked position and employee.</p>
   <label>Name<input autoFocus value={draft} disabled={busy} onChange={event=>setDraft(event.target.value)}/></label>
   <div className="bar"><button disabled={busy||!draft.trim()} onClick={()=>void saveChange()}>{busy?'Saving…':'Save Name'}</button>
    <button className="secondary" disabled={busy} onClick={()=>setEditing(null)}>Cancel</button></div>
  </section></div>}
 </main>
}
