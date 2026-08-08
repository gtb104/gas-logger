import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function getSupabaseKey(dictionaryName: string, fallbackName: string) {
  const dictionary = Deno.env.get(dictionaryName)

  if (dictionary) {
    const keys = JSON.parse(dictionary) as Record<string, string>

    return keys.default
  }

  return Deno.env.get(fallbackName)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { garageId, email, role = 'member', redirectTo } = await req.json()

    if (!garageId || !email) {
      return new Response(
        JSON.stringify({ error: 'garageId and email are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const publishableKey = getSupabaseKey(
      'SUPABASE_PUBLISHABLE_KEYS',
      'SUPABASE_PUBLISHABLE_KEY',
    )
    const secretKey = getSupabaseKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SECRET_KEY')

    if (!supabaseUrl || !publishableKey || !secretKey) {
      return new Response(
        JSON.stringify({ error: 'Supabase function environment is not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const authHeader = req.headers.get('Authorization')

    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    })

    const adminClient = createClient(supabaseUrl, secretKey)

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser()

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unable to verify signed-in user' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { data: membership, error: membershipError } = await userClient
      .from('garage_members')
      .select('role')
      .eq('garage_id', garageId)
      .eq('user_id', user.id)
      .single()

    if (membershipError || membership?.role !== 'owner') {
      return new Response(
        JSON.stringify({ error: 'Only garage owners can invite members' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const normalizedEmail = String(email).trim().toLowerCase()
    const inviteRole = role === 'owner' ? 'owner' : 'member'

    const { data: inviteRow, error: inviteRowError } = await userClient
      .from('garage_invites')
      .insert({
        garage_id: garageId,
        email: normalizedEmail,
        role: inviteRole,
        invited_by: user.id,
      })
      .select('id')
      .single()

    if (inviteRowError || !inviteRow) {
      return new Response(
        JSON.stringify({
          error: inviteRowError?.message ?? 'Unable to create garage invite',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { error: authInviteError } = await adminClient.auth.admin.inviteUserByEmail(
      normalizedEmail,
      {
        redirectTo,
        data: {
          invited_garage_id: garageId,
        },
      },
    )

    if (authInviteError) {
      await adminClient
        .from('garage_invites')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', inviteRow.id)

      const status =
        'status' in authInviteError
          ? (authInviteError.status as unknown)
          : undefined
      const message =
        status === 429
          ? 'Invite email limit reached. Try again later.'
          : authInviteError.message

      return new Response(
        JSON.stringify({ error: message }),
        {
          status: typeof status === 'number' ? status : 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
