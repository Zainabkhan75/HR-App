import {NextResponse} from 'next/server'
import {createHash} from 'node:crypto'
import {sameOriginRequest} from '../../../../lib/signin-server'
import {serviceDb,signPreview,uploadContext,verifyPreview} from '../../../../lib/bulk-upload-server'
import {payrollName,readPayrollCycle} from '../../../../lib/monthly-payroll'

const json=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
export async function POST(request:Request){
 if(!sameOriginRequest(request))return json({error:'Request not allowed'},403)
 const ctx=await uploadContext()
 if(ctx.status!==200)return json({error:'HR administrator access required'},ctx.status)
 try{
  const form=await request.formData()
  const file=form.get('file'),month=String(form.get('month')),action=form.get('action')
  if(!(file instanceof File)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||month<'2026-10'||(action!=='preview'&&action!=='publish'))return json({error:'Choose a payroll month and an Excel file.'},400)
  if(file.size>4_000_000)return json({error:'File exceeds 4 MB'},413)
  const bytes=Buffer.from(await file.arrayBuffer())
  const {rows,changes,approvedNew,aliases}=await readPayrollCycle(bytes,month)
  const admin=serviceDb()
  const {data:published,error:periodError}=await admin.from('monthly_payroll').select('employee_id,fields').eq('payroll_month',month+'-01').limit(2001)
  if(periodError)throw Error('Monthly payroll storage is unavailable.')
  const roster=new Map<string,{id:string;full_name:string;updated_at:string;employment_state:string;leaving_date:string|null}>()
  for(let offset=0;;offset+=500){
   const {data,error}=await ctx.db.from('employees').select('id,employee_no,full_name,updated_at,employment_state,leaving_date').order('employee_no').range(offset,offset+499)
   if(error||!data)throw Error('Employee records could not be checked.')
   for(const employee of data)roster.set(employee.employee_no,employee)
   if(data.length<500)break
  }
  const newEmployees=new Map<string,{name:string;designation:string}>()
  function resolve(id:string,name:string){
   const key=payrollName(name),alias=aliases.get(key)
   if(id&&alias&&id!==alias)throw Error('Conflicting confirmed IDs for '+name)
   if(id||alias){
    const number=id||alias!
    if(!roster.has(number))throw Error('Unknown employee ID '+number+' for '+name)
    return number
   }
   const approved=approvedNew.get(key)
   if(!approved)throw Error('Employee ID is required for '+name)
   const matches=[...roster].filter(([,employee])=>payrollName(employee.full_name)===key)
   if(matches.length>1)throw Error('More than one employee matches '+name)
   if(matches.length===1)return matches[0][0]
   if(!approved.designation)throw Error('A role is required to create '+name)
   const reference='new:'+key
   newEmployees.set(reference,approved)
   return reference
  }
  const payroll=rows.map(row=>({...row,reference:resolve(row.employeeNo,row.sourceName)}))
  if(new Set(payroll.map(row=>row.reference)).size!==payroll.length)throw Error('Multiple payroll rows match the same employee.')
  const names=new Map(payroll.map(row=>[payrollName(row.sourceName),row.reference]))
  const resolved=changes.map(change=>{
   const reference=change.employeeNo||aliases.has(payrollName(change.name))?resolve(change.employeeNo,change.name):
    names.get(payrollName(change.name))??resolve('',change.name)
   const employee=roster.get(reference)
   if(employee&&payrollName(employee.full_name)!==payrollName(change.name)&&aliases.get(payrollName(change.name))!==reference){
    throw Error('Name and employee ID disagree on Review row '+change.row)
   }
   return {...change,reference}
  })
  const changeKeys=new Set<string>()
  const payrollByReference=new Map(payroll.map(row=>[row.reference,row]))
  for(const change of resolved){
   const key=change.reference+'|'+change.field
   if(changeKeys.has(key))throw Error('Duplicate field decision on Review row '+change.row)
   changeKeys.add(key)
   if(change.field==='new_card'){
    const row=payrollByReference.get(change.reference)
    if(row)row.fields.new_card=change.value
   }
  }
  const referenced=[...new Set([...payroll,...resolved].map(row=>row.reference))].sort()
  const employees=referenced.flatMap(reference=>{
   const employee=roster.get(reference)
   return employee?[{reference,id:employee.id,updated_at:employee.updated_at}]:[]
  })
  const creates=[...newEmployees].map(([reference,employee])=>({reference,...employee}))
  if(published.length){
   const normalize=(fields:Record<string,string>)=>JSON.stringify(Object.entries(fields).filter(([key])=>key!=='new_card').sort(([a],[b])=>a.localeCompare(b)))
   const existing=new Map(published.map(row=>[row.employee_id,normalize(row.fields)]))
   if(payroll.length!==published.length||payroll.some(row=>existing.get(roster.get(row.reference)?.id??'')!==normalize(row.fields))){
    return json({error:'This month is already published and the workbook pay figures differ. Use the workbook that matches the published payroll to apply Review decisions.'},409)
   }
  }
  const hash=createHash('sha256').update('payroll-cycle:'+ctx.user.id+':'+month+':').update(bytes).update(JSON.stringify(employees)).digest('hex')
  if(action==='preview'){
   return json({month,token:signPreview({hash,expires:Date.now()+30*60*1000,timestamps:[]}),netCents:rows.reduce((sum,row)=>sum+row.netCents,0),
    changes:resolved,creates,alreadyPublished:published.length>0,
    rows:payroll.map(row=>({employeeNo:row.reference,name:roster.get(row.reference)?.full_name??row.sourceName,sourceName:row.sourceName,netCents:row.netCents}))})
  }
  verifyPreview(String(form.get('token')??''),hash)
  const {data,error}=await admin.rpc('apply_payroll_cycle',{
   p_month:month+'-01',p_actor:ctx.user.id,
   p_employees:employees,p_new:creates,p_changes:resolved,
   p_rows:payroll.map(row=>({reference:row.reference,fields:row.fields})),
  })
  if(error)return json({error:'Payroll cycle could not be applied. Preview again and contact HR support if the problem continues.'},409)
  return json({published:data.published,changed:data.changed,created:data.created,month})
 }catch(error){return json({error:error instanceof Error?error.message:'Payroll upload failed.'},400)}
}
