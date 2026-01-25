import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { mnemonicToWalletKey } from 'npm:@ton/crypto@3.3.0'
import { WalletContractV4 } from 'npm:@ton/ton@16.1.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ==================== DECRYPTION HELPER ====================
async function decryptMnemonic(encryptedBase64: string, password: string): Promise<string> {
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

// ==================== SETTINGS HELPER ====================
// Real-time derive wallet address from encrypted mnemonic
async function getAdminWallet(): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'ton_mnemonic_encrypted')
      .maybeSingle()
    
    if (!data?.value) {
      console.log('No mnemonic configured')
      return null
    }
    
    // Decrypt mnemonic
    const encryptionKey = SUPABASE_SERVICE_ROLE_KEY.substring(0, 64)
    const decryptedMnemonic = await decryptMnemonic(data.value, encryptionKey)
    const words = decryptedMnemonic.split(' ')
    
    // Derive wallet address
    const keyPair = await mnemonicToWalletKey(words)
    const wallet = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 })
    return wallet.address.toString({ bounceable: false })
  } catch (e) {
    console.error('Failed to derive wallet from mnemonic:', e)
    return null
  }
}

// ==================== RATE LIMITING ====================
const rateLimitMap = new Map<number, { count: number; lastReset: number }>()
const RATE_LIMIT = 15
const RATE_WINDOW = 60000

function isRateLimited(chatId: number): boolean {
  const now = Date.now()
  const userLimit = rateLimitMap.get(chatId)
  
  if (!userLimit || now - userLimit.lastReset > RATE_WINDOW) {
    rateLimitMap.set(chatId, { count: 1, lastReset: now })
    return false
  }
  
  if (userLimit.count >= RATE_LIMIT) return true
  userLimit.count++
  return false
}

// ==================== TELEGRAM API ====================
interface TgResponse { ok: boolean; result?: { message_id: number }; description?: string }

async function sendMessage(chatId: number, text: string, keyboard?: object): Promise<number | null> {
  try {
    const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'Markdown' }
    if (keyboard) body.reply_markup = keyboard
    
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    
    const result: TgResponse = await res.json()
    console.log('sendMessage:', result.ok ? 'success' : result.description)
    return result.ok ? result.result?.message_id || null : null
  } catch (e) {
    console.error('sendMessage error:', e)
    return null
  }
}

async function sendPhoto(chatId: number, photoUrl: string, caption: string, keyboard?: object): Promise<number | null> {
  try {
    const body: Record<string, unknown> = { chat_id: chatId, photo: photoUrl, caption, parse_mode: 'Markdown' }
    if (keyboard) body.reply_markup = keyboard
    
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    
    const result: TgResponse = await res.json()
    return result.ok ? result.result?.message_id || null : null
  } catch (e) {
    console.error('sendPhoto error:', e)
    return null
  }
}

// Edit message with new photo using editMessageMedia
async function editMediaWithPhoto(chatId: number, msgId: number, photoUrl: string, caption: string, keyboard?: object): Promise<boolean> {
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
    console.log('editMessageMedia:', result.ok ? 'success' : result.description)
    return result.ok
  } catch (e) {
    console.error('editMessageMedia error:', e)
    return false
  }
}
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

async function deleteMsg(chatId: number, msgId: number): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: msgId }),
    })
    return (await res.json()).ok
  } catch { return false }
}

async function answerCb(cbId: string, text?: string, alert = false): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: cbId, text, show_alert: alert }),
    })
  } catch {}
}

// ==================== QR CODE ====================
function generateQR(wallet: string, amount: number, comment: string): string {
  const tonLink = `ton://transfer/${wallet}?amount=${Math.floor(amount * 1e9)}&text=${encodeURIComponent(comment)}`
  return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(tonLink)}`
}

// ==================== KEYBOARDS ====================
const mainMenu = () => ({
  inline_keyboard: [
    [{ text: '📦 ရောင်းမည်', callback_data: 'm:sell' }, { text: '💰 ငွေသွင်း', callback_data: 'm:dep' }],
    [{ text: '💸 ငွေထုတ်', callback_data: 'm:wd' }, { text: '💳 လက်ကျန်', callback_data: 'm:bal' }],
    [{ text: '📋 အမှာစာများ', callback_data: 'm:ord' }, { text: '🛍️ ကျွန်ုပ်၏လင့်များ', callback_data: 'm:mylinks' }],
    [{ text: '📜 မှတ်တမ်း', callback_data: 'm:hist' }, { text: '⭐ ကျွန်ုပ်၏အဆင့်', callback_data: 'm:rating' }],
    [{ text: '❓ အကူအညီ', callback_data: 'm:help' }],
  ],
})

const backBtn = () => ({ inline_keyboard: [[{ text: '🏠 ပင်မစာမျက်နှာ', callback_data: 'm:home' }]] })
const cancelBtn = () => ({ inline_keyboard: [[{ text: '❌ ပယ်ဖျက်', callback_data: 'm:home' }]] })

const depositAmounts = () => ({
  inline_keyboard: [
    [{ text: '1 TON', callback_data: 'd:1' }, { text: '5 TON', callback_data: 'd:5' }, { text: '10 TON', callback_data: 'd:10' }],
    [{ text: '25 TON', callback_data: 'd:25' }, { text: '50 TON', callback_data: 'd:50' }, { text: '100 TON', callback_data: 'd:100' }],
    [{ text: '💰 စိတ်ကြိုက်ပမာဏ', callback_data: 'd:custom' }],
    [{ text: '🏠 ပင်မစာမျက်နှာ', callback_data: 'm:home' }],
  ],
})

const withdrawAmounts = (balance: number) => {
  const amounts = [1, 5, 10, 25, 50].filter(a => a <= balance)
  const buttons = amounts.map(a => ({ text: `${a} TON`, callback_data: `w:${a}` }))
  const rows = []
  for (let i = 0; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3))
  if (balance > 0) rows.push([{ text: `💰 အားလုံး (${balance.toFixed(2)} TON)`, callback_data: `w:${balance}` }])
  rows.push([{ text: '✏️ စိတ်ကြိုက်ပမာဏ', callback_data: 'w:custom' }])
  rows.push([{ text: '🏠 ပင်မစာမျက်နှာ', callback_data: 'm:home' }])
  return { inline_keyboard: rows }
}

const sellerBtns = (txId: string, buyerUsername?: string) => ({
  inline_keyboard: [
    [{ text: '📦 ပို့ပြီး', callback_data: `a:sent:${txId}` }, { text: '❌ ပယ်ဖျက်', callback_data: `a:cancel:${txId}` }],
    ...(buyerUsername ? [[{ text: '💬 ဝယ်သူနဲ့ Chat', url: `https://t.me/${buyerUsername}` }]] : []),
  ],
})

const buyerBtns = (txId: string, sellerUsername?: string) => ({
  inline_keyboard: [
    [{ text: '✅ ရရှိပြီး', callback_data: `a:recv:${txId}` }, { text: '⚠️ အငြင်းပွား', callback_data: `a:disp:${txId}` }],
    ...(sellerUsername ? [[{ text: '💬 ရောင်းသူနဲ့ Chat', url: `https://t.me/${sellerUsername}` }]] : []),
  ],
})

const confirmBtns = (txId: string) => ({
  inline_keyboard: [
    [{ text: '✅ အတည်ပြု', callback_data: `a:cfm:${txId}` }, { text: '❌ မလုပ်တော့', callback_data: 'm:ord' }],
  ],
})

// Buy buttons with balance option
const buyBtns = (txId: string, hasBalance: boolean) => ({
  inline_keyboard: hasBalance ? [
    [{ text: '💰 Balance ဖြင့်ဝယ်မည်', callback_data: `buy:bal:${txId}` }],
    [{ text: '🏠 ပင်မစာမျက်နှာ', callback_data: 'm:home' }],
  ] : [
    [{ text: '🏠 ပင်မစာမျက်နှာ', callback_data: 'm:home' }],
  ],
})

// Rating buttons (1-5 stars)
const ratingBtns = (txId: string, ratedId: string) => ({
  inline_keyboard: [
    [
      { text: '⭐', callback_data: `r:1:${txId}:${ratedId}` },
      { text: '⭐⭐', callback_data: `r:2:${txId}:${ratedId}` },
      { text: '⭐⭐⭐', callback_data: `r:3:${txId}:${ratedId}` },
    ],
    [
      { text: '⭐⭐⭐⭐', callback_data: `r:4:${txId}:${ratedId}` },
      { text: '⭐⭐⭐⭐⭐', callback_data: `r:5:${txId}:${ratedId}` },
    ],
    [{ text: '⏭️ ကျော်မည်', callback_data: 'm:home' }],
  ],
})

// Delete confirmation buttons
const deleteConfirmBtns = (msgId: number) => ({
  inline_keyboard: [
    [
      { text: '✅ ဖျက်မည်', callback_data: `del:yes:${msgId}` },
      { text: '❌ မဖျက်ပါ', callback_data: `del:no:${msgId}` },
    ],
  ],
})

// ==================== DATABASE ====================
async function getProfile(telegramId: number, username?: string) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('telegram_id', telegramId)
    .single()

  if (profile) {
    if (username && profile.telegram_username !== username) {
      await supabase.from('profiles').update({ telegram_username: username }).eq('id', profile.id)
    }
    return profile
  }

  const { data: newProfile, error } = await supabase
    .from('profiles')
    .insert({ telegram_id: telegramId, telegram_username: username || null, balance: 0 })
    .select()
    .single()

  if (error) throw error
  return newProfile
}

// Check if user is blocked
async function isUserBlocked(telegramId: number): Promise<{ blocked: boolean; reason?: string }> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_blocked, blocked_reason')
    .eq('telegram_id', telegramId)
    .single()
  
  if (profile?.is_blocked) {
    return { blocked: true, reason: profile.blocked_reason || undefined }
  }
  return { blocked: false }
}

