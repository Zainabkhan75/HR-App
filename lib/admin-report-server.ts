import {serverSupabase} from './server'
import {buildReports} from './admin-reports'
import type {ReportSources} from './admin-reports'
export async function adminReports(){
 const db=await serverSupabase(),{data:{user}}=await db.auth.getUser()
 if(!user)return{status:401 as const}
 const {data:role,error:roleError}=await db.from('user_roles').select('role').eq('user_id',user.id).eq('role','hr_admin').maybeSingle()
 if(roleError||!role)return{status:403 as const}
 const read=async(table:string,key:string)=>{const rows:Record<string,unknown>[]=[];for(let from=0;;from+=1000){const {data,error}=await db.from(table).select('*').order(key).range(from,from+999);if(error)throw Error('Report data unavailable');rows.push(...(data??[]));if(!data||data.length<1000)return rows}}
 try{const [employees,details,accounts,families]=await Promise.all([read('employees','employee_no'),read('employee_details','employee_id'),read('employee_accounts','employee_id'),read('employee_family_details','employee_id')]);const sources:ReportSources={employees,details,accounts,families};return{status:200 as const,data:buildReports(sources),generatedAt:new Date().toISOString()}}
 catch{return{status:503 as const}}
}
