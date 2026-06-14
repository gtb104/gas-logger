import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
  | string
  | undefined

export const supabaseConfigError =
  !supabaseUrl || !supabasePublishableKey
    ? 'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to enable Supabase Auth.'
    : ''

export const supabase =
  supabaseUrl && supabasePublishableKey
    ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
    : null
