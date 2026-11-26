import type {ReportTable,ReportRow} from './admin-reports'
type Row=Record<string,unknown>
export type OrganisationSources={employees:Row[];positions:Row[];subDepartments:Row[];departments:Row[];designations:Row[];details:Row[];managerLinks?:Row[]}
const s=(v:unknown)=>v==null?'':String(v)
export function buildOrganisationReport(source:OrganisationSources):ReportTable{
 const positions=new Map(source.positions.map(p=>[s(p.id),p])),subs=new Map(source.subDepartments.map(p=>[s(p.id),p])),depts=new Map(source.departments.map(p=>[s(p.id),p])),roles=new Map(source.designations.map(p=>[s(p.id),p]))
 const active=source.employees.filter(e=>e.employment_state==='active'),rows:ReportRow[]=[]
 const occupants=(id:unknown)=>active.filter(e=>s(e.position_id)===s(id))
 function emit(issue:string,e?:Row,p?:Row,sub?:Row,detail=''){
  sub=sub??subs.get(s(p?.department_id));const dept=depts.get(s(sub?.parent_department_id))
  rows.push({'Issue':issue,'Employee ID':s(e?.employee_no),'Full Name':s(e?.full_name),'Employment Status':s(e?.employment_state),'Position ID':s(p?.position_code||p?.id),'Position Title':s(p?.position_title),'Department ID':s(dept?.id),'Department':s(dept?.name),'Sub-department ID':s(sub?.id),'Sub-department':s(sub?.name),'Designation ID':s(p?.designation_id),'Designation':s(roles.get(s(p?.designation_id))?.title),'Parent Position ID':s(positions.get(s(p?.reports_to_position_id))?.position_code||p?.reports_to_position_id),'Details':detail})
 }
 for(const e of active){
  const p=positions.get(s(e.position_id))
  if(!p)emit('Employee without valid position',e,undefined,undefined,s(e.position_id)?'Position reference does not exist':'Assign a Position ID')
  if(!p&&(e.designation||e.department))emit('Legacy text-only assignment',e,undefined,undefined,'Legacy title or department exists without a valid position')
  const d=source.details.find(d=>d.employee_id===e.id),profile=d?.profile as Row|undefined
  const legacyManagers=[...(profile?.line_manager_employee_no?[s(profile.line_manager_employee_no)]:[]),...(source.managerLinks??[]).filter(l=>l.member_employee_id===e.id).map(l=>s(source.employees.find(m=>m.id===l.manager_employee_id)?.employee_no)||'unknown')];
  if(legacyManagers.length&&p){
   let parent=positions.get(s(p.reports_to_position_id));const seen=new Set([s(p.id)]);let managers:Row[]=[]
   while(parent&&!seen.has(s(parent.id))){seen.add(s(parent.id));managers=occupants(parent.id);if(managers.length)break;parent=positions.get(s(parent.reports_to_position_id))}
   if(legacyManagers.some(number=>!managers.some(m=>s(m.employee_no)===number)))emit('Legacy manager conflicts with hierarchy',e,p,undefined,'Stored manager '+legacyManagers.join(', ')+'; hierarchy manager(s): '+(managers.map(m=>s(m.employee_no)).join(', ')||'none'))
  }
 }
 for(const p of source.positions){
  if(!subs.has(s(p.department_id)))emit('Position without valid sub-department',undefined,p)
  if(!roles.has(s(p.designation_id)))emit('Position without valid designation',undefined,p)
  if(!p.is_reporting_root&&!positions.has(s(p.reports_to_position_id)))emit('Position without valid reporting parent',undefined,p)
  if(p.is_reporting_root&&p.reports_to_position_id)emit('Reporting root has parent',undefined,p)
  const seen=new Set([s(p.id)]);let parent=positions.get(s(p.reports_to_position_id)),depth=0,found=false
  while(parent){if(seen.has(s(parent.id))){emit('Circular reporting chain',undefined,p);break}seen.add(s(parent.id));depth++;if(occupants(parent.id).length){found=true;break}parent=positions.get(s(parent.reports_to_position_id))}
  if(depth&&!found)emit('No occupied manager in reporting chain',undefined,p)
  if(found&&depth>1)emit('Vacant parent: fallback required',undefined,p,undefined,'Nearest occupied ancestor is '+depth+' levels above')
 }
 for(const sub of source.subDepartments)if(!depts.has(s(sub.parent_department_id)))emit('Sub-department without valid department',undefined,undefined,sub)
 for(const [label,items,key] of [['Employee name',active,'full_name'],['Position title',source.positions,'position_title'],['Department name',source.departments,'name'],['Sub-department name',source.subDepartments,'name']] as const){
  const groups=new Map<string,Row[]>();for(const item of items){const name=s(item[key]).trim().toLowerCase();if(name)groups.set(name,[...(groups.get(name)||[]),item])}
  for(const group of groups.values())if(group.length>1)for(const item of group)emit('Duplicate '+label,label==='Employee name'?item:undefined,label==='Position title'?item:undefined,label==='Sub-department name'?item:undefined,s(item[key])+' — review; duplicates may be intentional')
 }
 return{columns:['Issue','Employee ID','Full Name','Employment Status','Department ID','Department','Sub-department ID','Sub-department','Position ID','Position Title','Designation ID','Designation','Parent Position ID','Details'],rows}
}
