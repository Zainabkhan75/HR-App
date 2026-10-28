'use client'
import {useEffect,useMemo,useState} from 'react'

type Row={employeeId:string;name:string;username:string;linked:boolean}
type Generated={employeeId:string;name:string;username:string;password:string}
export default function Credentials(){
 const [rows,setRows]=useState<Row[]>([]),[generated,setGenerated]=useState<Record<string,string>>({}),[selected,setSelected]=useState<string[]>([]),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 useEffect(()=>{fetch('/api/admin/credentials',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('Could not load employee accounts');return r.json()}).then(d=>setRows(d.rows)).catch(e=>setError(e.message))},[])
 const shown=useMemo(()=>rows.filter(r=>(r.employeeId+' '+r.name+' '+r.username).toLowerCase().includes(search.toLowerCase().trim())),[rows,search])
 function toggle(id:string){setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id])}
 async function generate(){
  if(!selected.length)return
  setBusy(true);setError('');setNotice('')
  try{
   const response=await fetch('/api/admin/credentials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({employeeIds:selected})})
   const data=await response.json()
   const completed=(data.results??[]) as Generated[]
   if(completed.length)setGenerated(old=>({...old,...Object.fromEntries(completed.map(r=>[r.employeeId,r.password]))}))
   if(!response.ok)throw Error(data.error??'Password generation failed')
   setNotice(`${completed.length} temporary password${completed.length===1?'':'s'} generated. Save the register now; passwords will disappear when you leave this page.${data.auditWarnings?.length?' Audit logging failed for employee IDs: '+data.auditWarnings.join(', ')+'.':''}`)
   setSelected([])
  }catch(e){setError(e instanceof Error?e.message:'Password generation failed')}
  finally{setBusy(false)}
 }
 function download(){
  const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"'
  const values=[['Employee ID','Name','Username','Password'],...rows.map(r=>[r.employeeId,r.name,r.username,generated[r.employeeId]??''])]
  const csv='\uFEFF'+values.map(row=>row.map(v=>quote(/^[\s]*[=+@\-\t\r]/.test(v)?"'"+v:v)).join(',')).join('\r\n')
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
  const anchor=document.createElement('a');anchor.href=url;anchor.download=`Bandana_Employee_Credentials_${new Date().toISOString().slice(0,10)}.csv`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
 }
 return <main className="shell"><header><div><div className="eyebrow">SEIDOHR / BANDANA · HR ADMINISTRATION</div><h1>Employee credentials</h1><p>Linked usernames and newly generated temporary passwords</p></div><nav className="head-actions"><a href="/employees">Employee directory</a><a href="/reports">Reports</a></nav></header>
 <section className="panel"><p className="notice">Existing passwords cannot be displayed. Generating a temporary password replaces that employee’s current password and requires them to change it at next sign-in. Passwords appear only in this session.</p>
 <div className="bar"><label>Find employee<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ID, name or username"/></label><button className="secondary" disabled={busy||!shown.some(r=>r.linked)} onClick={()=>setSelected(shown.filter(r=>r.linked).map(r=>r.employeeId))}>Select all linked shown</button><button disabled={busy||!selected.length} onClick={generate}>Generate for selected ({selected.length})</button><button className="secondary" onClick={download}>Download table CSV</button></div>
 {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
 <p className="muted">{rows.length} employees · {rows.filter(r=>r.linked).length} active linked accounts · {Object.keys(generated).length} passwords shown</p>
 <div className="tablewrap report-table" tabIndex={0}><table><thead><tr><th scope="col">Select</th><th scope="col">Emp ID</th><th scope="col">Name</th><th scope="col">Username</th><th scope="col">Password</th></tr></thead><tbody>{shown.map(r=><tr key={r.employeeId}><td><input aria-label={`Select ${r.name}`} type="checkbox" disabled={!r.linked||busy} checked={selected.includes(r.employeeId)} onChange={()=>toggle(r.employeeId)}/></td><td>{r.employeeId}</td><td>{r.name}</td><td>{r.username||<span className="muted">No linked account</span>}</td><td className="mono">{generated[r.employeeId]??<span className="muted">Not available</span>}</td></tr>)}</tbody></table></div>
 </section></main>
}
