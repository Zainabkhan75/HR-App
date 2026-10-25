import {createBrowserClient} from '@supabase/ssr'

// The reset page removes the code from the URL before creating this client,
// so it can exchange the code exactly once using the existing PKCE cookie.
export function recoveryDb(){
 return createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {isSingleton:false}
 )
}