const BLOCKED_MESSAGE = `🚫 *သင့်အကောင့် ပိတ်ထားပါသည်*

━━━━━━━━━━━━━━━
သင့်အကောင့်ကို Admin မှ ပိတ်ထားပါသည်။
အကူအညီလိုပါက Admin ထံ ဆက်သွယ်ပါ။
━━━━━━━━━━━━━━━`

const genLink = () => crypto.randomUUID().replace(/-/g, '').substring(0, 12)

const statusText: Record<string, string> = {
  pending_payment: '⏳ ငွေပေးချေရန်',
  payment_received: '💰 ငွေရရှိပြီး',
  item_sent: '📦 ပစ္စည်းပို့ပြီး',
  completed: '✅ ပြီးဆုံး',
  cancelled: '❌ ပယ်ဖျက်',
  disputed: '⚠️ အငြင်းပွား',
}

// ==================== USER STATE (DATABASE-BACKED) ====================
interface UserState { action: string; msgId?: number; data?: Record<string, unknown> }

async function getUserState(telegramId: number): Promise<UserState | null> {
  const { data } = await supabase
    .from('user_states')
    .select('action, msg_id, data')
    .eq('telegram_id', telegramId)
    .single()
  
  if (!data) return null
  return { action: data.action, msgId: data.msg_id || undefined, data: data.data as Record<string, unknown> || undefined }
}

async function setUserState(telegramId: number, state: UserState): Promise<void> {
  await supabase
    .from('user_states')
    .upsert({
      telegram_id: telegramId,
      action: state.action,
      msg_id: state.msgId || null,
      data: state.data || {},
    }, { onConflict: 'telegram_id' })
}

async function deleteUserState(telegramId: number): Promise<void> {
  await supabase.from('user_states').delete().eq('telegram_id', telegramId)
}

// ==================== MENU HANDLERS ====================
async function showHome(chatId: number, msgId?: number, username?: string) {
  const profile = await getProfile(chatId, username)
  const text = `🎉 *Escrow Bot*

━━━━━━━━━━━━━━━
💳 လက်ကျန်: *${Number(profile.balance).toFixed(2)} TON*
━━━━━━━━━━━━━━━

🔐 TON ဖြင့် လုံခြုံစွာ ရောင်းဝယ်ပါ`

  await deleteUserState(chatId)
  
  if (msgId) await editText(chatId, msgId, text, mainMenu())
  else await sendMessage(chatId, text, mainMenu())
}

async function showHelp(chatId: number, msgId: number) {
  await editText(chatId, msgId, `📖 *အကူအညီ*

━━━━━━━━━━━━━━━
*🏪 ရောင်းသူ:*
1️⃣ "ရောင်းမည်" > ပစ္စည်းအမည် | ဈေး
2️⃣ Link ကို ဝယ်သူထံပေး
3️⃣ ငွေရရှိပြီး > "ပို့ပြီး" နှိပ်
4️⃣ ဝယ်သူအတည်ပြု > ငွေရ

*🛒 ဝယ်သူ:*
1️⃣ Link ဖွင့် > QR Scan
2️⃣ TON ပေးချေ (Auto Detect)
3️⃣ ပစ္စည်းရ > "ရရှိပြီး" နှိပ်

*💰 ငွေသွင်း:* QR Scan > Auto Credit
*💸 ငွေထုတ်:* ပမာဏရွေး > Auto Send
━━━━━━━━━━━━━━━
⚠️ ပစ္စည်းမရမီ "ရရှိပြီး" မနှိပ်ပါ!`, backBtn())
}

async function showBalance(chatId: number, msgId: number, username?: string) {
  const profile = await getProfile(chatId, username)
  await editText(chatId, msgId, `💰 *လက်ကျန်ငွေ*

━━━━━━━━━━━━━━━
💳 *${Number(profile.balance).toFixed(2)} TON*
━━━━━━━━━━━━━━━

📥 ငွေသွင်း - QR Scan ပြီး Auto Credit
📤 ငွေထုတ် - Wallet ထည့်ပြီး Auto Send`, backBtn())
}

async function showSellPrompt(chatId: number, msgId: number) {
  await setUserState(chatId, { action: 'sell_title', msgId })
  await editText(chatId, msgId, `📦 *ပစ္စည်းရောင်းရန်*

━━━━━━━━━━━━━━━
📝 *အဆင့် ၁/၂*
ပစ္စည်းအမည် ထည့်ပါ:
━━━━━━━━━━━━━━━

ဥပမာ: \`iPhone 15 Pro Max\``, cancelBtn())
}

async function showDepositOptions(chatId: number, msgId: number) {
  await setUserState(chatId, { action: 'dep_select', msgId })
  await editText(chatId, msgId, `💰 *ငွေသွင်းရန်*

━━━━━━━━━━━━━━━
သွင်းလိုသော ပမာဏ ရွေးပါ:
━━━━━━━━━━━━━━━

✨ QR Scan ပြီး ငွေပေးပို့ပါ
💫 အလိုအလျောက် Credit ပေးပါမည်`, depositAmounts())
}

async function showDepositQR(chatId: number, msgId: number, amount: number, username?: string) {
  const adminWallet = await getAdminWallet()
  if (!adminWallet) {
    await editText(chatId, msgId, '❌ Wallet မသတ်မှတ်ရသေးပါ', backBtn())
    return
  }

  const profile = await getProfile(chatId, username)
  
  // Generate unique deposit code (6 chars)
  const uniqueCode = crypto.randomUUID().replace(/-/g, '').substring(0, 6).toUpperCase()
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes expiry
  
  // Create unique deposit address format: dep_<unique_code>
  const comment = `dep_${uniqueCode}`
  const qr = generateQR(adminWallet, amount, comment)
  
  await deleteMsg(chatId, msgId)
  
  // Enhanced QR display with better visual formatting
  const qrMsgId = await sendPhoto(chatId, qr, `💰 *ငွေသွင်း - ${amount} TON*

╔══════════════════════════════╗
║     📱 QR Scan ပြုလုပ်ပါ      ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━

💳 *Wallet Address:*
\`${adminWallet}\`

💵 *ပမာဏ:* ${amount} TON

🔐 *Memo (မဖြစ်မနေထည့်ပါ):*
\`${comment}\`

━━━━━━━━━━━━━━━━━━━━━━━━━
🔑 ID: \`${uniqueCode}\`
⏰ သက်တမ်း: ၃၀ မိနစ်
━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ *အရေးကြီး:* Memo မပါရင် ငွေထည့်မရပါ!

⏳ ငွေပေးချေပြီးပါက အလိုအလျောက်
   Balance ထဲသို့ ထည့်သွင်းပေးပါမည်...

🔔 *Real-time* အတည်ပြုပေးပါမည်`, backBtn())
  
  // Save pending deposit with unique code, expiry, and message ID for live updates
  await supabase.from('deposits').insert({
    profile_id: profile.id,
    amount_ton: amount,
    is_confirmed: false,
    unique_code: uniqueCode,
    expires_at: expiresAt.toISOString(),
    status: 'pending',
    telegram_msg_id: qrMsgId,
  })
  
  await deleteUserState(chatId)
}

async function showWithdrawOptions(chatId: number, msgId: number, username?: string) {
  const profile = await getProfile(chatId, username)
  const balance = Number(profile.balance)
  
  // Get commission rate for withdrawal fee display
  const { data: commSetting } = await supabase.from('settings').select('value').eq('key', 'commission_rate').single()
  const commRate = commSetting ? parseFloat(commSetting.value) : 5
  
  if (balance <= 0) {
    await editText(chatId, msgId, `❌ *လက်ကျန်ငွေ မရှိပါ*

ငွေသွင်းရန် "ငွေသွင်း" ကို နှိပ်ပါ`, backBtn())
    return
  }
  
  await setUserState(chatId, { action: 'wd_select', msgId, data: { balance, commRate } })
  await editText(chatId, msgId, `💸 *ငွေထုတ်ရန်*

━━━━━━━━━━━━━━━
💳 လက်ကျန်: *${balance.toFixed(2)} TON*
💰 Commission: *${commRate}%*
━━━━━━━━━━━━━━━

ထုတ်ယူလိုသော ပမာဏ ရွေးပါ:

⚠️ *မှတ်ချက်:* ငွေထုတ်ယူသောအခါ
${commRate}% commission ဖြတ်ပါမည်`, withdrawAmounts(balance))
}

async function showWithdrawWalletPrompt(chatId: number, msgId: number, amount: number) {
  // Get commission rate
  const { data: commSetting } = await supabase.from('settings').select('value').eq('key', 'commission_rate').single()
  const commRate = commSetting ? parseFloat(commSetting.value) : 5
  
  // Use precise calculations with proper rounding
  const amountNum = Number(amount)
  const fee = Math.round((amountNum * commRate / 100) * 10000) / 10000 // Round to 4 decimals
  const receiveAmount = Math.round((amountNum - fee) * 10000) / 10000
  
  console.log(`[WD] Amount: ${amountNum}, CommRate: ${commRate}%, Fee: ${fee}, Receive: ${receiveAmount}`)
  
  await setUserState(chatId, { action: 'wd_wallet', msgId, data: { amount: amountNum, fee, receiveAmount, commRate } })
  await editText(chatId, msgId, `💸 *ငွေထုတ်ရန်*

━━━━━━━━━━━━━━━
💵 ထုတ်ယူမည့်ပမာဏ: *${amountNum.toFixed(4)} TON*
📊 Commission (${commRate}%): *-${fee.toFixed(4)} TON*
✅ လက်ခံရရှိမည်: *${receiveAmount.toFixed(4)} TON*
━━━━━━━━━━━━━━━

📱 *သင်၏ TON Wallet လိပ်စာ ထည့်ပါ:*

ဥပမာ: \`UQBxxxxxxxxxxxxxxxx\``, cancelBtn())
}

