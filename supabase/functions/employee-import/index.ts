import {createClient} from 'npm:@supabase/supabase-js@2.49.0';
// No broad admin token is accepted or returned. Each operation requires a
// high-entropy, short-lived, single-use token for a pre-reviewed database job.
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 let input:{job?:string;token?:string};
 try{input=await req.json()}catch{return new Response('Invalid input',{status:400})}
 if(!/^[0-9a-f-]{36}$/i.test(input.job??'')||!input.token||input.token.length<40||input.token.length>200)return new Response('Unauthorised',{status:401});
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{autoRefreshToken:false,persistSession:false}});
 const {data:job,error:claimError}=await db.rpc('claim_employee_import',{p_job:input.job,p_token:input.token});
 if(claimError||!job)return new Response('Import job unavailable',{status:403});
 if(!Array.isArray(job.rows)||job.rows.length>100)return new Response('Invalid job',{status:400});
 const results:Array<Record<string,unknown>>=[];
 for(const row of job.rows){
  let created:string|null=null;
  try{
   if(row.login_email){
    const first=String(row.core.full_name).trim().split(/\s+/)[0];
    const cnic=String(row.profile.cnic_passport??'').replace(/[-\s]/g,'');
    if(!first||!/^[0-9]{13}$/.test(cnic))throw Error('Invalid password inputs');
    const {data,error}=await db.auth.admin.createUser({email:row.login_email,password:first+cnic.slice(-4),email_confirm:true,app_metadata:{employee_import_job:input.job},user_metadata:{full_name:row.core.full_name}});
    if(error||!data.user)throw Error('Account creation failed: '+(error?.code??'unknown'));
    created=data.user.id;
   }
   const {data,error}=await db.rpc('commit_employee_import',{p_job:input.job,p_row:row.source_row,p_user:created});
   if(error)throw Error('Profile commit failed: '+error.code);
   results.push({source_row:row.source_row,employee_no:data.employee_no,account_created:!!created,status:'completed'});
  }catch(error){
   let cleanup='not_needed';
   if(created){
    // A transport failure may occur after the commit. Verify the link before
    // deleting an account created by this job; never delete a linked user.
    const {data:link,error:linkError}=await db.from('employee_accounts').select('user_id').eq('user_id',created).maybeSingle();
    if(!linkError&&link){results.push({source_row:row.source_row,employee_no:row.employee_no,account_created:true,status:'completed_after_recheck'});continue}
    if(!linkError){const {error:cleanupError}=await db.auth.admin.deleteUser(created);cleanup=cleanupError?'manual_review':'removed_unlinked_new_account'}else cleanup='manual_review';
   }
   results.push({source_row:row.source_row,status:'failed',reason:error instanceof Error?error.message:'Unknown error',cleanup});
  }
 }
 return Response.json({job:input.job,results});
});
