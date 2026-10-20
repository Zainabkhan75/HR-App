'use client'

import {useState} from 'react'
import {browserDb} from '../../lib/supabase'

export default function AccountStatus({email,title,message}:{email?:string;title:string;message:string}){
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')

 async function switchAccount(){
  setBusy(true)
  setError('')
  try{
   const {error:signOutError}=await browserDb().auth.signOut({scope:'local'})
   if(signOutError){
    setError('We could not sign you out. Please try again.')
    setBusy(false)
    return
   }
   window.location.replace('/login')
  }catch{
   setError('We could not sign you out. Please check your connection and try again.')
   setBusy(false)
  }
 }

 return <main className="mobile-shell">
  <section className="panel">
   <div className="eyebrow">BANDANA / SEIDOHR</div>
   <h1>{title}</h1>
   <p>{message}</p>
   {email?<p>Signed in as: <strong style={{overflowWrap:'anywhere'}}>{email}</strong></p>:null}
   {error?<p role="alert" className="error">{error}</p>:null}
   <button type="button" disabled={busy} onClick={switchAccount}>{busy?'Signing out...':'Sign out and use another account'}</button>
   <p><a href="/portal">Try again</a></p>
  </section>
 </main>
}
