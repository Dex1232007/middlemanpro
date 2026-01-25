import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Generic error messages to prevent information leakage
const ERROR_MESSAGES = {
  UNAUTHORIZED: 'Unauthorized access',
  OPERATION_FAILED: 'Operation failed. Please try again.',
  NOT_CONFIGURED: 'Required configuration missing',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // SECURITY: Verify user is authenticated and is an admin
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      console.warn('Missing authorization header')
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.UNAUTHORIZED }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
    
    // Create client with user's token to verify authentication
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    })

    // Verify the token and get user claims
    const token = authHeader.replace('Bearer ', '')
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token)
    
    if (claimsError || !claimsData?.claims) {
      console.warn('Invalid token:', claimsError?.message)
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.UNAUTHORIZED }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    const userId = claimsData.claims.sub as string

    // Check if user is an admin using service role
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    
    const { data: roleData, error: roleError } = await adminSupabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .maybeSingle()

    if (roleError || !roleData) {
      console.warn('User is not an admin:', userId)
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.UNAUTHORIZED }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      )
    }

    // User is authenticated and is an admin, proceed with webhook setup
    const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
    const TELEGRAM_WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')
    
    if (!TELEGRAM_BOT_TOKEN) {
      console.error('TELEGRAM_BOT_TOKEN not configured')
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.NOT_CONFIGURED, details: 'Bot token missing' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    if (!TELEGRAM_WEBHOOK_SECRET) {
      console.error('TELEGRAM_WEBHOOK_SECRET not configured')
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.NOT_CONFIGURED, details: 'Webhook secret missing' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Extract project ref from SUPABASE_URL
    const projectRef = SUPABASE_URL?.match(/https:\/\/([^.]+)/)?.[1]
    const webhookUrl = `https://${projectRef}.supabase.co/functions/v1/telegram-webhook`

    console.log('Admin', userId, 'setting webhook to:', webhookUrl)

    // Set webhook with secret_token for request validation
    const setWebhookRes = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          allowed_updates: ['message', 'callback_query'],
          secret_token: TELEGRAM_WEBHOOK_SECRET,
        }),
      }
    )

    const setResult = await setWebhookRes.json()
    console.log('setWebhook result:', setResult.ok ? 'success' : 'failed', setResult.description)

    // Get webhook info for verification
    const infoRes = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`
    )
    const infoResult = await infoRes.json()

    // Get bot info
    const meRes = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`
    )
    const meResult = await meRes.json()

    return new Response(
      JSON.stringify({
        success: setResult.ok,
        message: setResult.ok ? 'Webhook configured successfully' : 'Webhook configuration failed',
        bot: meResult.ok ? `@${meResult.result.username}` : null,
        webhook_url: webhookUrl,
        has_secret: infoResult.result?.has_custom_certificate === false && setResult.ok,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error: unknown) {
    console.error('Webhook setup error:', error)
    return new Response(
      JSON.stringify({ error: ERROR_MESSAGES.OPERATION_FAILED }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
