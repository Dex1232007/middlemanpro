import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ERROR_MESSAGES = {
  UNAUTHORIZED: 'Unauthorized access',
  NOT_ADMIN: 'Admin privileges required',
  INVALID_TOKEN: 'Invalid bot token format',
  OPERATION_FAILED: 'Operation failed. Please try again.',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    
    // Get the authorization header
    const authHeader = req.headers.get('authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.UNAUTHORIZED }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    // Create Supabase client with user's token
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    })

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.UNAUTHORIZED }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    // Check if user is admin
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle()

    if (roleError || !roleData) {
      console.warn('Non-admin user attempted to update bot token:', user.id)
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.NOT_ADMIN }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      )
    }

    // Get request body
    const { botToken } = await req.json()

    // Validate bot token format (should be like: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz)
    const tokenRegex = /^\d+:[A-Za-z0-9_-]+$/
    if (!botToken || typeof botToken !== 'string' || !tokenRegex.test(botToken)) {
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.INVALID_TOKEN }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Verify the token by calling Telegram API
    const verifyRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`)
    const verifyData = await verifyRes.json()

    if (!verifyData.ok) {
      return new Response(
        JSON.stringify({ error: 'Bot token verification failed. Please check your token.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Store the new token in settings table for reference
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey)

    // Update or insert bot token setting (masked for display)
    const maskedToken = botToken.substring(0, 10) + '...' + botToken.substring(botToken.length - 5)
    
    const { error: settingsError } = await adminSupabase
      .from('settings')
      .upsert({
        key: 'telegram_bot_token_masked',
        value: maskedToken,
        description: 'Telegram Bot Token (masked)'
      }, { onConflict: 'key' })

    if (settingsError) {
      console.error('Settings update error:', settingsError)
    }

    // Auto-save bot_username from validated token
    const botUsername = verifyData.result.username
    const { error: usernameError } = await adminSupabase
      .from('settings')
      .upsert({
        key: 'bot_username',
        value: botUsername,
        description: 'Telegram Bot Username (auto-fetched)'
      }, { onConflict: 'key' })
    
    if (usernameError) {
      console.error('Bot username save error:', usernameError)
    } else {
      console.log('Bot username auto-saved:', botUsername)
    }

    console.log('Bot token validated successfully for bot:', verifyData.result.username)

    // Automatically set up webhook for the new bot token
    const TELEGRAM_WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')
    let webhookResult = { success: false, message: 'Webhook secret not configured' }
    
    if (TELEGRAM_WEBHOOK_SECRET) {
      const projectRef = supabaseUrl?.match(/https:\/\/([^.]+)/)?.[1]
      const webhookUrl = `https://${projectRef}.supabase.co/functions/v1/telegram-webhook`
      
      console.log('Setting up webhook for new bot to:', webhookUrl)
      
      try {
        const setWebhookRes = await fetch(
          `https://api.telegram.org/bot${botToken}/setWebhook`,
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
        console.log('Webhook setup result:', setResult.ok ? 'success' : 'failed', setResult.description)
        
        webhookResult = {
          success: setResult.ok,
          message: setResult.ok ? 'Webhook configured successfully' : (setResult.description || 'Webhook setup failed')
        }
      } catch (webhookError) {
        console.error('Webhook setup error:', webhookError)
        webhookResult = { success: false, message: 'Webhook setup failed' }
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Bot token validated successfully',
        botUsername: verifyData.result.username,
        botName: verifyData.result.first_name,
        webhook: webhookResult,
        note: 'Please update the TELEGRAM_BOT_TOKEN secret in Lovable Cloud settings to apply the new token.'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: unknown) {
    console.error('Update bot token error:', error)
    return new Response(
      JSON.stringify({ error: ERROR_MESSAGES.OPERATION_FAILED }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})