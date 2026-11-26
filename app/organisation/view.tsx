'use client'
import SearchableSelect from '../searchable-select'

import {useEffect,useState} from 'react'
import {browserDb} from '../../lib/supabase'

type SubDepartment={id:number;name:string;parent_department_id:string|null}
type OrganisationDepartment={id:string;name:string}
type Designation={id:number;title:string;department_id:number|null}
type Position={id:number;position_code:string|null;title:string;location:string|null;department_id:number|null;designation_id:number|null;reports_to_position_id:number|null}
type Assignment={position_id:number|null;employee_no:string;full_name:string}

export default function Organisation(){
 const [positions,setPositions]=useState<Position[]>([])
 const [positionDepartment,setPositionDepartment]=useState('')
 const [positionDesignation,setPositionDesignation]=useState('')
 const [positionTitle,setPositionTitle]=useState('')
 const [parentPosition,setParentPosition]=useState('')
 const [editPositionId,setEditPositionId]=useState('')
 const [editPositionTitle,setEditPositionTitle]=useState('')
 const [editPositionDepartment,setEditPositionDepartment]=useState('')
 const [editPositionDesignation,setEditPositionDesignation]=useState('')
 const [editParentPosition,setEditParentPosition]=useState('')
 const [subDepartments,setSubDepartments]=useState<SubDepartment[]>([])
 const [organisationDepartments,setOrganisationDepartments]=useState<OrganisationDepartment[]>([])
 const [designations,setDesignations]=useState<Designation[]>([])
 const [assignments,setAssignments]=useState<Assignment[]>([])
 const [editing,setEditing]=useState<{kind:'sub'|'org'|'designation';id:number|string;previous:string}|null>(null)
 const [draft,setDraft]=useState('')
 const [newSubDepartment,setNewSubDepartment]=useState('')
 const [newSubParent,setNewSubParent]=useState('')
 const [newOrgId,setNewOrgId]=useState('')
 const [newOrgName,setNewOrgName]=useState('')
 const [newTitle,setNewTitle]=useState('')
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')

 async function load(){
  const db=browserDb()
  const [orgs,subs,roles,people,seats]=await Promise.all([
   db.from('organisation_departments').select('id,name').order('name'),
   db.from('departments').select('id,name,parent_department_id').order('name'),
   db.from('designations').select('id,title,department_id').order('title'),
   db.from('employees').select('position_id,employee_no,full_name').eq('employment_state','active').limit(2000),
   db.from('positions').select('id,position_code,title,location,department_id,designation_id,reports_to_position_id').order('id'),
  ])
  if(orgs.error||subs.error||roles.error||people.error||seats.error)throw Error('Could not load organisation records.')
  setPositions(seats.data)
  setOrganisationDepartments([...orgs.data].sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true})));setSubDepartments(subs.data);setDesignations(roles.data);setAssignments(people.data)
 }
 useEffect(()=>{void load().catch(failure=>setError(failure.message))},[])

 async function saveChange(){
  if(!editing||!draft.trim()||busy)return
  setBusy(true);setError('');setNotice('')
  try{
   const table=editing.kind==='org'?'organisation_departments':editing.kind==='sub'?'departments':'designations'
   const column=editing.kind==='designation'?'title':'name'
   const {error:saveError}=await browserDb().from(table).update({[column]:draft.trim()}).eq('id',editing.id).eq(column,editing.previous).select('id').single()
   if(saveError)throw Error('Could not save. Check for a duplicate name or refresh if someone else edited this record.')
   setEditing(null);await load();setNotice('Saved. The updated organisation name is now used across the app.')
  }catch(failure){setError(failure instanceof Error?failure.message:'Could not save.')}
  finally{setBusy(false)}
 }
 async function add(kind:'sub'|'org'|'designation'){
  if(busy)return
  setBusy(true);setError('');setNotice('')
  try{
   const db=browserDb()
   if(kind==='org'){
    if(!newOrgId.trim()||!newOrgName.trim())throw Error('Enter a Department ID and Department name.')
    const result=await db.from('organisation_departments').insert({id:newOrgId.trim(),name:newOrgName.trim()})
    if(result.error)throw Error('Could not add this Department. Check that the ID and name are unique.')
    setNewOrgId('');setNewOrgName('')
   }else if(kind==='sub'){
    if(!newSubDepartment.trim()||!newSubParent)throw Error('Enter a Sub-department name and choose its Department.')
    const result=await db.from('departments').insert({name:newSubDepartment.trim(),parent_department_id:newSubParent})
    if(result.error)throw Error('Could not add this Sub-department. Check that the name is unique.')
    setNewSubDepartment('');setNewSubParent('')
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
 async function saveSubDepartmentParent(id:number,parentId:string){
  if(busy||!parentId)return
  setBusy(true);setError('');setNotice('')
  try{
   const {error:saveError}=await browserDb().from('departments').update({parent_department_id:parentId}).eq('id',id)
   if(saveError)throw Error('Could not change the Department assignment.')
   await load();setNotice('Sub-department Department assignment updated. Positions under it retain their Position IDs.')
  }catch(failure){setError(failure instanceof Error?failure.message:'Could not change the Department assignment.')}
  finally{setBusy(false)}
 }
 async function savePositionEdit(){
  if(busy||!editPositionId||!editPositionTitle.trim()||!editPositionDepartment||!editPositionDesignation)return
  setBusy(true);setError('');setNotice('')
  try{
   const {data,error:saveError}=await browserDb().rpc('update_organisation_position',{
    p_position_id:Number(editPositionId),
    p_title:editPositionTitle.trim(),
    p_department_id:Number(editPositionDepartment),
    p_designation_id:Number(editPositionDesignation),
    p_reports_to_position_id:editParentPosition?Number(editParentPosition):null,
   })
   if(saveError)throw Error(saveError.message)
   await load()
   setNotice(`Position ${data} updated. Assigned employees inherit the revised structure.`)
  }catch(failure){setError(failure instanceof Error?failure.message:'Could not update the position.')}
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
 const designationCategories=designations.filter(role=>role.department_id===null)
 const currentLegacyDesignation=designations.find(role=>String(role.id)===editPositionDesignation&&role.department_id!==null)
 const editDesignationOptions=[...designationCategories,...(currentLegacyDesignation?[currentLegacyDesignation]:[])].sort((a,b)=>a.id-b.id)
 const counts=new Map<number,number>()
 const designationByPosition=new Map(positions.map(position=>[position.id,position.designation_id]))
 for(const assignment of assignments){
  const designationId=assignment.position_id==null?null:designationByPosition.get(assignment.position_id)
  if(designationId!=null)counts.set(designationId,(counts.get(designationId)??0)+1)
 }
 function renderReportingTree(subId:number){
  const seats=positions.filter(p=>(p.department_id??-1)===subId).sort((a,b)=>a.title.localeCompare(b.title)||a.id-b.id)
  const localIds=new Set(seats.map(p=>p.id))
  const visited=new Set<number>()
  function row(pos:Position):React.ReactNode{
   if(visited.has(pos.id))return null
   visited.add(pos.id)
   const reports=seats.filter(p=>p.reports_to_position_id===pos.id)
   const manager=positions.find(p=>p.id===pos.reports_to_position_id)
   const designation=designations.find(d=>d.id===pos.designation_id)
   const staff=assignments.filter(a=>a.position_id===pos.id)
   return <li key={pos.id} style={{marginBlock:'0.55rem'}}>
    <strong>{pos.position_code} · {pos.title}</strong>{' '}
    <small>{designation?designation.id+' · '+designation.title:'Designation unassigned'} | {staff.length?staff.map(a=>a.employee_no+' · '+a.full_name).join(', '):'Vacant'}</small>
    {manager&&!localIds.has(manager.id)&&<div><small>Reports to {manager.position_code} · {manager.title} (outside this sub-department)</small></div>}
    {reports.length>0&&<ul style={{borderLeft:'2px solid #d8e0e8',paddingLeft:'1.4rem'}}>{reports.map(row)}</ul>}
   </li>
  }
  const roots=seats.filter(p=>p.reports_to_position_id===null||!localIds.has(p.reports_to_position_id))
  const rows=roots.map(row)
  const unresolved=seats.filter(p=>!visited.has(p.id))
  return <><ul>{rows}</ul>{unresolved.length>0&&<><p>Reporting chain needs review</p><ul>{unresolved.map(row)}</ul></>}</>
 }
 return <main className="shell">
  <header><div><div className="eyebrow">BANDANA / HR ADMINISTRATION</div><h1>Positions, Departments, Sub-departments &amp; Designations</h1></div>
   <nav className="head-actions"><a href="/employees">Employee Directory</a><a href="/reports">Reports</a></nav></header>
  {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
  <details className="panel"><summary><strong>Organisation chart</strong></summary>
   {organisationDepartments.concat([{id:'',name:'Unassigned department'}]).map(org=>{
    const subs=subDepartments.filter(s=>(s.parent_department_id??'')===org.id)
    if(!org.id&&positions.some(p=>p.department_id===null))subs.push({id:-1,name:'Unassigned sub-department',parent_department_id:null})
    if(!org.id&&!subs.length)return null
    return <details key={org.id} className="panel"><summary>{org.id} {org.name}</summary>
     {subs.length===0&&<p>No sub-departments assigned.</p>}
     {subs.map(sub=><section key={sub.id}><h3>{sub.id>0?'DP'+sub.id+' · ':''}{sub.name}</h3>
      {renderReportingTree(sub.id)}
      {!positions.some(p=>(p.department_id??-1)===sub.id)&&<p>No positions assigned.</p>}
     </section>)}</details>
   })}
   {assignments.some(a=>a.position_id===null)&&<details><summary>Employees without a position</summary>{assignments.filter(a=>a.position_id===null).map(a=><div key={a.employee_no}>{a.employee_no} · {a.full_name}</div>)}</details>}
  </details>
  <section className="panel"><h2>Add New Position</h2>
   <form className="bar" onSubmit={event=>{event.preventDefault();void addPosition()}}>
    <label>Sub-department<SearchableSelect required value={positionDepartment} disabled={busy} onChange={event=>setPositionDepartment(event.target.value)}>
     <option value="">Select sub-department</option>{subDepartments.map(sub=><option key={sub.id} value={sub.id}>{sub.name} · {organisationDepartments.find(org=>org.id===sub.parent_department_id)?.name??'No Department'}</option>)}</SearchableSelect></label>
    <label>Designation<SearchableSelect required value={positionDesignation} disabled={busy} onChange={event=>{const designation=designations.find(item=>String(item.id)===event.target.value);setPositionDesignation(event.target.value);if(designation&&!positionTitle.trim())setPositionTitle(designation.title)}}>
     <option value="">Select designation</option>{designationCategories.map(role=><option key={role.id} value={role.id}>{role.title}</option>)}</SearchableSelect></label>
    <label>Position Title<input required value={positionTitle} disabled={busy} onChange={event=>setPositionTitle(event.target.value)}/></label>
    <label>Reports To<SearchableSelect required value={parentPosition} disabled={busy} onChange={event=>setParentPosition(event.target.value)}><option value="">Select reporting position</option>{positions.map(position=><option key={position.id} value={position.id}>{[position.position_code??position.id,position.title,position.location].filter(Boolean).join(' · ')}</option>)}</SearchableSelect></label>
    <button disabled={busy||!positionTitle.trim()||!positionDepartment||!positionDesignation||!parentPosition}>Add Position</button>
   </form><p className="muted">Selecting a Sub-department automatically assigns its mapped Department.</p>
  </section>
  <section className="panel"><h2>Edit Existing Position</h2>
   <form className="bar" onSubmit={event=>{event.preventDefault();void savePositionEdit()}}>
    <label>Position<SearchableSelect required value={editPositionId} disabled={busy} onChange={event=>{const value=event.target.value;setEditPositionId(value);const position=positions.find(item=>String(item.id)===value);if(position){setEditPositionTitle(position.title);setEditPositionDepartment(position.department_id==null?'':String(position.department_id));setEditPositionDesignation(position.designation_id==null?'':String(position.designation_id));setEditParentPosition(position.reports_to_position_id==null?'':String(position.reports_to_position_id))}}}><option value="">Select position</option>{positions.map(position=><option key={position.id} value={position.id}>{[position.position_code??position.id,position.title].filter(Boolean).join(' · ')}</option>)}</SearchableSelect></label>
    <label>Sub-department<SearchableSelect required value={editPositionDepartment} disabled={busy} onChange={event=>setEditPositionDepartment(event.target.value)}><option value="">Select sub-department</option>{subDepartments.map(sub=><option key={sub.id} value={sub.id}>{sub.name} · {organisationDepartments.find(org=>org.id===sub.parent_department_id)?.name??'No Department'}</option>)}</SearchableSelect></label>
    <label>Designation<SearchableSelect required value={editPositionDesignation} disabled={busy} onChange={event=>setEditPositionDesignation(event.target.value)}><option value="">Select designation</option>{editDesignationOptions.map(role=><option key={role.id} value={role.id} disabled={role.department_id!==null}>{role.id} · {role.title}{role.department_id!==null?" (existing legacy assignment)":""}</option>)}</SearchableSelect></label>
    <label>Position Title<input required value={editPositionTitle} disabled={busy} onChange={event=>setEditPositionTitle(event.target.value)}/></label>
    <label>Reports To<SearchableSelect value={editParentPosition} disabled={busy} onChange={event=>setEditParentPosition(event.target.value)}><option value="">No parent position</option>{positions.filter(position=>String(position.id)!==editPositionId).map(position=><option key={position.id} value={position.id}>{[position.position_code??position.id,position.title,position.location].filter(Boolean).join(' · ')}</option>)}</SearchableSelect></label>
    <button disabled={busy||!editPositionId||!editPositionTitle.trim()||!editPositionDepartment||!editPositionDesignation}>Save Position</button>
   </form><p className="muted">Changing a Position updates its Sub-department, mapped Department, Designation and reporting line for every employee assigned to that Position. The Position ID remains unchanged.</p>
  </section>
  <section className="panel"><h2>Departments</h2>
   <div className="bar"><label>New Department ID<input placeholder="DPT 109" value={newOrgId} disabled={busy} onChange={event=>setNewOrgId(event.target.value)}/></label><label>New Department<input value={newOrgName} disabled={busy} onChange={event=>setNewOrgName(event.target.value)}/></label><button disabled={busy||!newOrgId.trim()||!newOrgName.trim()} onClick={()=>void add('org')}>Add Department</button></div>
   <div className="tablewrap"><table><thead><tr><th>Department ID</th><th>Department</th><th>Sub-departments</th><th>Actions</th></tr></thead><tbody>{organisationDepartments.map(org=><tr key={org.id}><td>{org.id}</td><td>{org.name}</td><td>{subDepartments.filter(sub=>sub.parent_department_id===org.id).length}</td><td><button className="link" disabled={busy} onClick={()=>{setEditing({kind:'org',id:org.id,previous:org.name});setDraft(org.name)}}>Rename</button></td></tr>)}</tbody></table></div>
  </section>
  <section className="panel"><h2>Sub-departments</h2>
   <div className="bar"><label>New Sub-department<input value={newSubDepartment} disabled={busy} onChange={event=>setNewSubDepartment(event.target.value)}/></label><label>Department<SearchableSelect required value={newSubParent} disabled={busy} onChange={event=>setNewSubParent(event.target.value)}><option value="">Select Department</option>{organisationDepartments.map(org=><option key={org.id} value={org.id}>{org.id} · {org.name}</option>)}</SearchableSelect></label><button disabled={busy||!newSubDepartment.trim()||!newSubParent} onClick={()=>void add('sub')}>Add Sub-department</button></div>
   <div className="tablewrap"><table><thead><tr><th>Sub-department ID</th><th>Sub-department</th><th>Department</th><th>Positions</th><th>Actions</th></tr></thead><tbody>{subDepartments.map(sub=><tr key={sub.id}><td>{sub.id}</td><td>{sub.name}</td><td><SearchableSelect aria-label={'Department for '+sub.name} value={sub.parent_department_id??''} disabled={busy} onChange={event=>void saveSubDepartmentParent(sub.id,event.target.value)}><option value="">Select Department</option>{organisationDepartments.map(org=><option key={org.id} value={org.id}>{org.id} · {org.name}</option>)}</SearchableSelect></td><td>{positions.filter(position=>position.department_id===sub.id).length}</td><td><button className="link" disabled={busy} onClick={()=>{setEditing({kind:'sub',id:sub.id,previous:sub.name});setDraft(sub.name)}}>Rename</button></td></tr>)}</tbody></table></div>
  </section>
  <section className="panel"><h2>Designations</h2><div className="bar"><label>New Designation<input value={newTitle} disabled={busy} onChange={event=>setNewTitle(event.target.value)}/></label><button disabled={busy||!newTitle.trim()} onClick={()=>void add('designation')}>Add Designation</button></div>
   <div className="tablewrap"><table><thead><tr><th>Designation ID</th><th>Designation</th><th>Active Employees</th><th>Actions</th></tr></thead><tbody>{designationCategories.map(role=><tr key={role.id}><td>{role.id}</td><td>{role.title}</td><td>{counts.get(role.id)??0}</td><td><button className="link" disabled={busy} onClick={()=>{setEditing({kind:'designation',id:role.id,previous:role.title});setDraft(role.title)}}>Rename</button></td></tr>)}</tbody></table></div>
  </section>
  {editing&&<div className="overlay"><section className="dialog" role="dialog" aria-modal="true" aria-label="Rename shared record"><h2>Rename {editing.kind==='org'?'Department':editing.kind==='sub'?'Sub-department':'Designation'}</h2><p>Save to update this name in the organisation register.</p><label>Name<input autoFocus value={draft} disabled={busy} onChange={event=>setDraft(event.target.value)}/></label><div className="bar"><button disabled={busy||!draft.trim()} onClick={()=>void saveChange()}>{busy?'Saving…':'Save Name'}</button><button className="secondary" disabled={busy} onClick={()=>setEditing(null)}>Cancel</button></div></section></div>}
 </main>
}