async function showOrders(chatId: number, msgId: number, username?: string) {
  const profile = await getProfile(chatId, username)

  const { data: sellerTxs } = await supabase
    .from('transactions')
    .select('*, products(*)')
    .eq('seller_id', profile.id)
    .in('status', ['pending_payment', 'payment_received', 'item_sent', 'disputed'])
    .order('created_at', { ascending: false })
    .limit(5)

  const { data: buyerTxs } = await supabase
    .from('transactions')
    .select('*, products(*)')
    .eq('buyer_id', profile.id)
    .in('status', ['pending_payment', 'payment_received', 'item_sent', 'disputed'])
    .order('created_at', { ascending: false })
    .limit(5)

  if ((!sellerTxs?.length) && (!buyerTxs?.length)) {
    await editText(chatId, msgId, `📭 *အရောင်းအဝယ် မရှိပါ*

ပစ္စည်းရောင်းရန် "ရောင်းမည်" နှိပ်ပါ`, backBtn())
    return
  }

  let text = `📋 *ကျွန်ုပ်၏ အရောင်းအဝယ်များ*\n\n`
  const btns: { text: string; callback_data: string }[][] = []

  if (sellerTxs?.length) {
    text += `━━━ 📤 *ရောင်းနေသည်* ━━━\n\n`
    for (const tx of sellerTxs) {
      text += `📦 *${tx.products?.title}*\n💵 ${tx.amount_ton} TON | ${statusText[tx.status]}\n\n`
      if (tx.status === 'payment_received') {
        btns.push([{ text: `📦 ${tx.products?.title?.substring(0, 12)} - ပို့ပြီး`, callback_data: `a:sent:${tx.id}` }])
      }
    }
  }

  if (buyerTxs?.length) {
    text += `━━━ 📥 *ဝယ်နေသည်* ━━━\n\n`
    for (const tx of buyerTxs) {
      text += `📦 *${tx.products?.title}*\n💵 ${tx.amount_ton} TON | ${statusText[tx.status]}\n\n`
      if (tx.status === 'item_sent') {
        btns.push([{ text: `✅ ${tx.products?.title?.substring(0, 12)} - ရရှိပြီး`, callback_data: `a:recv:${tx.id}` }])
      }
    }
  }

  btns.push([{ text: '📜 မှတ်တမ်း', callback_data: 'm:hist' }])
  btns.push([{ text: '🏠 ပင်မစာမျက်နှာ', callback_data: 'm:home' }])
  await editText(chatId, msgId, text, { inline_keyboard: btns })
}

// ==================== TRANSACTION HISTORY ====================
async function showHistory(chatId: number, msgId: number, username?: string) {
  const profile = await getProfile(chatId, username)

  // Get completed/cancelled transactions
  const { data: sellerTxs } = await supabase
    .from('transactions')
    .select('*, products(*), buyer:profiles!transactions_buyer_id_fkey(telegram_username, avg_rating, total_ratings)')
    .eq('seller_id', profile.id)
    .in('status', ['completed', 'cancelled'])
    .order('created_at', { ascending: false })
    .limit(10)

  const { data: buyerTxs } = await supabase
    .from('transactions')
    .select('*, products(*), seller:profiles!transactions_seller_id_fkey(telegram_username, avg_rating, total_ratings)')
    .eq('buyer_id', profile.id)
    .in('status', ['completed', 'cancelled'])
    .order('created_at', { ascending: false })
    .limit(10)

  if ((!sellerTxs?.length) && (!buyerTxs?.length)) {
    await editText(chatId, msgId, `📭 *မှတ်တမ်း မရှိသေးပါ*

ပြီးဆုံးသော အရောင်းအဝယ်များ ဤနေရာတွင် ပြပါမည်`, backBtn())
    return
  }

  let text = `📜 *ကျွန်ုပ်၏ မှတ်တမ်း*\n\n`

  if (sellerTxs?.length) {
    text += `━━━ 📤 *ရောင်းခဲ့သည်* ━━━\n\n`
    for (const tx of sellerTxs) {
      const date = new Date(tx.created_at).toLocaleDateString('my-MM')
      const statusIcon = tx.status === 'completed' ? '✅' : '❌'
      const buyerRating = tx.buyer?.avg_rating ? ` ⭐${tx.buyer.avg_rating}` : ''
      text += `${statusIcon} *${tx.products?.title}*\n💵 ${tx.amount_ton} TON | ${date}${buyerRating}\n\n`
    }
  }

  if (buyerTxs?.length) {
    text += `━━━ 📥 *ဝယ်ခဲ့သည်* ━━━\n\n`
    for (const tx of buyerTxs) {
      const date = new Date(tx.created_at).toLocaleDateString('my-MM')
      const statusIcon = tx.status === 'completed' ? '✅' : '❌'
      const sellerRating = tx.seller?.avg_rating ? ` ⭐${tx.seller.avg_rating}` : ''
      text += `${statusIcon} *${tx.products?.title}*\n💵 ${tx.amount_ton} TON | ${date}${sellerRating}\n\n`
    }
  }

  await editText(chatId, msgId, text, backBtn())
}

