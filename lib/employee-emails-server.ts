import {emailRecipients} from './employee-emails'
export async function loadEmailRecipients(db:any){
 const [e,d]=await Promise.all([db.from('employees').select('id,employee_no,full_name,department,employment_state').order('employee_no').limit(2000),db.from('employee_details').select('employee_id,profile').limit(2000)])
 if(e.error||d.error)throw Error('Could not load employee email addresses')
 return emailRecipients(e.data??[],d.data??[])
}
