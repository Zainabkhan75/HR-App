import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function serverSupabase() {
  const jar = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return jar.getAll()
        },
        setAll(items) {
          try {
            items.forEach(({ name, value, options }) => {
              jar.set(name, value, options)
            })
          } catch {
            // Cookie writes may be unavailable
            // in Server Components.
          }
        },
      },
    }
  )
}