// ==================== MY SALES LINKS ====================
async function showMyLinks(chatId: number, msgId: number, username?: string) {
  const profile = await getProfile(chatId, username)

  // Get ALL transactions created by this seller (including pending with no buyer)
  const { data: myLinks } = await supabase
    .from('transactions')
    .select('*, products(*)')
    .eq('seller_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(15)

  if (!myLinks?.length) {
    await editText(chatId, msgId, `📭 *ရောင်းလင့် မရှိသေးပါ*

ပစ္စည်းရောင်းရန် "ရောင်းမည်" နှိပ်ပါ`, backBtn())
    return
  }

  const { data: botSetting } = await supabase.from('settings').select('value').eq('key', 'bot_username').maybeSingle()
  const botUsername = botSetting?.value || 'YourBot'

  let text = `🛍️ *ကျွန်ုပ်၏ ရောင်းလင့်များ*\n\n`
  const btns: { text: string; callback_data: string }[][] = []

  for (const tx of myLinks) {
    const statusIcon = statusText[tx.status] || tx.status
    const hasBuyer = !!tx.buyer_id
    const buyerStatus = hasBuyer ? '👤 ဝယ်သူရှိ' : '⏳ ဝယ်သူမရှိ'
    
    text += `📦 *${tx.products?.title}*\n`
    text += `💵 ${tx.amount_ton} TON | ${statusIcon}\n`
    text += `${buyerStatus}\n`
    text += `🔗 \`https://t.me/${botUsername}?start=buy_${tx.unique_link}\`\n\n`

    // Add action button based on status
    if (tx.status === 'pending_payment' && !hasBuyer) {
      btns.push([{ text: `❌ ${tx.products?.title?.substring(0, 12)} - ဖျက်မည်`, callback_data: `a:cancel:${tx.id}` }])
    } else if (tx.status === 'payment_received') {
      btns.push([{ text: `📦 ${tx.products?.title?.substring(0, 12)} - ပို့ပြီး`, callback_data: `a:sent:${tx.id}` }])
    }
  }

  btns.push([{ text: '🏠 ပင်မစာမျက်နှာ', callback_data: 'm:home' }])
  await editText(chatId, msgId, text, { inline_keyboard: btns })
}

// ==================== RATING SYSTEM ====================
async function showMyRating(chatId: number, msgId: number, username?: string) {
  const profile = await getProfile(chatId, username)
  
  const avgRating = Number(profile.avg_rating) || 0
  const totalRatings = Number(profile.total_ratings) || 0
  
  // Get recent ratings received
  const { data: recentRatings } = await supabase
    .from('ratings')
    .select('rating, comment, created_at, rater:profiles!ratings_rater_id_fkey(telegram_username)')
    .eq('rated_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(5)
  
  let text = `⭐ *ကျွန်ုပ်၏ အဆင့်သတ်မှတ်ချက်*

━━━━━━━━━━━━━━━
⭐ ပျမ်းမျှ: *${avgRating.toFixed(1)} / 5.0*
📊 စုစုပေါင်း: *${totalRatings}* ခု
━━━━━━━━━━━━━━━`

  if (recentRatings?.length) {
    text += `\n\n*မကြာမီက ရရှိသော အဆင့်များ:*\n`
    for (const r of recentRatings) {
      const stars = '⭐'.repeat(r.rating)
      // Handle the rater relation which could be an array or object
      const raterData = Array.isArray(r.rater) ? r.rater[0] : r.rater
      const rater = raterData?.telegram_username ? `@${raterData.telegram_username}` : 'User'
      text += `\n${stars} - ${rater}`
      if (r.comment) text += `\n   💬 "${r.comment}"`
    }
  }

  await editText(chatId, msgId, text, backBtn())
}

async function handleRating(chatId: number, msgId: number, rating: number, txId: string, ratedId: string, cbId: string, telegramId: number) {
  const profile = await getProfile(telegramId)
  
  // Check if already rated
  const { data: existingRating } = await supabase
    .from('ratings')
    .select('id')
    .eq('transaction_id', txId)
    .eq('rater_id', profile.id)
    .maybeSingle()
  
  if (existingRating) {
    await answerCb(cbId, '❌ ဤ အရောင်းအဝယ်ကို အဆင့်သတ်မှတ်ပြီးပါပြီ', true)
    return
  }
  
  // Insert rating (without comment first)
  const { data: insertedRating, error } = await supabase.from('ratings').insert({
    transaction_id: txId,
    rater_id: profile.id,
    rated_id: ratedId,
    rating: rating,
  }).select('id').single()
  
  if (error) {
    console.error('Rating error:', error)
    await answerCb(cbId, '❌ အမှားဖြစ်ပွားပါသည်', true)
    return
  }
  
  await answerCb(cbId, `✅ ${rating} ⭐ အဆင့်သတ်မှတ်ပြီး!`)
  
  // Ask for optional comment
  await setUserState(chatId, { action: 'rating_comment', msgId, data: { ratingId: insertedRating.id, rating } })
  
  await editText(chatId, msgId, `✅ *${rating} ⭐ အဆင့်သတ်မှတ်ပြီး!*

━━━━━━━━━━━━━━━
${'⭐'.repeat(rating)} ${rating}/5
━━━━━━━━━━━━━━━

📝 *Feedback/Comment ရေးမည်လား?*

ထပ်ပြောချင်တာရှိရင် အောက်မှာ ရိုက်ထည့်ပါ
(သို့) "ကျော်မည်" နှိပ်ပါ`, skipCommentBtn())
}

// Skip comment button
const skipCommentBtn = () => ({
  inline_keyboard: [
    [{ text: '⏭️ ကျော်မည်', callback_data: 'skip_comment' }],
  ],
})

// Handle rating comment input
async function handleRatingComment(chatId: number, comment: string, msgId: number, ratingId: string, rating: number) {
  const safeComment = comment.substring(0, 500).trim()
  
  if (safeComment) {
    await supabase
      .from('ratings')
      .update({ comment: safeComment })
      .eq('id', ratingId)
  }
  
  await deleteUserState(chatId)
  
  await editText(chatId, msgId, `✅ *ကျေးဇူးတင်ပါသည်!*

━━━━━━━━━━━━━━━
${'⭐'.repeat(rating)} ${rating}/5
${safeComment ? `💬 "${safeComment}"` : ''}
━━━━━━━━━━━━━━━

အဆင့်သတ်မှတ်ပေးသည့်အတွက် ကျေးဇူးပါ 🙏`, backBtn())
}

// ==================== ACTION HANDLERS ====================
// Input validation helper
function sanitizeTitle(title: string): string {
  // Escape markdown special characters to prevent injection
  return title.replace(/[*_`\[\]()]/g, '\\$&')
}

function validateProductInput(title: string, price: number): { valid: boolean; error?: string } {
  const MAX_TITLE_LENGTH = 200
  const MIN_PRICE = 0.01
  const MAX_PRICE = 100000

  if (!title || title.length < 1) {
    return { valid: false, error: 'ပစ္စည်းအမည် ထည့်ပါ' }
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return { valid: false, error: `အမည် ${MAX_TITLE_LENGTH} စာလုံးထက် နည်းရပါမည်` }
  }
  if (isNaN(price) || !Number.isFinite(price)) {
    return { valid: false, error: 'ဈေးနှုန်း မမှန်ကန်ပါ' }
  }
  if (price < MIN_PRICE || price > MAX_PRICE) {
    return { valid: false, error: `ဈေးနှုန်း ${MIN_PRICE} - ${MAX_PRICE} TON ဖြစ်ရပါမည်` }
  }
  return { valid: true }
}

// Step 1: Handle product title input
async function handleSellTitle(chatId: number, title: string, msgId: number) {
  const safeTitle = title.substring(0, 200).trim()
  
  if (!safeTitle || safeTitle.length < 1) {
    await editText(chatId, msgId, `❌ *ပစ္စည်းအမည် ထည့်ပါ*

━━━━━━━━━━━━━━━
📝 *အဆင့် ၁/၂*
ပစ္စည်းအမည် ထည့်ပါ:
━━━━━━━━━━━━━━━`, cancelBtn())
    return
  }
  
  // Save title and move to price step
  await setUserState(chatId, { action: 'sell_price', msgId, data: { title: safeTitle } })
  await editText(chatId, msgId, `📦 *ပစ္စည်းရောင်းရန်*

━━━━━━━━━━━━━━━
📦 *${sanitizeTitle(safeTitle)}*
━━━━━━━━━━━━━━━

💵 *အဆင့် ၂/၂*
ဈေးနှုန်း (TON) ထည့်ပါ:

ဥပမာ: \`150\` သို့ \`25.5\``, cancelBtn())
}

// Step 2: Handle product price input and create product
async function handleSellPrice(chatId: number, priceText: string, msgId: number, username?: string) {
  const state = await getUserState(chatId)
  const title = state?.data?.title as string
  
  if (!title) {
    await editText(chatId, msgId, '❌ အမှားဖြစ်ပွားပါသည်။ ထပ်မံကြိုးစားပါ', backBtn())
    await deleteUserState(chatId)
    return
  }
  
  const price = parseFloat(priceText.trim())
  
  const validation = validateProductInput(title, price)
  if (!validation.valid) {
    await editText(chatId, msgId, `❌ *${validation.error}*

━━━━━━━━━━━━━━━
📦 *${sanitizeTitle(title)}*
━━━━━━━━━━━━━━━

💵 ဈေးနှုန်း (TON) ထည့်ပါ:

ဥပမာ: \`150\` သို့ \`25.5\``, cancelBtn())
    return
  }

  const profile = await getProfile(chatId, username)
  const link = genLink()

  // NO FEE on selling - full price goes to seller
  // Fee will be deducted on withdrawal
  const commission = 0
  const sellerGets = price

  const { data: product, error } = await supabase
    .from('products')
    .insert({ seller_id: profile.id, title, price_ton: price, unique_link: link, is_active: true })
    .select()
    .single()

  if (error) {
    await editText(chatId, msgId, '❌ အမှားဖြစ်ပွားပါသည်', backBtn())
    await deleteUserState(chatId)
    return
  }

  await supabase.from('transactions').insert({
    product_id: product.id,
    seller_id: profile.id,
    amount_ton: price,
    commission_ton: commission,
    seller_receives_ton: sellerGets,
    unique_link: link,
    status: 'pending_payment',
  })

  const { data: botSetting } = await supabase.from('settings').select('value').eq('key', 'bot_username').single()
  const botUsername = botSetting?.value || 'YourBot'
  const productLink = `https://t.me/${botUsername}?start=buy_${link}`

  const safeTitle = sanitizeTitle(title)
  await editText(chatId, msgId, `✅ *ပစ္စည်း ဖန်တီးပြီး!*

━━━━━━━━━━━━━━━
📦 *${safeTitle}*
💵 ဈေး: *${price} TON*
💰 ရရှိမည်: *${sellerGets.toFixed(2)} TON*
━━━━━━━━━━━━━━━

🔗 *Link:*
\`${productLink}\`

📢 ဝယ်သူထံ ဤ Link ပေးပို့ပါ

💡 *မှတ်ချက်:* ငွေထုတ်ယူသောအခါ
commission ဖြတ်ပါမည်`, backBtn())
  await deleteUserState(chatId)
}

// Direct product creation from /sell command (no msgId needed)
async function handleCreateProductDirect(chatId: number, title: string, price: number, username?: string) {
  // Validate input
  const safeTitle = title.substring(0, 200) // Enforce max length
  const validation = validateProductInput(safeTitle, price)
  if (!validation.valid) {
    await sendMessage(chatId, `❌ *${validation.error}*`, backBtn())
    return
  }

  const profile = await getProfile(chatId, username)
  const link = genLink()

  // NO FEE on selling - full price goes to seller
  // Fee will be deducted on withdrawal
  const commission = 0
  const sellerGets = price

  const { data: product, error } = await supabase
    .from('products')
    .insert({ seller_id: profile.id, title: safeTitle, price_ton: price, unique_link: link, is_active: true })
    .select()
    .single()

  if (error) {
    console.error('Product creation error:', error)
    await sendMessage(chatId, '❌ အမှားဖြစ်ပွားပါသည်', backBtn())
    return
  }

  await supabase.from('transactions').insert({
    product_id: product.id,
    seller_id: profile.id,
    amount_ton: price,
    commission_ton: commission,
    seller_receives_ton: sellerGets,
    unique_link: link,
    status: 'pending_payment',
  })

  const { data: botSetting } = await supabase.from('settings').select('value').eq('key', 'bot_username').single()
  const botUsername = botSetting?.value || 'YourBot'
  const productLink = `https://t.me/${botUsername}?start=buy_${link}`

  const displayTitle = sanitizeTitle(safeTitle)
  await sendMessage(chatId, `✅ *ပစ္စည်း ဖန်တီးပြီး!*

━━━━━━━━━━━━━━━
📦 *${displayTitle}*
💵 ဈေး: *${price} TON*
💰 ရရှိမည်: *${sellerGets.toFixed(2)} TON*
━━━━━━━━━━━━━━━

🔗 *Link:*
\`${productLink}\`

📢 ဝယ်သူထံ ဤ Link ပေးပို့ပါ

💡 *မှတ်ချက်:* ငွေထုတ်ယူသောအခါ
commission ဖြတ်ပါမည်`, backBtn())
}

async function handleWithdrawRequest(chatId: number, wallet: string, msgId: number, username?: string) {
  const state = await getUserState(chatId)
  
  // Get amount data from state with proper number conversion
  const amount = Number(state?.data?.amount) || 0
  const fee = Number(state?.data?.fee) || 0
  const receiveAmount = Number(state?.data?.receiveAmount) || (amount - fee)
  const commRate = Number(state?.data?.commRate) || 5
  
  console.log(`[WD Request] Amount: ${amount}, Fee: ${fee}, Receive: ${receiveAmount}, CommRate: ${commRate}%`)
  
  if (!amount || amount <= 0 || !wallet) {
    await editText(chatId, msgId, '❌ ပမာဏ သို့မဟုတ် Wallet မှားနေပါသည်', backBtn())
    await deleteUserState(chatId)
    return
  }

  // Validate amount limits - get min withdrawal from settings
  const { data: minWdSetting } = await supabase.from('settings').select('value').eq('key', 'min_withdrawal_amount').maybeSingle()
  const MIN_WITHDRAWAL = minWdSetting ? parseFloat(minWdSetting.value) : 0.01
  const MAX_WITHDRAWAL = 10000
  if (amount < MIN_WITHDRAWAL || amount > MAX_WITHDRAWAL || !Number.isFinite(amount)) {
    await editText(chatId, msgId, `❌ *ပမာဏ မမှန်ကန်ပါ*\n\n${MIN_WITHDRAWAL} - ${MAX_WITHDRAWAL} TON ဖြစ်ရပါမည်`, cancelBtn())
    await deleteUserState(chatId)
    return
  }

  // Validate TON wallet format (basic check)
  if (!wallet.match(/^(UQ|EQ|0:|kQ)[A-Za-z0-9_-]{46,48}$/)) {
    await editText(chatId, msgId, '❌ *Wallet လိပ်စာ မမှန်ကန်ပါ*\n\nTON wallet format ဖြစ်ရပါမည်', cancelBtn())
    return
  }

  const profile = await getProfile(chatId, username)
  const balance = Number(profile.balance)

  if (balance < amount) {
    await editText(chatId, msgId, `❌ *လက်ကျန်ငွေ မလုံလောက်ပါ*\n\nလက်ကျန်: ${balance.toFixed(4)} TON\nထုတ်ယူလိုသည်: ${amount.toFixed(4)} TON`, backBtn())
    await deleteUserState(chatId)
    return
  }

  // Check withdrawal mode setting
  const { data: modeSetting } = await supabase.from('settings').select('value').eq('key', 'withdrawal_mode').maybeSingle()
  const withdrawalMode = modeSetting?.value || 'manual'
  
  console.log(`[WD] Withdrawal mode: ${withdrawalMode}`)

  // Delete current message and send new one for tracking
  await deleteMsg(chatId, msgId)
  
  // Send status message and save its ID for live updates
  const statusMsgId = await sendMessage(chatId, `⏳ *ငွေထုတ်ယူမှု တောင်းဆိုနေသည်...*

━━━━━━━━━━━━━━━
💵 ထုတ်ယူမည်: *${amount.toFixed(4)} TON*
📊 Commission (${commRate}%): *-${fee.toFixed(4)} TON*
✅ ရရှိမည်: *${receiveAmount.toFixed(4)} TON*
💳 Wallet: \`${wallet.substring(0, 10)}...${wallet.slice(-6)}\`
━━━━━━━━━━━━━━━

⏳ *Status:* စောင့်ဆိုင်းနေသည်...`)

  // Create withdrawal record with fee info and message ID for live updates
  const { data: newWithdrawal, error } = await supabase.from('withdrawals').insert({
    profile_id: profile.id,
    amount_ton: amount,
    destination_wallet: wallet,
    status: 'pending',
    admin_notes: `Fee: ${fee.toFixed(4)} TON (${commRate}%), Receive: ${receiveAmount.toFixed(4)} TON`,
    telegram_msg_id: statusMsgId,
  }).select().single()

  if (error) {
    console.error('Withdrawal creation error:', error)
    if (statusMsgId) {
      await editText(chatId, statusMsgId, '❌ အမှားဖြစ်ပွားပါသည်', backBtn())
    }
    await deleteUserState(chatId)
    return
  }

  // Save wallet address to profile
  await supabase.from('profiles').update({ ton_wallet_address: wallet }).eq('id', profile.id)

  // Notify admin about new withdrawal (for manual mode)
  if (withdrawalMode === 'manual') {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/notify-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
          type: 'admin_new_withdrawal',
          amount: amount,
          user_telegram_username: profile.telegram_username,
          destination_wallet: wallet
        })
      })
      console.log('Admin notified about new withdrawal')
    } catch (e) {
      console.error('Failed to notify admin about withdrawal:', e)
    }
  }

  // If AUTO mode, immediately process the withdrawal
  if (withdrawalMode === 'auto') {
    console.log(`[WD] Auto mode enabled - processing withdrawal ${newWithdrawal.id} immediately`)
    
    // Update status to "checking"
    if (statusMsgId) {
      await editText(chatId, statusMsgId, `🔍 *စစ်ဆေးနေသည်...*

━━━━━━━━━━━━━━━
💵 ထုတ်ယူမည်: *${amount.toFixed(4)} TON*
📊 Commission (${commRate}%): *-${fee.toFixed(4)} TON*
✅ ရရှိမည်: *${receiveAmount.toFixed(4)} TON*
💳 Wallet: \`${wallet.substring(0, 10)}...${wallet.slice(-6)}\`
━━━━━━━━━━━━━━━

🔄 *On-chain transfer လုပ်နေသည်...*
⏳ ခဏစောင့်ပါ...`, undefined)
    }
    
    try {
      // Invoke auto-withdraw function with force=true to process immediately
      const autoWithdrawUrl = `${SUPABASE_URL}/functions/v1/auto-withdraw`
      const response = await fetch(autoWithdrawUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ force: true }),
      })
      
      const result = await response.json()
      console.log(`[WD] Auto-withdraw result:`, result)
      
      if (result.success && result.processed > 0) {
        // Success - auto-withdraw already sent notification to user
        console.log(`[WD] Instant withdrawal processed successfully`)
      } else if (result.errors?.length > 0) {
        // Failed - notify user
        if (statusMsgId) {
          await editText(chatId, statusMsgId, `❌ *ငွေထုတ်ယူမှု မအောင်မြင်ပါ*

━━━━━━━━━━━━━━━
💵 ${amount.toFixed(4)} TON
━━━━━━━━━━━━━━━

ပြဿနာ: ${result.errors[0]?.substring(0, 100) || 'Unknown error'}

Admin ထံ ဆက်သွယ်ပါ။`, backBtn())
        }
      } else {
        // No withdrawals processed (maybe already completed)
        console.log(`[WD] Auto-withdraw returned no processed items`)
      }
    } catch (e) {
      console.error('[WD] Auto-withdraw invocation error:', e)
      if (statusMsgId) {
        await editText(chatId, statusMsgId, `❌ *ငွေထုတ်ယူမှု အမှားဖြစ်ပါသည်*

━━━━━━━━━━━━━━━
💵 ${amount.toFixed(4)} TON
━━━━━━━━━━━━━━━

Admin ထံ ဆက်သွယ်ပါ။`, backBtn())
      }
    }
  } else {
    // Manual mode - show waiting message
    const newBalance = balance // Balance unchanged until approved
    
    if (statusMsgId) {
      await editText(chatId, statusMsgId, `✅ *ငွေထုတ်ယူမှု တောင်းဆိုပြီး!*

━━━━━━━━━━━━━━━
💵 ထုတ်ယူမည်: *${amount.toFixed(4)} TON*
📊 Commission (${commRate}%): *-${fee.toFixed(4)} TON*
✅ ရရှိမည်: *${receiveAmount.toFixed(4)} TON*
💳 Wallet: \`${wallet.substring(0, 10)}...${wallet.slice(-6)}\`
━━━━━━━━━━━━━━━

💰 လက်ကျန်: *${newBalance.toFixed(4)} TON*
   *(အတည်ပြုပြီးမှ ဖြတ်ပါမည်)*

⏳ *Status:* Admin မှ အတည်ပြုပေးပါမည်
အတည်ပြုပြီးပါက ငွေပို့ပေးပါမည်`, backBtn())
    }
  }
  
  await deleteUserState(chatId)
}

