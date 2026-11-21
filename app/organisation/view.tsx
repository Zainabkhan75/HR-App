'use client'

import {useEffect,useState} from 'react'
import {browserDb} from '../../lib/supabase'

type Department={id:number;name:string}
type Designation={id:number;title:string}
type Position={id:number;position_code:string|null;title:string;location:string|null;department_id:number|null;designation_id:number|null}
type Assignment={position_id:number|null}

export default function Organisation(){
 const [positions,setPositions]=useState<Position[]>([])
 const [positionDepartment,setPositionDepartment]=useState('')
 const [positionDesignation,setPositionDesignation]=useState('')
 const [positionTitle,setPositionTitle]=useState('')
 const [parentPosition,setParentPosition]=useState('')
 const [departments,setDepartments]=useState<Department[]>([])
 const [designations,setDesignations]=useState<Designation[]>([])
 const [assignments,setAssignments]=useState<Assignment[]>([])
 const [editing,setEditing]=useState<{kind:'department'|'designation';id:number;previous:string}|null>(null)
 const [draft,setDraft]=useState('')
 const [newDepartment,setNewDepartment]=useState('')
 const [newTitle,setNewTitle]=useState('')
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')

 async function load(){
  const db=browserDb()
  const [depts,roles,people,seats]=await Promise.all([
   db.from('departments').select('id,name').order('name'),
   db.from('designations').select('id,title').order('title'),
   db.from('employees').select('position_id').eq('employment_state','active').limit(2000),
   db.from('positions').select('id,position_code,title,location,department_id,designation_id').order('title').order('id'),
  ])
  if(depts.error||roles.error||people.error||seats.error)throw Error('Could not load organisation records.')
  setPositions(seats.data)
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
    if(!newTitle.trim())throw Error('Enter a designation.')
    const result=await db.rpc('add_global_designation',{p_title:newTitle.trim()})
    if(result.error)throw Error('Could not add this designation. Refresh and try again.')
    setNewTitle('')
   }
   await load();setNotice('Added to the shared organisation records.')
  }catch(failure){setError(failure instanceof Error?failure.message:'Could not add the record.')}
  finally{setBusy(false)}
 }
 async function addPosition(){
  if(busy||!positionTitle.trim()||!positionDepartment||!positionDesignation||!parentPosition)return
  setBusy(true);setError('');setNotice('')
  try{
   const {data,error:saveError}=await browserDb().rpc('create_organisation_position',{
    p_title:positionTitle.trim(),
    p_department_id:Number(positionDepartment),
    p_designation_id:Number(positionDesignation),
    p_reports_to_position_id:Number(parentPosition),
   })
   if(saveError)throw Error(saveError.message)
   setPositionTitle('');setParentPosition('')
   setNotice(`Position ${data} created.`)
   await load().catch(()=>setError('The position was saved. Refresh to reload the organisation records.'))
  }catch(failure){setError(failure instanceof Error?failure.message:'Could not add the position.')}
  finally{setBusy(false)}
 }
 const counts=new Map<number,number>()
 const designationByPosition=new Map(positions.map(position=>[position.id,position.designation_id]))
 for(const assignment of assignments){
  const designationId=assignment.position_id==null?null:designationByPosition.get(assignment.position_id)
  if(designationId!=null)counts.set(designationId,(counts.get(designationId)??0)+1)
 }
 return <main className="shell">
  <header><div><div className="eyebrow">BANDANA / HR ADMINISTRATION</div><h1>Positions, Departments &amp; Designations</h1></div>
   <nav className="head-actions"><a href="/employees">Employee Directory</a><a href="/reports">Reports</a></nav></header>
  {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
  <section className="panel"><h2>Add New Position</h2>
   <form className="bar" onSubmit={event=>{event.preventDefault();void addPosition()}}>
    <label>Department<select required value={positionDepartment} disabled={busy}
     onChange={event=>setPositionDepartment(event.target.value)}>
     <option value="">Select department</option>
     {departments.map(department=><option key={department.id} value={department.id}>{department.name}</option>)}
    </select></label>
    <label>Designation<select required value={positionDesignation} disabled={busy} onChange={event=>{
     const designation=designations.find(item=>String(item.id)===event.target.value)
     setPositionDesignation(event.target.value)
     if(designation&&!positionTitle.trim())setPositionTitle(designation.title)
    }}>
     <option value="">Select designation</option>
     {designations.map(role=><option key={role.id} value={role.id}>{role.title}</option>)}
    </select></label>
    <label>Position Title<input required value={positionTitle} disabled={busy} onChange={event=>setPositionTitle(event.target.value)}/></label>
    <label>Reports To<select required value={parentPosition} disabled={busy} onChange={event=>setParentPosition(event.target.value)}>
     <option value="">Select reporting position</option>
     {positions.map(position=><option key={position.id} value={position.id}>
      {[position.position_code??position.id,position.title,position.location].filter(Boolean).join(' · ')}
     </option>)}
    </select></label>
    <button disabled={busy||!positionTitle.trim()||!positionDepartment||!positionDesignation||!parentPosition}>Add Position</button>
   </form>
  </section>
  <section className="panel"><h2>Departments</h2>
   <div className="bar"><label>New Department<input value={newDepartment} disabled={busy} onChange={event=>setNewDepartment(event.target.value)}/></label>
    <button disabled={busy||!newDepartment.trim()} onClick={()=>void add('department')}>Add Department</button></div>
   <div className="tablewrap"><table><thead><tr><th>Department ID</th><th>Department</th><th>Positions</th><th>Actions</th></tr></thead>
    <tbody>{departments.map(department=><tr key={department.id}><td>{department.id}</td><td>{department.name}</td>
     <td>{positions.filter(position=>position.department_id===department.id).length}</td>
     <td><button className="link" disabled={busy} onClick={()=>{setEditing({kind:'department',id:department.id,previous:department.name});setDraft(department.name)}}>Rename</button></td></tr>)}</tbody></table></div>
  </section>
  <section className="panel"><h2>Designations</h2><div className="bar">
   <label>New Designation<input value={newTitle} disabled={busy} onChange={event=>setNewTitle(event.target.value)}/></label>
   <button disabled={busy||!newTitle.trim()} onClick={()=>void add('designation')}>Add Designation</button></div>
   <div className="tablewrap"><table><thead><tr><th>Designation ID</th><th>Designation</th><th>Active Employees</th><th>Actions</th></tr></thead>
    <tbody>{designations.map(role=><tr key={role.id}><td>{role.id}</td><td>{role.title}</td>
     <td>{counts.get(role.id)??0}</td><td><button className="link" disabled={busy}
      onClick={()=>{setEditing({kind:'designation',id:role.id,previous:role.title});setDraft(role.title)}}>Rename</button></td></tr>)}</tbody></table></div>
  </section>
  {editing&&<div className="overlay"><section className="dialog" role="dialog" aria-modal="true" aria-label="Rename shared record">
   <h2>Rename {editing.kind==='department'?'Department':'Designation'}</h2>
   <p>Save to update this name in the organisation register.</p>
   <label>Name<input autoFocus value={draft} disabled={busy} onChange={event=>setDraft(event.target.value)}/></label>
   <div className="bar"><button disabled={busy||!draft.trim()} onClick={()=>void saveChange()}>{busy?'Saving…':'Save Name'}</button>
    <button className="secondary" disabled={busy} onClick={()=>setEditing(null)}>Cancel</button></div>
  </section></div>}
 </main>
}
