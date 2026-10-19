
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

type CookieToSet = {
  name: string
  value: string
  options?: Parameters<
    Awaited<ReturnType<typeof cookies>>['set']
  >[2]
}

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
        setAll(items: CookieToSet[]) {
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
