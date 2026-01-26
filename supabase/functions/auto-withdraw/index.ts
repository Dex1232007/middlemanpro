import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const TONCENTER_API_KEY = Deno.env.get('TONCENTER_API_KEY') || ''
const ADMIN_WALLET_ENV = Deno.env.get('ADMIN_TON_WALLET_ADDRESS') || ''

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ==================== REFERRAL EARNINGS ====================
async function processReferralEarningsOnWithdraw(
  profileId: string,
  withdrawAmount: number,
  withdrawalId: string
): Promise<{ l1Paid: number; l2Paid: number }> {
  let l1Paid = 0
  let l2Paid = 0

  try {
    // Get referral rates from settings
    const { data: l1Setting } = await supabase.from('settings').select('value').eq('key', 'referral_l1_rate').maybeSingle()
    const { data: l2Setting } = await supabase.from('settings').select('value').eq('key', 'referral_l2_rate').maybeSingle()
    
    const l1Rate = l1Setting ? parseFloat(l1Setting.value) : 5 // 5% default
    const l2Rate = l2Setting ? parseFloat(l2Setting.value) : 3 // 3% default

    // Get the user's referrers (both L1 and L2)
    const { data: referrals } = await supabase
      .from('referrals')
      .select('referrer_id, level')
      .eq('referred_id', profileId)

    if (!referrals || referrals.length === 0) {
      console.log(`No referrers found for profile ${profileId}`)
      return { l1Paid, l2Paid }
    }

    for (const ref of referrals) {
      const rate = ref.level === 1 ? l1Rate : l2Rate
      const earnings = Math.round((withdrawAmount * rate / 100) * 10000) / 10000

      if (earnings <= 0) continue

      // Record referral earning (use withdrawal_id as transaction reference)
      await supabase.from('referral_earnings').insert({
        referrer_id: ref.referrer_id,
        from_profile_id: profileId,
        from_transaction_id: withdrawalId, // Using withdrawal ID as reference
        amount_ton: earnings,
        level: ref.level
      })

      // Credit referrer's balance
      const { data: referrer } = await supabase
        .from('profiles')
        .select('id, balance, total_referral_earnings, telegram_id')
        .eq('id', ref.referrer_id)
        .single()

      if (referrer) {
        const newBalance = Number(referrer.balance) + earnings
        const newTotalEarnings = Number(referrer.total_referral_earnings || 0) + earnings

        await supabase.from('profiles').update({
          balance: newBalance,
          total_referral_earnings: newTotalEarnings
        }).eq('id', referrer.id)

        // Track paid amounts
        if (ref.level === 1) {
          l1Paid = earnings
        } else {
          l2Paid = earnings
        }

        // Notify referrer
        if (referrer.telegram_id) {
          await sendTg(referrer.telegram_id, `🎁 *Referral Commission ရရှိပြီး!*

━━━━━━━━━━━━━━━━━━━━━━━━━
💰 *+${earnings.toFixed(4)} TON*
📊 Level ${ref.level} (${rate}%)
━━━━━━━━━━━━━━━━━━━━━━━━━

💳 လက်ကျန်: *${newBalance.toFixed(4)} TON*
🎁 စုစုပေါင်း Referral: *${newTotalEarnings.toFixed(4)} TON*

✅ သင်၏ Referral မှ ငွေထုတ်သောကြောင့်
   commission ရရှိပါသည်!`)
        }

        console.log(`Referral earning credited: ${earnings} TON to ${referrer.id} (L${ref.level})`)
      }
    }
  } catch (e) {
    console.error('Process referral earnings error:', e)
  }

  return { l1Paid, l2Paid }
}

const TON_API_V2 = 'https://toncenter.com/api/v2'

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
  if (keyboard) {
    body.reply_markup = keyboard
  }
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  console.log('TG send:', (await res.json()).ok ? 'ok' : 'fail')
}

function mainMenuBtn() {
  return {
    inline_keyboard: [[{ text: '🏠 ပင်မစာမျက်နှာ', callback_data: 'm:home' }]]
  }
}

