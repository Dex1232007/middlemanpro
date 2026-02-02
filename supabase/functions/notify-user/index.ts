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

async function sendTelegramMessage(chatId: number, text: string, parseMode = 'Markdown', keyboard?: object) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
  }
  if (keyboard) body.reply_markup = keyboard
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  
  const result = await response.json()
  console.log('Telegram send result:', result)
  return result
}

interface NotifyRequest {
  type: 'withdrawal_approved' | 'withdrawal_rejected' | 'dispute_resolved_buyer' | 'dispute_resolved_seller' | 'deposit_confirmed' | 'custom' | 'admin_new_dispute' | 'admin_new_withdrawal' | 'admin_high_value_tx' | 'admin_new_deposit' | 'admin_transaction_completed' | 'mmk_deposit_approved' | 'mmk_deposit_rejected' | 'admin_new_mmk_withdrawal' | 'mmk_withdrawal_approved' | 'mmk_withdrawal_rejected' | 'admin_new_mmk_deposit'
  profile_id?: string
  telegram_id?: number
  amount?: number
  tx_hash?: string
  admin_notes?: string
  resolution?: 'completed' | 'cancelled'
  product_title?: string
  custom_message?: string
  // Additional fields for admin notifications
  user_telegram_username?: string
  transaction_link?: string
  destination_wallet?: string
  // High-value transaction fields
  buyer_username?: string
  seller_username?: string
  // Deposit fields
  unique_code?: string
  currency?: string
  payment_method?: string
  new_balance?: number
  // MMK specific fields
  account_name?: string
  withdrawal_id?: string
  deposit_id?: string
}

