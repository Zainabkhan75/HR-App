// Keep recovery requests and callbacks on one origin so the PKCE cookie matches.
export const RECOVERY_ORIGIN='https://hr-app-five-psi.vercel.app'

export type RecoveryInput=
 | {kind:'code';code:string}
 | {kind:'token_hash';tokenHash:string}
 | {kind:'implicit';accessToken:string;refreshToken:string}
 | {kind:'invalid'}

export function recoveryInput(url:URL):RecoveryInput{
 const fragment=new URLSearchParams(url.hash.slice(1))
 if(url.searchParams.has('error')||url.searchParams.has('error_code')||fragment.has('error')||fragment.has('error_code'))return {kind:'invalid'}
 const code=url.searchParams.get('code')
 if(code)return {kind:'code',code}
 const tokenHash=url.searchParams.get('token_hash')
 if(tokenHash&&url.searchParams.get('type')==='recovery')return {kind:'token_hash',tokenHash}
 const accessToken=fragment.get('access_token')
 const refreshToken=fragment.get('refresh_token')
 if(fragment.get('type')==='recovery'&&accessToken&&refreshToken)return {kind:'implicit',accessToken,refreshToken}
 return {kind:'invalid'}
}

export function recoveryLanding(url:URL):string|null{
 const fragment=new URLSearchParams(url.hash.slice(1))
 const isCallback=url.searchParams.has('code')||url.searchParams.has('token_hash')||
  fragment.get('type')==='recovery'||url.searchParams.has('error')||
  url.searchParams.has('error_code')||fragment.has('error')||fragment.has('error_code')
 if(!isCallback)return null
 const destination=new URL('/reset-password',RECOVERY_ORIGIN)
 destination.search=url.search
 destination.hash=url.hash
 return destination.href
}
