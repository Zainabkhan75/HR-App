'use client'

import {useEffect} from 'react'
import {recoveryLanding} from '../lib/recovery-url'

export default function Home(){
 useEffect(()=>{
  // Inspect the callback before navigating: a server redirect loses query
  // codes and cannot see the fragment used by older recovery emails.
  const destination=recoveryLanding(new URL(window.location.href))
  window.location.replace(destination??'/employees')
 },[])
 return <main className="login"><section className="panel"><h1>Bandana HRMS</h1><p role="status">Opening your account...</p></section></main>
}
