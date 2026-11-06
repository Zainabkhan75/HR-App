import {NextResponse} from 'next/server'
import {createHash} from 'node:crypto'
import {sameOriginRequest} from '../../../../lib/signin-server'
import {serviceDb,signPreview,uploadContext,verifyPreview} from '../../../../lib/bulk-upload-server'
import {readMonthlyPayroll} from '../../../../lib/monthly-payroll'

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
  const rows=await readMonthlyPayroll(bytes,month)
  const admin=serviceDb()
  const {data:published,error:periodError}=await admin.from('monthly_payroll').select('payroll_month').eq('payroll_month',month+'-01').limit(1)
  if(periodError)throw Error('Monthly payroll storage is unavailable.')
  if(published.length)return json({error:'This payroll month is already published.'},409)
  const roster=new Map<string,{id:string;full_name:string;updated_at:string}>()
  for(let i=0;i<rows.length;i+=200){
   const {data,error}=await ctx.db.from('employees').select('id,employee_no,full_name,updated_at').in('employee_no',rows.slice(i,i+200).map(row=>row.employeeNo))
   if(error)throw Error('Employee records could not be checked.')
   for(const employee of data)roster.set(employee.employee_no,employee)
  }
  const unknown=rows.filter(row=>!roster.has(row.employeeNo))
  if(unknown.length)throw Error('Unknown employee IDs: '+unknown.map(row=>row.employeeNo).join(', '))
  const hash=createHash('sha256').update('monthly-payroll:'+ctx.user.id+':'+month+':').update(bytes).update(JSON.stringify(rows.map(row=>roster.get(row.employeeNo)))).digest('hex')
  if(action==='preview'){
   return json({month,token:signPreview({hash,expires:Date.now()+30*60*1000,timestamps:[]}),netCents:rows.reduce((sum,row)=>sum+row.netCents,0),
    rows:rows.map(row=>({employeeNo:row.employeeNo,name:roster.get(row.employeeNo)!.full_name,sourceName:row.sourceName,netCents:row.netCents}))})
  }
  verifyPreview(String(form.get('token')??''),hash)
  const {data,error}=await admin.rpc('publish_monthly_payroll',{
   p_month:month+'-01',p_actor:ctx.user.id,
   p_rows:rows.map(row=>({employee_id:roster.get(row.employeeNo)!.id,fields:row.fields})),
  })
  if(error)return json({error:'Payroll could not be published. Check whether the month is already published, then refresh the preview.'},409)
  return json({published:data,month})
 }catch(error){return json({error:error instanceof Error?error.message:'Payroll upload failed.'},400)}
}