async function editTgMessage(chatId: number, msgId: number, text: string) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: msgId, text, parse_mode: 'Markdown' }),
    })
    const result = await res.json()
    console.log('TG edit:', result.ok ? 'ok' : result.description)
    return result.ok
  } catch (e) {
    console.error('TG edit error:', e)
    return false
  }
}

async function deleteTgMessage(chatId: number, msgId: number) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: msgId }),
    })
    const result = await res.json()
    return result.ok
  } catch (e) {
    console.error('TG delete error:', e)
    return false
  }
}

// ==================== ENCRYPTION (AES-GCM) ====================
async function decryptMnemonic(encryptedBase64: string, password: string): Promise<string> {
  const encryptedBytes = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0))
  
  const salt = encryptedBytes.slice(0, 16)
  const iv = encryptedBytes.slice(16, 28)
  const ciphertext = encryptedBytes.slice(28)
  
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  )
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    derivedKey,
    ciphertext
  )
  
  return new TextDecoder().decode(decrypted)
}

// ==================== TON WALLET HELPERS ====================
async function getMnemonicWords(): Promise<string[]> {
  const { data: setting, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'ton_mnemonic_encrypted')
    .maybeSingle()
  
  if (error || !setting?.value) {
    throw new Error('Mnemonic not configured')
  }
  
  const encryptionKey = SUPABASE_SERVICE_ROLE_KEY.substring(0, 64)
  const mnemonic = await decryptMnemonic(setting.value, encryptionKey)
  const words = mnemonic.trim().split(/\s+/)
  
  if (words.length !== 24) {
    throw new Error(`Invalid mnemonic: expected 24 words, got ${words.length}`)
  }
  
  return words
}

async function getConfiguredAdminWalletAddress(): Promise<string> {
  const { data: setting, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'admin_ton_wallet')
    .maybeSingle()

  if (error) {
    console.error('Failed to load admin_ton_wallet setting:', error)
  }

  return (setting?.value || ADMIN_WALLET_ENV || '').trim()
}

type TonSender = {
  walletAddress: string
  sendTransfer: (args: { to: string; amountNano: bigint; comment?: string }) => Promise<void>
}

async function createTonSender(mnemonicWords: string[]): Promise<TonSender> {
  console.log('Loading TON libraries...')

  const tonCrypto = await import('https://esm.sh/@ton/crypto@3.3.0?bundle')
  const tonCore = await import('https://esm.sh/@ton/ton@16.1.0?bundle')

  console.log('TON libraries loaded successfully')

  const keyPair = await tonCrypto.mnemonicToWalletKey(mnemonicWords)

  const wallet = tonCore.WalletContractV4.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  })

  const walletAddress = wallet.address.toString()
  console.log('Mnemonic-derived wallet address:', walletAddress)

  const endpoint = TONCENTER_API_KEY
    ? `https://toncenter.com/api/v2/jsonRPC?api_key=${TONCENTER_API_KEY}`
    : 'https://toncenter.com/api/v2/jsonRPC'

  const client = new tonCore.TonClient({ endpoint })
  const walletContract = client.open(wallet)

  return {
    walletAddress,
    sendTransfer: async ({ to, amountNano, comment }) => {
      const seqno = await walletContract.getSeqno()
      console.log('Current seqno:', seqno)

      await walletContract.sendTransfer({
        secretKey: keyPair.secretKey,
        seqno,
        messages: [
          tonCore.internal({
            to,
            value: amountNano,
            body: comment || '',
            bounce: false,
          }),
        ],
      })
    },
  }
}

function getTonCenterHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (TONCENTER_API_KEY) {
    headers['X-API-Key'] = TONCENTER_API_KEY
  }
  return headers
}

async function getWalletBalance(wallet: string): Promise<number> {
  try {
    const url = `${TON_API_V2}/getAddressBalance?address=${encodeURIComponent(wallet)}`
    const res = await fetch(url, { headers: getTonCenterHeaders() })
    const data = await res.json()
    
    if (data?.ok && typeof data.result === 'string') {
      return parseInt(data.result, 10) / 1e9
    }

    console.warn('TON API getAddressBalance not ok:', { wallet, data })
    return 0
  } catch (e) {
    console.error('Get balance error:', e)
    return 0
  }
}

