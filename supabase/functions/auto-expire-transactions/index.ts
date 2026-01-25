import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Send Telegram message
async function sendMessage(chatId: number, text: string, keyboard?: object): Promise<boolean> {
  try {
    const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'Markdown' }
    if (keyboard) body.reply_markup = keyboard
    
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    
    const result = await res.json()
    return result.ok
  } catch (e) {
    console.error('sendMessage error:', e)
    return false
  }
}

// Edit existing message
async function editText(chatId: number, msgId: number, text: string, keyboard?: object): Promise<boolean> {
  try {
    const body: Record<string, unknown> = { chat_id: chatId, message_id: msgId, text, parse_mode: 'Markdown' }
    if (keyboard) body.reply_markup = keyboard
    
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    
    const result = await res.json()
    return result.ok
  } catch (e) {
    console.error('editText error:', e)
    return false
  }
}

const backBtn = () => ({
  inline_keyboard: [[{ text: '🏠 ပင်မစာမျက်နှာ', callback_data: 'm:home' }]],
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    console.log('Checking for expired transactions...')

    // Find expired pending_payment transactions
    const { data: expiredTxs, error: fetchError } = await supabase
      .from('transactions')
      .select('*')
      .eq('status', 'pending_payment')
      .not('expires_at', 'is', null)
      .lt('expires_at', new Date().toISOString())

    if (fetchError) {
      console.error('Error fetching expired transactions:', fetchError)
      throw fetchError
    }

    if (!expiredTxs || expiredTxs.length === 0) {
      console.log('No expired transactions found')
      return new Response(
        JSON.stringify({ ok: true, message: 'No expired transactions', count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Found ${expiredTxs.length} expired transactions`)

    let cancelledCount = 0
    let notifiedBuyers = 0
    let notifiedSellers = 0

    for (const tx of expiredTxs) {
      // Get product info
      let productTitle = 'Unknown'
      if (tx.product_id) {
        const { data: product } = await supabase
          .from('products')
          .select('title')
          .eq('id', tx.product_id)
          .maybeSingle()
        if (product) productTitle = product.title
      }

      // Get buyer info
      let buyer: { telegram_id: number | null; telegram_username: string | null } | null = null
      if (tx.buyer_id) {
        const { data } = await supabase
          .from('profiles')
          .select('telegram_id, telegram_username')
          .eq('id', tx.buyer_id)
          .maybeSingle()
        buyer = data
      }

      // Get seller info
      let seller: { telegram_id: number | null; telegram_username: string | null } | null = null
      if (tx.seller_id) {
        const { data } = await supabase
          .from('profiles')
          .select('telegram_id, telegram_username')
          .eq('id', tx.seller_id)
          .maybeSingle()
        seller = data
      }

      // Update transaction status to cancelled
      const { error: updateError } = await supabase
        .from('transactions')
        .update({ status: 'cancelled' })
        .eq('id', tx.id)

      if (updateError) {
        console.error(`Error cancelling transaction ${tx.id}:`, updateError)
        continue
      }

      cancelledCount++
      console.log(`Cancelled expired transaction: ${tx.id}`)

      const amount = Number(tx.amount_ton).toFixed(4)

      // Notify buyer if exists
      if (buyer?.telegram_id) {
        let buyerNotified = false
        
        // Try to edit existing message first
        if (tx.buyer_msg_id) {
          buyerNotified = await editText(
            buyer.telegram_id,
            tx.buyer_msg_id,
            `⏰ *ရောင်းဝယ်မှု ပယ်ဖျက်ပြီး*

━━━━━━━━━━━━━━━
📦 *${productTitle}*
💵 ${amount} TON
━━━━━━━━━━━━━━━

❌ *အကြောင်းပြချက်:* 
သတ်မှတ်ချိန်အတွင်း ငွေမပေးချေရသဖြင့် 
အလိုအလျောက် ပယ်ဖျက်ပြီးပါပြီ

🔄 ထပ်မံဝယ်ယူလိုပါက link အသစ် တောင်းပါ`, backBtn()
          )
        }

        // If edit fails (message might be deleted), try sending new message
        if (!buyerNotified) {
          await sendMessage(
            buyer.telegram_id,
            `⏰ *ရောင်းဝယ်မှု ပယ်ဖျက်ပြီး*

━━━━━━━━━━━━━━━
📦 *${productTitle}*
💵 ${amount} TON
━━━━━━━━━━━━━━━

❌ *အကြောင်းပြချက်:* 
သတ်မှတ်ချိန်အတွင်း ငွေမပေးချေရသဖြင့် 
အလိုအလျောက် ပယ်ဖျက်ပြီးပါပြီ

🔄 ထပ်မံဝယ်ယူလိုပါက link အသစ် တောင်းပါ`, backBtn()
          )
        }
        notifiedBuyers++
      }

      // Notify seller
      if (seller?.telegram_id) {
        const buyerName = buyer?.telegram_username 
          ? `@${buyer.telegram_username}` 
          : `Buyer #${buyer?.telegram_id || 'Unknown'}`

        await sendMessage(
          seller.telegram_id,
          `⏰ *ရောင်းဝယ်မှု ပယ်ဖျက်ပြီး*

━━━━━━━━━━━━━━━
📦 *${productTitle}*
💵 ${amount} TON
👤 ဝယ်သူ: ${buyerName}
━━━━━━━━━━━━━━━

❌ *အကြောင်းပြချက်:* 
သတ်မှတ်ချိန်အတွင်း ငွေမပေးချေရသဖြင့် 
အလိုအလျောက် ပယ်ဖျက်ပြီးပါပြီ`, backBtn()
        )
        notifiedSellers++
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    const result = {
      ok: true,
      message: `Processed ${expiredTxs.length} expired transactions`,
      cancelled: cancelledCount,
      notifiedBuyers,
      notifiedSellers,
    }

    console.log('Auto-expire result:', result)

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Auto-expire error:', error)
    return new Response(
      JSON.stringify({ ok: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