async function handleBuyLink(chatId: number, link: string, username?: string) {
  const { data: tx } = await supabase
    .from('transactions')
    .select('*, products(*), seller:profiles!transactions_seller_id_fkey(telegram_username)')
    .eq('unique_link', link)
    .single()

  if (!tx) {
    await sendMessage(chatId, '❌ *Link မရှိတော့ပါ*', mainMenu())
    return
  }

  // Check if expired
  if (tx.expires_at && new Date(tx.expires_at) < new Date()) {
    await sendMessage(chatId, '❌ *ဤအမှာစာ သက်တမ်းကုန်သွားပါပြီ*', mainMenu())
    return
  }

  if (tx.status !== 'pending_payment') {
    await sendMessage(chatId, '❌ *ဤအရောင်းအဝယ် ပြီးဆုံးပြီး*', mainMenu())
    return
  }

  const profile = await getProfile(chatId, username)

  if (tx.seller_id === profile.id) {
    await sendMessage(chatId, '❌ *ကိုယ်တိုင်ဖန်တီးထားသော ပစ္စည်း ဝယ်၍မရပါ*', mainMenu())
    return
  }

  // Check if another buyer already claimed this link (locked for 1 hour)
  if (tx.buyer_id && tx.buyer_id !== profile.id) {
    await sendMessage(chatId, `❌ *အခြားသူတစ်ယောက် ဝယ်နေပါပြီ*

━━━━━━━━━━━━━━━
⏰ 1 နာရီအတွင်း ငွေပေးသွင်းခြင်း မရှိပါက
   ပြန်လည်ဝယ်ယူနိုင်ပါမည်
━━━━━━━━━━━━━━━`, mainMenu())
    return
  }

  // Set 1-hour expiry when buyer initiates purchase
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour expiry
  
  await supabase.from('transactions').update({ 
    buyer_id: profile.id, 
    buyer_telegram_id: chatId,
    expires_at: expiresAt.toISOString()
  }).eq('id', tx.id)

  const adminWallet = await getAdminWallet()
  if (!adminWallet) {
    await sendMessage(chatId, '❌ Wallet မသတ်မှတ်ရသေးပါ', mainMenu())
    return
  }

  // Check if buyer has enough balance
  const buyerBalance = Number(profile.balance)
  const hasEnoughBalance = buyerBalance >= Number(tx.amount_ton)
  const sellerUsername = tx.seller?.telegram_username ? `@${tx.seller.telegram_username}` : 'Seller'

  const comment = `tx_${tx.unique_link}`
  const qr = generateQR(adminWallet, tx.amount_ton, comment)

  // Send QR with balance option if available
  let caption = `🛒 *ဝယ်ယူရန်*

━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
💵 *${tx.amount_ton} TON*
🏪 ${sellerUsername}
━━━━━━━━━━━━━━━`

  if (hasEnoughBalance) {
    caption += `
💳 လက်ကျန်: *${buyerBalance.toFixed(2)} TON*
✅ *Balance နဲ့ ဝယ်နိုင်ပါတယ်!*
━━━━━━━━━━━━━━━`
  }

  caption += `
💳 \`${adminWallet}\`

🔐 *Memo (မဖြစ်မနေထည့်ပါ):*
\`${comment}\`

━━━━━━━━━━━━━━━
⚠️ *Memo မပါရင် ငွေထည့်မရပါ!*
⏰ သက်တမ်း: 1 နာရီ
⚠️ ပစ္စည်းမရမီ "ရရှိပြီး" မနှိပ်ပါ!`

  // Send QR with expiry warning and store message ID
  const msgId = await sendPhoto(chatId, qr, caption, buyBtns(tx.id, hasEnoughBalance))

  // Store buyer message ID for auto-deletion on expiry
  if (msgId) {
    await supabase.from('transactions').update({ buyer_msg_id: msgId }).eq('id', tx.id)
  }
}

