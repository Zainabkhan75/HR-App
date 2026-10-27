'use client'

import {useEffect,useState} from 'react'
import type {FormEvent} from 'react'
import {browserDb} from '../../lib/supabase'
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
   const {error:resetError}=await browserDb().auth.resetPasswordForEmail(email.trim(),{
    redirectTo:new URL('/reset-password',RECOVERY_ORIGIN).href
   })
   if(resetError){
    setError(resetError.status===429
     ?'Too many requests. Please wait before trying again.'
     :'We could not process the reset request. Please try again later or contact HR.')
    return
   }
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
   <p>If an account exists for this email and email recovery is available, you will receive a reset link.</p>
   <p>Check your inbox and spam folder. Open the link in this same browser and on this device.</p>
   <p>If no email arrives, contact HR for help with your account.</p>
  </div>:<form onSubmit={sendReset}>
   <p>Enter the email registered for your HRMS account.</p>
   <label>Registered email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={event=>setEmail(event.target.value)} disabled={busy}/></label>
   {error?<p className="error" role="alert">{error}</p>:null}
   <button type="submit" disabled={busy||!onRecoveryOrigin}>{busy?'Sending...':'Send reset link'}</button>
  </form>}
  <p className="recovery-help">No email registered, or no access to that inbox? Contact HR to verify your identity and help reset your password.</p>
  <nav className="recovery-links" aria-label="Account recovery"><a href="/login">Back to sign in</a><a href="/forgot-username">Forgot username?</a></nav>
 </section></main>
}
