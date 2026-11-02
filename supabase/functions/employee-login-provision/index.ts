import {createClient} from 'npm:@supabase/supabase-js@2.49.0';
Deno.serve(async(req:Request)=>{
if(req.method!=='POST')return new Response('Method not allowed',{status:405});
let input;try{input=await req.json()}catch{return new Response('Invalid input',{status:400})}
if(!/^[0-9a-f-]{36}$/i.test(input.job??'')||typeof input.token!=='string'||input.token.length<40||input.token.length>200)return new Response('Unauthorised',{status:401});
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{autoRefreshToken:false,persistSession:false}});
const {data:job,error:claim}=await db.rpc('claim_employee_import',{p_job:input.job,p_token:input.token});
if(claim||!job||!Array.isArray(job.rows)||job.rows.length>60)return new Response('Job unavailable',{status:403});
const results=[];
for(const row of job.rows){
let uid:string|null=null,created=false;
try{
const {data:e,error:ee}=await db.from('employees').select('id,employee_no,full_name,updated_at').eq('id',row.employee_id).single();
const {data:d,error:de}=await db.from('employee_details').select('profile,updated_at').eq('employee_id',row.employee_id).single();
if(ee||de||!e||!d||e.updated_at!==row.expected_updated_at||d.updated_at!==row.expected_profile_updated_at)throw Error('Employee changed since review');
const {data:links,error:le}=await db.from('employee_accounts').select('employee_id').eq('employee_id',row.employee_id);
if(le||links?.length)throw Error('Account already linked or unreadable');
const cnic=String(d.profile.cnic_passport??'').replace(/[-\s]/g,'');
const first=String(e.full_name).trim().split(/\s+/)[0];
const password=/^\d{13}$/.test(cnic)&&first.length+4>=6?first+cnic.slice(-4):'Pakistan1234';
const attrs={password,email_confirm:true,app_metadata:{employee_provision_job:input.job},user_metadata:{full_name:e.full_name}};
if(row.existing_user_id){
const {data:existing,error:ue}=await db.auth.admin.getUserById(row.existing_user_id);
const {data:roles,error:re}=await db.from('user_roles').select('role').eq('user_id',row.existing_user_id);
if(ue||re||!existing.user||existing.user.email?.toLowerCase()!==row.login_email||roles?.length)throw Error('Existing identity not eligible');
const {data,error}=await db.auth.admin.updateUserById(row.existing_user_id,attrs);
if(error||!data.user)throw Error('Auth reset failed: '+(error?.code??'unknown'));uid=data.user.id;
}else{
const {data,error}=await db.auth.admin.createUser({email:row.login_email,...attrs});
if(error||!data.user)throw Error('Auth create failed: '+(error?.code??'unknown'));uid=data.user.id;created=true;
}
const {data,error}=await db.rpc('commit_employee_provision',{p_job:input.job,p_employee:row.employee_id,p_user:uid});
if(error)throw Error('Account link failed: '+error.message);
results.push({employee_no:data,status:created?'created':'password_reset_and_relinked',login_email:row.login_email});
}catch(error){
let cleanup='not_needed';
if(uid){const {data:linked,error:ce}=await db.from('employee_accounts').select('employee_id').eq('user_id',uid).maybeSingle();
if(!ce&&linked){results.push({employee_no:row.employee_no,status:'linked_after_recheck',login_email:row.login_email});continue;}
if(!ce&&created){const {error:del}=await db.auth.admin.deleteUser(uid);cleanup=del?'manual_review':'new_unlinked_user_removed';}else cleanup='manual_review';}
results.push({employee_no:row.employee_no,status:'failed',reason:error instanceof Error?error.message:'Unknown error',cleanup});
}
}
return Response.json({results});
});