// ==================== BUY WITH BALANCE ====================
async function handleBuyWithBalance(chatId: number, msgId: number, txId: string, cbId: string, telegramId: number, username?: string) {
  const { data: tx } = await supabase
    .from('transactions')
    .select('*, products(*), seller:profiles!transactions_seller_id_fkey(*)')
    .eq('id', txId)
    .single()

  if (!tx) {
    await answerCb(cbId, '❌ ရှာမတွေ့ပါ', true)
    return
  }

  if (tx.status !== 'pending_payment') {
    await answerCb(cbId, '❌ ဤအရောင်းအဝယ် ပြီးဆုံးပြီး', true)
    return
  }

  const profile = await getProfile(telegramId, username)
  const balance = Number(profile.balance)
  const amount = Number(tx.amount_ton)

  if (balance < amount) {
    await answerCb(cbId, '❌ လက်ကျန်ငွေ မလုံလောက်ပါ', true)
    return
  }

  await answerCb(cbId, '🔄 စစ်ဆေးနေသည်...')

  // Step 1: Show processing animation
  const processingQR = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent('PROCESSING...')}&bgcolor=FFF9C4`
  await editMediaWithPhoto(chatId, msgId, processingQR, `⏳ *ငွေပေးချေနေသည်...*

━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
💵 *${amount} TON*
━━━━━━━━━━━━━━━

🔄 Balance မှ ဖြတ်တောက်နေသည်...`)

  await new Promise(r => setTimeout(r, 600))

  // Deduct from buyer's balance
  const newBuyerBalance = balance - amount
  await supabase.from('profiles').update({ balance: newBuyerBalance }).eq('id', profile.id)

  // Update transaction to payment_received
  await supabase.from('transactions').update({
    status: 'payment_received',
    ton_tx_hash: `balance_${Date.now()}`, // Mark as balance payment
  }).eq('id', tx.id)

  // Step 2: Show success with celebration
  const successQR = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent('PAID!')}&bgcolor=90EE90`
  await editMediaWithPhoto(chatId, msgId, successQR, `🎉 *Balance ဖြင့် ဝယ်ယူပြီး!*

╔══════════════════════════════╗
║                              ║
║      ✅ *ငွေပေးချေပြီး*       ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
💵 *${amount} TON*
━━━━━━━━━━━━━━━━━━━━━━━━━

💳 လက်ကျန်: *${newBuyerBalance.toFixed(2)} TON*

⏳ ရောင်းသူမှ ပစ္စည်းပို့ပေးပါမည်
⚠️ *သတိ:* ပစ္စည်းမရမီ "ရရှိပြီး" မနှိပ်ပါ!`, buyerBtns(tx.id, tx.seller?.telegram_username))

  // Notify seller
  if (tx.seller?.telegram_id) {
    const buyerUsername = profile.telegram_username 
      ? `@${profile.telegram_username}` 
      : `ID: ${profile.telegram_id || 'Unknown'}`
    
    await sendMessage(tx.seller.telegram_id, `🎉 *ငွေရရှိပြီး! (Balance)*

╔══════════════════════════════╗
║                              ║
║      💰 *ငွေလက်ခံပြီး*        ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
💵 *${amount.toFixed(4)} TON*
━━━━━━━━━━━━━━━━━━━━━━━━━

👤 *ဝယ်သူ:* ${buyerUsername}

✅ ဝယ်သူမှ Balance ဖြင့် ငွေပေးချေပြီးပါပြီ

📦 ပစ္စည်းပို့ပြီးပါက "ပို့ပြီး" နှိပ်ပါ`, sellerBtns(tx.id, profile.telegram_username))
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
          product_title: tx.products?.title,
          buyer_username: profile.telegram_username,
          seller_username: tx.seller?.telegram_username,
          tx_hash: `balance_${Date.now()}`
        })
      })
      console.log(`Admin notified about high-value balance purchase: ${amount} TON`)
    } catch (e) {
      console.error('Failed to notify admin about high-value tx:', e)
    }
  }
}

// ==================== TRANSACTION ACTIONS ====================
// Helper to get status reason
function getStatusReason(status: string): string {
  switch (status) {
    case 'pending_payment': return 'ငွေမပေးချေရသေးပါ'
    case 'payment_received': return 'ငွေပေးချေပြီးပါပြီ၊ ပစ္စည်းပို့ရန် စောင့်နေပါသည်'
    case 'item_sent': return 'ပစ္စည်းပို့ပြီးပါပြီ၊ ဝယ်သူ အတည်ပြုရန် စောင့်နေပါသည်'
    case 'completed': return 'အရောင်းအဝယ် ပြီးဆုံးပြီးပါပြီ'
    case 'cancelled': return 'ပယ်ဖျက်ထားပြီးပါပြီ'
    case 'disputed': return 'အငြင်းပွားမှု ရှိနေပါသည်'
    default: return 'လုပ်ဆောင်၍ မရပါ'
  }
}

async function handleItemSent(chatId: number, msgId: number, txId: string, cbId: string, telegramId: number) {
  const { data: tx } = await supabase
    .from('transactions')
    .select('*, products(*), seller:profiles!transactions_seller_id_fkey(*), buyer:profiles!transactions_buyer_id_fkey(*)')
    .eq('id', txId)
    .single()

  if (!tx) { 
    await answerCb(cbId, '❌ ရောင်းဝယ်မှု ရှာမတွေ့ပါ', true)
    return 
  }
  if (!tx.products) {
    await answerCb(cbId, '❌ ပစ္စည်း ရှာမတွေ့ပါ (ဖျက်ထားပြီးဖြစ်နိုင်ပါသည်)', true)
    return
  }
  if (tx.seller?.telegram_id !== telegramId) { 
    await answerCb(cbId, '❌ သင်သည် ဤရောင်းဝယ်မှု၏ ရောင်းသူမဟုတ်ပါ', true)
    return 
  }
  if (tx.status !== 'payment_received') { 
    await answerCb(cbId, `❌ ${getStatusReason(tx.status)}`, true)
    return 
  }

  await supabase.from('transactions').update({ status: 'item_sent', item_sent_at: new Date().toISOString() }).eq('id', txId)
  await answerCb(cbId, '✅ မှတ်တမ်းတင်ပြီး!')

  const buyerUsername = tx.buyer?.telegram_username 
    ? `@${tx.buyer.telegram_username}` 
    : `ID: ${tx.buyer?.telegram_id || 'Unknown'}`

  await editText(chatId, msgId, `✅ *ပစ္စည်းပို့ပြီး!*

━━━━━━━━━━━━━━━
📦 ${tx.products?.title}
💵 ${tx.amount_ton} TON
👤 ဝယ်သူ: ${buyerUsername}
━━━━━━━━━━━━━━━

ဝယ်သူ အတည်ပြုပါက ငွေရရှိပါမည်`, backBtn())

  if (tx.buyer?.telegram_id) {
    const sellerUsername = tx.seller?.telegram_username 
      ? `@${tx.seller.telegram_username}` 
      : `ID: ${tx.seller?.telegram_id || 'Unknown'}`
    
    // Edit existing buyer message if available, otherwise send new
    if (tx.buyer_msg_id) {
      await editText(tx.buyer.telegram_id, tx.buyer_msg_id, `📦 *ပစ္စည်းပို့ပြီး!*

━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
🏪 ရောင်းသူ: ${sellerUsername}
━━━━━━━━━━━━━━━

ပစ္စည်းရရှိပါက "ရရှိပြီး" နှိပ်ပါ

⚠️ မရရှိမီ မနှိပ်ပါ!`, buyerBtns(txId, tx.seller?.telegram_username))
    } else {
      await sendMessage(tx.buyer.telegram_id, `📦 *ပစ္စည်းပို့ပြီး!*

━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
🏪 ရောင်းသူ: ${sellerUsername}
━━━━━━━━━━━━━━━

ပစ္စည်းရရှိပါက "ရရှိပြီး" နှိပ်ပါ

⚠️ မရရှိမီ မနှိပ်ပါ!`, buyerBtns(txId, tx.seller?.telegram_username))
    }
  }
}