// (note) Transfer is sent via createTonSender() to ensure the source wallet matches the mnemonic.

// ==================== PROCESS WITHDRAWALS ====================
async function processWithdrawals() {
  const { data: commSetting } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'commission_rate')
    .maybeSingle()
  
  const commRate = commSetting ? parseFloat(commSetting.value) : 5

  const { data: withdrawals, error } = await supabase
    .from('withdrawals')
    .select('*, profile:profiles(*)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(5)

  if (error) {
    console.error('Failed to fetch withdrawals:', error)
    return { processed: 0, failed: 0, errors: [error.message] }
  }

  if (!withdrawals?.length) {
    console.log('No pending withdrawals')
    return { processed: 0, failed: 0, errors: [] }
  }

  console.log(`Processing ${withdrawals.length} withdrawals...`)
  
  // Load mnemonic once for all withdrawals
  let mnemonicWords: string[]
  try {
    mnemonicWords = await getMnemonicWords()
    console.log(`Mnemonic loaded: ${mnemonicWords.length} words`)
  } catch (e) {
    console.error('Mnemonic not configured:', e)
    return { processed: 0, failed: 0, errors: ['Mnemonic not configured'] }
  }
  
  const sender = await createTonSender(mnemonicWords)

  const configuredWallet = await getConfiguredAdminWalletAddress()
  if (configuredWallet && configuredWallet !== sender.walletAddress) {
    console.warn('Configured admin wallet does not match mnemonic-derived wallet. Using mnemonic-derived wallet for auto-send.', {
      configuredWallet,
      mnemonicWallet: sender.walletAddress,
    })
  }

  let walletBalance = await getWalletBalance(sender.walletAddress)
  console.log(`Source wallet (mnemonic): ${sender.walletAddress}`)
  console.log(`Wallet balance: ${walletBalance} TON`)

  let processed = 0
  let failed = 0
  const errors: string[] = []

  for (const wd of withdrawals) {
    try {
      const withdrawAmount = Number(wd.amount_ton)
      const fee = withdrawAmount * (commRate / 100)
      const sendAmount = withdrawAmount - fee
      
      console.log(`Processing withdrawal ${wd.id}: ${withdrawAmount} TON (fee: ${fee.toFixed(4)}, send: ${sendAmount.toFixed(4)}) to ${wd.destination_wallet}`)
      
      const profile = wd.profile
      if (!profile) {
        throw new Error('Profile not found')
      }
      
      const currentBalance = Number(profile.balance)
      
      // LIVE STATUS UPDATE: Show progress bar animation
      if (profile.telegram_id && wd.telegram_msg_id) {
        console.log(`📱 Updating withdrawal status with progress: ${wd.telegram_msg_id}`)
        
        // Step 1: Started (20%)
        await editTgMessage(profile.telegram_id, wd.telegram_msg_id, `🔍 *စစ်ဆေးနေသည်...*

━━━━━━━━━━━━━━━
💵 ထုတ်ယူမည်: *${withdrawAmount.toFixed(4)} TON*
📊 Commission (${commRate}%): *-${fee.toFixed(4)} TON*
✅ ရရှိမည်: *${sendAmount.toFixed(4)} TON*
💳 Wallet: \`${wd.destination_wallet.substring(0, 10)}...${wd.destination_wallet.slice(-6)}\`
━━━━━━━━━━━━━━━

📊 *Progress:* ${progressBar(2, 10)}

✅ တောင်းဆိုချက် လက်ခံပြီး
🔄 လက်ကျန် စစ်ဆေးနေသည်...`)
      }
      
      // Check user balance
      if (currentBalance < withdrawAmount) {
        throw new Error(`Insufficient user balance: ${currentBalance} < ${withdrawAmount}`)
      }
      
      // Check wallet has enough funds (with 0.05 TON buffer for network fees)
      if (walletBalance < sendAmount + 0.05) {
        throw new Error(`Insufficient wallet balance: ${walletBalance.toFixed(4)} < ${(sendAmount + 0.05).toFixed(4)}`)
      }
      
      // Step 2: Balance verified (50%)
      if (profile.telegram_id && wd.telegram_msg_id) {
        await editTgMessage(profile.telegram_id, wd.telegram_msg_id, `💸 *ငွေလွှဲနေသည်...*

━━━━━━━━━━━━━━━
💵 ထုတ်ယူမည်: *${withdrawAmount.toFixed(4)} TON*
📊 Commission (${commRate}%): *-${fee.toFixed(4)} TON*
✅ ရရှိမည်: *${sendAmount.toFixed(4)} TON*
💳 Wallet: \`${wd.destination_wallet.substring(0, 10)}...${wd.destination_wallet.slice(-6)}\`
━━━━━━━━━━━━━━━

📊 *Progress:* ${progressBar(5, 10)}

✅ တောင်းဆိုချက် လက်ခံပြီး
✅ လက်ကျန် စစ်ဆေးပြီး
🔄 Blockchain သို့ ပေးပို့နေသည်...`)
      }
      
      // ========== SEND TON ON-CHAIN ==========
      console.log(`🚀 Sending ${sendAmount.toFixed(4)} TON to ${wd.destination_wallet}...`)
      
      const amountNano = BigInt(Math.floor(sendAmount * 1e9))
      await sender.sendTransfer({
        to: wd.destination_wallet,
        amountNano,
        comment: `Withdrawal ${wd.id.substring(0, 8)}`,
      })
      
      // Step 3: Transaction sent (80%)
      if (profile.telegram_id && wd.telegram_msg_id) {
        await editTgMessage(profile.telegram_id, wd.telegram_msg_id, `⏳ *အတည်ပြုနေသည်...*

━━━━━━━━━━━━━━━
💵 ထုတ်ယူမည်: *${withdrawAmount.toFixed(4)} TON*
📊 Commission (${commRate}%): *-${fee.toFixed(4)} TON*
✅ ရရှိမည်: *${sendAmount.toFixed(4)} TON*
💳 Wallet: \`${wd.destination_wallet.substring(0, 10)}...${wd.destination_wallet.slice(-6)}\`
━━━━━━━━━━━━━━━

📊 *Progress:* ${progressBar(8, 10)}

✅ တောင်းဆိုချက် လက်ခံပြီး
✅ လက်ကျန် စစ်ဆေးပြီး
✅ Blockchain သို့ ပေးပို့ပြီး
🔄 အတည်ပြုနေသည်...`)
      }

      // We don't get the real tx hash immediately from this RPC path.
      const txRef = `auto_${Date.now()}_${wd.id.substring(0, 8)}`
      console.log(`✅ TON sent! Ref: ${txRef}`)
      
      // Update wallet balance after send
      walletBalance -= (sendAmount + 0.01)
      
      // Deduct FULL amount from user balance (includes fee)
      const newBalance = currentBalance - withdrawAmount
      await supabase
        .from('profiles')
        .update({ balance: newBalance })
        .eq('id', profile.id)
      
      // Mark withdrawal as completed
      await supabase.from('withdrawals').update({
        status: 'completed',
        processed_at: new Date().toISOString(),
        ton_tx_hash: txRef,
        admin_notes: `Auto-sent. Amount: ${withdrawAmount} TON, Fee (${commRate}%): ${fee.toFixed(4)} TON, Sent: ${sendAmount.toFixed(4)} TON`,
      }).eq('id', wd.id)
      
      // Process referral earnings on withdrawal
      const { l1Paid, l2Paid } = await processReferralEarningsOnWithdraw(profile.id, withdrawAmount, wd.id)
      const referralInfo = (l1Paid > 0 || l2Paid > 0) 
        ? `\n🎁 *Referral Bonus:* L1: ${l1Paid.toFixed(4)}, L2: ${l2Paid.toFixed(4)}`
        : ''
      
      // Delete old status message and send fresh confirmation
      if (profile.telegram_id) {
        if (wd.telegram_msg_id) {
          await deleteTgMessage(profile.telegram_id, wd.telegram_msg_id)
        }
        
        await sendTg(profile.telegram_id, `✅ *ငွေထုတ်ယူမှု အောင်မြင်ပါပြီ!*

╔══════════════════════════════╗
║                              ║
║     ✅ *SENT SUCCESS*        ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
💵 *ထုတ်ယူပမာဏ:* ${withdrawAmount.toFixed(4)} TON
📊 *Commission (${commRate}%):* -${fee.toFixed(4)} TON
✅ *ပေးပို့ပြီး:* ${sendAmount.toFixed(4)} TON
💳 *Wallet:* ${wd.destination_wallet.substring(0, 10)}...${wd.destination_wallet.slice(-6)}
━━━━━━━━━━━━━━━━━━━━━━━━━

🔗 *Ref:* \`${txRef}\`
⏱️ ၅ မိနစ်အတွင်း သင်၏ Wallet သို့ ရောက်ရှိပါမည်

💰 *လက်ကျန်:* ${newBalance.toFixed(4)} TON

🎉 ကျေးဇူးတင်ပါသည်!`, mainMenuBtn())
      }
      
      console.log(`✅ Withdrawal ${wd.id} completed: ${sendAmount.toFixed(4)} TON${referralInfo}`)
      processed++
      
      // Delay between transactions for rate limiting
      if (withdrawals.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    } catch (e) {
      console.error(`❌ Withdrawal ${wd.id} failed:`, e)
      
      // Keep as pending so it can retry; just record the error.
      await supabase.from('withdrawals').update({
        admin_notes: `Auto-send failed (will retry): ${String(e)}`,
      }).eq('id', wd.id)
      
      // Notify user
      if (wd.profile?.telegram_id) {
        await sendTg(wd.profile.telegram_id, `❌ *ငွေထုတ်ယူမှု မအောင်မြင်ပါ*

╔══════════════════════════════╗
║                              ║
║     ❌ *SEND FAILED*         ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
💵 *ပမာဏ:* ${wd.amount_ton} TON
━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ *ပြဿနာ:* ${String(e).substring(0, 100)}

🔄 စနစ်မှ အလိုအလျောက် ထပ်မံကြိုးစားပါမည်
💬 အကူအညီလိုပါက Admin ထံ ဆက်သွယ်ပါ`)
      }
      
      failed++
      errors.push(`${wd.id}: ${String(e)}`)
    }
  }

  return { processed, failed, errors }
}

// ==================== SERVER ====================
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Check TONCENTER API key
    if (!TONCENTER_API_KEY) {
      console.warn('TONCENTER_API_KEY not configured - using free tier with rate limits')
    }
    
    // Check withdrawal mode setting
    const { data: modeSetting } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'withdrawal_mode')
      .maybeSingle()
    
    const withdrawalMode = modeSetting?.value || 'manual'
    
    // If mode is manual, skip auto processing (unless force=true in body)
    let forceProcess = false
    try {
      const body = await req.json()
      forceProcess = body?.force === true
    } catch {
      // No body or invalid JSON, that's fine
    }
    
    if (withdrawalMode === 'manual' && !forceProcess) {
      console.log('Withdrawal mode is manual, skipping auto-process')
      return new Response(JSON.stringify({
        success: true,
        skipped: true,
        message: 'Withdrawal mode is manual. Use Admin Panel for manual approval.',
        mode: withdrawalMode,
        timestamp: new Date().toISOString(),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    
    // Check mnemonic configuration
    const { data: setting } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'ton_mnemonic_encrypted')
      .maybeSingle()
    
    if (!setting?.value) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Mnemonic not configured. Please configure it in Admin Settings.',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }
    
    // Process withdrawals
    const result = await processWithdrawals()
    
    const adminWallet = await getConfiguredAdminWalletAddress()

    return new Response(JSON.stringify({
      success: true,
      wallet: adminWallet || null,
      processed: result.processed,
      failed: result.failed,
      errors: result.errors,
      mode: 'auto-send',
      timestamp: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('Auto-withdraw error:', e)
    return new Response(JSON.stringify({ 
      success: false,
      error: String(e) 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
