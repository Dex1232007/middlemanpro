import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function sendTelegramMessage(chatId: number, text: string, parseMode = 'Markdown') {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
    }),
  })
  
  const result = await response.json()
  return result
}

async function verifyAdminAuth(req: Request): Promise<{ authorized: boolean; error?: string }> {
  const authHeader = req.headers.get('authorization')
  
  if (!authHeader) {
    return { authorized: false, error: 'No authorization header' }
  }

  const token = authHeader.replace('Bearer ', '')
  if (token === SUPABASE_SERVICE_ROLE_KEY) {
    return { authorized: true }
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    })

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { authorized: false, error: 'Invalid authentication' }
    }

    const { data: roleData, error: roleError } = await adminSupabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle()

    if (roleError || !roleData) {
      return { authorized: false, error: 'Admin privileges required' }
    }

    return { authorized: true }
  } catch (error) {
    console.error('Auth verification error:', error)
    return { authorized: false, error: 'Authentication failed' }
  }
}

interface BroadcastRequest {
  message: string
  target?: 'all' | 'active' | 'with_balance'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Verify admin authentication
    const authResult = await verifyAdminAuth(req)
    if (!authResult.authorized) {
      console.warn('Unauthorized broadcast attempt:', authResult.error)
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    const body: BroadcastRequest = await req.json()
    console.log('Broadcast request:', body)

    if (!body.message || body.message.trim() === '') {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Get users based on target
    let query = adminSupabase
      .from('profiles')
      .select('telegram_id, telegram_username')
      .not('telegram_id', 'is', null)
      .eq('is_blocked', false)

    if (body.target === 'with_balance') {
      query = query.gt('balance', 0)
    }

    const { data: users, error: usersError } = await query

    if (usersError) {
      console.error('Error fetching users:', usersError)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch users' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    if (!users || users.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, failed: 0, message: 'No users to send' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Format message with header
    const formattedMessage = `📢 *Admin မှ ကြေညာချက်*

━━━━━━━━━━━━━━━

${body.message}

━━━━━━━━━━━━━━━
_Middleman Bot_`

    let sent = 0
    let failed = 0
    const errors: string[] = []

    // Send messages with rate limiting (30 messages per second max for Telegram)
    for (const user of users) {
      if (!user.telegram_id) continue

      try {
        const result = await sendTelegramMessage(user.telegram_id, formattedMessage)
        
        if (result.ok) {
          sent++
        } else {
          failed++
          errors.push(`${user.telegram_username || user.telegram_id}: ${result.description}`)
        }

        // Rate limiting: wait 50ms between messages
        await new Promise(resolve => setTimeout(resolve, 50))
      } catch (error) {
        failed++
        errors.push(`${user.telegram_username || user.telegram_id}: ${error}`)
      }
    }

    console.log(`Broadcast complete: ${sent} sent, ${failed} failed`)

    return new Response(
      JSON.stringify({ 
        success: true, 
        sent, 
        failed,
        total: users.length,
        errors: errors.slice(0, 10) // Return first 10 errors only
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: unknown) {
    console.error('Broadcast error:', error)
    return new Response(
      JSON.stringify({ error: 'Broadcast failed' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
