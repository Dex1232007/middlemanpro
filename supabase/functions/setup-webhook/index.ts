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
    // SECURITY: Require service role key authentication
    const authHeader = req.headers.get('authorization')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!authHeader || authHeader !== `Bearer ${serviceRoleKey}`) {
      console.warn('Unauthorized setup-webhook attempt')
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.UNAUTHORIZED }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
    
    if (!TELEGRAM_BOT_TOKEN) {
      return new Response(JSON.stringify({ error: ERROR_MESSAGES.NOT_CONFIGURED }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Extract project ref from SUPABASE_URL
    const projectRef = SUPABASE_URL?.match(/https:\/\/([^.]+)/)?.[1]
    const webhookUrl = `https://${projectRef}.supabase.co/functions/v1/telegram-webhook`
    
    // Get the webhook secret for authentication
    const TELEGRAM_WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')
    
    if (!TELEGRAM_WEBHOOK_SECRET) {
      console.error('TELEGRAM_WEBHOOK_SECRET not configured')
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.NOT_CONFIGURED }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Setting webhook to:', webhookUrl)

    // Set webhook with secret_token for request validation
    // Telegram will send this secret in the x-telegram-bot-api-secret-token header
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
    console.log('setWebhook result:', setResult.ok ? 'success' : 'failed')

    // Get webhook info
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