async function handleItemReceived(chatId: number, msgId: number, txId: string, cbId: string, telegramId: number) {
  const { data: tx } = await supabase
    .from('transactions')
    .select('*, products(*), buyer:profiles!transactions_buyer_id_fkey(*)')
    .eq('id', txId)
    .single()

  if (!tx) { 
    await answerCb(cbId, '❌ ရောင်းဝယ်မှု ရှာမတွေ့ပါ', true)
    return 
  }
  if (!tx.products) {
    await answerCb(cbId, '❌ ပစ္စည်း ရှာမတွေ့ပါ (ဖျက်ထားပြီးဖြစ်နိုင်ပါသည်)', true)
    return
  }
  if (tx.buyer?.telegram_id !== telegramId) { 
    await answerCb(cbId, '❌ သင်သည် ဤရောင်းဝယ်မှု၏ ဝယ်သူမဟုတ်ပါ', true)
    return 
  }
  if (tx.status !== 'item_sent') { 
    await answerCb(cbId, `❌ ${getStatusReason(tx.status)}`, true)
    return 
  }

  await answerCb(cbId)
  
  const confirmText = `⚠️ *အတည်ပြုရန်*

━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
━━━━━━━━━━━━━━━

ရရှိပြီးကြောင်း အတည်ပြုမည်လား?

*သတိ:* ရောင်းသူထံ ငွေလွှဲမည်
ပြန်ပြင်၍ မရပါ`

  // Try editText first, if fails (photo message), try editMessageMedia, if still fails send new message
  const textEdited = await editText(chatId, msgId, confirmText, confirmBtns(txId))
  if (!textEdited) {
    // Message might be a photo, try to edit as media
    const confirmQR = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent('CONFIRM?')}&bgcolor=FFEB3B`
    const mediaEdited = await editMediaWithPhoto(chatId, msgId, confirmQR, confirmText, confirmBtns(txId))
    if (!mediaEdited) {
      // If both fail, send new message
      await sendMessage(chatId, confirmText, confirmBtns(txId))
    }
  }
}

async function handleConfirmReceived(chatId: number, msgId: number, txId: string, cbId: string, telegramId: number) {
  const { data: tx } = await supabase
    .from('transactions')
    .select('*, products(*), seller:profiles!transactions_seller_id_fkey(*), buyer:profiles!transactions_buyer_id_fkey(*)')
    .eq('id', txId)
    .single()

  if (!tx) { 
    await answerCb(cbId, '❌ ရောင်းဝယ်မှု ရှာမတွေ့ပါ', true)
    return 
  }
  if (!tx.products) {
    await answerCb(cbId, '❌ ပစ္စည်း ရှာမတွေ့ပါ (ဖျက်ထားပြီးဖြစ်နိုင်ပါသည်)', true)
    return
  }
  if (tx.status !== 'item_sent') { 
    await answerCb(cbId, `❌ ${getStatusReason(tx.status)}`, true)
    return 
  }

  await supabase.from('transactions').update({ status: 'completed', confirmed_at: new Date().toISOString() }).eq('id', txId)

  // Credit seller
  if (tx.seller) {
    const newBal = Number(tx.seller.balance) + Number(tx.seller_receives_ton)
    await supabase.from('profiles').update({ balance: newBal }).eq('id', tx.seller.id)

    if (tx.seller.telegram_id) {
      // Notify seller and ask to rate buyer
      await sendMessage(tx.seller.telegram_id, `🎉 *ငွေရရှိပြီး!*

━━━━━━━━━━━━━━━
📦 ${tx.products?.title}
💰 +${Number(tx.seller_receives_ton).toFixed(2)} TON
💳 လက်ကျန်: *${newBal.toFixed(2)} TON*
━━━━━━━━━━━━━━━

ငွေထုတ်ရန် "ငွေထုတ်" နှိပ်ပါ`, backBtn())

      // Ask seller to rate buyer
      if (tx.buyer?.id) {
        await sendMessage(tx.seller.telegram_id, `⭐ *ဝယ်သူကို အဆင့်သတ်မှတ်ပေးပါ*

━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
━━━━━━━━━━━━━━━

ဝယ်သူအား ဘယ်လောက် အဆင့်ပေးမလဲ?
သင့်အဆင့်သတ်မှတ်ချက်က အနာဂတ် ဝယ်သူများအတွက် အကူအညီဖြစ်ပါမည်`, ratingBtns(txId, tx.buyer.id))
      }
    }
  }

  await answerCb(cbId, '✅ အတည်ပြုပြီး!')
  
  // Edit existing message instead of delete + send new (to avoid spam)
  if (tx.seller?.id) {
    await editText(chatId, msgId, `🎉 *အရောင်းအဝယ် ပြီးဆုံးပါပြီ!*

╔══════════════════════════════╗
║                              ║
║      ✅ *SUCCESS*            ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
💵 *${tx.amount_ton} TON*
━━━━━━━━━━━━━━━━━━━━━━━━━

⭐ *ရောင်းသူကို အဆင့်သတ်မှတ်ပေးပါ*

သင့်အဆင့်သတ်မှတ်ချက်က အနာဂတ် 
ဝယ်သူများအတွက် အကူအညီဖြစ်ပါမည်`, ratingBtns(txId, tx.seller.id))
  } else {
    await editText(chatId, msgId, `✅ *အရောင်းအဝယ် ပြီးဆုံးပါပြီ!*

━━━━━━━━━━━━━━━
📦 ${tx.products?.title}
💵 ${tx.amount_ton} TON
━━━━━━━━━━━━━━━

ကျေးဇူးတင်ပါသည် 🙏`, backBtn())
  }
}

async function handleDispute(chatId: number, msgId: number, txId: string, cbId: string, telegramId: number) {
  const { data: tx } = await supabase
    .from('transactions')
    .select('*, products(*), buyer:profiles!transactions_buyer_id_fkey(*)')
    .eq('id', txId)
    .single()

  if (!tx) { 
    await answerCb(cbId, '❌ ရောင်းဝယ်မှု ရှာမတွေ့ပါ', true)
    return 
  }
  if (!tx.products) {
    await answerCb(cbId, '❌ ပစ္စည်း ရှာမတွေ့ပါ (ဖျက်ထားပြီးဖြစ်နိုင်ပါသည်)', true)
    return
  }
  if (tx.buyer?.telegram_id !== telegramId) { 
    await answerCb(cbId, '❌ သင်သည် ဤရောင်းဝယ်မှု၏ ဝယ်သူမဟုတ်ပါ', true)
    return 
  }
  if (tx.status === 'completed') {
    await answerCb(cbId, '❌ အရောင်းအဝယ် ပြီးဆုံးပြီးပါပြီ', true)
    return
  }
  if (tx.status === 'cancelled') {
    await answerCb(cbId, '❌ ပယ်ဖျက်ထားပြီးပါပြီ', true)
    return
  }
  if (tx.status === 'disputed') {
    await answerCb(cbId, '❌ အငြင်းပွားမှု တင်ပြီးပါပြီ', true)
    return
  }

  await supabase.from('transactions').update({ status: 'disputed' }).eq('id', txId)
  await answerCb(cbId, '⚠️ အငြင်းပွားမှု တင်ပြီး', true)

  await editText(chatId, msgId, `⚠️ *အငြင်းပွားမှု တင်ပြီး*

📦 ${tx.products?.title}

Admin စစ်ဆေးပြီး ဆက်သွယ်ပါမည်`, backBtn())

  // Notify admin about new dispute
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/notify-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        type: 'admin_new_dispute',
        amount: tx.amount_ton,
        product_title: tx.products?.title,
        user_telegram_username: tx.buyer?.telegram_username,
        transaction_link: tx.unique_link
      })
    })
    console.log('Admin notified about dispute:', txId)
  } catch (e) {
    console.error('Failed to notify admin about dispute:', e)
  }
}

async function handleCancelTx(chatId: number, msgId: number, txId: string, cbId: string, telegramId: number) {
  const { data: tx } = await supabase
    .from('transactions')
    .select('*, products(*), seller:profiles!transactions_seller_id_fkey(*)')
    .eq('id', txId)
    .single()

  if (!tx) { 
    await answerCb(cbId, '❌ ရောင်းဝယ်မှု ရှာမတွေ့ပါ', true)
    return 
  }
  if (!tx.products) {
    await answerCb(cbId, '❌ ပစ္စည်း ရှာမတွေ့ပါ (ဖျက်ထားပြီးဖြစ်နိုင်ပါသည်)', true)
    return
  }
  if (tx.seller?.telegram_id !== telegramId) { 
    await answerCb(cbId, '❌ သင်သည် ဤရောင်းဝယ်မှု၏ ရောင်းသူမဟုတ်ပါ', true)
    return 
  }
  if (tx.status === 'completed') {
    await answerCb(cbId, '❌ အရောင်းအဝယ် ပြီးဆုံးပြီးပါပြီ', true)
    return
  }
  if (tx.status === 'cancelled') {
    await answerCb(cbId, '❌ ပယ်ဖျက်ထားပြီးပါပြီ', true)
    return
  }
  if (tx.status === 'item_sent') {
    await answerCb(cbId, '❌ ပစ္စည်းပို့ပြီးပါပြီ၊ ပယ်ဖျက်၍မရပါ', true)
    return
  }
  if (tx.status === 'disputed') {
    await answerCb(cbId, '❌ အငြင်းပွားမှု ရှိနေပါသည်', true)
    return
  }

  await supabase.from('transactions').update({ status: 'cancelled' }).eq('id', txId)
  await answerCb(cbId, '❌ ပယ်ဖျက်ပြီး!')

  await editText(chatId, msgId, `❌ *ပယ်ဖျက်ပြီး*

📦 ${tx.products?.title}`, backBtn())
}

// ==================== MAIN HANDLERS ====================
async function handleMessage(msg: { chat: { id: number }; from?: { username?: string }; text?: string; message_id: number }) {
  const chatId = msg.chat.id
  const username = msg.from?.username
  const text = msg.text?.trim() || ''
  const inMsgId = msg.message_id

  console.log(`[${chatId}] ${text}`)
  if (isRateLimited(chatId)) return

  // Check if user is blocked
  const blockCheck = await isUserBlocked(chatId)
  if (blockCheck.blocked) {
    const reason = blockCheck.reason ? `\n\n📝 *အကြောင်းပြချက်:* ${blockCheck.reason}` : ''
    await sendMessage(chatId, BLOCKED_MESSAGE + reason)
    return
  }

  // Commands
  if (text.startsWith('/start')) {
    const parts = text.split(' ')
    if (parts[1]?.startsWith('buy_')) {
      await handleBuyLink(chatId, parts[1].replace('buy_', ''), username)
    } else {
      await showHome(chatId, undefined, username)
    }
    await deleteUserState(chatId)
    return
  }

  // Handle /sell command: /sell <title> <price>
  if (text.startsWith('/sell ')) {
    const sellText = text.replace('/sell ', '').trim()
    const lastSpaceIdx = sellText.lastIndexOf(' ')
    
    if (lastSpaceIdx > 0) {
      const title = sellText.substring(0, lastSpaceIdx).trim()
      const priceStr = sellText.substring(lastSpaceIdx + 1).trim()
      const price = parseFloat(priceStr)
      
      if (title && !isNaN(price) && price > 0) {
        await handleCreateProductDirect(chatId, title, price, username)
        return
      }
    }
    
    // Show usage if format is wrong
    await sendMessage(chatId, `❌ *ပုံစံမှား*

━━━━━━━━━━━━━━━
*မှန်ကန်သောပုံစံ:*
\`/sell <ပစ္စည်းအမည်> <ဈေး>\`

*ဥပမာ:*
\`/sell iPhone 15 Pro 150\`
\`/sell hei 1928\`
━━━━━━━━━━━━━━━`, backBtn())
    return
  }

  if (text.startsWith('/')) {
    await showHome(chatId, undefined, username)
    await deleteUserState(chatId)
    return
  }

  // State handling
  const state = await getUserState(chatId)
  
  // Step-by-step sell flow
  if (state?.action === 'sell_title' && state.msgId) {
    await handleSellTitle(chatId, text, state.msgId)
    await deleteMsg(chatId, inMsgId)
    return
  }
  
  if (state?.action === 'sell_price' && state.msgId) {
    await handleSellPrice(chatId, text, state.msgId, username)
    await deleteMsg(chatId, inMsgId)
    return
  }

  if (state?.action === 'wd_wallet' && state.msgId) {
    await handleWithdrawRequest(chatId, text, state.msgId, username)
    await deleteMsg(chatId, inMsgId)
    return
  }

  // Custom withdrawal amount input
  if (state?.action === 'wd_custom' && state.msgId) {
    const amount = parseFloat(text)
    const balance = Number(state.data?.balance) || 0
    const minWithdrawal = Number(state.data?.minWithdrawal) || 0.01
    
    if (!isNaN(amount) && amount >= minWithdrawal && amount <= balance) {
      await showWithdrawWalletPrompt(chatId, state.msgId, amount)
      await deleteMsg(chatId, inMsgId)
      return
    } else if (amount < minWithdrawal) {
      await editText(chatId, state.msgId, `❌ *အနည်းဆုံး ပမာဏ: ${minWithdrawal} TON*\n\nထုတ်ယူလိုသော ပမာဏ ထပ်ရိုက်ပါ:`, cancelBtn())
      await deleteMsg(chatId, inMsgId)
      return
    } else if (amount > balance) {
      await editText(chatId, state.msgId, `❌ *လက်ကျန်ငွေ မလုံလောက်ပါ*\n\nလက်ကျန်: ${balance.toFixed(4)} TON\n\nထုတ်ယူလိုသော ပမာဏ ထပ်ရိုက်ပါ:`, cancelBtn())
      await deleteMsg(chatId, inMsgId)
      return
    }
  }

  if (state?.action === 'dep_custom' && state.msgId) {
    const amount = parseFloat(text)
    if (!isNaN(amount) && amount > 0) {
      await showDepositQR(chatId, state.msgId, amount, username)
      await deleteMsg(chatId, inMsgId)
      return
    }
  }

  // Rating comment input
  if (state?.action === 'rating_comment' && state.msgId && state.data?.ratingId) {
    const ratingId = String(state.data.ratingId)
    const ratingNum = Number(state.data.rating) || 5
    await handleRatingComment(chatId, text, state.msgId, ratingId, ratingNum)
    await deleteMsg(chatId, inMsgId)
    return
  }

  await showHome(chatId, undefined, username)
}

