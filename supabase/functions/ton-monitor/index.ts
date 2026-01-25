import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { mnemonicToWalletKey } from 'npm:@ton/crypto@3.3.0'
import { WalletContractV4 } from 'npm:@ton/ton@16.1.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// TON API
const TON_API = 'https://toncenter.com/api/v2'

// Cache derived wallet address (derived once per invocation)
let cachedAdminWallet: string | null = null

// ==================== DERIVE ADMIN WALLET FROM MNEMONIC ====================
async function deriveAdminWallet(): Promise<string | null> {
  if (cachedAdminWallet) return cachedAdminWallet
  
  try {
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'ton_mnemonic_encrypted')
      .maybeSingle()
    
    if (!data?.value) {
      console.error('No mnemonic configured')
      return null
    }
    
    // Decrypt mnemonic
    const encryptionKey = SUPABASE_SERVICE_ROLE_KEY.substring(0, 64)
    const mnemonic = await decryptMnemonicForWallet(data.value, encryptionKey)
    const words = mnemonic.split(' ')
    
    if (words.length !== 24) {
      console.error('Invalid mnemonic word count:', words.length)
      return null
    }
    
    // Derive wallet address
    const keyPair = await mnemonicToWalletKey(words)
    const wallet = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 })
    cachedAdminWallet = wallet.address.toString({ bounceable: false })
    
    console.log('Derived admin wallet:', cachedAdminWallet)
    return cachedAdminWallet
  } catch (e) {
    console.error('Failed to derive wallet from mnemonic:', e)
    return null
  }
}

// Simple decrypt for wallet derivation (same as main decryptMnemonic but defined early)
async function decryptMnemonicForWallet(encryptedBase64: string, password: string): Promise<string> {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  
  const combined = new Uint8Array(atob(encryptedBase64).split('').map(c => c.charCodeAt(0)))
  
  const salt = combined.slice(0, 16)
  const iv = combined.slice(16, 28)
  const ciphertext = combined.slice(28)
  
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  )
  
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  )
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    ciphertext
  )
  
  return decoder.decode(decrypted)
}

interface TonTx {
  hash: string
  utime: number
  in_msg: { source: string; destination: string; value: string; message?: string }
}

// ==================== PROGRESS BAR ====================
function progressBar(step: number, total: number): string {
  const filled = '▓'
  const empty = '░'
  const filledCount = Math.round((step / total) * 10)
  const emptyCount = 10 - filledCount
  const percent = Math.round((step / total) * 100)
  return `${filled.repeat(filledCount)}${empty.repeat(emptyCount)} ${percent}%`
}

// ==================== TELEGRAM ====================
async function sendTg(chatId: number, text: string, keyboard?: object) {
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'Markdown' }
  if (keyboard) body.reply_markup = keyboard
  
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  console.log('TG send:', (await res.json()).ok ? 'ok' : 'fail')
}

async function editTgMessage(chatId: number, msgId: number, text: string, keyboard?: object) {
  const body: Record<string, unknown> = { 
    chat_id: chatId, 
    message_id: msgId, 
    text, 
    parse_mode: 'Markdown' 
  }
  if (keyboard) body.reply_markup = keyboard
  
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result = await res.json()
    console.log('TG edit:', result.ok ? 'ok' : result.description)
    return result.ok
  } catch (e) {
    console.error('TG edit error:', e)
    return false
  }
}

// Edit message with new photo using editMessageMedia
async function editTgMediaWithPhoto(chatId: number, msgId: number, photoUrl: string, caption: string, keyboard?: object): Promise<boolean> {
  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      message_id: msgId,
      media: {
        type: 'photo',
        media: photoUrl,
        caption: caption,
        parse_mode: 'Markdown'
      }
    }
    if (keyboard) body.reply_markup = keyboard
    
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageMedia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    
    const result = await res.json()
    console.log('TG editMedia:', result.ok ? 'ok' : result.description)
    return result.ok
  } catch (e) {
    console.error('TG editMedia error:', e)
    return false
  }
}