async function verifyAdminAuth(req: Request): Promise<{ authorized: boolean; error?: string }> {
  const authHeader = req.headers.get('authorization')
  
  if (!authHeader) {
    return { authorized: false, error: 'No authorization header' }
  }

  // Check if it's a service role call (internal/cron)
  const token = authHeader.replace('Bearer ', '')
  if (token === SUPABASE_SERVICE_ROLE_KEY) {
    return { authorized: true }
  }

  // Otherwise, verify user is authenticated admin
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    })

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { authorized: false, error: 'Invalid authentication' }
    }

    // Check if user is admin using service role client
    const { data: roleData, error: roleError } = await adminSupabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle()

    if (roleError || !roleData) {
      console.warn('Non-admin user attempted to use notify-user:', user.id)
      return { authorized: false, error: 'Admin privileges required' }
    }

    return { authorized: true }
  } catch (error) {
    console.error('Auth verification error:', error)
    return { authorized: false, error: 'Authentication failed' }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Verify admin authentication
    const authResult = await verifyAdminAuth(req)
    if (!authResult.authorized) {
      console.warn('Unauthorized notify-user attempt:', authResult.error)
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    const body: NotifyRequest = await req.json()
    console.log('Notify request:', body)

    let telegramId = body.telegram_id

    // For admin notifications, get admin telegram ID from settings
    if (body.type === 'admin_new_dispute' || body.type === 'admin_new_withdrawal' || body.type === 'admin_high_value_tx' || body.type === 'admin_new_deposit' || body.type === 'admin_transaction_completed' || body.type === 'admin_new_mmk_withdrawal' || body.type === 'admin_new_mmk_deposit') {
      const { data: adminSetting } = await adminSupabase
        .from('settings')
        .select('value')
        .eq('key', 'admin_telegram_id')
        .maybeSingle()
      
      if (adminSetting?.value) {
        telegramId = parseInt(adminSetting.value)
        console.log('Admin telegram ID:', telegramId)
      } else {
        console.warn('Admin telegram ID not configured')
        return new Response(
          JSON.stringify({ success: false, message: 'Admin Telegram ID not configured' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    } else {
      // Get telegram_id from profile_id if not provided
      if (!telegramId && body.profile_id) {
        const { data: profile } = await adminSupabase
          .from('profiles')
          .select('telegram_id')
          .eq('id', body.profile_id)
          .single()
        
        if (profile?.telegram_id) {
          telegramId = profile.telegram_id
        }
      }
    }

    if (!telegramId) {
      return new Response(
        JSON.stringify({ error: 'No telegram_id found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    let message = ''

    switch (body.type) {
      case 'withdrawal_approved':
        message = `✅ *ငွေထုတ်ယူမှု အတည်ပြုပြီးပါပြီ!*

💰 ပမာဏ: ${Number(body.amount).toFixed(4)} TON
${body.tx_hash ? `🔗 TX Hash: \`${body.tx_hash}\`` : ''}
${body.admin_notes ? `📝 မှတ်ချက်: ${body.admin_notes}` : ''}

သင့်ပိုက်ဆံအိတ်သို့ ပေးပို့ပြီးပါပြီ။`
        break

      case 'withdrawal_rejected':
        message = `❌ *ငွေထုတ်ယူမှု ငြင်းပယ်ခံရပါပြီ*

💰 ပမာဏ: ${Number(body.amount).toFixed(4)} TON
${body.admin_notes ? `📝 အကြောင်းပြချက်: ${body.admin_notes}` : ''}

သင့်လက်ကျန်ငွေသို့ ပြန်လည်ထည့်သွင်းပေးပါပြီ။`
        break

      case 'dispute_resolved_buyer':
        message = body.resolution === 'completed'
          ? `✅ *အငြင်းပွားမှု ဖြေရှင်းပြီးပါပြီ*

📦 ${body.product_title || 'ပစ္စည်း'}
💵 ${Number(body.amount).toFixed(4)} TON

ရောင်းသူထံ ငွေလွှဲပြောင်းပေးပြီးပါပြီ။`
          : `✅ *အငြင်းပွားမှု ဖြေရှင်းပြီးပါပြီ*

📦 ${body.product_title || 'ပစ္စည်း'}
💵 ${Number(body.amount).toFixed(4)} TON

အရောင်းအဝယ် ပယ်ဖျက်ပြီးပါပြီ။`
        break

      case 'dispute_resolved_seller':
        message = body.resolution === 'completed'
          ? `✅ *အငြင်းပွားမှု ဖြေရှင်းပြီးပါပြီ*

📦 ${body.product_title || 'ပစ္စည်း'}
💰 ရရှိသောငွေ: ${Number(body.amount).toFixed(4)} TON

သင့်လက်ကျန်ငွေသို့ ထည့်သွင်းပေးပြီးပါပြီ။`
          : `❌ *အငြင်းပွားမှု ဖြေရှင်းပြီးပါပြီ*

📦 ${body.product_title || 'ပစ္စည်း'}

အရောင်းအဝယ် ပယ်ဖျက်ခံရပါပြီ။`
        break

      case 'deposit_confirmed':
        message = `💰 *ငွေသွင်းမှု အတည်ပြုပြီးပါပြီ!*

ပမာဏ: ${Number(body.amount).toFixed(4)} TON
${body.tx_hash ? `TX Hash: \`${body.tx_hash}\`` : ''}`
        break

      case 'admin_new_dispute':
        message = `⚠️ *အငြင်းပွားမှု အသစ်ရောက်ရှိလာပါပြီ!*

╔══════════════════════════════╗
║                              ║
║    🚨 *NEW DISPUTE*          ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
📦 *${body.product_title || 'ပစ္စည်း'}*
💵 ပမာဏ: *${Number(body.amount).toFixed(4)} TON*
👤 ဝယ်သူ: ${body.user_telegram_username ? `@${body.user_telegram_username}` : 'Unknown'}
🏪 ရောင်းသူ: ${body.seller_username ? `@${body.seller_username}` : 'Unknown'}
🔗 Link: \`${body.transaction_link || 'N/A'}\`
━━━━━━━━━━━━━━━━━━━━━━━━━

📋 *ဖြေရှင်းရန် အောက်မှ ရွေးချယ်ပါ:*
✅ ပြီးဆုံး = ရောင်းသူထံ ငွေလွှဲ
❌ ပယ်ဖျက် = ဝယ်သူထံ ငွေပြန်အမ်း`
        
        // Send with resolution buttons
        const disputeBtns = {
          inline_keyboard: [
            [
              { text: '✅ ပြီးဆုံး (ရောင်းသူထံ)', callback_data: `adm:dcomp:${body.transaction_link}` },
              { text: '❌ ပယ်ဖျက် (ဝယ်သူထံ)', callback_data: `adm:dcanc:${body.transaction_link}` }
            ]
          ]
        }
        await sendTelegramMessage(telegramId, message, 'Markdown', disputeBtns)
        
        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

      case 'admin_new_withdrawal':
        message = `💸 *ငွေထုတ်ယူမှု အသစ်ရောက်ရှိလာပါပြီ!*

💰 ပမာဏ: ${Number(body.amount).toFixed(4)} TON
👤 အသုံးပြုသူ: ${body.user_telegram_username ? `@${body.user_telegram_username}` : 'Unknown'}
📤 Destination: \`${body.destination_wallet?.substring(0, 10)}...${body.destination_wallet?.slice(-6) || 'N/A'}\`

ကျေးဇူးပြု၍ Admin Dashboard မှ စစ်ဆေးပါ။`
        break

      case 'admin_high_value_tx':
        message = `💎 *High-Value Transaction!*

━━━━━━━━━━━━━━━
📦 ${body.product_title || 'ပစ္စည်း'}
💰 ပမာဏ: *${Number(body.amount).toFixed(4)} TON*
🛒 ဝယ်သူ: ${body.buyer_username ? `@${body.buyer_username}` : 'Unknown'}
🏪 ရောင်းသူ: ${body.seller_username ? `@${body.seller_username}` : 'Unknown'}
${body.tx_hash ? `🔗 Hash: \`${body.tx_hash.substring(0, 16)}...\`` : ''}
━━━━━━━━━━━━━━━

✅ ငွေပေးချေမှု အတည်ပြုပြီးပါပြီ။`
        break

      case 'admin_new_deposit':
        message = `💰 *ငွေသွင်းမှု အသစ်!*

━━━━━━━━━━━━━━━
💵 ပမာဏ: *${Number(body.amount).toFixed(4)} TON*
👤 အသုံးပြုသူ: ${body.user_telegram_username ? `@${body.user_telegram_username}` : 'Unknown'}
🔑 Code: \`${body.unique_code || 'N/A'}\`
${body.tx_hash ? `🔗 Hash: \`${body.tx_hash.substring(0, 16)}...\`` : ''}
━━━━━━━━━━━━━━━

✅ Balance သို့ ထည့်သွင်းပြီးပါပြီ။`
        break

      case 'admin_transaction_completed':
        message = `✅ *ရောင်းဝယ်မှု ပြီးဆုံးပြီး!*

━━━━━━━━━━━━━━━
📦 ${body.product_title || 'ပစ္စည်း'}
💰 ပမာဏ: *${Number(body.amount).toFixed(4)} TON*
🛒 ဝယ်သူ: ${body.buyer_username ? `@${body.buyer_username}` : 'Unknown'}
🏪 ရောင်းသူ: ${body.seller_username ? `@${body.seller_username}` : 'Unknown'}
━━━━━━━━━━━━━━━

💵 ရောင်းသူ Balance ထဲသို့ ငွေထည့်ပြီးပါပြီ။`
        break

      case 'mmk_deposit_approved':
        const methodNameApproved = body.payment_method === 'KBZPAY' ? 'KBZPay' : body.payment_method === 'WAVEPAY' ? 'WavePay' : 'MMK'
        message = `✅ *ငွေသွင်းမှု အတည်ပြုပြီးပါပြီ!*

╔══════════════════════════════╗
║                              ║
║     💵 *DEPOSIT APPROVED*    ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
💵 *ပမာဏ:* ${Number(body.amount).toLocaleString()} MMK
📱 *Payment:* ${methodNameApproved}
🔑 *Code:* \`${body.unique_code || 'N/A'}\`
━━━━━━━━━━━━━━━━━━━━━━━━━

💰 *လက်ကျန်ငွေ:* ${Number(body.new_balance || 0).toLocaleString()} MMK
${body.admin_notes ? `📝 *မှတ်ချက်:* ${body.admin_notes}` : ''}

✅ သင့် Balance ထဲသို့ ထည့်သွင်းပြီးပါပြီ။`
        break

      case 'mmk_deposit_rejected':
        const methodNameRejected = body.payment_method === 'KBZPAY' ? 'KBZPay' : body.payment_method === 'WAVEPAY' ? 'WavePay' : 'MMK'
        message = `❌ *ငွေသွင်းမှု ငြင်းပယ်ခံရပါပြီ*

╔══════════════════════════════╗
║                              ║
║     ❌ *DEPOSIT REJECTED*    ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
💵 *ပမာဏ:* ${Number(body.amount).toLocaleString()} MMK
📱 *Payment:* ${methodNameRejected}
🔑 *Code:* \`${body.unique_code || 'N/A'}\`
━━━━━━━━━━━━━━━━━━━━━━━━━
${body.admin_notes ? `\n📝 *အကြောင်းပြချက်:* ${body.admin_notes}\n` : ''}
⚠️ ပြန်လည်ကြိုးစားလိုပါက ငွေသွင်းမှုအသစ် ပြုလုပ်ပါ။`
        break

      case 'admin_new_mmk_withdrawal':
        const mmkMethodName = body.payment_method === 'KBZPAY' ? 'KBZPay' : body.payment_method === 'WAVEPAY' ? 'WavePay' : 'MMK'
        const mmkMethodIcon = body.payment_method === 'KBZPAY' ? '📱' : '📲'
        message = `💵 *MMK ငွေထုတ်ယူမှု အသစ်!*

╔══════════════════════════════╗
║                              ║
║   ${mmkMethodIcon} *NEW MMK WITHDRAWAL*   ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
💵 *ပမာဏ:* ${Number(body.amount).toLocaleString()} MMK
${mmkMethodIcon} *Payment:* ${mmkMethodName}
👤 *Account:* ${body.account_name || 'N/A'}
📱 *Phone:* \`${body.destination_wallet}\`
👤 *အသုံးပြုသူ:* ${body.user_telegram_username ? `@${body.user_telegram_username}` : 'Unknown'}
━━━━━━━━━━━━━━━━━━━━━━━━━

📋 *ဖြေရှင်းရန် အောက်မှ ရွေးချယ်ပါ:*`
        
        // Send with approve/reject buttons for MMK withdrawal
        if (body.withdrawal_id) {
          const mmkWdBtns = {
            inline_keyboard: [
              [
                { text: '✅ အတည်ပြု', callback_data: `adm:mwdap:${body.withdrawal_id}` },
                { text: '❌ ငြင်းပယ်', callback_data: `adm:mwdrej:${body.withdrawal_id}` }
              ]
            ]
          }
          await sendTelegramMessage(telegramId, message, 'Markdown', mmkWdBtns)
          
          return new Response(
            JSON.stringify({ success: true }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        break

      case 'admin_new_mmk_deposit':
        const depMethodName = body.payment_method === 'KBZPAY' ? 'KBZPay' : body.payment_method === 'WAVEPAY' ? 'WavePay' : 'MMK'
        const depMethodIcon = body.payment_method === 'KBZPAY' ? '📱' : '📲'
        message = `💰 *MMK ငွေသွင်းမှု အသစ်!*

╔══════════════════════════════╗
║                              ║
║   ${depMethodIcon} *NEW MMK DEPOSIT*      ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
💵 *ပမာဏ:* ${Number(body.amount).toLocaleString()} MMK
${depMethodIcon} *Payment:* ${depMethodName}
🔑 *Code:* \`${body.unique_code || 'N/A'}\`
👤 *အသုံးပြုသူ:* ${body.user_telegram_username ? `@${body.user_telegram_username}` : 'Unknown'}
━━━━━━━━━━━━━━━━━━━━━━━━━

📋 *ဖြေရှင်းရန် အောက်မှ ရွေးချယ်ပါ:*`
        
        // Send with approve/reject buttons for MMK deposit
        if (body.deposit_id) {
          const mmkDepBtns = {
            inline_keyboard: [
              [
                { text: '✅ အတည်ပြု', callback_data: `adm:mdepap:${body.deposit_id}` },
                { text: '❌ ငြင်းပယ်', callback_data: `adm:mdeprej:${body.deposit_id}` }
              ]
            ]
          }
          await sendTelegramMessage(telegramId, message, 'Markdown', mmkDepBtns)
          
          return new Response(
            JSON.stringify({ success: true }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        break

      case 'mmk_withdrawal_approved':
        const approvedMethodName = body.payment_method === 'KBZPAY' ? 'KBZPay' : body.payment_method === 'WAVEPAY' ? 'WavePay' : 'MMK'
        const approvedMethodIcon = body.payment_method === 'KBZPAY' ? '📱' : '📲'
        message = `✅ *ငွေထုတ်ယူမှု အတည်ပြုပြီးပါပြီ!*

╔══════════════════════════════╗
║                              ║
║   ${approvedMethodIcon} *WITHDRAWAL APPROVED*  ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
💵 *ပမာဏ:* ${Number(body.amount).toLocaleString()} MMK
${approvedMethodIcon} *Payment:* ${approvedMethodName}
📱 *Phone:* \`${body.destination_wallet}\`
━━━━━━━━━━━━━━━━━━━━━━━━━
${body.tx_hash ? `\n🔗 *Reference:* \`${body.tx_hash}\`\n` : ''}
${body.admin_notes ? `📝 *မှတ်ချက်:* ${body.admin_notes}\n` : ''}
💰 *လက်ကျန်ငွေ:* ${Number(body.new_balance || 0).toLocaleString()} MMK

✅ သင့်ဖုန်းသို့ ငွေပို့ပြီးပါပြီ။`
        break

      case 'mmk_withdrawal_rejected':
        const rejectedMethodName = body.payment_method === 'KBZPAY' ? 'KBZPay' : body.payment_method === 'WAVEPAY' ? 'WavePay' : 'MMK'
        const rejectedMethodIcon = body.payment_method === 'KBZPAY' ? '📱' : '📲'
        message = `❌ *ငွေထုတ်ယူမှု ငြင်းပယ်ခံရပါပြီ*

╔══════════════════════════════╗
║                              ║
║   ${rejectedMethodIcon} *WITHDRAWAL REJECTED*  ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
💵 *ပမာဏ:* ${Number(body.amount).toLocaleString()} MMK
${rejectedMethodIcon} *Payment:* ${rejectedMethodName}
📱 *Phone:* \`${body.destination_wallet}\`
━━━━━━━━━━━━━━━━━━━━━━━━━
${body.admin_notes ? `\n📝 *အကြောင်းပြချက်:* ${body.admin_notes}\n` : ''}
💰 *လက်ကျန်ငွေ:* ${Number(body.new_balance || 0).toLocaleString()} MMK
   _(ငွေပြန်ထည့်ပေးပြီးပါပြီ)_

⚠️ ပြန်လည်ကြိုးစားလိုပါက ငွေထုတ်ယူမှုအသစ် ပြုလုပ်ပါ။`
        break

      case 'custom':
        message = body.custom_message || 'Notification from Middleman Bot'
        break

      default:
        message = 'Notification from Middleman Bot'
    }

    await sendTelegramMessage(telegramId, message)

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: unknown) {
    console.error('Notify error:', error)
    return new Response(
      JSON.stringify({ error: 'Notification failed' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
