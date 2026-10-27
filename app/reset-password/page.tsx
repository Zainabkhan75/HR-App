'use client'

import {useEffect,useRef,useState} from 'react'
import type {FormEvent} from 'react'
import {recoveryDb} from '../../lib/recovery'
import {recoveryInput,recoveryLanding,RECOVERY_ORIGIN} from '../../lib/recovery-url'

export default function ResetPassword(){
 const client=useRef<ReturnType<typeof recoveryDb>|null>(null)
 const verification=useRef<Promise<boolean>|null>(null)
 const [phase,setPhase]=useState<'checking'|'invalid'|'ready'|'saved'>('checking')
 const [password,setPassword]=useState('')
 const [confirm,setConfirm]=useState('')
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')

 useEffect(()=>{
  let mounted=true
  if(!verification.current){
   const url=new URL(window.location.href)
   if(url.origin!==RECOVERY_ORIGIN){
    const destination=recoveryLanding(url)
    window.location.replace(destination??new URL('/forgot-password',RECOVERY_ORIGIN).href)
    return
   }
   const input=recoveryInput(url)
   // Strip credentials before creating a client with automatic URL detection.
   window.history.replaceState(null,'','/reset-password')
   verification.current=(async()=>{
    if(input.kind==='invalid')return false
    const db=recoveryDb()
    client.current=db
    const result=input.kind==='code'
     ?await db.auth.exchangeCodeForSession(input.code)
     :input.kind==='token_hash'
      ?await db.auth.verifyOtp({token_hash:input.tokenHash,type:'recovery'})
      :await db.auth.setSession({access_token:input.accessToken,refresh_token:input.refreshToken})
    if(result.error||!result.data.session)return false
    const {data:{user},error:userError}=await db.auth.getUser()
    return !userError&&!!user
   })().catch(()=>false)
  }
  verification.current.then(valid=>{if(mounted)setPhase(valid?'ready':'invalid')})
  return ()=>{mounted=false}
 },[])

 async function savePassword(event:FormEvent<HTMLFormElement>){
  event.preventDefault()
  if(busy||phase!=='ready'||!client.current)return
  setError('')
  if(password.length<12){setError('Please choose at least 12 characters.');return}
  if(password!==confirm){setError('Passwords do not match.');return}
  setBusy(true)
  let passwordSaved=false
  try{
   const db=client.current
   const {error:passwordError}=await db.auth.updateUser({password})
   if(passwordError){
    setError('The password could not be updated. Please try a different password or request a new reset link.')
    return
   }
   passwordSaved=true
   setPassword('')
   setConfirm('')
   // HR-only accounts have no employee summary; they do not need this flag.
   const {data:summary,error:summaryError}=await db.rpc('my_employee_summary')
   if(summaryError){
    setNotice('Your password has changed. If self-service still asks for a password change, contact HR.')
   }else if(Array.isArray(summary)&&summary[0]?.must_change_password){
    const {error:flagError}=await db.rpc('confirm_password_changed')
    if(flagError)setNotice('Your password has changed, but HR needs to check your first-login status.')
   }
   setPhase('saved')
  }catch{
   if(passwordSaved){
    setNotice('Your password has changed. If self-service still asks for a password change, contact HR.')
    setPhase('saved')
   }else{
    setError('We could not confirm the password update. Please check your connection. If you retry, your new password may already work.')
   }
  }finally{
   setBusy(false)
  }
 }

 return <main className="login"><section className="panel">
  <div className="eyebrow">SEIDOHR / BANDANA</div>
  <h1>Reset your password</h1>
  {phase==='checking'?<p role="status">Checking your reset link...</p>:null}
  {phase==='invalid'?<div>
   <p role="alert">This reset link is missing, expired or could not be verified. Request a new link and open it in the same browser and on the same device where you requested it.</p>
   <p><a href="/forgot-password">Request a new reset link</a></p>
  </div>:null}
  {phase==='ready'?<form onSubmit={savePassword}>
   <p>Choose a new password with at least 12 characters.</p>
   <label>New password<input type="password" autoComplete="new-password" required minLength={12} value={password} onChange={event=>setPassword(event.target.value)} disabled={busy}/></label>
   <label>Confirm new password<input type="password" autoComplete="new-password" required minLength={12} value={confirm} onChange={event=>setConfirm(event.target.value)} disabled={busy}/></label>
   {error?<p role="alert" className="error">{error}</p>:null}
   <button type="submit" disabled={busy}>{busy?'Saving...':'Save new password'}</button>
  </form>:null}
  {phase==='saved'?<div role="status">
   <p>Your password has been updated.</p>
   {notice?<p>{notice}</p>:null}
   <a className="recovery-action" href="/portal">Continue to HRMS</a>
  </div>:null}
  <nav className="recovery-links" aria-label="Account recovery"><a href="/login">Back to sign in</a></nav>
 </section></main>
}