const sellerBtns = (id: string) => ({
  inline_keyboard: [[
    { text: '📦 ပို့ပြီး', callback_data: `a:sent:${id}` },
    { text: '❌ ပယ်ဖျက်', callback_data: `a:cancel:${id}` },
  ]],
})

const buyerBtns = (id: string) => ({
  inline_keyboard: [[
    { text: '✅ ရရှိပြီး', callback_data: `a:recv:${id}` },
    { text: '⚠️ အငြင်းပွား', callback_data: `a:disp:${id}` },
  ]],
})

// ==================== TON API ====================
interface TonApiTx {
  transaction_id?: { hash?: string }
  hash?: string
  utime?: number
  lt?: string
  in_msg?: TonTx['in_msg']
}

async function getTransactions(wallet: string, limit = 50): Promise<TonTx[]> {
  try {
    const res = await fetch(`${TON_API}/getTransactions?address=${wallet}&limit=${limit}`)
    const data = await res.json()
    
    if (!data.ok) {
      console.error('TON API error:', data)
      return []
    }
    
    // Map API response to our interface - handle different hash field names
    return (data.result || []).map((tx: TonApiTx) => ({
      hash: tx.transaction_id?.hash || tx.hash || `${tx.utime}_${tx.lt}`,
      utime: tx.utime || 0,
      in_msg: tx.in_msg || { source: '', destination: '', value: '0' }
    }))
  } catch (e) {
    console.error('TON API error:', e)
    return []
  }
}

function nanoToTon(nano: string): number {
  return parseInt(nano) / 1e9
}

function normalizeWallet(addr: string): string {
  return addr.toLowerCase().replace(/[^a-z0-9]/g, '').slice(-40)
}

// ==================== CLEANUP OLD CONFIRMED DEPOSITS ====================
async function cleanupConfirmedDeposits() {
  // Delete confirmed deposits older than 24 hours
  const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  
  const { data: oldDeposits, error } = await supabase
    .from('deposits')
    .delete()
    .eq('status', 'confirmed')
    .lt('confirmed_at', cutoffDate)
    .select('id')
  
  if (error) {
    console.error('Cleanup error:', error)
    return 0
  }
  
  const count = oldDeposits?.length || 0
  if (count > 0) {
    console.log(`🧹 Cleaned up ${count} old confirmed deposits`)
  }
  return count
}

// ==================== EXPIRE DEPOSITS ====================
async function expireDeposits() {
  const now = new Date().toISOString()
  
  const { data: expired } = await supabase
    .from('deposits')
    .select('*, profile:profiles(*)')
    .eq('status', 'pending')
    .lt('expires_at', now)
  
  if (!expired?.length) return 0
  
  console.log(`Expiring ${expired.length} deposits...`)
  
  for (const dep of expired) {
    await supabase.from('deposits').update({ status: 'expired' }).eq('id', dep.id)
    
    // Notify user
    if (dep.profile?.telegram_id) {
      await sendTg(dep.profile.telegram_id, `⏰ *ငွေသွင်းမှု သက်တမ်းကုန်သွားပါပြီ*

━━━━━━━━━━━━━━━
💵 ပမာဏ: *${dep.amount_ton} TON*
🔑 Code: *${dep.unique_code}*
━━━━━━━━━━━━━━━

ထပ်မံငွေသွင်းလိုပါက /start နှိပ်ပြီး
"💰 ငွေသွင်း" ရွေးပါ`)
    }
  }
  
  return expired.length
}

