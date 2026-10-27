'use client'

import {useEffect,useState} from 'react'
import type {FormEvent} from 'react'
import {RECOVERY_ORIGIN} from '../../lib/recovery-url'

export default function ForgotPassword(){
 const [onRecoveryOrigin,setOnRecoveryOrigin]=useState(false)
 const [email,setEmail]=useState('')
 const [busy,setBusy]=useState(false)
 const [sent,setSent]=useState(false)
 const [error,setError]=useState('')

 useEffect(()=>{
  if(window.location.origin!==RECOVERY_ORIGIN){
   window.location.replace(new URL('/forgot-password',RECOVERY_ORIGIN).href)
  }else{
   setOnRecoveryOrigin(true)
  }
 },[])

 async function sendReset(event:FormEvent<HTMLFormElement>){
  event.preventDefault()
  if(busy||!onRecoveryOrigin)return
  setBusy(true)
  setError('')
  try{
   const response=await fetch('/api/auth/recover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email.trim()})})
   const result=await response.json()
   if(!response.ok){setError(result.error??'We could not process the reset request. Please try again later or contact HR.');return}
   setSent(true)
  }catch{
   setError('We could not process the reset request. Please check your connection and try again.')
  }finally{
   setBusy(false)
  }
 }

 return <main className="login"><section className="panel">
  <div className="eyebrow">SEIDOHR / BANDANA</div>
  <h1>Forgot password?</h1>
  {sent?<div role="status">
   <p>If this email matches an account, a reset link will be sent to its registered recovery inbox.</p>
   <p>Check your inbox and spam folder. Open the link in this same browser and on this device.</p>
   <p>If no email arrives, contact HR for help with your account.</p>
  </div>:<form onSubmit={sendReset}>
   <p>Enter your unique registered work or personal email.</p>
   <label>Registered email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={event=>setEmail(event.target.value)} disabled={busy}/></label>
   {error?<p className="error" role="alert">{error}</p>:null}
   <button type="submit" disabled={busy||!onRecoveryOrigin}>{busy?'Sending...':'Send reset link'}</button>
  </form>}
  <p className="recovery-help">No email registered, or no access to that inbox? Contact HR to verify your identity and help reset your password.</p>
  <nav className="recovery-links" aria-label="Account recovery"><a href="/login">Back to sign in</a></nav>
 </section></main>
}

