import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Define bot commands
    const commands = [
      { command: 'start', description: '🏠 ပင်မစာမျက်နှာ' },
      { command: 'ping', description: '🟢 Bot Alive စစ်ဆေးရန်' },
      { command: 'balance', description: '💰 လက်ကျန်ငွေ စစ်ရန်' },
      { command: 'referral', description: '🎁 Referral Link & Stats' },
      { command: 'sell', description: '📦 ရောင်းမယ် (ဥပမာ: /sell iPhone 150)' },
      { command: 'help', description: '📚 Commands များ ကြည့်ရန်' },
    ]

    // Call Telegram API to set commands
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands }),
    })

    const result = await res.json()

    if (result.ok) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Bot commands set successfully!',
          commands: commands.map(c => `/${c.command} - ${c.description}`)
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } else {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: result.description || 'Failed to set commands'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }
  } catch (error) {
    console.error('Set bot commands error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to set commands' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
