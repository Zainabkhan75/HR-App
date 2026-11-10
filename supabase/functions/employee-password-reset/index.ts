import {createClient} from 'npm:@supabase/supabase-js@2.49.0';
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 let input;try{input=await req.json()}catch{return new Response('Invalid input',{status:400})}
 if(!/^[0-9a-f-]{36}$/i.test(input.job??'')||typeof input.token!=='string'||input.token.length!==64)return new Response('Unauthorised',{status:401});
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:job,error}=await db.rpc('claim_employee_import',{p_job:input.job,p_token:input.token});
 if(error||!job||!Array.isArray(job.rows)||job.rows.length>100||job.rows.some((r:any)=>r.action!=='reset_first_name_cnic_4'))return new Response('Job unavailable',{status:403});
 const actor=job.rows[0]?.actor_id;
 const {data:role,error:roleError}=await db.from('user_roles').select('role').eq('user_id',actor).eq('role','hr_admin').maybeSingle();
 if(roleError||!role)return new Response('Actor unavailable',{status:403});
 const results:any[]=[];
 for(let i=0;i<job.rows.length;i+=5)await Promise.all(job.rows.slice(i,i+5).map(async(row:any)=>{
  try{
   const {data:e,error:ee}=await db.from('employees').select('id,employee_no,full_name').eq('id',row.employee_id).single();
   const {data:a,error:ae}=await db.from('employee_accounts').select('user_id,login_email').eq('employee_id',row.employee_id).single();
   if(ee||ae||!e||!a||a.user_id!==row.user_id||e.employee_no!==row.employee_no||e.full_name!==row.full_name)throw Error('Employee changed since approval');
   const password = 'Pakistan1234';
   const {data:auth,error:authError}=await db.auth.admin.getUserById(a.user_id);
   if(authError||!auth.user||auth.user.email?.toLowerCase()!==a.login_email.toLowerCase())throw Error('Identity mismatch');
   const {error:flag}=await db.from('employee_accounts').update({must_change_password:true}).eq('employee_id',e.id).eq('user_id',a.user_id).select('employee_id').single();if(flag)throw Error('Password change flag failed');
   const {error:reset}=await db.auth.admin.updateUserById(a.user_id,{password});if(reset)throw Error('Password reset failed: '+reset.message);
   const {error:audit}=await db.from('employee_action_audit').insert({employee_id:e.id,employee_no:e.employee_no,action:'admin_password_generated',actor_id:actor,reason:'HR administrator reset the temporary password',record_snapshot:{password_rule:'shared_temporary_password'}});
   results.push({employee_no:e.employee_no,status:'reset',audit_logged:!audit});
  }catch(e){results.push({employee_no:row.employee_no,status:'failed',reason:e instanceof Error?e.message:'Unknown error'})}
 }));
 await db.rpc('finish_employee_login',{p_job:input.job,p_actor:actor});
 return Response.json({results:results.sort((a,b)=>a.employee_no.localeCompare(b.employee_no))});
});