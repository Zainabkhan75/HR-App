export const EMAIL_FROM='Bandana HR <hr@bandana.seidohr.com>'
export const LOGIN_URL='https://hr-app-five-psi.vercel.app/login'
export type EmailEmployee={id:string;employee_no:string;full_name:string;department:string|null;employment_state:string}
export type EmailDetail={employee_id:string;profile:Record<string,unknown>|null}
export const MAX_ATTACHMENT_BYTES=2*1024*1024
export type Attachment={filename:string;content:string}
export type Recipient={id:string;employee_no:string;name:string;department:string;email:string|null;source:string;reason:string;test?:boolean;attachment?:Attachment;attachmentName?:string}
const clean=(v:unknown)=>typeof v==='string'?v.trim().toLowerCase():''
const valid=(v:string)=>v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
export function emailRecipients(employees:EmailEmployee[],details:EmailDetail[]):Recipient[]{
 const profiles=new Map(details.map(d=>[d.employee_id,d.profile??{}])),owners=new Map<string,Set<string>>()
 for(const e of employees)for(const k of ['email','personal_email']){const v=clean(profiles.get(e.id)?.[k]);if(valid(v)){if(!owners.has(v))owners.set(v,new Set());owners.get(v)!.add(e.id)}}
 return employees.map(e=>{const p=profiles.get(e.id)??{},work=clean(p.email),personal=clean(p.personal_email)
 const email=e.employment_state==='active'?[work,personal].find(v=>valid(v)&&owners.get(v)?.size===1)??null:null
 return{id:e.id,employee_no:e.employee_no,name:e.full_name,department:e.department??'',email,source:email?(email===work?'Work email':'Personal email'):'',reason:email?'':e.employment_state!=='active'?'Inactive employee':'Missing, invalid or shared email'}
 })
}
export function validateMessage(subject:unknown,body:unknown):{subject:string;body:string}{
 if(typeof subject!=='string'||!subject.trim()||subject.length>200||/[\r\n]/.test(subject))throw Error('Enter a subject of up to 200 characters on one line')
 if(typeof body!=='string'||!body.trim()||body.length>20000)throw Error('Enter a message of up to 20,000 characters')
 const unknown=body.match(/{{[^{}]+}}/g)?.filter(v=>!['{{name}}','{{employee_id}}','{{login_url}}'].includes(v))
 if(unknown?.length)throw Error('Supported placeholders: {{name}}, {{employee_id}}, {{login_url}}')
 return{subject:subject.trim(),body:body.trim()}
}
export function emailPayload(c:{subject:string;body:string;reply_to:string;recipients:Recipient[]}){
 return c.recipients.map(r=>({from:EMAIL_FROM,to:[r.email!],reply_to:c.reply_to,subject:c.subject,
 text:c.body.replace(/{{name}}/g,()=>r.name).replace(/{{employee_id}}/g,()=>r.employee_no).replace(/{{login_url}}/g,()=>LOGIN_URL),...(r.attachment?{attachments:[r.attachment]}:{})}))
}
export async function sendEmailBatch(c:{id:string;subject:string;body:string;reply_to:string;recipients:Recipient[]},key:string,fetcher:typeof fetch=fetch){
 if(!key.trim())throw Error('Add RESEND_API_KEY in Vercel before sending')
 if(c.recipients.length<1||c.recipients.length>100||c.recipients.some(r=>!r.email||!valid(r.email)))throw Error('Select 1 to 100 valid recipients')
 const attached=c.recipients.some(r=>r.attachment)
 if(attached&&c.recipients.length!==1)throw Error('Select one recipient when attaching a file')
 const payload=emailPayload(c)
 const response=await fetcher(attached?'https://api.resend.com/emails':'https://api.resend.com/emails/batch',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key,'Idempotency-Key':'bandana-email/'+c.id},body:JSON.stringify(attached?payload[0]:payload),signal:AbortSignal.timeout(20000)})
 const result=await response.json()
 if(!response.ok)return{status:response.status>=500?'uncertain':'failed',result:null,error:typeof result.message==='string'?result.message:'Resend rejected the request'}
 const accepted=attached?[result]:result.data
 if(!Array.isArray(accepted)||accepted.length!==c.recipients.length||accepted.some((r:{id?:string})=>typeof r?.id!=='string'))return{status:'uncertain',result:null,error:'Resend response could not be confirmed. Check before retrying.'}
 return{status:'accepted',result:accepted,error:null}
}
