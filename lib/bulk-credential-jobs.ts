import {provisionEmployeeLogin} from './employee-login-server'
import {serviceDb} from './bulk-upload-server'

export async function runBulkCredentialJobs(actor:string,hash:string){
 const db=serviceDb(),results:Record<string,unknown>[]=[]
 const {data:jobs,error}=await db.from('bulk_credential_jobs').select('*,employee:employee_records(employee_no,full_name)').eq('actor_id',actor).eq('file_hash',hash).order('created_at')
 if(error)throw Error('Could not load credential actions. Retry this upload.')
 for(const job of jobs??[]){
  const identity={employee_no:job.employee?.employee_no??job.employee_id,full_name:job.employee?.full_name??''}
  if(job.status==='complete'){results.push({...job.result,status:'created'});continue}
  if(job.status==='uncertain'||(job.status==='sending'&&job.action==='RESET')){
   results.push({...identity,status:'pending',reason:'Check the previous password reset in Credentials before taking further action.'});continue
  }
  const {data:claim,error:claimError}=await db.rpc('claim_bulk_credential_job',{p_id:job.id,p_actor:actor})
  if(claimError||!claim){results.push({...identity,status:'pending',reason:'Credential action is already running. Retry this upload.'});continue}
  let resetAttempted=false
  try{
   const {data:employee,error:lookup}=await db.from('employees').select('employee_no,full_name,employment_state').eq('id',job.employee_id).single()
   if(lookup||employee.employment_state!=='active')throw Error('An active employee is required')
   let result:Record<string,unknown>
   const {data:account,error:accountError}=await db.from('employee_accounts').select('user_id,login_email,is_active').eq('employee_id',job.employee_id).maybeSingle()
   if(accountError)throw Error('Could not check employee credentials')
   if(job.action==='CREATE'){
    if(account){
     if(!account.is_active)throw Error('The linked account is inactive')
     result={employee_no:employee.employee_no,full_name:employee.full_name,username:account.login_email}
    }else{
     const login=await provisionEmployeeLogin(db,job.employee_id,actor,job.confirmed_email??undefined)
     result={employee_no:login.employee_no,full_name:login.full_name,username:login.username}
    }
   }else{
    if(!account?.is_active)throw Error('An active account is required to reset a password')
    const {data:roles,error:roleError}=await db.from('user_roles').select('role').eq('user_id',account.user_id)
    if(roleError||roles.some(role=>role.role==='hr_admin'))throw Error('Administrator passwords must be managed through administrator recovery')
    const {data:auth,error:authError}=await db.auth.admin.getUserById(account.user_id)
    if(authError||auth.user.email?.toLowerCase()!==account.login_email.toLowerCase())throw Error('Authentication identity mismatch')
    const {error:flagError}=await db.from('employee_accounts').update({must_change_password:true}).eq('employee_id',job.employee_id)
    if(flagError)throw Error('Could not require password change')
    resetAttempted=true
    const {error:resetError}=await db.auth.admin.updateUserById(account.user_id,{password:'Pakistan1234'})
    if(resetError)throw Error('Password reset could not be confirmed')
    result={employee_no:employee.employee_no,full_name:employee.full_name,username:account.login_email}
   }
   const {error:finish}=await db.rpc('finish_bulk_credential_job',{p_id:job.id,p_actor:actor,p_claim:claim,p_result:result,p_error:null})
   if(finish)throw Error('Credential outcome needs checking before retrying')
   results.push({...result,status:'created'})
  }catch(error){
   const reason=(resetAttempted?'UNCERTAIN: ':'')+(error instanceof Error?error.message:'Credential action failed')
   await db.rpc('finish_bulk_credential_job',{p_id:job.id,p_actor:actor,p_claim:claim,p_result:null,p_error:reason})
   results.push({...identity,status:'pending',reason})
  }
 }
 return results
}
