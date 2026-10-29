'use client'
import {useState} from 'react'

type Change={field:string;before:string;after:string;action:'fill'|'replace'|'skip'}
type PreviewRow={action:'NEW'|'UPDATE';reference:string;employeeNo:string;name:string;replace:boolean;fill:number;overwrite:number;skipped:number;unchanged:number;changes:Change[]}
type Preview={rows:PreviewRow[];token:string;totals:{employees:number;fill:number;replace:number;skipped:number}}
export default function BulkUpload(){
 const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[showAll,setShowAll]=useState(false)
 async function download(){setBusy(true);setError('');try{const response=await fetch('/api/admin/bulk-upload/template',{cache:'no-store'});if(!response.ok)throw Error('Could not download template');const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download='Bandana_Employee_Bulk_Upload_Template.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){setError(e instanceof Error?e.message:'Download failed')}finally{setBusy(false)}}
 async function send(action:'preview'|'apply'){
  if(!file)return
  setBusy(true);setError('');setNotice('')
  try{const form=new FormData();form.set('file',file);form.set('action',action);if(action==='apply'&&preview)form.set('token',preview.token)
   const response=await fetch('/api/admin/bulk-upload',{method:'POST',body:form,cache:'no-store'}),result=await response.json()
   if(!response.ok)throw Error(result.error??'Upload failed')
   if(action==='preview'){setPreview(result as Preview);setNotice('Preview ready. Review the changes below before applying.')}
   else{setNotice(`Applied ${result.fields} field changes across ${result.applied} employees.${result.created?.length?' New IDs: '+result.created.map((r:{name:string;employee_no:string})=>r.name+' ('+r.employee_no+')').join('; '):''}`);setPreview(null);setFile(null);const input=document.getElementById('bulk-upload-file') as HTMLInputElement|null;if(input)input.value=''}
  }catch(e){setError(e instanceof Error?e.message:'Upload failed');if(action==='apply')setPreview(null)}finally{setBusy(false)}
 }
 const shown=preview?.rows.filter(r=>showAll||r.fill+r.overwrite+r.skipped>0)??[]
 return <main className="shell"><header><div><div className="eyebrow">SEIDOHR / BANDANA · HR ADMINISTRATION</div><h1>Bulk employee upload</h1><p>Add new employees and update existing records</p></div><nav className="head-actions"><a href="/employees">Employee directory</a><a href="/reports">Reports</a></nav></header>
 <section className="panel"><h2>1. Download the Excel template</h2><p>The Employees and Family sheets are populated with the latest saved values when you download them. They cover core, profile, salary, bank, historical payroll, spouse and child fields. Separate reference sheets preserve the original values for comparison.</p><button onClick={()=>void download()} disabled={busy}>Download template</button>
 <h2>2. Edit the values you want to update</h2><p>For existing employees choose <strong>UPDATE</strong> and match by Employee ID. For new employees add a row, choose <strong>NEW</strong>, leave Employee ID and YES/NO blank, and enter name, department and designation. The app assigns an Active employee ID when applied. Use a unique Upload reference such as NEW-01 to link any new family rows. Possible duplicate names, CNICs or email addresses must be resolved first.</p><p>For UPDATE rows, edit the relevant cell; blank cells leave stored values untouched. In each employee or family row, choose <strong>NO</strong> to fill empty fields only or <strong>YES</strong> to replace differing values too. An unchanged downloaded file makes no updates.</p><p className="muted">Account credentials, employment activation and leave settings use their own app workflows.</p>
 <label>Choose completed Excel file<input id="bulk-upload-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e=>{setFile(e.target.files?.[0]??null);setPreview(null);setError('');setNotice('')}}/></label><button disabled={!file||busy} onClick={()=>void send('preview')}>{busy?'Working…':'Preview changes'}</button>
 {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
 </section>
 {preview&&<section className="panel"><h2>3. Review and apply</h2><p>{preview.totals.employees} employee rows · {preview.totals.fill} empty fields to fill · {preview.totals.replace} existing values to replace · {preview.totals.skipped} differences skipped because the row says NO</p><label><input type="checkbox" checked={showAll} onChange={e=>setShowAll(e.target.checked)}/> Show unchanged rows too</label>
 <div className="tablewrap"><table><thead><tr><th>Emp ID</th><th>Name</th><th>Replace?</th><th>Changes</th></tr></thead><tbody>{shown.map(row=><tr key={row.reference}><td>{row.action==='NEW'?'NEW · '+row.reference:row.employeeNo}</td><td>{row.name}</td><td>{row.action==='NEW'?'New record':row.replace?'YES':'NO'}</td><td>{row.changes.length?row.changes.map((change,i)=><div key={i} className="bulk-change"><strong>{change.field}</strong> · {change.action==='fill'?'Fill empty':change.action==='replace'?'Replace':'Skipped'}<br/><span className="muted">{change.before||'(empty)'} → {change.after}</span></div>):<span className="muted">No changes</span>}</td></tr>)}</tbody></table></div>
 <p className="muted">This preview expires after 30 minutes. If anyone edits a matching employee before you apply it, upload the file again for a fresh preview.</p><button disabled={busy||preview.totals.fill+preview.totals.replace===0} onClick={()=>void send('apply')}>{busy?'Applying…':`Apply ${preview.totals.fill+preview.totals.replace} changes`}</button>
 </section>}
 </main>
}
