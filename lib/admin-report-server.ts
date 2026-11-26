import {serverSupabase} from './server'
import {buildOrganisationReport} from './organisation-report'
import {buildReports} from './admin-reports'
import type {ReportSources} from './admin-reports'
export async function adminReports(){
 const db=await serverSupabase(),{data:{user}}=await db.auth.getUser()
 if(!user)return{status:401 as const}
 const {data:role,error:roleError}=await db.from('user_roles').select('role').eq('user_id',user.id).eq('role','hr_admin').maybeSingle()
 if(roleError||!role)return{status:403 as const}
 const read=async(table:string,key:string,columns:string)=>{const rows:Record<string,unknown>[]=[];for(let from=0;;from+=1000){const {data,error}=await db.from(table).select(columns).order(key).range(from,from+999);if(error)throw Error('Report data unavailable');for(const item of data??[]){if(item&&typeof item==='object'&&!Array.isArray(item))rows.push(item as unknown as Record<string,unknown>)}if(!data||data.length<1000)return rows}}
 try{const [employees,details,accounts,families,positions,subDepartments,departments,designations,managerLinks]=await Promise.all([read('employees','employee_no','id,employee_no,full_name,designation,department,location,employment_state,reports_to_text,leaving_date,record_status,source_note,position_id'),read('employee_details','employee_id','employee_id,profile,payroll_sep_2026'),read('employee_accounts','employee_id','employee_id,username,is_active,must_change_password'),read('employee_family_details','employee_id','employee_id,spouse,children'),read('position_records','id','id,position_code,position_title,department_id,designation_id,reports_to_position_id,is_reporting_root'),read('departments','id','id,name,parent_department_id'),read('organisation_departments','id','id,name'),read('designations','id','id,title'),read('manager_team_links','member_employee_id','manager_employee_id,member_employee_id')]);const sources:ReportSources={employees,details,accounts,families};return{status:200 as const,data:{...buildReports(sources),organisation:buildOrganisationReport({employees,details,positions,subDepartments,departments,designations,managerLinks})},generatedAt:new Date().toISOString()}}
 catch{return{status:503 as const}}
}
