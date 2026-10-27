'use client'
import {useState} from 'react'
import {validLoginEmail} from '../../lib/login-email'
export default function Login(){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 async function signIn(e:React.FormEvent){
  e.preventDefault();if(busy)return;setError('')
  if(!validLoginEmail(email)){setError('Enter your registered work or personal email.');return}
  setBusy(true)
  try{const response=await fetch('/api/auth/signin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email.trim(),password,next:new URLSearchParams(window.location.search).get('next')})});const result=await response.json();if(!response.ok){setError(result.error??'Could not sign in.');return}window.location.assign(result.redirect??'/portal')}
  catch{setError('Could not sign in. Please check your connection.')}
  finally{setBusy(false)}
 }
 return <main className="login"><form className="panel" onSubmit={signIn}><div className="eyebrow">SEIDOHR / BANDANA</div><h1>Bandana HRMS</h1><p>Sign in with your unique registered work or personal email.</p><label>Work or personal email<input type="email" required maxLength={254} value={email} disabled={busy} onChange={e=>setEmail(e.target.value)} autoComplete="username"/></label><label>Password<input type="password" required value={password} disabled={busy} onChange={e=>setPassword(e.target.value)} autoComplete="current-password"/></label>{error?<p role="alert" className="error">{error}</p>:null}<button disabled={busy}>{busy?'Signing in...':'Sign in'}</button><nav className="recovery-links" aria-label="Account recovery"><a href="/forgot-password">Forgot password?</a></nav><p className="recovery-help">Shared work mailbox? Use your unique personal email registered with HR.</p></form></main>
}
