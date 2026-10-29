import {NextResponse} from 'next/server'
import {sameOriginRequest} from '../../../../lib/signin-server'
import {fieldsFor,fileHash,parseWorkbook,planUpload} from '../../../../lib/bulk-upload'
import {readSnapshot,serviceDb,signPreview,uploadContext,verifyPreview} from '../../../../lib/bulk-upload-server'

export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'}
const json=(body:object,status=200)=>NextResponse.json(body,{status,headers})
export async function POST(request:Request){
 if(!sameOriginRequest(request))return json({error:'Request not allowed'},403)
 const ctx=await uploadContext()
 if(ctx.status!==200)return json({error:ctx.status===401?'Sign in required':'HR administrator access required'},ctx.status)
 try{
  const form=await request.formData(),file=form.get('file'),action=form.get('action')
  if(!(file instanceof File)||!['preview','apply'].includes(String(action)))return json({error:'Choose an Excel file and action'},400)
  if(file.size>4_000_000)return json({error:'File exceeds 4 MB'},413)
  const bytes=Buffer.from(await file.arrayBuffer()),hash=fileHash(bytes),snapshot=await readSnapshot(ctx.db),fields=fieldsFor(snapshot)
  const rows=await parseWorkbook(bytes,fields),planned=planUpload(rows,snapshot,fields)
  if(action==='preview'){
   const token=signPreview({hash,expires:Date.now()+30*60*1000,timestamps:planned.map(r=>({reference:r.reference,action:r.action,employeeNo:r.employeeNo,core:r.expectedCoreUpdatedAt,details:r.expectedDetailsUpdatedAt,family:r.expectedFamilyUpdatedAt}))})
   return json({rows:planned,token,totals:{employees:planned.length,fill:planned.reduce((n,r)=>n+r.fill,0),replace:planned.reduce((n,r)=>n+r.overwrite,0),skipped:planned.reduce((n,r)=>n+r.skipped,0)}})
  }
  const token=form.get('token');if(typeof token!=='string')return json({error:'Preview required'},400)
  const signed=verifyPreview(token,hash),byId=new Map(signed.timestamps.map(t=>[t.reference||t.employeeNo,t]))
  if(byId.size!==planned.length||planned.some(r=>{const t=byId.get(r.reference);return !t||(t.action||'UPDATE')!==r.action||t.core!==r.expectedCoreUpdatedAt||t.details!==r.expectedDetailsUpdatedAt||t.family!==r.expectedFamilyUpdatedAt}))return json({error:'Employee data changed since preview. Preview the upload again'},409)
  const changes=planned.filter(r=>r.action==='NEW'||r.fill+r.overwrite>0)
  if(!changes.length)return json({applied:0,fields:0})
  const payload=changes.map(r=>({action:r.action,reference:r.reference,employee_no:r.employeeNo,expected_core_updated_at:r.expectedCoreUpdatedAt,expected_details_updated_at:r.expectedDetailsUpdatedAt,expected_family_updated_at:r.expectedFamilyUpdatedAt,replace:r.replace,core:r.core,profile:r.profile,payroll:r.payroll,family:r.family}))
  const {data,error}=await serviceDb().rpc('apply_employee_bulk_upload_v2',{p_rows:payload,p_actor:ctx.user.id,p_file_hash:hash})
  if(error) return json({error:'Upload was not applied. Employee data may have changed; preview again.',detail:error.message},409)
  return json({applied:changes.length,fields:data?.fields??changes.reduce((n,r)=>n+r.fill+r.overwrite,0),created:data?.created??[],newEmployees:data?.created?.length??0})
 }catch(error){return json({error:error instanceof Error?error.message:'Upload failed'},400)}
}
