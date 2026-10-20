'use client'
import {browserDb} from '../../lib/supabase'
type Summary={employee_no:string;full_name:string;designation:string|null;department:string|null;location:string|null}
type Team={employee_no:string;full_name:string;designation:string|null;department:string|null}
export default function Portal({summary,team,isManager}:{summary:Summary;team:Team[];isManager:boolean}){
 async function logOut(){await browserDb().auth.signOut();window.location.href='/login'}
 return <main className="mobile-shell">
  <header><div><div className="eyebrow">BANDANA / SEIDOHR</div><h1>Welcome, {summary.full_name}</h1><p>{summary.designation||'Employee'} · {summary.department||'Department not recorded'}</p></div><button className="secondary" onClick={logOut}>Sign out</button></header>
  <section className="panel"><h2>My employment profile</h2><dl className="profile-grid">
  <dt>Employee ID</dt><dd>{summary.employee_no}</dd><dt>Department</dt><dd>{summary.department||'Not recorded'}</dd><dt>Designation</dt><dd>{summary.designation||'Not recorded'}</dd><dt>Location</dt><dd>{summary.location||'Not recorded'}</dd>
  </dl></section>
  {isManager&&<section className="panel"><h2>My team</h2>{team.length===0?<p>No verified direct reports have been linked yet.</p>:<ul className="team-list">{team.map(m=><li key={m.employee_no}><strong>{m.full_name}</strong><span>{m.employee_no} · {m.designation||'Designation not recorded'}</span></li>)}</ul>}</section>}
  <section className="panel"><h2>Coming next</h2><p>Leave applications, approvals and profile update requests will be added after the account-access pilot.</p></section>
 </main>
}
