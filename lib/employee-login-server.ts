type Db=any
export async function provisionEmployeeLogin(db:Db,employeeId:string,actorId:string){
 const {data:p,error:prepare}=await db.rpc('prepare_employee_login',{p_employee:employeeId,p_actor:actorId})
 if(prepare||!p)throw Error(prepare?.message??'Login preparation failed')
 let created:string|null=null,linked=false
 try{
  const {data,error}=await db.auth.admin.createUser({email:p.username,password:p.initial_password,email_confirm:true,app_metadata:{employee_provision_job:p.job},user_metadata:{full_name:p.full_name}})
  if(error||!data?.user)throw Error('Could not create the sign-in account. Check the email address or contact HR.')
  created=data.user.id
  const {error:commit}=await db.rpc('commit_employee_provision',{p_job:p.job,p_employee:employeeId,p_user:created})
  if(commit){
   const {data:account,error:check}=await db.from('employee_accounts').select('employee_id').eq('user_id',created).maybeSingle()
   if(!check&&account){linked=true}
   else{
    if(!check){const {error:cleanup}=await db.auth.admin.deleteUser(created);if(cleanup)throw Error('Login could not be linked; HR technical review required before retrying.')}
    throw Error(check?'Login outcome needs HR technical review before retrying.':'Employee data changed or login could not be linked. Reload and try again.')
   }
  }else linked=true
  return{employee_no:p.employee_no,full_name:p.full_name,username:p.username,initial_password:p.initial_password,must_change_password:true,email_sent:false}
 }finally{await db.rpc('finish_employee_login',{p_job:p.job,p_actor:actorId})}
}
