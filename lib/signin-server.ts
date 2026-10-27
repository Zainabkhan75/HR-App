import {createClient} from '@supabase/supabase-js'
// This module is imported by Route Handlers only; canonical emails and admin
// credentials never enter browser responses or client component bundles.
export async function resolveSigninEmail(email:string):Promise<string|null>{
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY
 if(!key)throw Error('Email sign-in unavailable')
 const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,key,{auth:{persistSession:false,autoRefreshToken:false}})
 const {data,error}=await admin.rpc('resolve_signin_email',{p_email:email.trim().toLowerCase()})
 if(error)throw Error('Email sign-in unavailable')
 return typeof data==='string'?data:null
}
export function sameOriginRequest(request:Request):boolean{
 try{return new URL(request.headers.get('origin')??'').origin===new URL(request.url).origin}catch{return false}
}
