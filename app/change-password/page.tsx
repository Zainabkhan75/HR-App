'use client'
import {useState} from 'react'
import {browserDb} from '../../lib/supabase'
export default function ChangePassword(){
 const [password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 async function change(e:React.FormEvent){e.preventDefault();setError('');if(password.length<12){setError('Please choose at least 12 characters.');return}if(password!==confirm){setError('Passwords do not match.');return}setBusy(true);const db=browserDb();const {error:authErr}=await db.auth.updateUser({password});if(authErr){setError(authErr.message);setBusy(false);return}const {error:flagErr}=await db.rpc('confirm_password_changed');if(flagErr){setError('Password was changed, but the account flag could not be updated. Contact HR.');setBusy(false);return}window.location.href='/portal'}
 return <main className="login"><form className="panel" onSubmit={change}><div className="eyebrow">BANDANA / SEIDOHR</div><h1>Choose your personal password</h1><p>You must set a new password before using self-service.</p><label>New password<input type="password" autoComplete="new-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><label>Confirm new password<input type="password" autoComplete="new-password" required value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>{error&&<p className="error" role="alert">{error}</p>}<button disabled={busy}>{busy?'Saving...':'Save password'}</button></form></main>
}