// ==================== EXPIRE TRANSACTIONS (1-hour limit for buyers) ====================
async function expireTransactions() {
  const now = new Date().toISOString()
  
  const { data: expired } = await supabase
    .from('transactions')
    .select('*, products(*), buyer:profiles!transactions_buyer_id_fkey(*), seller:profiles!transactions_seller_id_fkey(*)')
    .eq('status', 'pending_payment')
    .not('expires_at', 'is', null)
    .lt('expires_at', now)
  
  if (!expired?.length) return 0
  
  console.log(`Expiring ${expired.length} transactions...`)
  
  for (const tx of expired) {
    // Mark as cancelled
    await supabase.from('transactions').update({ 
      status: 'cancelled',
      updated_at: new Date().toISOString()
    }).eq('id', tx.id)
    
    // Delete buyer's QR message if we have the message ID
    if (tx.buyer_msg_id && tx.buyer?.telegram_id) {
      await deleteTgMsg(tx.buyer.telegram_id, tx.buyer_msg_id)
      console.log(`Deleted buyer message ${tx.buyer_msg_id} for tx ${tx.id}`)
    }
    
    // Notify buyer
    if (tx.buyer?.telegram_id) {
      await sendTg(tx.buyer.telegram_id, `⏰ *အမှာစာ သက်တမ်းကုန်သွားပါပြီ*

━━━━━━━━━━━━━━━
📦 *${tx.products?.title || 'ပစ္စည်း'}*
💵 *${tx.amount_ton} TON*
━━━━━━━━━━━━━━━

1 နာရီအတွင်း ငွေပေးချေမှု မပြုလုပ်ခဲ့ပါ။
ထပ်မံဝယ်ယူလိုပါက link ကို ထပ်နှိပ်ပါ။`)
    }
    
    // Notify seller
    if (tx.seller?.telegram_id) {
      await sendTg(tx.seller.telegram_id, `⏰ *အရောင်းအဝယ် ပယ်ဖျက်ခံရပါပြီ*

━━━━━━━━━━━━━━━
📦 *${tx.products?.title || 'ပစ္စည်း'}*
💵 *${tx.amount_ton} TON*
━━━━━━━━━━━━━━━

ဝယ်သူက 1 နာရီအတွင်း ငွေမပေးချေခဲ့ပါ။
Product link: ယခင်အတိုင်း အသုံးပြုနိုင်ပါသည်။`)
    }
  }
  
  return expired.length
}

// Delete Telegram message helper
async function deleteTgMsg(chatId: number, msgId: number): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: msgId }),
    })
    return (await res.json()).ok
  } catch {
    return false
  }
}

