'use client'
import {useState} from 'react'
import {browserDb} from '../../lib/supabase'
export default function Login(){const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
async function signIn(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');const {error}=await browserDb().auth.signInWithPassword({email,password});setBusy(false);if(error)setError(error.message);else window.location.href='/employees'}
return <main className="login"><form className="panel" onSubmit={signIn}><div className="eyebrow">SEIDOHR / BANDANA</div><h1>HR Administration</h1><p>Sign in with your approved account.</p><label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} autoComplete="username"/></label><label>Password<input type="password" required value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password"/></label>{error&&<p role="alert" className="error">{error}</p>}<button disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form></main>}