async function handleCallback(cb: { id: string; from: { id: number; username?: string }; data?: string; message?: { chat: { id: number }; message_id: number } }) {
  const chatId = cb.message?.chat.id
  const msgId = cb.message?.message_id
  const data = cb.data || ''
  const telegramId = cb.from.id
  const username = cb.from.username

  if (!chatId || !msgId) { await answerCb(cb.id); return }
  console.log(`[${chatId}] CB: ${data}`)
  if (isRateLimited(chatId)) { await answerCb(cb.id, 'ခဏစောင့်ပါ...'); return }

  // Check if user is blocked
  const blockCheck = await isUserBlocked(telegramId)
  if (blockCheck.blocked) {
    await answerCb(cb.id, '🚫 သင့်အကောင့် ပိတ်ထားပါသည်', true)
    return
  }

  const [type, action, id] = data.split(':')

  // Menu
  if (type === 'm') {
    await answerCb(cb.id)
    switch (action) {
      case 'home': await showHome(chatId, msgId, username); break
      case 'sell': await showSellPrompt(chatId, msgId); break
      case 'dep': await showDepositOptions(chatId, msgId); break
      case 'wd': await showWithdrawOptions(chatId, msgId, username); break
      case 'bal': await showBalance(chatId, msgId, username); break
      case 'ord': await showOrders(chatId, msgId, username); break
      case 'mylinks': await showMyLinks(chatId, msgId, username); break
      case 'hist': await showHistory(chatId, msgId, username); break
      case 'rating': await showMyRating(chatId, msgId, username); break
      case 'help': await showHelp(chatId, msgId); break
    }
    return
  }

  // Deposit
  if (type === 'd') {
    await answerCb(cb.id)
    if (action === 'custom') {
      await setUserState(chatId, { action: 'dep_custom', msgId })
      await editText(chatId, msgId, `💰 *စိတ်ကြိုက် ပမာဏ*

သွင်းလိုသော ပမာဏ ရိုက်ထည့်ပါ:
ဥပမာ: \`25.5\``, cancelBtn())
    } else {
      const amt = parseInt(action)
      if (!isNaN(amt)) await showDepositQR(chatId, msgId, amt, username)
    }
    return
  }

  // Withdraw
  if (type === 'w') {
    await answerCb(cb.id)
    if (action === 'custom') {
      // Get balance for validation
      const profile = await getProfile(telegramId, username)
      const balance = Number(profile.balance)
      
      // Get commission rate and min withdrawal for display
      const { data: commSetting } = await supabase.from('settings').select('value').eq('key', 'commission_rate').single()
      const commRate = commSetting ? parseFloat(commSetting.value) : 5
      
      const { data: minWdSetting } = await supabase.from('settings').select('value').eq('key', 'min_withdrawal_amount').maybeSingle()
      const minWithdrawal = minWdSetting ? parseFloat(minWdSetting.value) : 0.01
      
      await setUserState(chatId, { action: 'wd_custom', msgId, data: { balance, commRate, minWithdrawal } })
      await editText(chatId, msgId, `💸 *စိတ်ကြိုက် ပမာဏ*

━━━━━━━━━━━━━━━
💳 လက်ကျန်: *${balance.toFixed(4)} TON*
💰 Commission: *${commRate}%*
━━━━━━━━━━━━━━━

ထုတ်ယူလိုသော ပမာဏ ရိုက်ထည့်ပါ:
ဥပမာ: \`5.5\`

⚠️ အနည်းဆုံး: ${minWithdrawal} TON
⚠️ အများဆုံး: ${balance.toFixed(4)} TON`, cancelBtn())
    } else {
      const amt = parseFloat(action)
      if (!isNaN(amt)) await showWithdrawWalletPrompt(chatId, msgId, amt)
    }
    return
  }

  // Actions
  if (type === 'a') {
    switch (action) {
      case 'sent': await handleItemSent(chatId, msgId, id, cb.id, telegramId); break
      case 'recv': await handleItemReceived(chatId, msgId, id, cb.id, telegramId); break
      case 'cfm': await handleConfirmReceived(chatId, msgId, id, cb.id, telegramId); break
      case 'disp': await handleDispute(chatId, msgId, id, cb.id, telegramId); break
      case 'cancel': await handleCancelTx(chatId, msgId, id, cb.id, telegramId); break
      default: await answerCb(cb.id)
    }
    return
  }

  // Rating callback: r:<rating>:<txId>:<ratedId>
  if (type === 'r') {
    const rating = parseInt(action)
    const txId = id
    const ratedId = data.split(':')[3] || ''
    if (rating >= 1 && rating <= 5 && txId && ratedId) {
      await handleRating(chatId, msgId, rating, txId, ratedId, cb.id, telegramId)
    } else {
      await answerCb(cb.id, '❌ အမှားဖြစ်ပွားပါသည်', true)
    }
    return
  }

  // Buy with balance callback: buy:bal:<txId>
  if (type === 'buy' && action === 'bal') {
    await handleBuyWithBalance(chatId, msgId, id, cb.id, telegramId, username)
    return
  }

  // Delete confirmation callback: del:yes|no:<originalMsgId>
  if (type === 'del') {
    if (action === 'yes') {
      await answerCb(cb.id, '🗑️ ဖျက်ပြီး!')
      await deleteMsg(chatId, msgId)
    } else {
      await answerCb(cb.id, '✅ သိမ်းထားပြီး!')
      await editText(chatId, msgId, `✅ *Message သိမ်းထားပါသည်*

ဤ message ကို ဖျက်မည်မဟုတ်ပါ`, backBtn())
    }
    return
  }

  // Skip comment callback
  if (data === 'skip_comment') {
    const state = await getUserState(chatId)
    if (state?.action === 'rating_comment' && state.data?.rating) {
      await deleteUserState(chatId)
      const rating = Number(state.data.rating)
      await answerCb(cb.id, '✅ ကျော်လိုက်ပြီး!')
      await editText(chatId, msgId, `✅ *ကျေးဇူးတင်ပါသည်!*

━━━━━━━━━━━━━━━
${'⭐'.repeat(rating)} ${rating}/5
━━━━━━━━━━━━━━━

အဆင့်သတ်မှတ်ပေးသည့်အတွက် ကျေးဇူးပါ 🙏`, backBtn())
    } else {
      await answerCb(cb.id)
    }
    return
  }

  await answerCb(cb.id)
}

// ==================== WEBHOOK VALIDATION ====================
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')

function verifyTelegramRequest(req: Request): boolean {
  // Telegram sends the secret_token in this header when configured
  const secretToken = req.headers.get('x-telegram-bot-api-secret-token')
  
  // If no secret is configured, reject all requests (fail-closed)
  if (!TELEGRAM_WEBHOOK_SECRET) {
    console.warn('TELEGRAM_WEBHOOK_SECRET not configured - rejecting request')
    return false
  }
  
  // Verify the token matches
  if (secretToken !== TELEGRAM_WEBHOOK_SECRET) {
    console.warn('Invalid webhook secret token received')
    return false
  }
  
  return true
}

// ==================== SERVER ====================
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    // SECURITY: Verify request is from Telegram
    if (!verifyTelegramRequest(req)) {
      console.warn('Unauthorized webhook request rejected')
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body = await req.json()
    console.log('Webhook:', JSON.stringify(body).substring(0, 300))

    if (body.message) await handleMessage(body.message)
    else if (body.callback_query) await handleCallback(body.callback_query)

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('Error:', e)
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
