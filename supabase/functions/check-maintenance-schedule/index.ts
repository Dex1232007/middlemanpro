import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function sendTelegramMessage(chatId: number, text: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    })
    return (await res.json()).ok
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Get scheduled maintenance settings
    const { data: settings } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', [
        'scheduled_maintenance_enabled',
        'scheduled_maintenance_start',
        'scheduled_maintenance_end',
        'bot_maintenance',
        'admin_telegram_id'
      ])

    const getValue = (key: string) => settings?.find(s => s.key === key)?.value

    const scheduledEnabled = getValue('scheduled_maintenance_enabled') === 'true'
    const scheduleStart = getValue('scheduled_maintenance_start')
    const scheduleEnd = getValue('scheduled_maintenance_end')
    const currentMaintenance = getValue('bot_maintenance') === 'true'
    const adminTelegramId = getValue('admin_telegram_id')

    if (!scheduledEnabled || !scheduleStart || !scheduleEnd) {
      return new Response(
        JSON.stringify({ success: true, message: 'Scheduled maintenance not enabled' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const now = new Date()
    const startTime = new Date(scheduleStart)
    const endTime = new Date(scheduleEnd)

    console.log(`Checking schedule: now=${now.toISOString()}, start=${startTime.toISOString()}, end=${endTime.toISOString()}`)

    let action: 'enable' | 'disable' | 'none' = 'none'

    // Check if we're within the maintenance window
    if (now >= startTime && now < endTime) {
      // Should be in maintenance mode
      if (!currentMaintenance) {
        action = 'enable'
      }
    } else if (now >= endTime) {
      // Maintenance window has ended
      if (currentMaintenance) {
        action = 'disable'
      }
      // Also disable the schedule since it's complete
      await supabase.from('settings').upsert({ 
        key: 'scheduled_maintenance_enabled', 
        value: 'false' 
      }, { onConflict: 'key' })
    }

    if (action !== 'none') {
      // Toggle maintenance mode
      const newValue = action === 'enable' ? 'true' : 'false'
      await supabase.from('settings').upsert({ 
        key: 'bot_maintenance', 
        value: newValue 
      }, { onConflict: 'key' })

      console.log(`Maintenance mode ${action === 'enable' ? 'ENABLED' : 'DISABLED'} by schedule`)

      // Notify admin
      if (adminTelegramId) {
        const message = action === 'enable'
          ? `🔧 *SCHEDULED MAINTENANCE STARTED*\n\n━━━━━━━━━━━━━━━\n⚠️ Bot အလိုအလျောက် ပိတ်ပြီး\n━━━━━━━━━━━━━━━\n\n📅 အချိန်: ${now.toLocaleString('my-MM')}\n⏰ ပြီးဆုံးမည်: ${endTime.toLocaleString('my-MM')}\n\n💡 User များ bot ကို အသုံးပြု၍မရတော့ပါ`
          : `✅ *SCHEDULED MAINTENANCE ENDED*\n\n━━━━━━━━━━━━━━━\n🟢 Bot အလိုအလျောက် ပြန်ဖွင့်ပြီး\n━━━━━━━━━━━━━━━\n\n📅 အချိန်: ${now.toLocaleString('my-MM')}\n\n💡 User များ ပုံမှန်အတိုင်း အသုံးပြုနိုင်ပါပြီ`

        await sendTelegramMessage(parseInt(adminTelegramId), message)
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          action,
          message: `Maintenance mode ${action === 'enable' ? 'enabled' : 'disabled'} by schedule`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: true, action: 'none', message: 'No action needed' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Check maintenance schedule error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to check schedule' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
