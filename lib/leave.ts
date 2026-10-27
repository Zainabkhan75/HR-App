export const leaveTypes=['annual','sick','casual'] as const
export type LeaveType=typeof leaveTypes[number]
export type Policy={year:number;annual:number;sick:number;casual:number;weekdays_only:boolean;holidays:string[]}
export type Balance={type:LeaveType;entitlement:number|null;opening_taken:number|null;verified:boolean;taken:number;approved:number;pending:number}
export type LeaveRequest={id:string;employee_id:string;manager_employee_id:string;employee_name:string;employee_no:string;manager_name?:string;year:number;leave_type:LeaveType;start_date:string;end_date:string;charge_dates:string[];days:number;reason:string;status:'pending'|'approved'|'rejected'|'cancelled';decision_note:string|null;created_at:string}
export type InboxItem={id:string;kind:'leave_request'|'leave_decision'|'task'|'alert';title:string;body:string;request_id:string|null;request_year:number|null;read_at:string|null;completed_at:string|null;created_at:string}
export type EmployeeOption={id:string;name:string;employee_no:string;designation:string|null;account_active:boolean;is_manager:boolean;user_id:string|null}
export type Opening={employee_id:string;year:number;leave_type:LeaveType;entitlement:number;taken:number;confirmed_at:string}
export type WorkspaceData={is_hr:boolean;employee_id:string|null;year:number;policy:Policy|null;manager:{name:string;designation:string|null;ready:boolean}|null;balances:Balance[];requests:LeaveRequest[];approvals:LeaveRequest[];inbox:InboxItem[];employees?:EmployeeOption[];links?:{manager_employee_id:string;member_employee_id:string}[];openings?:Opening[];team?:EmployeeOption[];email_queue?:{id:string;subject:string;status:string;created_at:string}[]}
export const titleCase=(value:string)=>value.charAt(0).toUpperCase()+value.slice(1)
export function availableDays(balance:Balance):number|null{
 return balance.verified&&balance.entitlement!==null?balance.entitlement-(balance.opening_taken??0)-balance.approved-balance.pending:null
}
export function countLeaveDays(start:string,end:string,policy:Policy):number|null{
 const a=Date.parse(start+'T00:00:00Z'),b=Date.parse(end+'T00:00:00Z')
 if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||!Number.isFinite(a)||!Number.isFinite(b)||b<a||b-a>366*86400000||new Date(a).toISOString().slice(0,10)!==start||new Date(b).toISOString().slice(0,10)!==end||Number(start.slice(0,4))!==policy.year||Number(end.slice(0,4))!==policy.year)return null
 const holidays=new Set(policy.holidays)
 let count=0
 for(let stamp=a;stamp<=b;stamp+=86400000){const d=new Date(stamp);if((!policy.weekdays_only||(d.getUTCDay()!==0&&d.getUTCDay()!==6))&&!holidays.has(d.toISOString().slice(0,10)))count++}
 return count
}
export function safeWorkspaceNext(value:string|null):string|null{
 if(!value||!value.startsWith('/workspace')||/[\\\r\n]/.test(value))return null
 try{const u=new URL(value,'https://local.invalid');return u.origin==='https://local.invalid'&&u.pathname==='/workspace'?u.pathname+u.search:null}catch{return null}
}