// ==================== DEPOSIT PROCESSING ====================
async function processDeposit(tx: TonTx) {
  const hash = tx.hash
  const amount = nanoToTon(tx.in_msg.value)
  const sender = tx.in_msg.source
  const memo = tx.in_msg.message || ''

  console.log(`Processing: ${hash}, ${amount} TON, memo: ${memo}`)

  // Skip tiny amounts
  if (amount < 0.01) return

  // Check if already processed
  const { data: existing } = await supabase
    .from('deposits')
    .select('id')
    .eq('ton_tx_hash', hash)
    .maybeSingle()
  
  if (existing) return

  const { data: existingTx } = await supabase
    .from('transactions')
    .select('id')
    .eq('ton_tx_hash', hash)
    .maybeSingle()
  
  if (existingTx) return

  // Parse memo for matching
  // Format: tx_<unique_link> for transactions
  // Format: dep_<unique_code> for deposits (new format)
  // Format: dep_<profile_id>_<timestamp> for deposits (legacy)
  
  // 1. Check for transaction payment (tx_<link>)
  if (memo.startsWith('tx_')) {
    const link = memo.replace('tx_', '')
    const { data: pendingTx } = await supabase
      .from('transactions')
      .select('*, buyer:profiles!transactions_buyer_id_fkey(*), seller:profiles!transactions_seller_id_fkey(*), products(*)')
      .eq('unique_link', link)
      .eq('status', 'pending_payment')
      .single()

    if (pendingTx) {
      // Check if transaction expired (1-hour limit)
      if (pendingTx.expires_at && new Date(pendingTx.expires_at) < new Date()) {
        console.log(`⏰ Transaction expired: ${link}, payment after deadline - LOST`)
        
        // Mark as cancelled
        await supabase.from('transactions').update({ 
          status: 'cancelled',
          admin_notes: `Late payment received after expiration. Amount: ${amount} TON, Hash: ${hash}. User must contact admin for manual resolution.`,
          updated_at: new Date().toISOString()
        }).eq('id', pendingTx.id)
        
        // Notify buyer - payment is LOST
        if (pendingTx.buyer?.telegram_id) {
          await sendTg(pendingTx.buyer.telegram_id, `❌ *ငွေပေးချေမှု ပျက်ပြယ်ပါပြီ*

━━━━━━━━━━━━━━━
📦 *${pendingTx.products?.title || 'ပစ္စည်း'}*
💵 *${amount.toFixed(4)} TON*
━━━━━━━━━━━━━━━

⏰ 1 နာရီ အချိန်ကန့်သတ်ချက် ကျော်လွန်ပြီးနောက် ငွေပေးချေခဲ့ပါသည်။

⚠️ *သင့်ငွေ ပြန်ရယူရန် Admin ထံ ဆက်သွယ်ပါ*
Hash: \`${hash.substring(0, 20)}...\``)
        }
        
        // Notify seller
        if (pendingTx.seller?.telegram_id) {
          await sendTg(pendingTx.seller.telegram_id, `⚠️ *နောက်ကျငွေပေးချေမှု*

━━━━━━━━━━━━━━━
📦 *${pendingTx.products?.title || 'ပစ္စည်း'}*
💵 *${amount.toFixed(4)} TON*
━━━━━━━━━━━━━━━

ဝယ်သူက 1 နာရီ ကျော်ပြီးမှ ငွေပေးချေခဲ့သည်။
အမှာစာ ပယ်ဖျက်ပြီး ဖြစ်ပါသည်။`)
        }
        return
      }
      
      // Verify amount (with 5% tolerance)
      const expected = Number(pendingTx.amount_ton)
      const tolerance = Math.max(0.05, expected * 0.05)
      
      if (Math.abs(amount - expected) <= tolerance) {
        console.log(`✅ Matched TX payment: ${hash} -> ${pendingTx.id}`)
        
        await supabase.from('transactions').update({
          status: 'payment_received',
          ton_tx_hash: hash,
        }).eq('id', pendingTx.id)

        // Notify seller with buyer info
        if (pendingTx.seller?.telegram_id) {
          const buyerUsername = pendingTx.buyer?.telegram_username 
            ? `@${pendingTx.buyer.telegram_username}` 
            : `ID: ${pendingTx.buyer?.telegram_id || 'Unknown'}`
          
          await sendTg(pendingTx.seller.telegram_id, `💰 *ငွေရရှိပြီး!*

━━━━━━━━━━━━━━━
📦 *${pendingTx.products?.title}*
💵 *${amount.toFixed(4)} TON*
👤 ${buyerUsername}
━━━━━━━━━━━━━━━

💬 Chat လုပ်ပြီး ပစ္စည်းပို့ပါ
ပို့ပြီးရင် "ပို့ပြီး" နှိပ်ပါ`, sellerBtns(pendingTx.id))
        }

        // Update buyer's QR message using editMessageMedia
        if (pendingTx.buyer?.telegram_id && pendingTx.buyer_msg_id) {
          const sellerUsername = pendingTx.seller?.telegram_username 
            ? `@${pendingTx.seller.telegram_username}` 
            : `Seller`
          
          const successQR = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent('PAID')}&bgcolor=90EE90`
          await editTgMediaWithPhoto(pendingTx.buyer.telegram_id, pendingTx.buyer_msg_id, successQR, `✅ *ငွေပေးချေမှု အတည်ပြုပြီး!*

━━━━━━━━━━━━━━━
📦 *${pendingTx.products?.title}*
💵 *${amount.toFixed(4)} TON*
🏪 ${sellerUsername}
━━━━━━━━━━━━━━━

⏳ ရောင်းသူမှ ပစ္စည်းပို့ပေးပါမည်
⚠️ ပစ္စည်းမရမီ "ရရှိပြီး" မနှိပ်ပါ!`, buyerBtns(pendingTx.id))
        } else if (pendingTx.buyer?.telegram_id) {
          // Fallback: send new message if no msg_id stored
          const sellerUsername = pendingTx.seller?.telegram_username 
            ? `@${pendingTx.seller.telegram_username}` 
            : `Seller`
          
          await sendTg(pendingTx.buyer.telegram_id, `✅ *ငွေပေးချေမှု အတည်ပြုပြီး!*

━━━━━━━━━━━━━━━
📦 *${pendingTx.products?.title}*
💵 *${amount.toFixed(4)} TON*
🏪 ${sellerUsername}
━━━━━━━━━━━━━━━

⏳ ရောင်းသူမှ ပစ္စည်းပို့ပေးပါမည်
⚠️ ပစ္စည်းမရမီ "ရရှိပြီး" မနှိပ်ပါ!`)
        }

        // Notify admin for high-value transactions (>= 50 TON)
        const HIGH_VALUE_THRESHOLD = 50
        if (amount >= HIGH_VALUE_THRESHOLD) {
          try {
            await fetch(`${SUPABASE_URL}/functions/v1/notify-user`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
              },
              body: JSON.stringify({
                type: 'admin_high_value_tx',
                amount: amount,
                product_title: pendingTx.products?.title,
                buyer_username: pendingTx.buyer?.telegram_username,
                seller_username: pendingTx.seller?.telegram_username,
                tx_hash: hash
              })
            })
            console.log(`Admin notified about high-value transaction: ${amount} TON`)
          } catch (e) {
            console.error('Failed to notify admin about high-value tx:', e)
          }
        }
        return
      }
    }
  }

  // 2. Check for deposit with unique code (dep_<unique_code>)
  if (memo.startsWith('dep_')) {
    const codePart = memo.replace('dep_', '').toUpperCase()
    
    // Try new format first (unique_code)
    const { data: pendingDeposit } = await supabase
      .from('deposits')
      .select('*, profile:profiles(*)')
      .eq('unique_code', codePart)
      .eq('status', 'pending')
      .maybeSingle()

    if (pendingDeposit) {
      // Check if expired
      if (pendingDeposit.expires_at && new Date(pendingDeposit.expires_at) < new Date()) {
        console.log(`⏰ Deposit expired: ${codePart}`)
        await supabase.from('deposits').update({ status: 'expired' }).eq('id', pendingDeposit.id)
        
        if (pendingDeposit.profile?.telegram_id) {
          await sendTg(pendingDeposit.profile.telegram_id, `⏰ *ငွေသွင်းမှု သက်တမ်းကုန်သွားပါပြီ*

━━━━━━━━━━━━━━━
💵 ပမာဏ: *${amount.toFixed(4)} TON*
━━━━━━━━━━━━━━━

ငွေပြန်ရယူရန် Admin ထံ ဆက်သွယ်ပါ`)
        }
        return
      }
      
      console.log(`✅ Matched deposit by code: ${hash} -> ${pendingDeposit.id}`)
      
      // LIVE STATUS UPDATE: Show progress bar animation
      const profile = pendingDeposit.profile
      if (profile?.telegram_id && pendingDeposit.telegram_msg_id) {
        console.log(`📱 Updating deposit status: ${pendingDeposit.telegram_msg_id}`)
        
        // Step 1: Transaction detected - use editMessageMedia with checking image
        const checkingQR = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent('CHECKING...')}&bgcolor=f0f0f0`
        await editTgMediaWithPhoto(profile.telegram_id, pendingDeposit.telegram_msg_id, checkingQR, `🔍 *စစ်ဆေးနေသည်...*

━━━━━━━━━━━━━━━
💵 *${amount.toFixed(4)} TON*
🔑 \`${codePart}\`
━━━━━━━━━━━━━━━

${progressBar(5, 10)}

✅ Transaction တွေ့ရှိပြီး
🔄 စစ်ဆေးနေသည်...`)

        await new Promise(r => setTimeout(r, 600))
      }
      
      // Use actual blockchain amount for crediting
      const actualAmount = amount
      
      // Update deposit record with actual received amount
      await supabase.from('deposits').update({
        amount_ton: actualAmount,
        ton_tx_hash: hash,
        is_confirmed: true,
        confirmed_at: new Date().toISOString(),
        status: 'confirmed',
      }).eq('id', pendingDeposit.id)

      // Update balance with actual blockchain amount
      const newBal = Number(profile.balance) + actualAmount
      await supabase.from('profiles').update({ balance: newBal }).eq('id', profile.id)

      // Update QR message to show confirmation using editMessageMedia
      if (profile.telegram_id && pendingDeposit.telegram_msg_id) {
        const successQR = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent('SUCCESS')}&bgcolor=90EE90`
        const updated = await editTgMediaWithPhoto(profile.telegram_id, pendingDeposit.telegram_msg_id, successQR, `✅ *ငွေသွင်းမှု အတည်ပြုပြီး!*

━━━━━━━━━━━━━━━
💵 +*${actualAmount.toFixed(4)} TON*
💳 လက်ကျန်: *${newBal.toFixed(4)} TON*
━━━━━━━━━━━━━━━

✨ Balance ထည့်သွင်းပြီး!`)
        
        // Fallback: if editMedia fails, delete and send new message
        if (!updated) {
          await deleteTgMsg(profile.telegram_id, pendingDeposit.telegram_msg_id)
          await sendTg(profile.telegram_id, `✅ *ငွေသွင်းမှု အတည်ပြုပြီး!*

━━━━━━━━━━━━━━━
💵 +*${actualAmount.toFixed(4)} TON*
💳 လက်ကျန်: *${newBal.toFixed(4)} TON*
━━━━━━━━━━━━━━━`)
        }
      }
      return
    }
    
    // Legacy format is no longer supported - require proper deposit code
    console.log(`⚠️ Unknown deposit code format: ${codePart}`)
  }

  // REMOVED: Wallet address matching - can bypass expiration checks
  // REMOVED: Amount-based transaction matching - can bypass expiration checks
  
  // All deposits MUST use proper memo format (dep_XXXXXX) within 1 hour window
  // Unmatched payments require manual admin intervention
  console.log(`⚠️ Unmatched deposit: ${amount} TON from ${sender} - requires manual verification`)
}

// ==================== AES-GCM ENCRYPTION ====================
async function decryptMnemonic(encryptedBase64: string, password: string): Promise<string> {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  
  // Decode base64
  const combined = new Uint8Array(atob(encryptedBase64).split('').map(c => c.charCodeAt(0)))
  
  // Extract salt, iv, and ciphertext
  const salt = combined.slice(0, 16)
  const iv = combined.slice(16, 28)
  const ciphertext = combined.slice(28)
  
  // Derive key using PBKDF2
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  )
  
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  )
  
  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    ciphertext
  )
  
  return decoder.decode(decrypted)
}

async function getMnemonicWords(): Promise<string[] | null> {
  const { data: setting } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'ton_mnemonic_encrypted')
    .maybeSingle()
  
  if (!setting?.value) return null
  
  try {
    const encryptionKey = SUPABASE_SERVICE_ROLE_KEY.substring(0, 64)
    const mnemonic = await decryptMnemonic(setting.value, encryptionKey)
    return mnemonic.split(' ')
  } catch (e) {
    console.error('Failed to decrypt mnemonic:', e)
    return null
  }
}

async function getWalletBalance(): Promise<number> {
  try {
    const adminWallet = await deriveAdminWallet()
    if (!adminWallet) return 0
    
    const res = await fetch(`${TON_API}/getAddressBalance?address=${adminWallet}`)
    const data = await res.json()
    return data.ok ? parseInt(data.result) / 1e9 : 0
  } catch (e) {
    console.error('Get balance error:', e)
    return 0
  }
}

// ==================== WITHDRAWAL STATS (NO PROCESSING - HANDLED BY auto-withdraw) ====================
async function getWithdrawalStats() {
  // Just report stats - actual processing is done by auto-withdraw function
  const { data: pending } = await supabase
    .from('withdrawals')
    .select('id')
    .eq('status', 'pending')
  
  const count = pending?.length || 0
  if (count > 0) {
    console.log(`📊 ${count} pending withdrawal(s) - will be processed by auto-withdraw cron`)
  } else {
    console.log('No pending withdrawals')
  }
  
  return { pending: count }
}

// ==================== MAIN MONITOR ====================
async function monitor() {
  console.log('=== TON Monitor Starting ===')
  
  // Derive wallet from mnemonic
  const adminWallet = await deriveAdminWallet()
  if (!adminWallet) {
    console.error('Failed to derive admin wallet - mnemonic not configured')
    return { expiredDeposits: 0, expiredTransactions: 0, deposits: 0, withdrawals: 0, cleanedUp: 0, error: 'No mnemonic configured' }
  }
  
  console.log(`Wallet: ${adminWallet}`)
  console.log(`Time: ${new Date().toISOString()}`)

  // Cleanup old confirmed deposits (24+ hours old)
  const cleanedUpCount = await cleanupConfirmedDeposits()
  
  // Expire old deposits first
  const expiredDepositCount = await expireDeposits()
  console.log(`Expired deposits: ${expiredDepositCount}`)

  // Expire old transactions (1-hour buyer limit)
  const expiredTxCount = await expireTransactions()
  console.log(`Expired transactions: ${expiredTxCount}`)

  // Get recent transactions (increase limit for faster detection)
  const transactions = await getTransactions(adminWallet, 100)
  console.log(`Found ${transactions.length} transactions`)

  // Process incoming transactions
  let depositsProcessed = 0
  for (const tx of transactions) {
    // TON API returns transactions for the wallet we queried
    // in_msg is the incoming message (what was sent TO the wallet)
    const inMsg = tx.in_msg || {}
    const dest = inMsg.destination || ''
    const src = inMsg.source || ''
    const value = inMsg.value || '0'
    const memo = inMsg.message || ''
    const amount = nanoToTon(value)
    
    console.log(`TX: hash=${tx.hash?.slice(0, 16)}... dest=${dest} src=${src?.slice(-20)} amount=${amount.toFixed(4)} memo="${memo}"`)
    
    // Skip if no value or too small
    if (amount < 0.01) {
      console.log(`  → Skipped: amount too small`)
      continue
    }
    
    // Skip if no source (not a transfer)
    if (!src) {
      console.log(`  → Skipped: no source`)
      continue
    }

    try {
      await processDeposit(tx)
      depositsProcessed++
    } catch (e) {
      console.error(`Error processing ${tx.hash}:`, e)
    }
  }

  // Report withdrawal stats (actual processing is done by auto-withdraw function)
  const withdrawalStats = await getWithdrawalStats()

  console.log(`=== Monitor Complete ===`)
  console.log(`Cleaned up deposits: ${cleanedUpCount}`)
  console.log(`Expired deposits: ${expiredDepositCount}`)
  console.log(`Expired transactions: ${expiredTxCount}`)
  console.log(`Deposits checked: ${depositsProcessed}`)
  console.log(`Pending withdrawals: ${withdrawalStats.pending}`)

  return { 
    cleanedUp: cleanedUpCount,
    expiredDeposits: expiredDepositCount, 
    expiredTransactions: expiredTxCount,
    deposits: depositsProcessed, 
    pendingWithdrawals: withdrawalStats.pending 
  }
}

// ==================== SERVER ====================
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const result = await monitor()
    
    const walletAddress = await deriveAdminWallet()
    
    return new Response(JSON.stringify({
      success: true,
      wallet: walletAddress,
      cleaned_up: result.cleanedUp,
      expired_deposits: result.expiredDeposits,
      expired_transactions: result.expiredTransactions,
      deposits_checked: result.deposits,
      pending_withdrawals: result.pendingWithdrawals,
      timestamp: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('Monitor error:', e)
    return new Response(JSON.stringify({ error: 'Monitor operation failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
