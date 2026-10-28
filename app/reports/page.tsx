import {redirect} from 'next/navigation'
import {adminReports} from '../../lib/admin-report-server'
import Reports from './view'
export const dynamic='force-dynamic'
export default async function ReportsPage(){
 const result=await adminReports()
 if(result.status===401)redirect('/login?next=/reports')
 if(result.status!==200)return <main className="shell"><h1>{result.status===403?'Access restricted':'Reports unavailable'}</h1><p>{result.status===403?'HR administrator access is required.':'Could not load the reports. Please refresh to try again.'}</p><a href="/employees">Back to directory</a></main>
 return <Reports data={result.data} generatedAt={result.generatedAt}/>
}
