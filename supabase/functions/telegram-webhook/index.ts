import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mnemonicToWalletKey } from "npm:@ton/crypto@3.3.0";
import { WalletContractV4 } from "npm:@ton/ton@16.1.0";
import { t, type Language } from "./translations.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ==================== PAYMENT METHODS ====================
interface PaymentMethod {
  id: string;
  name: string;
  code: string;
  currency: string;
  account_info: string | null;
  instructions: string | null;
  icon: string | null;
}

async function getActivePaymentMethods(): Promise<PaymentMethod[]> {
  const { data } = await supabase
    .from("payment_methods")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  return data || [];
}

async function getPaymentMethodByCode(code: string): Promise<PaymentMethod | null> {
  const { data } = await supabase
    .from("payment_methods")
    .select("*")
    .eq("code", code)
    .eq("is_active", true)
    .maybeSingle();
  return data;
}

// ==================== DECRYPTION HELPER ====================
async function decryptMnemonic(encryptedBase64: string, password: string): Promise<string> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const combined = new Uint8Array(
    atob(encryptedBase64)
      .split("")
      .map((c) => c.charCodeAt(0)),
  );

  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const ciphertext = combined.slice(28);

  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
    "deriveKey",
  ]);

  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ciphertext);

  return decoder.decode(decrypted);
}

// ==================== SETTINGS HELPER ====================
// Real-time derive wallet address from encrypted mnemonic
async function getAdminWallet(): Promise<string | null> {
  try {
    const { data } = await supabase.from("settings").select("value").eq("key", "ton_mnemonic_encrypted").maybeSingle();

    if (!data?.value) {
      console.log("No mnemonic configured");
      return null;
    }

    // Decrypt mnemonic
    const encryptionKey = SUPABASE_SERVICE_ROLE_KEY.substring(0, 64);
    const decryptedMnemonic = await decryptMnemonic(data.value, encryptionKey);
    const words = decryptedMnemonic.split(" ");

    // Derive wallet address
    const keyPair = await mnemonicToWalletKey(words);
    const wallet = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 });
    return wallet.address.toString({ bounceable: false });
  } catch (e) {
    console.error("Failed to derive wallet from mnemonic:", e);
    return null;
  }
}

// ==================== RATE LIMITING ====================
const rateLimitMap = new Map<number, { count: number; lastReset: number }>();
const RATE_LIMIT = 15;
const RATE_WINDOW = 60000;

function isRateLimited(chatId: number): boolean {
  const now = Date.now();
  const userLimit = rateLimitMap.get(chatId);

  if (!userLimit || now - userLimit.lastReset > RATE_WINDOW) {
    rateLimitMap.set(chatId, { count: 1, lastReset: now });
    return false;
  }

  if (userLimit.count >= RATE_LIMIT) return true;
  userLimit.count++;
  return false;
}

// ==================== TELEGRAM API ====================
interface TgResponse {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
}

async function sendMessage(chatId: number, text: string, keyboard?: object): Promise<number | null> {
  try {
    const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: "Markdown" };
    if (keyboard) body.reply_markup = keyboard;

    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const result: TgResponse = await res.json();
    console.log("sendMessage:", result.ok ? "success" : result.description);
    return result.ok ? result.result?.message_id || null : null;
  } catch (e) {
    console.error("sendMessage error:", e);
    return null;
  }
}

async function sendPhoto(chatId: number, photoUrl: string, caption: string, keyboard?: object): Promise<number | null> {
  try {
    const body: Record<string, unknown> = { chat_id: chatId, photo: photoUrl, caption, parse_mode: "Markdown" };
    if (keyboard) body.reply_markup = keyboard;

    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const result: TgResponse = await res.json();
    return result.ok ? result.result?.message_id || null : null;
  } catch (e) {
    console.error("sendPhoto error:", e);
    return null;
  }
}

// Edit message media (photo) using Telegram's editMessageMedia API
async function editMessageMedia(
  chatId: number,
  msgId: number,
  photoUrl: string,
  caption: string,
  keyboard?: object,
): Promise<boolean> {
  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      message_id: msgId,
      media: {
        type: "photo",
        media: photoUrl,
        caption: caption,
        parse_mode: "Markdown",
      },
    };
    if (keyboard) body.reply_markup = keyboard;

    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageMedia`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const result = await res.json();
    console.log("editMessageMedia:", result.ok ? "success" : result.description);
    return result.ok;
  } catch (e) {
    console.error("editMessageMedia error:", e);
    return false;
  }
}
async function editText(chatId: number, msgId: number, text: string, keyboard?: object): Promise<boolean> {
  try {
    const body: Record<string, unknown> = { chat_id: chatId, message_id: msgId, text, parse_mode: "Markdown" };
    if (keyboard) body.reply_markup = keyboard;

    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const result = await res.json();
    return result.ok;
  } catch (e) {
    console.error("editText error:", e);
    return false;
  }
}

async function deleteMsg(chatId: number, msgId: number): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: msgId }),
    });
    return (await res.json()).ok;
  } catch {
    return false;
  }
}

async function answerCb(cbId: string, text?: string, alert = false): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: cbId, text, show_alert: alert }),
    });
  } catch {}
}

// ==================== QR CODE ====================
function generateQR(wallet: string, amount: number, comment: string): string {
  const tonLink = `ton://transfer/${wallet}?amount=${Math.floor(amount * 1e9)}&text=${encodeURIComponent(comment)}`;
  return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(tonLink)}`;
}

// ==================== KEYBOARDS ====================
// Main Menu - Inline keyboard only (no reply keyboard)
const mainMenu = (lang: Language = "my") => ({
  inline_keyboard: [
    [
      { text: t(lang, "menu.order"), callback_data: "m:sell" },
      { text: t(lang, "menu.deposit"), callback_data: "m:dep" },
    ],
    [
      { text: t(lang, "menu.withdraw"), callback_data: "m:wd" },
      { text: t(lang, "menu.balance"), callback_data: "m:bal" },
    ],
    [
      { text: t(lang, "menu.orders"), callback_data: "m:ord" },
      { text: t(lang, "menu.mylinks"), callback_data: "m:mylinks" },
    ],
    [
      { text: t(lang, "menu.history"), callback_data: "m:hist" },
      { text: t(lang, "menu.rating"), callback_data: "m:rating" },
    ],
    [
      { text: t(lang, "menu.referral"), callback_data: "m:ref" },
      { text: t(lang, "menu.language"), callback_data: "m:lang" },
    ],
    [{ text: t(lang, "menu.help"), callback_data: "m:help" }],
    [{ text: "📢 Official Channel", url: "https://t.me/middleman_offical" }],
  ],
});

const backBtn = (lang: Language = "my") => ({
  inline_keyboard: [[{ text: t(lang, "menu.home"), callback_data: "m:home" }]],
});
const cancelBtn = (lang: Language = "my") => ({
  inline_keyboard: [[{ text: t(lang, "menu.cancel"), callback_data: "m:home" }]],
});

// Deposit payment method selection
const depositMethodBtn = (lang: Language = "my") => ({
  inline_keyboard: [
    [{ text: t(lang, "deposit.ton_auto"), callback_data: "dpm:TON" }],
    [{ text: t(lang, "deposit.kbzpay"), callback_data: "dpm:KBZPAY" }],
    [{ text: t(lang, "deposit.wavepay"), callback_data: "dpm:WAVEPAY" }],
    [{ text: t(lang, "menu.home"), callback_data: "m:home" }],
  ],
});

// TON deposit amounts
const depositAmountsTON = (lang: Language = "my") => ({
  inline_keyboard: [
    [
      { text: "1 TON", callback_data: "dt:1" },
      { text: "5 TON", callback_data: "dt:5" },
      { text: "10 TON", callback_data: "dt:10" },
    ],
    [
      { text: "25 TON", callback_data: "dt:25" },
      { text: "50 TON", callback_data: "dt:50" },
      { text: "100 TON", callback_data: "dt:100" },
    ],
    [{ text: t(lang, "deposit.custom"), callback_data: "dt:custom" }],
    [{ text: t(lang, "menu.back"), callback_data: "m:dep" }],
  ],
});

// MMK deposit amounts (KBZPay/WavePay)
const depositAmountsMMK = (lang: Language = "my") => ({
  inline_keyboard: [
    [
      { text: "5,000 MMK", callback_data: "dm:5000" },
      { text: "10,000 MMK", callback_data: "dm:10000" },
      { text: "20,000 MMK", callback_data: "dm:20000" },
    ],
    [
      { text: "50,000 MMK", callback_data: "dm:50000" },
      { text: "100,000 MMK", callback_data: "dm:100000" },
      { text: "200,000 MMK", callback_data: "dm:200000" },
    ],
    [{ text: t(lang, "deposit.custom"), callback_data: "dm:custom" }],
    [{ text: t(lang, "menu.back"), callback_data: "m:dep" }],
  ],
});

// Withdraw currency selection
const withdrawCurrencyBtn = (balanceTon: number, balanceMmk: number, lang: Language = "my") => ({
  inline_keyboard: [
    ...(balanceTon > 0 ? [[{ text: `💎 TON (${balanceTon.toFixed(2)})`, callback_data: "wc:TON" }]] : []),
    ...(balanceMmk > 0 ? [[{ text: `💵 MMK (${balanceMmk.toLocaleString()})`, callback_data: "wc:MMK" }]] : []),
    [{ text: t(lang, "menu.home"), callback_data: "m:home" }],
  ],
});

// TON withdraw amounts
const withdrawAmountsTON = (balance: number, lang: Language = "my") => {
  const amounts = [1, 5, 10, 25, 50].filter((a) => a <= balance);
  const buttons = amounts.map((a) => ({ text: `${a} TON`, callback_data: `wt:${a}` }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3));
  if (balance > 0)
    rows.push([{ text: `${t(lang, "withdraw.all")} (${balance.toFixed(2)} TON)`, callback_data: `wt:${balance}` }]);
  rows.push([{ text: t(lang, "withdraw.custom"), callback_data: "wt:custom" }]);
  rows.push([{ text: t(lang, "menu.back"), callback_data: "m:wd" }]);
  return { inline_keyboard: rows };
};

// MMK withdraw amounts
const withdrawAmountsMMK = (balance: number, lang: Language = "my") => {
  const amounts = [5000, 10000, 20000, 50000, 100000].filter((a) => a <= balance);
  const buttons = amounts.map((a) => ({ text: `${a.toLocaleString()} MMK`, callback_data: `wm:${a}` }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  if (balance > 0)
    rows.push([
      { text: `${t(lang, "withdraw.all")} (${balance.toLocaleString()} MMK)`, callback_data: `wm:${balance}` },
    ]);
  rows.push([{ text: t(lang, "withdraw.custom"), callback_data: "wm:custom" }]);
  rows.push([{ text: t(lang, "menu.back"), callback_data: "m:wd" }]);
  return { inline_keyboard: rows };
};

// MMK withdraw method selection
const withdrawMethodMMK = (lang: Language = "my") => ({
  inline_keyboard: [
    [{ text: "📱 KBZPay", callback_data: "wmm:KBZPAY" }],
    [{ text: "📲 WavePay", callback_data: "wmm:WAVEPAY" }],
    [{ text: t(lang, "menu.back"), callback_data: "wc:MMK" }],
  ],
});

// Language selection
const languageBtn = (currentLang: Language = "my") => ({
  inline_keyboard: [
    [{ text: `🇲🇲 မြန်မာ ${currentLang === "my" ? "✓" : ""}`, callback_data: "lang:my" }],
    [{ text: `🇺🇸 English ${currentLang === "en" ? "✓" : ""}`, callback_data: "lang:en" }],
    [{ text: t(currentLang, "menu.home"), callback_data: "m:home" }],
  ],
});

// Legacy TON-only amounts (keep for compatibility)
const withdrawAmounts = (balance: number, lang: Language = "my") => withdrawAmountsTON(balance, lang);

const sellerBtns = (txId: string, buyerUsername?: string) => ({
  inline_keyboard: [
    [
      { text: "📦 ပို့ပြီး", callback_data: `a:sent:${txId}` },
      { text: "❌ ပယ်ဖျက်", callback_data: `a:cancel:${txId}` },
    ],
    ...(buyerUsername ? [[{ text: "💬 ဝယ်သူနဲ့ Chat", url: `https://t.me/${buyerUsername}` }]] : []),
  ],
});

const buyerBtns = (txId: string, sellerUsername?: string) => ({
  inline_keyboard: [
    [
      { text: "✅ ရရှိပြီး", callback_data: `a:recv:${txId}` },
      { text: "⚠️ အငြင်းပွား", callback_data: `a:disp:${txId}` },
    ],
    ...(sellerUsername ? [[{ text: "💬 ရောင်းသူနဲ့ Chat", url: `https://t.me/${sellerUsername}` }]] : []),
  ],
});

const confirmBtns = (txId: string) => ({
  inline_keyboard: [
    [
      { text: "✅ အတည်ပြု", callback_data: `a:cfm:${txId}` },
      { text: "❌ မလုပ်တော့", callback_data: "m:ord" },
    ],
  ],
});

// Buy buttons with balance option
const buyBtns = (txId: string, hasBalance: boolean) => ({
  inline_keyboard: hasBalance
    ? [
        [{ text: "💰 Balance ဖြင့်ဝယ်မည်", callback_data: `buy:bal:${txId}` }],
        [{ text: "🏠 ပင်မစာမျက်နှာ", callback_data: "m:home" }],
      ]
    : [
        [{ text: t(lang, "deposit.kbzpay"), callback_data: "dpm:KBZPAY" }],
        [{ text: t(lang, "deposit.wavepay"), callback_data: "dpm:WAVEPAY" }],
        [{ text: "🏠 ပင်မစာမျက်နှာ", callback_data: "m:home" }],
      ],
});

// Rating buttons (1-5 stars)
// IMPORTANT: Telegram callback_data has a 64-byte limit.
// Use short callback format: r:<rating>:<txKey>:<role>
// - txKey: transaction.unique_link (preferred) or tx id
// - role: 's' (rate seller) | 'b' (rate buyer)
const ratingBtns = (txKey: string, role: "s" | "b") => ({
  inline_keyboard: [
    [
      { text: "⭐", callback_data: `r:1:${txKey}:${role}` },
      { text: "⭐⭐", callback_data: `r:2:${txKey}:${role}` },
      { text: "⭐⭐⭐", callback_data: `r:3:${txKey}:${role}` },
    ],
    [
      { text: "⭐⭐⭐⭐", callback_data: `r:4:${txKey}:${role}` },
      { text: "⭐⭐⭐⭐⭐", callback_data: `r:5:${txKey}:${role}` },
    ],
    [{ text: "⏭️ ကျော်မည်", callback_data: "m:home" }],
  ],
});

// Delete confirmation buttons
const deleteConfirmBtns = (msgId: number) => ({
  inline_keyboard: [
    [
      { text: "✅ ဖျက်မည်", callback_data: `del:yes:${msgId}` },
      { text: "❌ မဖျက်ပါ", callback_data: `del:no:${msgId}` },
    ],
  ],
});

// ==================== DATABASE ====================
// Generate unique referral code (6 chars alphanumeric)
function generateReferralCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Avoid confusing chars like 0/O, 1/I
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function getProfile(telegramId: number, username?: string, referrerCode?: string) {
  const { data: profile } = await supabase.from("profiles").select("*").eq("telegram_id", telegramId).single();

  if (profile) {
    // Update username if changed
    if (username && profile.telegram_username !== username) {
      await supabase.from("profiles").update({ telegram_username: username }).eq("id", profile.id);
    }
    // Generate referral code if missing
    if (!profile.referral_code) {
      const refCode = generateReferralCode();
      await supabase.from("profiles").update({ referral_code: refCode }).eq("id", profile.id);
      profile.referral_code = refCode;
    }
    return profile;
  }

  // Create new profile with referral code
  const refCode = generateReferralCode();
  const { data: newProfile, error } = await supabase
    .from("profiles")
    .insert({
      telegram_id: telegramId,
      telegram_username: username || null,
      balance: 0,
      referral_code: refCode,
    })
    .select()
    .single();

  if (error) throw error;

  // If referrer code provided, create referral relationships
  if (referrerCode && newProfile) {
    await processReferral(newProfile.id, referrerCode);
  }

  return newProfile;
}

// Process referral when new user joins via referral link
async function processReferral(newUserId: string, referrerCode: string) {
  try {
    // Find referrer by code
    const { data: referrer } = await supabase
      .from("profiles")
      .select("id, telegram_id, telegram_username, referred_by")
      .eq("referral_code", referrerCode)
      .single();

    if (!referrer || referrer.id === newUserId) return;

    // Update new user's referred_by
    await supabase.from("profiles").update({ referred_by: referrer.id }).eq("id", newUserId);

    // Create Level 1 referral relationship
    await supabase.from("referrals").insert({
      referrer_id: referrer.id,
      referred_id: newUserId,
      level: 1,
    });

    // If referrer was also referred, create Level 2 relationship
    if (referrer.referred_by) {
      await supabase.from("referrals").insert({
        referrer_id: referrer.referred_by,
        referred_id: newUserId,
        level: 2,
      });
    }

    // Notify referrer about new referral
    if (referrer.telegram_id) {
      await sendMessage(
        referrer.telegram_id,
        `🎉 *Referral အသစ် ရရှိပြီး!*

━━━━━━━━━━━━━━━
👤 သင်၏ Referral Link မှတဆင့် 
   အသုံးပြုသူ အသစ် စာရင်းသွင်းပြီး!
━━━━━━━━━━━━━━━

💰 သူတို့၏ transaction များမှ 
   commission ရရှိပါမည်!

📊 *Commission Rates:*
• Level 1: 10%
• Level 2: 5%`,
      );
    }

    console.log(`Referral created: ${referrer.id} -> ${newUserId}`);
  } catch (e) {
    console.error("Process referral error:", e);
  }
}

// Process referral earnings when a transaction is completed
async function processReferralEarnings(transactionId: string, commissionTon: number, buyerId: string | null) {
  if (!buyerId || !commissionTon || commissionTon <= 0) return;

  try {
    // Get referral rates from settings
    const { data: l1Setting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "referral_l1_rate")
      .maybeSingle();
    const { data: l2Setting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "referral_l2_rate")
      .maybeSingle();

    const l1Rate = l1Setting ? parseFloat(l1Setting.value) : 10; // 10% default
    const l2Rate = l2Setting ? parseFloat(l2Setting.value) : 5; // 5% default

    // Get buyer's referrers (both L1 and L2)
    const { data: referrals } = await supabase
      .from("referrals")
      .select("referrer_id, level")
      .eq("referred_id", buyerId);

    if (!referrals || referrals.length === 0) {
      console.log(`No referrers found for buyer ${buyerId}`);
      return;
    }

    const commission = Number(commissionTon);

    for (const ref of referrals) {
      const rate = ref.level === 1 ? l1Rate : l2Rate;
      const earnings = Math.round(((commission * rate) / 100) * 10000) / 10000;

      if (earnings <= 0) continue;

      // Record referral earning
      await supabase.from("referral_earnings").insert({
        referrer_id: ref.referrer_id,
        from_profile_id: buyerId,
        from_transaction_id: transactionId,
        amount_ton: earnings,
        level: ref.level,
      });

      // Credit referrer's balance
      const { data: referrer } = await supabase
        .from("profiles")
        .select("id, balance, total_referral_earnings, telegram_id")
        .eq("id", ref.referrer_id)
        .single();

      if (referrer) {
        const newBalance = Number(referrer.balance) + earnings;
        const newTotalEarnings = Number(referrer.total_referral_earnings || 0) + earnings;

        await supabase
          .from("profiles")
          .update({
            balance: newBalance,
            total_referral_earnings: newTotalEarnings,
          })
          .eq("id", referrer.id);

        // Notify referrer
        if (referrer.telegram_id) {
          await sendMessage(
            referrer.telegram_id,
            `🎁 *Referral Commission ရရှိပြီး!*

━━━━━━━━━━━━━━━━━━━━━━━━━
💰 *+${earnings.toFixed(4)} TON*
📊 Level ${ref.level} (${rate}%)
━━━━━━━━━━━━━━━━━━━━━━━━━

💳 လက်ကျန်: *${newBalance.toFixed(4)} TON*
🎁 စုစုပေါင်း Referral: *${newTotalEarnings.toFixed(4)} TON*

✅ သင်၏ Referral မှ transaction ပြီးစီးသောကြောင့်
   commission ရရှိပါသည်!`,
          );
        }

        console.log(`Referral earning credited: ${earnings} TON to ${referrer.id} (L${ref.level})`);
      }
    }
  } catch (e) {
    console.error("Process referral earnings error:", e);
  }
}

// Check if user is blocked
async function isUserBlocked(telegramId: number): Promise<{ blocked: boolean; reason?: string }> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_blocked, blocked_reason")
    .eq("telegram_id", telegramId)
    .single();

  if (profile?.is_blocked) {
    return { blocked: true, reason: profile.blocked_reason || undefined };
  }
  return { blocked: false };
}

const BLOCKED_MESSAGE = `🚫 *သင့်အကောင့် ပိတ်ထားပါသည်*

━━━━━━━━━━━━━━━
သင့်အကောင့်ကို Admin မှ ပိတ်ထားပါသည်။
အကူအညီလိုပါက Admin ထံ ဆက်သွယ်ပါ။
━━━━━━━━━━━━━━━`;

// Check if bot is in maintenance mode
async function isMaintenanceMode(): Promise<{ enabled: boolean; message: string }> {
  try {
    const { data: maintSetting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "bot_maintenance")
      .maybeSingle();

    if (maintSetting?.value === "true") {
      const { data: msgSetting } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "maintenance_message")
        .maybeSingle();

      return {
        enabled: true,
        message: msgSetting?.value || "🔧 Bot ပြုပြင်နေဆဲ ဖြစ်ပါသည်။ ခဏစောင့်ပါ။",
      };
    }
    return { enabled: false, message: "" };
  } catch (e) {
    console.error("Error checking maintenance mode:", e);
    return { enabled: false, message: "" };
  }
}

const genLink = () => crypto.randomUUID().replace(/-/g, "").substring(0, 12);

const statusText: Record<string, string> = {
  pending_payment: "⏳ ငွေပေးချေရန်",
  payment_received: "💰 ငွေရရှိပြီး",
  item_sent: "📦 ပစ္စည်းပို့ပြီး",
  completed: "✅ ပြီးဆုံး",
  cancelled: "❌ ပယ်ဖျက်",
  disputed: "⚠️ အငြင်းပွား",
};

// ==================== USER STATE (DATABASE-BACKED) ====================
interface UserState {
  action: string;
  msgId?: number;
  data?: Record<string, unknown>;
}

async function getUserState(telegramId: number): Promise<UserState | null> {
  const { data } = await supabase
    .from("user_states")
    .select("action, msg_id, data")
    .eq("telegram_id", telegramId)
    .single();

  if (!data) return null;
  return {
    action: data.action,
    msgId: data.msg_id || undefined,
    data: (data.data as Record<string, unknown>) || undefined,
  };
}

async function setUserState(telegramId: number, state: UserState): Promise<void> {
  await supabase.from("user_states").upsert(
    {
      telegram_id: telegramId,
      action: state.action,
      msg_id: state.msgId || null,
      data: state.data || {},
    },
    { onConflict: "telegram_id" },
  );
}

async function deleteUserState(telegramId: number): Promise<void> {
  await supabase.from("user_states").delete().eq("telegram_id", telegramId);
}

// ==================== MENU HANDLERS ====================
async function showHome(chatId: number, msgId?: number, username?: string) {
  const profile = await getProfile(chatId, username);
  const lang = (profile.language || "my") as Language;
  const balanceTon = Number(profile.balance);
  const balanceMmk = Number(profile.balance_mmk || 0);

  const text = `${t(lang, "welcome.title")}

╔══════════════════════════════╗
║                              ║
║   🔐 *ESCROW BOT*            ║
║   _Safe & Secure Trading_    ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
💎 *TON:* ${balanceTon.toFixed(2)}
💵 *MMK:* ${balanceMmk.toLocaleString()}
━━━━━━━━━━━━━━━━━━━━━━━━━

${t(lang, "welcome.tagline")}

✨ *${lang === "en" ? "Features" : "အထူးအချက်များ"}:*
• 💰 ${lang === "en" ? "Deposit - Auto Credit" : "ငွေသွင်း - Auto Credit"}
• 💸 ${lang === "en" ? "Withdraw - Instant Send" : "ငွေထုတ် - Instant Send"}
• 🛡️ Escrow - 100% Safe
• ⭐ Rating System`;

  await deleteUserState(chatId);

  if (msgId) {
    const edited = await editText(chatId, msgId, text, mainMenu(lang));
    if (!edited) {
      await deleteMsg(chatId, msgId);
      await sendMessage(chatId, text, mainMenu(lang));
    }
  } else {
    await sendMessage(chatId, text, mainMenu(lang));
  }
}

// Helper functions removed - now using only inline keyboards

async function showHelp(chatId: number, msgId: number) {
  const text = `📖 *အကူအညီ*

╔══════════════════════════════╗
║                              ║
║     📖 *HOW TO USE*          ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━

🏪 *ရောင်းသူအတွက်:*
━━━━━━━━━━━━━━━━━━━━━━━━━
1️⃣ "📦 Order ပြုလုပ်မည်" ခလုပ်နှိပ်ပါ
2️⃣ ပစ္စည်းအမည်နှင့် ဈေးနှုန်း ထည့်ပါ
3️⃣ Link ရရှိပြီး ဝယ်သူထံ ပေးပို့ပါ
4️⃣ ဝယ်သူမှ ငွေပေးချေပြီးပါက အကြောင်းကြားမည်
5️⃣ ပစ္စည်းပို့ပြီး "ပို့ပြီး" ခလုပ်နှိပ်ပါ
6️⃣ ဝယ်သူ အတည်ပြုပြီးပါက ငွေရရှိမည်

━━━━━━━━━━━━━━━━━━━━━━━━━

🛒 *ဝယ်သူအတွက်:*
━━━━━━━━━━━━━━━━━━━━━━━━━
1️⃣ ရောင်းသူထံမှ Link ရယူပါ
2️⃣ Link နှိပ်ပြီး QR Scan သို့မဟုတ် Address သို့ ငွေလွှဲပါ
3️⃣ ငွေပေးချေမှု အလိုအလျောက် စစ်ဆေးမည်
4️⃣ ရောင်းသူမှ ပစ္စည်းပို့ပေးမည်
5️⃣ ပစ္စည်းရရှိပါက "ရရှိပြီး" ခလုပ်နှိပ်ပါ

━━━━━━━━━━━━━━━━━━━━━━━━━

💰 *ငွေသွင်း:*
• "💰 ငွေသွင်း" > ပမာဏရွေး > QR Scan
• ငွေလွှဲပြီး Auto Credit ရရှိမည်

💸 *ငွေထုတ်:*
• "💸 ငွေထုတ်" > ပမာဏရွေး > Wallet ထည့်
• Auto/Manual mode ဖြင့် ငွေရရှိမည်

━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ *အရေးကြီး သတိပေးချက်:*
• ပစ္စည်းမရရှိမီ "ရရှိပြီး" မနှိပ်ပါနှင့်
• Wallet လိပ်စာ မှန်ကန်ရန် စစ်ဆေးပါ
• ပြဿနာရှိပါက "Dispute" ဖွင့်ပါ`;

  const edited = await editText(chatId, msgId, text, backBtn());
  if (!edited) {
    await deleteMsg(chatId, msgId);
    await sendMessage(chatId, text, backBtn());
  }
}

// ==================== REFERRAL MENU ====================
async function showReferral(chatId: number, msgId: number, username?: string) {
  const profile = await getProfile(chatId, username);

  // Get bot username directly from Telegram API (most accurate)
  let botUsername = "YourBot";
  try {
    const getMeRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`);
    const getMeData = await getMeRes.json();
    console.log("[DEBUG] getMe API response:", getMeData);
    if (getMeData.ok && getMeData.result?.username) {
      botUsername = getMeData.result.username;
      console.log("[INFO] Bot username from API:", botUsername);
    } else {
      console.warn("[WARN] getMe API failed or no username:", getMeData);
    }
  } catch (e) {
    console.error("Failed to get bot username:", e);
    // Fallback to settings if API fails
    const { data: botSetting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "bot_username")
      .maybeSingle();
    botUsername = botSetting?.value || "YourBot";
    console.log("[INFO] Using fallback bot username:", botUsername);
  }

  // Get referral stats
  const { count: l1Count } = await supabase
    .from("referrals")
    .select("*", { count: "exact", head: true })
    .eq("referrer_id", profile.id)
    .eq("level", 1);

  const { count: l2Count } = await supabase
    .from("referrals")
    .select("*", { count: "exact", head: true })
    .eq("referrer_id", profile.id)
    .eq("level", 2);

  const totalEarnings = Number(profile.total_referral_earnings) || 0;

  // Get referral rates from settings (same as admin panel)
  const { data: l1Setting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "referral_l1_rate")
    .maybeSingle();
  const { data: l2Setting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "referral_l2_rate")
    .maybeSingle();
  const l1Rate = l1Setting ? parseFloat(l1Setting.value) : 5;
  const l2Rate = l2Setting ? parseFloat(l2Setting.value) : 3;

  const refLink = `https://t.me/${botUsername}?start=ref_${profile.referral_code}`;

  const text = `🎁 *Referral Program*

╔══════════════════════════════╗
║                              ║
║     🎁 *EARN COMMISSION*     ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
🔗 *သင်၏ Referral Link:*
\`${refLink}\`
━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *Commission Rates:*
• Level 1: *${l1Rate}%* (တိုက်ရိုက် refer)
• Level 2: *${l2Rate}%* (သင် refer လူ၏ referral)

━━━━━━━━━━━━━━━━━━━━━━━━━
👥 *သင်၏ Referrals:*
• Level 1: *${l1Count || 0}* ယောက်
• Level 2: *${l2Count || 0}* ယောက်

💰 *စုစုပေါင်း ရရှိငွေ:*
*${totalEarnings.toFixed(4)} TON*
━━━━━━━━━━━━━━━━━━━━━━━━━

📢 *သင်၏ Referral Link ကို 
   မိတ်ဆွေများထံ မျှဝေပါ!*

💡 သူတို့ transaction လုပ်တိုင်း
   သင် commission ရရှိမည်!`;

  const edited = await editText(chatId, msgId, text, backBtn());
  if (!edited) {
    await deleteMsg(chatId, msgId);
    await sendMessage(chatId, text, backBtn());
  }
}

async function showBalance(chatId: number, msgId: number, username?: string) {
  const profile = await getProfile(chatId, username);
  const lang = (profile.language || "my") as Language;
  const balanceTon = Number(profile.balance);
  const balanceMmk = Number(profile.balance_mmk || 0);

  const text = `${t(lang, "balance.title")}

╔══════════════════════════════╗
║                              ║
║     💰 *YOUR BALANCE*        ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
💎 *TON:* ${balanceTon.toFixed(4)}
💵 *MMK:* ${balanceMmk.toLocaleString()} Ks
━━━━━━━━━━━━━━━━━━━━━━━━━

📥 *${lang === "en" ? "Deposit" : "ငွေသွင်း"}:*
• TON - Auto Credit (QR Scan)
• KBZPay/WavePay - Manual (Admin စစ်ဆေး)

📤 *${lang === "en" ? "Withdraw" : "ငွေထုတ်"}:*
• TON - Wallet သို့ Auto Send
• MMK - KBZPay/WavePay သို့ Manual

💡 *${lang === "en" ? "Note" : "မှတ်ချက်"}:* ${lang === "en" ? "Commission applies to withdrawals" : "ငွေထုတ်ယူသောအခါ Commission ဖြတ်ပါမည်"}`;

  const edited = await editText(chatId, msgId, text, backBtn(lang));
  if (!edited) {
    await deleteMsg(chatId, msgId);
    await sendMessage(chatId, text, backBtn(lang));
  }
}

// Currency selection for sell flow
const sellCurrencyBtn = (lang: Language = "my") => ({
  inline_keyboard: [
    [
      { text: "💎 TON", callback_data: "sc:TON" },
      { text: "💵 MMK", callback_data: "sc:MMK" },
    ],
    [{ text: t(lang, "menu.home"), callback_data: "m:home" }],
  ],
});

async function showSellPrompt(chatId: number, msgId: number, username?: string) {
  const profile = await getProfile(chatId, username);
  const lang = (profile.language || "my") as Language;

  await setUserState(chatId, { action: "sell_currency", msgId });
  const text = `📦 *${lang === "en" ? "Create Order" : "ပစ္စည်းရောင်း/ဝယ်ရန်"}*

╔══════════════════════════════╗
║                              ║
║   💰 *SELECT CURRENCY*       ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
${lang === "en" ? "Select payment currency:" : "ငွေကြေးအမျိုးအစား ရွေးပါ:"}
━━━━━━━━━━━━━━━━━━━━━━━━━

💎 *TON* - Crypto ဖြင့် ရောင်း/ဝယ်
💵 *MMK* - ကျပ်ငွေ ဖြင့် ရောင်း/ဝယ်`;

  const edited = await editText(chatId, msgId, text, sellCurrencyBtn(lang));
  if (!edited) {
    await deleteMsg(chatId, msgId);
    const newMsg = await sendMessage(chatId, text, sellCurrencyBtn(lang));
    if (newMsg) await setUserState(chatId, { action: "sell_currency", msgId: newMsg });
  }
}

// Show sell title prompt after currency selection
async function showSellTitlePrompt(chatId: number, msgId: number, currency: string, username?: string) {
  const profile = await getProfile(chatId, username);
  const lang = (profile.language || "my") as Language;
  const currencyIcon = currency === "TON" ? "💎" : "💵";

  await setUserState(chatId, { action: "sell_title", msgId, data: { currency } });
  const text = `📦 *${lang === "en" ? "Create Order" : "ပစ္စည်းရောင်း/ဝယ်ရန်"}*

━━━━━━━━━━━━━━━
${currencyIcon} *Currency:* ${currency}
━━━━━━━━━━━━━━━

📝 *${lang === "en" ? "Step 1/2" : "အဆင့် ၁/၂"}*
${lang === "en" ? "Enter product name:" : "မိမိရောင်းဝယ်လိုသည့် ပစ္စည်းအမျိုးအမည် ရေးပို့ပါ:"}

${lang === "en" ? "Example" : "ဥပမာ"}: \`iPhone 15 Pro Max\``;

  const edited = await editText(chatId, msgId, text, cancelBtn(lang));
  if (!edited) {
    await deleteMsg(chatId, msgId);
    const newMsg = await sendMessage(chatId, text, cancelBtn(lang));
    if (newMsg) await setUserState(chatId, { action: "sell_title", msgId: newMsg, data: { currency } });
  }
}

async function showDepositOptions(chatId: number, msgId: number, username?: string) {
  const profile = await getProfile(chatId, username);
  const lang = (profile.language || "my") as Language;

  await setUserState(chatId, { action: "dep_method_select", msgId });
  const text = `${t(lang, "deposit.title")}

╔══════════════════════════════╗
║                              ║
║     💰 *DEPOSIT*             ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
${t(lang, "deposit.select_method")}
━━━━━━━━━━━━━━━━━━━━━━━━━

💎 *TON* - Auto Credit (Blockchain)
📱 *KBZPay/WavePay* - Manual (Admin စစ်ဆေးပေးမည်)`;

  const edited = await editText(chatId, msgId, text, depositMethodBtn(lang));
  if (!edited) {
    await deleteMsg(chatId, msgId);
    const newMsg = await sendMessage(chatId, text, depositMethodBtn(lang));
    if (newMsg) await setUserState(chatId, { action: "dep_method_select", msgId: newMsg });
  }
}

// Show TON deposit amount selection
async function showDepositTONAmounts(chatId: number, msgId: number, username?: string) {
  const profile = await getProfile(chatId, username);
  const lang = (profile.language || "my") as Language;

  await setUserState(chatId, { action: "dep_ton_amount", msgId, data: { currency: "TON" } });
  const text = `💎 *TON ငွေသွင်းရန်*

━━━━━━━━━━━━━━━
${t(lang, "deposit.select_amount")}
━━━━━━━━━━━━━━━

✨ QR Scan ပြီး ငွေပေးပို့ပါ
💫 ${t(lang, "deposit.auto_credit")}`;

  const edited = await editText(chatId, msgId, text, depositAmountsTON(lang));
  if (!edited) {
    await deleteMsg(chatId, msgId);
    const newMsg = await sendMessage(chatId, text, depositAmountsTON(lang));
    if (newMsg) await setUserState(chatId, { action: "dep_ton_amount", msgId: newMsg, data: { currency: "TON" } });
  }
}

// Show MMK deposit amount selection
async function showDepositMMKAmounts(chatId: number, msgId: number, paymentMethod: string, username?: string) {
  const profile = await getProfile(chatId, username);
  const lang = (profile.language || "my") as Language;

  const methodName = paymentMethod === "KBZPAY" ? "KBZPay" : "WavePay";
  const methodIcon = paymentMethod === "KBZPAY" ? "📱" : "📲";

  await setUserState(chatId, { action: "dep_mmk_amount", msgId, data: { currency: "MMK", paymentMethod } });
  const text = `${methodIcon} *${methodName} ငွေသွင်းရန်*

━━━━━━━━━━━━━━━
${t(lang, "deposit.select_amount")}
━━━━━━━━━━━━━━━

📱 ${t(lang, "deposit.mmk_step1")}
📸 ${t(lang, "deposit.mmk_step2")}
⏳ ${t(lang, "deposit.mmk_pending")}`;

  const edited = await editText(chatId, msgId, text, depositAmountsMMK(lang));
  if (!edited) {
    await deleteMsg(chatId, msgId);
    const newMsg = await sendMessage(chatId, text, depositAmountsMMK(lang));
    if (newMsg)
      await setUserState(chatId, { action: "dep_mmk_amount", msgId: newMsg, data: { currency: "MMK", paymentMethod } });
  }
}

async function showDepositQR(chatId: number, msgId: number, amount: number, username?: string) {
  const adminWallet = await getAdminWallet();
  if (!adminWallet) {
    await editText(chatId, msgId, "❌ Wallet မသတ်မှတ်ရသေးပါ", backBtn());
    return;
  }

  const profile = await getProfile(chatId, username);

  // Generate unique deposit code (6 chars)
  const uniqueCode = crypto.randomUUID().replace(/-/g, "").substring(0, 6).toUpperCase();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes expiry

  // Create unique deposit address format: dep_<unique_code>
  const comment = `dep_${uniqueCode}`;
  const qr = generateQR(adminWallet, amount, comment);

  await deleteMsg(chatId, msgId);

  // Enhanced QR display with better visual formatting
  const qrMsgId = await sendPhoto(
    chatId,
    qr,
    `💰 *ငွေသွင်း - ${amount} TON*

━━━━━━━━━━━━━━━
📱 QR Scan သို့မဟုတ် အောက်တွင်ပါရှိသော Address သို့ ငွေလွဲပါ။

💳 \`${adminWallet}\`

💵 *ပမာဏ:* ${amount} TON

🔐 *Comment တွင် Memo စာသား ကူးထည့်ပေးပါ:*
\`${comment}\`

━━━━━━━━━━━━━━━
🔑 ID: \`${uniqueCode}\`
⚠️ *Memo မပါရင် ငွေထည့်မရပါ!*
💫 ငွေလွဲပြီး Transaction Confirm ဖြစ်သည်နှင့် အလိုအလျောက် Balance ထဲသို့ ထည့်သွင်းပေးပါမည်။
⏰ သက်တမ်း: *၃၀ မိနစ်အတွင်း* ငွေပို့ပါ
━━━━━━━━━━━━━━━`,
    backBtn(),
  );

  // Save pending deposit with unique code, expiry, and message ID for live updates
  await supabase.from("deposits").insert({
    profile_id: profile.id,
    amount_ton: amount,
    is_confirmed: false,
    unique_code: uniqueCode,
    expires_at: expiresAt.toISOString(),
    status: "pending",
    telegram_msg_id: qrMsgId,
  });

  await deleteUserState(chatId);
}

async function showWithdrawOptions(chatId: number, msgId: number, username?: string) {
  const profile = await getProfile(chatId, username);
  const lang = (profile.language || "my") as Language;
  const balanceTon = Number(profile.balance);
  const balanceMmk = Number(profile.balance_mmk || 0);

  if (balanceTon <= 0 && balanceMmk <= 0) {
    const noBalanceText = `❌ *${lang === "en" ? "No balance available" : "လက်ကျန်ငွေ မရှိပါ"}*

${lang === "en" ? "Please deposit first" : 'ငွေသွင်းရန် "ငွေသွင်း" ကို နှိပ်ပါ'}`;
    const edited = await editText(chatId, msgId, noBalanceText, backBtn(lang));
    if (!edited) {
      await deleteMsg(chatId, msgId);
      await sendMessage(chatId, noBalanceText, backBtn(lang));
    }
    return;
  }

  await setUserState(chatId, { action: "wd_currency_select", msgId, data: { balanceTon, balanceMmk } });
  const text = `${t(lang, "withdraw.title")}

╔══════════════════════════════╗
║                              ║
║     💸 *WITHDRAW*            ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
💎 *TON:* ${balanceTon.toFixed(2)}
💵 *MMK:* ${balanceMmk.toLocaleString()} Ks
━━━━━━━━━━━━━━━━━━━━━━━━━

${t(lang, "withdraw.select_currency")}`;

  const edited = await editText(chatId, msgId, text, withdrawCurrencyBtn(balanceTon, balanceMmk, lang));
  if (!edited) {
    await deleteMsg(chatId, msgId);
    const newMsg = await sendMessage(chatId, text, withdrawCurrencyBtn(balanceTon, balanceMmk, lang));
    if (newMsg)
      await setUserState(chatId, { action: "wd_currency_select", msgId: newMsg, data: { balanceTon, balanceMmk } });
  }
}

// Show TON withdrawal amounts
async function showWithdrawTONAmounts(chatId: number, msgId: number, username?: string) {
  const profile = await getProfile(chatId, username);
  const lang = (profile.language || "my") as Language;
  const balance = Number(profile.balance);

  const { data: commSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "commission_rate")
    .maybeSingle();
  const commRate = commSetting ? parseFloat(commSetting.value) : 5;

  await setUserState(chatId, { action: "wt_amount", msgId, data: { balance, commRate, currency: "TON" } });
  const text = `💎 *TON ${lang === "en" ? "Withdrawal" : "ငွေထုတ်ရန်"}*

━━━━━━━━━━━━━━━━━━━━━━━━━
💳 *${lang === "en" ? "Balance" : "လက်ကျန်"}:* ${balance.toFixed(4)} TON
💰 *Commission:* ${commRate}%
━━━━━━━━━━━━━━━━━━━━━━━━━

${t(lang, "withdraw.select_amount")}`;

  const edited = await editText(chatId, msgId, text, withdrawAmountsTON(balance, lang));
  if (!edited) {
    await deleteMsg(chatId, msgId);
    const newMsg = await sendMessage(chatId, text, withdrawAmountsTON(balance, lang));
    if (newMsg)
      await setUserState(chatId, { action: "wt_amount", msgId: newMsg, data: { balance, commRate, currency: "TON" } });
  }
}

// Show MMK withdrawal amounts
async function showWithdrawMMKAmounts(chatId: number, msgId: number, username?: string) {
  const profile = await getProfile(chatId, username);
  const lang = (profile.language || "my") as Language;
  const balance = Number(profile.balance_mmk || 0);

  const { data: commSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "commission_rate")
    .maybeSingle();
  const commRate = commSetting ? parseFloat(commSetting.value) : 5;

  await setUserState(chatId, { action: "wm_amount", msgId, data: { balance, commRate, currency: "MMK" } });
  const text = `💵 *MMK ${lang === "en" ? "Withdrawal" : "ငွေထုတ်ရန်"}*

━━━━━━━━━━━━━━━━━━━━━━━━━
💳 *${lang === "en" ? "Balance" : "လက်ကျန်"}:* ${balance.toLocaleString()} MMK
💰 *Commission:* ${commRate}%
━━━━━━━━━━━━━━━━━━━━━━━━━

${t(lang, "withdraw.select_amount")}`;

  const edited = await editText(chatId, msgId, text, withdrawAmountsMMK(balance, lang));
  if (!edited) {
    await deleteMsg(chatId, msgId);
    const newMsg = await sendMessage(chatId, text, withdrawAmountsMMK(balance, lang));
    if (newMsg)
      await setUserState(chatId, { action: "wm_amount", msgId: newMsg, data: { balance, commRate, currency: "MMK" } });
  }
}

// Show MMK withdraw method selection
async function showWithdrawMMKMethod(chatId: number, msgId: number, amount: number, username?: string) {
  const profile = await getProfile(chatId, username);
  const lang = (profile.language || "my") as Language;

  const { data: commSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "commission_rate")
    .maybeSingle();
  const commRate = commSetting ? parseFloat(commSetting.value) : 5;
  const fee = Math.round((amount * commRate) / 100);
  const receiveAmount = amount - fee;

  await setUserState(chatId, { action: "wm_method", msgId, data: { amount, fee, receiveAmount, currency: "MMK" } });
  const text = `💵 *MMK ${lang === "en" ? "Withdrawal" : "ငွေထုတ်ရန်"}*

━━━━━━━━━━━━━━━━━━━━━━━━━
💵 *${lang === "en" ? "Amount" : "ထုတ်ယူမည်"}:* ${amount.toLocaleString()} MMK
📊 *Commission (${commRate}%):* -${fee.toLocaleString()} MMK
✅ *${lang === "en" ? "You receive" : "လက်ခံရရှိမည်"}:* ${receiveAmount.toLocaleString()} MMK
━━━━━━━━━━━━━━━━━━━━━━━━━

${t(lang, "withdraw.select_method")}`;

  const edited = await editText(chatId, msgId, text, withdrawMethodMMK(lang));
  if (!edited) {
    await deleteMsg(chatId, msgId);
    const newMsg = await sendMessage(chatId, text, withdrawMethodMMK(lang));
    if (newMsg)
      await setUserState(chatId, {
        action: "wm_method",
        msgId: newMsg,
        data: { amount, fee, receiveAmount, currency: "MMK" },
      });
  }
}

// Show language selection
async function showLanguageSelect(chatId: number, msgId: number, username?: string) {
  const profile = await getProfile(chatId, username);
  const currentLang = (profile.language || "my") as Language;

  const text = `${t(currentLang, "lang.title")}

╔══════════════════════════════╗
║                              ║
║     🌐 *LANGUAGE*            ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
${t(currentLang, "lang.current")} ${currentLang === "my" ? "🇲🇲 မြန်မာ" : "🇺🇸 English"}
━━━━━━━━━━━━━━━━━━━━━━━━━

${currentLang === "en" ? "Select your preferred language:" : "သင်နှစ်သက်ရာ ဘာသာစကား ရွေးပါ:"}`;

  const edited = await editText(chatId, msgId, text, languageBtn(currentLang));
  if (!edited) {
    await deleteMsg(chatId, msgId);
    await sendMessage(chatId, text, languageBtn(currentLang));
  }
}

// Show MMK deposit instructions (KBZPay/WavePay)
async function showDepositMMKInstructions(
  chatId: number,
  msgId: number,
  amount: number,
  paymentMethod: string,
  username?: string,
) {
  const profile = await getProfile(chatId, username);
  const lang = (profile.language || "my") as Language;

  // Get payment account info from settings
  const settingKey = paymentMethod === "KBZPAY" ? "kbzpay_account" : "wavepay_account";
  const { data: accountSetting } = await supabase.from("settings").select("value").eq("key", settingKey).maybeSingle();
  const accountInfo = accountSetting?.value || (lang === "en" ? "Not configured" : "မသတ်မှတ်ရသေးပါ");

  const methodName = paymentMethod === "KBZPAY" ? "KBZPay" : "WavePay";
  const methodIcon = paymentMethod === "KBZPAY" ? "📱" : "📲";

  // Generate unique deposit code
  const uniqueCode = crypto.randomUUID().replace(/-/g, "").substring(0, 6).toUpperCase();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiry for manual

  await deleteMsg(chatId, msgId);

  const text = `${methodIcon} *${methodName} ငွေသွင်း*

╔══════════════════════════════╗
║                              ║
║     💵 *DEPOSIT MMK*         ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
💵 *${lang === "en" ? "Amount" : "ပမာဏ"}:* ${amount.toLocaleString()} MMK
🔑 *Code:* \`${uniqueCode}\`
━━━━━━━━━━━━━━━━━━━━━━━━━

📱 *${lang === "en" ? "Transfer to" : "ငွေလွှဲရန်"}:*
\`${accountInfo}\`

━━━━━━━━━━━━━━━━━━━━━━━━━

📝 *${lang === "en" ? "Instructions" : "လုပ်ဆောင်ရန်"}:*
1️⃣ ${lang === "en" ? "Transfer to above account" : "အထက်ပါ Account သို့ ငွေလွှဲပါ"}
2️⃣ ${lang === "en" ? "Include code in note/memo" : "Note/Memo တွင် Code ထည့်ပါ"}
3️⃣ ${lang === "en" ? "Send screenshot here" : "Screenshot ကို ဤနေရာမှ ပို့ပါ"}

⏳ *${lang === "en" ? "Admin will verify and credit" : "Admin စစ်ဆေးပြီး Credit ပေးပါမည်"}*
⏰ *${lang === "en" ? "Expires in 1 hour" : "သက်တမ်း: ၁ နာရီ"}*
━━━━━━━━━━━━━━━━━━━━━━━━━

📸 *${lang === "en" ? "Send payment screenshot now" : "ငွေလွှဲပြီး Screenshot ပို့ပါ"}:*`;

  const newMsgId = await sendMessage(chatId, text, cancelBtn(lang));

  // Save pending MMK deposit
  await supabase.from("deposits").insert({
    profile_id: profile.id,
    amount_ton: amount, // Using amount_ton field but it's actually MMK
    currency: "MMK",
    payment_method: paymentMethod,
    is_confirmed: false,
    unique_code: uniqueCode,
    expires_at: expiresAt.toISOString(),
    status: "pending",
    telegram_msg_id: newMsgId,
  });

  // Set state to wait for screenshot
  await setUserState(chatId, {
    action: "dep_mmk_screenshot",
    msgId: newMsgId || undefined,
    data: { amount, paymentMethod, uniqueCode },
  });
}

// Handle MMK deposit screenshot upload
async function handleMMKDepositScreenshot(
  chatId: number,
  photos: Array<{ file_id: string; file_unique_id: string; width: number; height: number }>,
  stateData: { amount?: number; paymentMethod?: string; uniqueCode?: string },
  username?: string,
) {
  const profile = await getProfile(chatId, username);
  const lang = (profile.language || "my") as Language;

  // Get the largest photo (best quality)
  const largestPhoto = photos.reduce((prev, curr) =>
    curr.width * curr.height > prev.width * prev.height ? curr : prev,
  );

  try {
    // Get file path from Telegram
    const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: largestPhoto.file_id }),
    });
    const fileData = await fileRes.json();

    if (!fileData.ok || !fileData.result?.file_path) {
      await sendMessage(
        chatId,
        `❌ *${lang === "en" ? "Failed to process photo" : "ဓာတ်ပုံ process မရပါ"}*

${lang === "en" ? "Please try again" : "ထပ်မံကြိုးစားပါ"}`,
        cancelBtn(lang),
      );
      return;
    }

    // Download photo from Telegram
    const photoUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`;
    const photoResponse = await fetch(photoUrl);
    const photoBlob = await photoResponse.arrayBuffer();

    // Upload to Supabase Storage
    const fileName = `${stateData.uniqueCode}_${Date.now()}.jpg`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("deposit-screenshots")
      .upload(fileName, photoBlob, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (uploadError) {
      console.error("Screenshot upload error:", uploadError);
      await sendMessage(
        chatId,
        `❌ *${lang === "en" ? "Failed to upload screenshot" : "Screenshot တင်မရပါ"}*

${lang === "en" ? "Please try again" : "ထပ်မံကြိုးစားပါ"}`,
        cancelBtn(lang),
      );
      return;
    }

    // Get public URL
    const { data: urlData } = supabase.storage.from("deposit-screenshots").getPublicUrl(fileName);

    const screenshotUrl = urlData.publicUrl;

    // Update deposit with screenshot URL and get deposit ID
    const { data: depositRecord } = await supabase
      .from("deposits")
      .update({ screenshot_url: screenshotUrl })
      .eq("unique_code", stateData.uniqueCode)
      .eq("profile_id", profile.id)
      .select("id")
      .single();

    // Clear user state
    await deleteUserState(chatId);

    // Notify admin about new MMK deposit with inline approve/reject buttons
    if (depositRecord?.id) {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/notify-user`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            type: "admin_new_mmk_deposit",
            amount: stateData.amount,
            user_telegram_username: profile.telegram_username,
            unique_code: stateData.uniqueCode,
            payment_method: stateData.paymentMethod,
            currency: "MMK",
            deposit_id: depositRecord.id,
          }),
        });
        console.log("Admin notified about new MMK deposit");
      } catch (e) {
        console.error("Failed to notify admin about MMK deposit:", e);
      }
    }

    // Send success message
    const successText = `✅ *${lang === "en" ? "Screenshot Uploaded!" : "Screenshot တင်ပြီးပါပြီ!"}*

╔══════════════════════════════╗
║                              ║
║     📸 *SCREENSHOT SENT*     ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
💵 *${lang === "en" ? "Amount" : "ပမာဏ"}:* ${Number(stateData.amount).toLocaleString()} MMK
🔑 *Code:* \`${stateData.uniqueCode}\`
📱 *${lang === "en" ? "Payment" : "ငွေပေးချေမှု"}:* ${stateData.paymentMethod === "KBZPAY" ? "KBZPay" : "WavePay"}
━━━━━━━━━━━━━━━━━━━━━━━━━

⏳ *${lang === "en" ? "Admin will verify and credit your balance" : "Admin စစ်ဆေးပြီး Balance ထည့်ပေးပါမည်"}*

💡 *${lang === "en" ? "Note" : "မှတ်ချက်"}:* ${lang === "en" ? "You will receive a notification when approved" : "အတည်ပြုပြီးပါက အကြောင်းကြားပါမည်"}`;

    await sendMessage(chatId, successText, backBtn(lang));
  } catch (error) {
    console.error("Screenshot handling error:", error);
    await sendMessage(
      chatId,
      `❌ *${lang === "en" ? "Error processing screenshot" : "Screenshot process မရပါ"}*

${lang === "en" ? "Please try again" : "ထပ်မံကြိုးစားပါ"}`,
      cancelBtn(lang),
    );
  }
}

// Show MMK withdraw account name prompt (step 1)
async function showWithdrawMMKAccountNamePrompt(
  chatId: number,
  msgId: number,
  amount: number,
  paymentMethod: string,
  username?: string,
) {
  const profile = await getProfile(chatId, username);
  const lang = (profile.language || "my") as Language;

  const { data: commSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "commission_rate")
    .maybeSingle();
  const commRate = commSetting ? parseFloat(commSetting.value) : 5;
  const fee = Math.round((amount * commRate) / 100);
  const receiveAmount = amount - fee;

  const methodName = paymentMethod === "KBZPAY" ? "KBZPay" : "WavePay";
  const methodIcon = paymentMethod === "KBZPAY" ? "📱" : "📲";

  await setUserState(chatId, {
    action: "wm_account_name",
    msgId,
    data: { amount, fee, receiveAmount, currency: "MMK", paymentMethod },
  });

  const text = `${methodIcon} *${methodName} ${lang === "en" ? "Withdrawal" : "ငွေထုတ်ရန်"}*

╔══════════════════════════════╗
║                              ║
║   👤 *ENTER ACCOUNT NAME*    ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
💵 *${lang === "en" ? "Amount" : "ထုတ်ယူမည်"}:* ${amount.toLocaleString()} MMK
📊 *Commission (${commRate}%):* -${fee.toLocaleString()} MMK
✅ *${lang === "en" ? "You receive" : "လက်ခံရရှိမည်"}:* ${receiveAmount.toLocaleString()} MMK
━━━━━━━━━━━━━━━━━━━━━━━━━

📝 *${lang === "en" ? "Step 1/2: Enter account name" : "အဆင့် ၁/၂: အကောင့်နာမည် ထည့်ပါ"}:*

${lang === "en" ? "Example" : "ဥပမာ"}: \`Mg Mg\` ${lang === "en" ? "or" : "သို့"} \`မောင်မောင်\`

⚠️ *${lang === "en" ? "Enter the name registered on your account" : "အကောင့်တွင် မှတ်ပုံတင်ထားသော နာမည် ထည့်ပါ"}*`;

  const edited = await editText(chatId, msgId, text, cancelBtn(lang));
  if (!edited) {
    await deleteMsg(chatId, msgId);
    const newMsg = await sendMessage(chatId, text, cancelBtn(lang));
    if (newMsg)
      await setUserState(chatId, {
        action: "wm_account_name",
        msgId: newMsg,
        data: { amount, fee, receiveAmount, currency: "MMK", paymentMethod },
      });
  }
}

// Show MMK withdraw phone prompt (step 2)
async function showWithdrawMMKPhonePrompt(
  chatId: number,
  msgId: number,
  amount: number,
  paymentMethod: string,
  accountName: string,
  username?: string,
) {
  const profile = await getProfile(chatId, username);
  const lang = (profile.language || "my") as Language;

  const { data: commSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "commission_rate")
    .maybeSingle();
  const commRate = commSetting ? parseFloat(commSetting.value) : 5;
  const fee = Math.round((amount * commRate) / 100);
  const receiveAmount = amount - fee;

  const methodName = paymentMethod === "KBZPAY" ? "KBZPay" : "WavePay";
  const methodIcon = paymentMethod === "KBZPAY" ? "📱" : "📲";

  await setUserState(chatId, {
    action: "wm_phone",
    msgId,
    data: { amount, fee, receiveAmount, currency: "MMK", paymentMethod, accountName },
  });

  const text = `${methodIcon} *${methodName} ${lang === "en" ? "Withdrawal" : "ငွေထုတ်ရန်"}*

╔══════════════════════════════╗
║                              ║
║   📱 *ENTER PHONE*           ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
💵 *${lang === "en" ? "Amount" : "ထုတ်ယူမည်"}:* ${amount.toLocaleString()} MMK
📊 *Commission (${commRate}%):* -${fee.toLocaleString()} MMK
✅ *${lang === "en" ? "You receive" : "လက်ခံရရှိမည်"}:* ${receiveAmount.toLocaleString()} MMK
👤 *${lang === "en" ? "Account" : "အကောင့်"}:* ${accountName}
━━━━━━━━━━━━━━━━━━━━━━━━━

📱 *${lang === "en" ? "Step 2/2: Enter phone number" : "အဆင့် ၂/၂: ဖုန်းနံပါတ် ထည့်ပါ"}:*

${lang === "en" ? "Example" : "ဥပမာ"}: \`09xxxxxxxxx\`

⚠️ *${lang === "en" ? "Verify number is correct" : "ဖုန်းနံပါတ် မှန်ကန်ရန် စစ်ဆေးပါ"}*`;

  const edited = await editText(chatId, msgId, text, cancelBtn(lang));
  if (!edited) {
    await deleteMsg(chatId, msgId);
    const newMsg = await sendMessage(chatId, text, cancelBtn(lang));
    if (newMsg)
      await setUserState(chatId, {
        action: "wm_phone",
        msgId: newMsg,
        data: { amount, fee, receiveAmount, currency: "MMK", paymentMethod, accountName },
      });
  }
}

async function showWithdrawWalletPrompt(chatId: number, msgId: number, amount: number) {
  // Get commission rate
  const { data: commSetting } = await supabase.from("settings").select("value").eq("key", "commission_rate").single();
  const commRate = commSetting ? parseFloat(commSetting.value) : 5;

  // Use precise calculations with proper rounding
  const amountNum = Number(amount);
  const fee = Math.round(((amountNum * commRate) / 100) * 10000) / 10000; // Round to 4 decimals
  const receiveAmount = Math.round((amountNum - fee) * 10000) / 10000;

  console.log(`[WD] Amount: ${amountNum}, CommRate: ${commRate}%, Fee: ${fee}, Receive: ${receiveAmount}`);

  await setUserState(chatId, { action: "wd_wallet", msgId, data: { amount: amountNum, fee, receiveAmount, commRate } });
  await editText(
    chatId,
    msgId,
    `💸 *ငွေထုတ်ရန်*

╔══════════════════════════════╗
║                              ║
║   📱 *ENTER WALLET*          ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
💵 *ထုတ်ယူမည်:* ${amountNum.toFixed(4)} TON
📊 *Commission (${commRate}%):* -${fee.toFixed(4)} TON
✅ *လက်ခံရရှိမည်:* ${receiveAmount.toFixed(4)} TON
━━━━━━━━━━━━━━━━━━━━━━━━━

📱 *သင်၏ TON Wallet လိပ်စာ ထည့်ပါ:*

ဥပမာ: \`UQBxxxxxxxxxxxxxxxx\`

⚠️ *သတိ:* Wallet လိပ်စာ မှန်ကန်ရန် စစ်ဆေးပါ
မှားယွင်းပါက ငွေပြန်ရနိုင်မည် မဟုတ်ပါ`,
    cancelBtn(),
  );
}

async function showOrders(chatId: number, msgId: number, username?: string) {
  const profile = await getProfile(chatId, username);

  const { data: sellerTxs } = await supabase
    .from("transactions")
    .select("*, products(*)")
    .eq("seller_id", profile.id)
    .in("status", ["pending_payment", "payment_received", "item_sent", "disputed"])
    .order("created_at", { ascending: false })
    .limit(5);

  const { data: buyerTxs } = await supabase
    .from("transactions")
    .select("*, products(*)")
    .eq("buyer_id", profile.id)
    .in("status", ["pending_payment", "payment_received", "item_sent", "disputed"])
    .order("created_at", { ascending: false })
    .limit(5);

  if (!sellerTxs?.length && !buyerTxs?.length) {
    await editText(
      chatId,
      msgId,
      `📭 *အရောင်းအဝယ် မရှိပါ*

ပစ္စည်းရောင်း/ဝယ်ရန် "Order ပြုလုပ်မည်" နှိပ်ပါ`,
      backBtn(),
    );
    return;
  }

  let text = `📋 *ကျွန်ုပ်၏ အရောင်းအဝယ်များ*\n\n`;
  const btns: { text: string; callback_data: string }[][] = [];

  if (sellerTxs?.length) {
    text += `━━━ 📤 *ရောင်းနေသည်* ━━━\n\n`;
    for (const tx of sellerTxs) {
      text += `📦 *${tx.products?.title}*\n💵 ${tx.amount_ton} TON | ${statusText[tx.status]}\n\n`;
      if (tx.status === "payment_received") {
        btns.push([
          { text: `📦 ${tx.products?.title?.substring(0, 12)} - ပို့ပြီး`, callback_data: `a:sent:${tx.id}` },
        ]);
      }
    }
  }

  if (buyerTxs?.length) {
    text += `━━━ 📥 *ဝယ်နေသည်* ━━━\n\n`;
    for (const tx of buyerTxs) {
      text += `📦 *${tx.products?.title}*\n💵 ${tx.amount_ton} TON | ${statusText[tx.status]}\n\n`;
      if (tx.status === "item_sent") {
        btns.push([
          { text: `✅ ${tx.products?.title?.substring(0, 12)} - ရရှိပြီး`, callback_data: `a:recv:${tx.id}` },
        ]);
      }
    }
  }

  btns.push([{ text: "📜 မှတ်တမ်း", callback_data: "m:hist" }]);
  btns.push([{ text: "🏠 ပင်မစာမျက်နှာ", callback_data: "m:home" }]);
  await editText(chatId, msgId, text, { inline_keyboard: btns });
}

// ==================== TRANSACTION HISTORY ====================
async function showHistory(chatId: number, msgId: number, username?: string) {
  const profile = await getProfile(chatId, username);

  // Get completed/cancelled transactions
  const { data: sellerTxs } = await supabase
    .from("transactions")
    .select("*, products(*), buyer:profiles!transactions_buyer_id_fkey(telegram_username, avg_rating, total_ratings)")
    .eq("seller_id", profile.id)
    .in("status", ["completed", "cancelled"])
    .order("created_at", { ascending: false })
    .limit(10);

  const { data: buyerTxs } = await supabase
    .from("transactions")
    .select("*, products(*), seller:profiles!transactions_seller_id_fkey(telegram_username, avg_rating, total_ratings)")
    .eq("buyer_id", profile.id)
    .in("status", ["completed", "cancelled"])
    .order("created_at", { ascending: false })
    .limit(10);

  if (!sellerTxs?.length && !buyerTxs?.length) {
    await editText(
      chatId,
      msgId,
      `📭 *မှတ်တမ်း မရှိသေးပါ*

ပြီးဆုံးသော အရောင်းအဝယ်များ ဤနေရာတွင် ပြပါမည်`,
      backBtn(),
    );
    return;
  }

  let text = `📜 *ကျွန်ုပ်၏ မှတ်တမ်း*\n\n`;

  if (sellerTxs?.length) {
    text += `━━━ 📤 *ရောင်းခဲ့သည်* ━━━\n\n`;
    for (const tx of sellerTxs) {
      const date = new Date(tx.created_at).toLocaleDateString("my-MM");
      const statusIcon = tx.status === "completed" ? "✅" : "❌";
      const buyerRating = tx.buyer?.avg_rating ? ` ⭐${tx.buyer.avg_rating}` : "";
      text += `${statusIcon} *${tx.products?.title}*\n💵 ${tx.amount_ton} TON | ${date}${buyerRating}\n\n`;
    }
  }

  if (buyerTxs?.length) {
    text += `━━━ 📥 *ဝယ်ခဲ့သည်* ━━━\n\n`;
    for (const tx of buyerTxs) {
      const date = new Date(tx.created_at).toLocaleDateString("my-MM");
      const statusIcon = tx.status === "completed" ? "✅" : "❌";
      const sellerRating = tx.seller?.avg_rating ? ` ⭐${tx.seller.avg_rating}` : "";
      text += `${statusIcon} *${tx.products?.title}*\n💵 ${tx.amount_ton} TON | ${date}${sellerRating}\n\n`;
    }
  }

  await editText(chatId, msgId, text, backBtn());
}

// ==================== MY SALES LINKS ====================
async function showMyLinks(chatId: number, msgId: number, username?: string) {
  const profile = await getProfile(chatId, username);

  // Get ALL transactions created by this seller (including pending with no buyer)
  const { data: myLinks } = await supabase
    .from("transactions")
    .select("*, products(*)")
    .eq("seller_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(15);

  if (!myLinks?.length) {
    await editText(
      chatId,
      msgId,
      `📭 *Order Link မရှိသေးပါ*

ပစ္စည်းရောင်း/ဝယ်ရန် "Order ပြုလုပ်မည်" နှိပ်ပါ`,
      backBtn(),
    );
    return;
  }

  const { data: botSetting } = await supabase.from("settings").select("value").eq("key", "bot_username").maybeSingle();
  const botUsername = botSetting?.value || "YourBot";

  let text = `🛍️ *ကျွန်ုပ်၏ ရောင်းလင့်များ*\n\n`;
  const btns: { text: string; callback_data: string }[][] = [];

  for (const tx of myLinks) {
    const statusIcon = statusText[tx.status] || tx.status;
    const hasBuyer = !!tx.buyer_id;
    const buyerStatus = hasBuyer ? "👤 ဝယ်သူရှိ" : "⏳ ဝယ်သူမရှိ";

    text += `📦 *${tx.products?.title}*\n`;
    text += `💵 ${tx.amount_ton} TON | ${statusIcon}\n`;
    text += `${buyerStatus}\n`;
    text += `🔗 \`https://t.me/${botUsername}?start=buy_${tx.unique_link}\`\n\n`;

    // Add action button based on status
    if (tx.status === "pending_payment" && !hasBuyer) {
      btns.push([{ text: `❌ ${tx.products?.title?.substring(0, 12)} - ဖျက်မည်`, callback_data: `a:cancel:${tx.id}` }]);
    } else if (tx.status === "payment_received") {
      btns.push([{ text: `📦 ${tx.products?.title?.substring(0, 12)} - ပို့ပြီး`, callback_data: `a:sent:${tx.id}` }]);
    }
  }

  btns.push([{ text: "🏠 ပင်မစာမျက်နှာ", callback_data: "m:home" }]);
  await editText(chatId, msgId, text, { inline_keyboard: btns });
}

// ==================== RATING SYSTEM ====================
async function showMyRating(chatId: number, msgId: number, username?: string) {
  const profile = await getProfile(chatId, username);

  const avgRating = Number(profile.avg_rating) || 0;
  const totalRatings = Number(profile.total_ratings) || 0;

  // Get recent ratings received
  const { data: recentRatings } = await supabase
    .from("ratings")
    .select("rating, comment, created_at, rater:profiles!ratings_rater_id_fkey(telegram_username)")
    .eq("rated_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(5);

  let text = `⭐ *ကျွန်ုပ်၏ အဆင့်သတ်မှတ်ချက်*

━━━━━━━━━━━━━━━
⭐ ပျမ်းမျှ: *${avgRating.toFixed(1)} / 5.0*
📊 စုစုပေါင်း: *${totalRatings}* ခု
━━━━━━━━━━━━━━━`;

  if (recentRatings?.length) {
    text += `\n\n*မကြာမီက ရရှိသော အဆင့်များ:*\n`;
    for (const r of recentRatings) {
      const stars = "⭐".repeat(r.rating);
      // Handle the rater relation which could be an array or object
      const raterData = Array.isArray(r.rater) ? r.rater[0] : r.rater;
      const rater = raterData?.telegram_username ? `@${raterData.telegram_username}` : "User";
      text += `\n${stars} - ${rater}`;
      if (r.comment) text += `\n   💬 "${r.comment}"`;
    }
  }

  await editText(chatId, msgId, text, backBtn());
}

async function handleRating(
  chatId: number,
  msgId: number,
  rating: number,
  txId: string,
  ratedId: string,
  cbId: string,
  telegramId: number,
) {
  const profile = await getProfile(telegramId);

  // Check if already rated this specific person for this transaction
  // (buyer rates seller, seller rates buyer - these are SEPARATE ratings)
  const { data: existingRating } = await supabase
    .from("ratings")
    .select("id")
    .eq("transaction_id", txId)
    .eq("rater_id", profile.id)
    .eq("rated_id", ratedId)
    .maybeSingle();

  if (existingRating) {
    await answerCb(cbId, "❌ ဤသူကို အဆင့်သတ်မှတ်ပြီးပါပြီ", true);
    return;
  }

  // Insert rating (without comment first)
  const { data: insertedRating, error } = await supabase
    .from("ratings")
    .insert({
      transaction_id: txId,
      rater_id: profile.id,
      rated_id: ratedId,
      rating: rating,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Rating error:", error);
    await answerCb(cbId, "❌ အမှားဖြစ်ပွားပါသည်", true);
    return;
  }

  await answerCb(cbId, `✅ ${rating} ⭐ အဆင့်သတ်မှတ်ပြီး!`);

  // Ask for optional comment
  await setUserState(chatId, { action: "rating_comment", msgId, data: { ratingId: insertedRating.id, rating } });

  const commentPrompt = `✅ *${rating} ⭐ အဆင့်သတ်မှတ်ပြီး!*

━━━━━━━━━━━━━━━
${"⭐".repeat(rating)} ${rating}/5
━━━━━━━━━━━━━━━

📝 *Feedback/Comment ရေးမည်လား?*

ထပ်ပြောချင်တာရှိရင် အောက်မှာ ရိုက်ထည့်ပါ
(သို့) "ကျော်မည်" နှိပ်ပါ`;

  // Try editText first, if fails (photo message), try editMessageMedia, then sendMessage
  const textEdited = await editText(chatId, msgId, commentPrompt, skipCommentBtn());
  if (!textEdited) {
    const ratingQR = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent("RATED")}&bgcolor=90EE90`;
    const mediaEdited = await editMessageMedia(chatId, msgId, ratingQR, commentPrompt, skipCommentBtn());
    if (!mediaEdited) {
      await sendMessage(chatId, commentPrompt, skipCommentBtn());
    }
  }
}

// Skip comment button
const skipCommentBtn = () => ({
  inline_keyboard: [[{ text: "⏭️ ကျော်မည်", callback_data: "skip_comment" }]],
});

// Handle rating comment input
async function handleRatingComment(chatId: number, comment: string, msgId: number, ratingId: string, rating: number) {
  const safeComment = comment.substring(0, 500).trim();

  if (safeComment) {
    await supabase.from("ratings").update({ comment: safeComment }).eq("id", ratingId);
  }

  await deleteUserState(chatId);

  const thankYouMsg = `✅ *ကျေးဇူးတင်ပါသည်!*

━━━━━━━━━━━━━━━
${"⭐".repeat(rating)} ${rating}/5
${safeComment ? `💬 "${safeComment}"` : ""}
━━━━━━━━━━━━━━━

အဆင့်သတ်မှတ်ပေးသည့်အတွက် ကျေးဇူးပါ 🙏`;

  // Try editText first, if fails (photo message), try editMessageMedia, then sendMessage
  const textEdited = await editText(chatId, msgId, thankYouMsg, backBtn());
  if (!textEdited) {
    const thankQR = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent("THANKS")}&bgcolor=90EE90`;
    const mediaEdited = await editMessageMedia(chatId, msgId, thankQR, thankYouMsg, backBtn());
    if (!mediaEdited) {
      await sendMessage(chatId, thankYouMsg, backBtn());
    }
  }
}

// ==================== ACTION HANDLERS ====================
// Input validation helper
function sanitizeTitle(title: string): string {
  // Escape markdown special characters to prevent injection
  return title.replace(/[*_`\[\]()]/g, "\\$&");
}

function validateProductInput(title: string, price: number): { valid: boolean; error?: string } {
  const MAX_TITLE_LENGTH = 200;
  const MIN_PRICE = 0.01;
  const MAX_PRICE = 100000;

  if (!title || title.length < 1) {
    return { valid: false, error: "ပစ္စည်းအမည် ထည့်ပါ" };
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return { valid: false, error: `အမည် ${MAX_TITLE_LENGTH} စာလုံးထက် နည်းရပါမည်` };
  }
  if (isNaN(price) || !Number.isFinite(price)) {
    return { valid: false, error: "ဈေးနှုန်း မမှန်ကန်ပါ" };
  }
  if (price < MIN_PRICE || price > MAX_PRICE) {
    return { valid: false, error: `ဈေးနှုန်း ${MIN_PRICE} - ${MAX_PRICE} TON ဖြစ်ရပါမည်` };
  }
  return { valid: true };
}

// Step 1: Handle product title input (with currency from state)
async function handleSellTitle(chatId: number, title: string, msgId: number, username?: string) {
  const state = await getUserState(chatId);
  const currency = (state?.data?.currency as string) || "TON";
  const currencyIcon = currency === "TON" ? "💎" : "💵";
  const currencyUnit = currency === "TON" ? "TON" : "MMK";
  const priceExample = currency === "TON" ? "`150` သို့ `25.5`" : "`50000` သို့ `100000`";

  const profile = await getProfile(chatId, username);
  const lang = (profile.language || "my") as Language;
  const safeTitle = title.substring(0, 200).trim();

  if (!safeTitle || safeTitle.length < 1) {
    await editText(
      chatId,
      msgId,
      `❌ *${lang === "en" ? "Enter product name" : "ပစ္စည်းအမည် ထည့်ပါ"}*

━━━━━━━━━━━━━━━
${currencyIcon} *Currency:* ${currency}
━━━━━━━━━━━━━━━

📝 *${lang === "en" ? "Step 1/2" : "အဆင့် ၁/၂"}*
${lang === "en" ? "Enter product name:" : "ပစ္စည်းအမည် ထည့်ပါ:"}`,
      cancelBtn(lang),
    );
    return;
  }

  // Save title and currency, move to price step
  await setUserState(chatId, { action: "sell_price", msgId, data: { title: safeTitle, currency } });
  await editText(
    chatId,
    msgId,
    `📦 *${lang === "en" ? "Create Order" : "ပစ္စည်းရောင်း/ဝယ်ရန်"}*

━━━━━━━━━━━━━━━
${currencyIcon} *Currency:* ${currency}
📦 *${sanitizeTitle(safeTitle)}*
━━━━━━━━━━━━━━━

${currencyIcon} *${lang === "en" ? "Step 2/2" : "အဆင့် ၂/၂"}*
${lang === "en" ? `Enter price (${currencyUnit}):` : `ဈေးနှုန်း (${currencyUnit}) ထည့်ပါ:`}

${lang === "en" ? "Example" : "ဥပမာ"}: ${priceExample}`,
    cancelBtn(lang),
  );
}

// Step 2: Handle product price input and create product (with currency support)
async function handleSellPrice(chatId: number, priceText: string, msgId: number, username?: string) {
  const state = await getUserState(chatId);
  const title = state?.data?.title as string;
  const currency = (state?.data?.currency as string) || "TON";
  const currencyIcon = currency === "TON" ? "💎" : "💵";
  const currencyUnit = currency === "TON" ? "TON" : "MMK";
  const priceExample = currency === "TON" ? "`150` သို့ `25.5`" : "`50000` သို့ `100000`";

  const profile = await getProfile(chatId, username);
  const lang = (profile.language || "my") as Language;

  if (!title) {
    await editText(
      chatId,
      msgId,
      `❌ ${lang === "en" ? "Error occurred. Please try again" : "အမှားဖြစ်ပွားပါသည်။ ထပ်မံကြိုးစားပါ"}`,
      backBtn(lang),
    );
    await deleteUserState(chatId);
    return;
  }

  // Parse price - for MMK, parse as integer
  const price = currency === "MMK" ? parseInt(priceText.trim()) : parseFloat(priceText.trim());

  // Validate based on currency
  const MIN_PRICE = currency === "TON" ? 0.01 : 1000;
  const MAX_PRICE = currency === "TON" ? 100000 : 100000000; // 100M MMK max

  if (isNaN(price) || !Number.isFinite(price) || price < MIN_PRICE || price > MAX_PRICE) {
    await editText(
      chatId,
      msgId,
      `❌ *${lang === "en" ? "Invalid price" : "ဈေးနှုန်း မမှန်ကန်ပါ"}*

━━━━━━━━━━━━━━━
${currencyIcon} *Currency:* ${currency}
📦 *${sanitizeTitle(title)}*
━━━━━━━━━━━━━━━

${currencyIcon} ${lang === "en" ? `Enter price (${currencyUnit}):` : `ဈေးနှုန်း (${currencyUnit}) ထည့်ပါ:`}
(${MIN_PRICE.toLocaleString()} - ${MAX_PRICE.toLocaleString()} ${currencyUnit})

${lang === "en" ? "Example" : "ဥပမာ"}: ${priceExample}`,
      cancelBtn(lang),
    );
    return;
  }

  const link = genLink();

  // NO FEE on selling - full price goes to seller
  // Fee will be deducted on withdrawal
  const commission = 0;
  const sellerGets = price;

  // Create product with currency
  const { data: product, error } = await supabase
    .from("products")
    .insert({
      seller_id: profile.id,
      title,
      price_ton: price,
      unique_link: link,
      is_active: true,
      currency: currency,
    })
    .select()
    .single();

  if (error) {
    console.error("Product creation error:", error);
    await editText(chatId, msgId, `❌ ${lang === "en" ? "Error occurred" : "အမှားဖြစ်ပွားပါသည်"}`, backBtn(lang));
    await deleteUserState(chatId);
    return;
  }

  // Create transaction with currency and amount_mmk if MMK
  await supabase.from("transactions").insert({
    product_id: product.id,
    seller_id: profile.id,
    amount_ton: currency === "TON" ? price : 0,
    amount_mmk: currency === "MMK" ? price : 0,
    commission_ton: commission,
    seller_receives_ton: currency === "TON" ? sellerGets : 0,
    unique_link: link,
    status: "pending_payment",
    currency: currency,
  });

  const { data: botSetting } = await supabase.from("settings").select("value").eq("key", "bot_username").single();
  const botUsername = botSetting?.value || "YourBot";
  const productLink = `https://t.me/${botUsername}?start=buy_${link}`;

  const displayPrice = currency === "TON" ? `${price} TON` : `${price.toLocaleString()} MMK`;
  const displaySellerGets = currency === "TON" ? `${sellerGets.toFixed(2)} TON` : `${sellerGets.toLocaleString()} MMK`;
  const safeDisplayTitle = sanitizeTitle(title);

  await editText(
    chatId,
    msgId,
    `✅ *${lang === "en" ? "Order Created!" : "Order ဖန်တီးပြီး!"}*

╔══════════════════════════════╗
║                              ║
║   ✅ *ORDER CREATED*         ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
${currencyIcon} *Currency:* ${currency}
📦 *${safeDisplayTitle}*
${currencyIcon} ${lang === "en" ? "Price" : "ဈေး"}: *${displayPrice}*
💰 ${lang === "en" ? "You receive" : "ရရှိမည်"}: *${displaySellerGets}*
━━━━━━━━━━━━━━━━━━━━━━━━━

🔗 *Link:*
\`${productLink}\`

📢 ${lang === "en" ? "Share this link with the buyer" : "မိမိနှင့် ရောင်းဝယ်မည့်သူထံသို့ ဤ Link အားပို့ပါ"}

💡 *${lang === "en" ? "Note" : "မှတ်ချက်"}:* ${lang === "en" ? "Commission deducted on withdrawal" : "ငွေထုတ်ယူသောအခါ commission ဖြတ်ပါမည်"}`,
    backBtn(lang),
  );
  await deleteUserState(chatId);
}

// Direct product creation from /sell command (no msgId needed)
async function handleCreateProductDirect(chatId: number, title: string, price: number, username?: string) {
  // Validate input
  const safeTitle = title.substring(0, 200); // Enforce max length
  const validation = validateProductInput(safeTitle, price);
  if (!validation.valid) {
    await sendMessage(chatId, `❌ *${validation.error}*`, backBtn());
    return;
  }

  const profile = await getProfile(chatId, username);
  const link = genLink();

  // NO FEE on selling - full price goes to seller
  // Fee will be deducted on withdrawal
  const commission = 0;
  const sellerGets = price;

  const { data: product, error } = await supabase
    .from("products")
    .insert({ seller_id: profile.id, title: safeTitle, price_ton: price, unique_link: link, is_active: true })
    .select()
    .single();

  if (error) {
    console.error("Product creation error:", error);
    await sendMessage(chatId, "❌ အမှားဖြစ်ပွားပါသည်", backBtn());
    return;
  }

  await supabase.from("transactions").insert({
    product_id: product.id,
    seller_id: profile.id,
    amount_ton: price,
    commission_ton: commission,
    seller_receives_ton: sellerGets,
    unique_link: link,
    status: "pending_payment",
  });

  const { data: botSetting } = await supabase.from("settings").select("value").eq("key", "bot_username").single();
  const botUsername = botSetting?.value || "YourBot";
  const productLink = `https://t.me/${botUsername}?start=buy_${link}`;

  const displayTitle = sanitizeTitle(safeTitle);
  await sendMessage(
    chatId,
    `✅ *ပစ္စည်း ဖန်တီးပြီး!*

━━━━━━━━━━━━━━━
📦 *${displayTitle}*
💵 ဈေး: *${price} TON*
💰 ရရှိမည်: *${sellerGets.toFixed(2)} TON*
━━━━━━━━━━━━━━━

🔗 *Link:*
\`${productLink}\`

📢 ဝယ်သူထံ ဤ Link ပေးပို့ပါ

💡 *မှတ်ချက်:* ငွေထုတ်ယူသောအခါ
commission ဖြတ်ပါမည်`,
    backBtn(),
  );
}

async function handleWithdrawRequest(chatId: number, wallet: string, msgId: number, username?: string) {
  const state = await getUserState(chatId);

  // Get amount data from state with proper number conversion
  const amount = Number(state?.data?.amount) || 0;
  const fee = Number(state?.data?.fee) || 0;
  const receiveAmount = Number(state?.data?.receiveAmount) || amount - fee;
  const commRate = Number(state?.data?.commRate) || 5;

  console.log(`[WD Request] Amount: ${amount}, Fee: ${fee}, Receive: ${receiveAmount}, CommRate: ${commRate}%`);

  if (!amount || amount <= 0 || !wallet) {
    await editText(chatId, msgId, "❌ ပမာဏ သို့မဟုတ် Wallet မှားနေပါသည်", backBtn());
    await deleteUserState(chatId);
    return;
  }

  // Validate amount limits - get min withdrawal from settings
  const { data: minWdSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "min_withdrawal_amount")
    .maybeSingle();
  const MIN_WITHDRAWAL = minWdSetting ? parseFloat(minWdSetting.value) : 0.01;
  const MAX_WITHDRAWAL = 10000;
  if (amount < MIN_WITHDRAWAL || amount > MAX_WITHDRAWAL || !Number.isFinite(amount)) {
    await editText(
      chatId,
      msgId,
      `❌ *ပမာဏ မမှန်ကန်ပါ*\n\n${MIN_WITHDRAWAL} - ${MAX_WITHDRAWAL} TON ဖြစ်ရပါမည်`,
      cancelBtn(),
    );
    await deleteUserState(chatId);
    return;
  }

  // Validate TON wallet format (basic check)
  if (!wallet.match(/^(UQ|EQ|0:|kQ)[A-Za-z0-9_-]{46,48}$/)) {
    await editText(chatId, msgId, "❌ *Wallet လိပ်စာ မမှန်ကန်ပါ*\n\nTON wallet format ဖြစ်ရပါမည်", cancelBtn());
    return;
  }

  const profile = await getProfile(chatId, username);
  const balance = Number(profile.balance);

  if (balance < amount) {
    await editText(
      chatId,
      msgId,
      `❌ *လက်ကျန်ငွေ မလုံလောက်ပါ*\n\nလက်ကျန်: ${balance.toFixed(4)} TON\nထုတ်ယူလိုသည်: ${amount.toFixed(4)} TON`,
      backBtn(),
    );
    await deleteUserState(chatId);
    return;
  }

  // Check withdrawal mode setting
  const { data: modeSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "withdrawal_mode")
    .maybeSingle();
  const withdrawalMode = modeSetting?.value || "manual";

  console.log(`[WD] Withdrawal mode: ${withdrawalMode}`);

  // Delete current message and send new one for tracking
  await deleteMsg(chatId, msgId);

  // Send status message and save its ID for live updates
  const statusMsgId = await sendMessage(
    chatId,
    `⏳ *ငွေထုတ်ယူမှု တောင်းဆိုနေသည်...*

╔══════════════════════════════╗
║                              ║
║    ⏳ *PROCESSING...*        ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
💵 *ထုတ်ယူမည်:* ${amount.toFixed(4)} TON
📊 *Commission (${commRate}%):* -${fee.toFixed(4)} TON
✅ *ရရှိမည်:* ${receiveAmount.toFixed(4)} TON
💳 *Wallet:* \`${wallet.substring(0, 10)}...${wallet.slice(-6)}\`
━━━━━━━━━━━━━━━━━━━━━━━━━

⏳ *Status:* စောင့်ဆိုင်းနေသည်...`,
  );

  // Create withdrawal record with fee info and message ID for live updates
  const { data: newWithdrawal, error } = await supabase
    .from("withdrawals")
    .insert({
      profile_id: profile.id,
      amount_ton: amount,
      destination_wallet: wallet,
      status: "pending",
      admin_notes: `Fee: ${fee.toFixed(4)} TON (${commRate}%), Receive: ${receiveAmount.toFixed(4)} TON`,
      telegram_msg_id: statusMsgId,
    })
    .select()
    .single();

  if (error) {
    console.error("Withdrawal creation error:", error);
    if (statusMsgId) {
      await editText(chatId, statusMsgId, "❌ အမှားဖြစ်ပွားပါသည်", backBtn());
    }
    await deleteUserState(chatId);
    return;
  }

  // Save wallet address to profile
  await supabase.from("profiles").update({ ton_wallet_address: wallet }).eq("id", profile.id);

  // Notify admin about new withdrawal (for manual mode)
  if (withdrawalMode === "manual") {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/notify-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          type: "admin_new_withdrawal",
          amount: amount,
          user_telegram_username: profile.telegram_username,
          destination_wallet: wallet,
        }),
      });
      console.log("Admin notified about new withdrawal");
    } catch (e) {
      console.error("Failed to notify admin about withdrawal:", e);
    }
  }

  // If AUTO mode, immediately process the withdrawal
  if (withdrawalMode === "auto") {
    console.log(`[WD] Auto mode enabled - processing withdrawal ${newWithdrawal.id} immediately`);

    // Update status to "checking"
    if (statusMsgId) {
      await editText(
        chatId,
        statusMsgId,
        `🔍 *စစ်ဆေးနေသည်...*

━━━━━━━━━━━━━━━
💵 ထုတ်ယူမည်: *${amount.toFixed(4)} TON*
📊 Commission (${commRate}%): *-${fee.toFixed(4)} TON*
✅ ရရှိမည်: *${receiveAmount.toFixed(4)} TON*
💳 Wallet: \`${wallet.substring(0, 10)}...${wallet.slice(-6)}\`
━━━━━━━━━━━━━━━

🔄 *On-chain transfer လုပ်နေသည်...*
⏳ ခဏစောင့်ပါ...`,
        undefined,
      );
    }

    try {
      // Invoke auto-withdraw function with force=true to process immediately
      const autoWithdrawUrl = `${SUPABASE_URL}/functions/v1/auto-withdraw`;
      const response = await fetch(autoWithdrawUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ force: true }),
      });

      const result = await response.json();
      console.log(`[WD] Auto-withdraw result:`, result);

      if (result.success && result.processed > 0) {
        // Success - auto-withdraw already sent notification to user
        console.log(`[WD] Instant withdrawal processed successfully`);
      } else if (result.errors?.length > 0) {
        // Failed - notify user
        if (statusMsgId) {
          await editText(
            chatId,
            statusMsgId,
            `❌ *ငွေထုတ်ယူမှု မအောင်မြင်ပါ*

━━━━━━━━━━━━━━━
💵 ${amount.toFixed(4)} TON
━━━━━━━━━━━━━━━

ပြဿနာ: ${result.errors[0]?.substring(0, 100) || "Unknown error"}

Admin ထံ ဆက်သွယ်ပါ။`,
            backBtn(),
          );
        }
      } else {
        // No withdrawals processed (maybe already completed)
        console.log(`[WD] Auto-withdraw returned no processed items`);
      }
    } catch (e) {
      console.error("[WD] Auto-withdraw invocation error:", e);
      if (statusMsgId) {
        await editText(
          chatId,
          statusMsgId,
          `❌ *ငွေထုတ်ယူမှု အမှားဖြစ်ပါသည်*

━━━━━━━━━━━━━━━
💵 ${amount.toFixed(4)} TON
━━━━━━━━━━━━━━━

Admin ထံ ဆက်သွယ်ပါ။`,
          backBtn(),
        );
      }
    }
  } else {
    // Manual mode - show waiting message
    const newBalance = balance; // Balance unchanged until approved

    if (statusMsgId) {
      await editText(
        chatId,
        statusMsgId,
        `✅ *ငွေထုတ်ယူမှု တောင်းဆိုပြီး!*

╔══════════════════════════════╗
║                              ║
║    📋 *REQUEST SUBMITTED*    ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
💵 *ထုတ်ယူမည်:* ${amount.toFixed(4)} TON
📊 *Commission (${commRate}%):* -${fee.toFixed(4)} TON
✅ *ရရှိမည်:* ${receiveAmount.toFixed(4)} TON
💳 *Wallet:* \`${wallet.substring(0, 10)}...${wallet.slice(-6)}\`
━━━━━━━━━━━━━━━━━━━━━━━━━

💰 *လက်ကျန်:* ${newBalance.toFixed(4)} TON
   _(အတည်ပြုပြီးမှ ဖြတ်ပါမည်)_

⏳ *Status:* Admin မှ အတည်ပြုရန် စောင့်နေသည်

📌 အတည်ပြုပြီးပါက သင်၏ Wallet သို့ 
   ငွေအလိုအလျောက် ပို့ပေးပါမည်`,
        backBtn(),
      );
    }
  }

  await deleteUserState(chatId);
}

// Handle MMK withdrawal request with phone number and account name
async function handleMMKWithdrawRequest(chatId: number, phone: string, msgId: number, username?: string) {
  const state = await getUserState(chatId);
  const profile = await getProfile(chatId, username);
  const lang = (profile.language || "my") as Language;

  // Get amount data from state
  const amount = Number(state?.data?.amount) || 0;
  const fee = Number(state?.data?.fee) || 0;
  const receiveAmount = Number(state?.data?.receiveAmount) || amount - fee;
  const paymentMethod = state?.data?.paymentMethod || "KBZPAY";
  const accountName = state?.data?.accountName || "";
  const { data: commSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "commission_rate")
    .maybeSingle();
  const commRate = commSetting ? parseFloat(commSetting.value) : 5;

  console.log(
    `[MMK WD Request] Amount: ${amount}, Fee: ${fee}, Receive: ${receiveAmount}, Method: ${paymentMethod}, Account: ${accountName}`,
  );

  if (!amount || amount <= 0 || !phone || !accountName) {
    await editText(chatId, msgId, "❌ ပမာဏ၊ ဖုန်းနံပါတ် သို့မဟုတ် အကောင့်နာမည် မှားနေပါသည်", backBtn(lang));
    await deleteUserState(chatId);
    return;
  }

  // Validate phone number format (Myanmar format)
  const cleanPhone = phone.replace(/\s+/g, "").replace(/-/g, "");
  if (!cleanPhone.match(/^(09|959|\+959)[0-9]{7,9}$/)) {
    await editText(
      chatId,
      msgId,
      `❌ *ဖုန်းနံပါတ် မမှန်ကန်ပါ*

${lang === "en" ? "Please enter a valid Myanmar phone number" : "မြန်မာ ဖုန်းနံပါတ် ထည့်ပါ"}
${lang === "en" ? "Example" : "ဥပမာ"}: \`09xxxxxxxxx\``,
      cancelBtn(lang),
    );
    return;
  }

  // Validate amount limits
  const MIN_WITHDRAWAL = 1000; // Minimum 1000 MMK
  const MAX_WITHDRAWAL = 10000000; // Maximum 10M MMK
  if (amount < MIN_WITHDRAWAL || amount > MAX_WITHDRAWAL) {
    await editText(
      chatId,
      msgId,
      `❌ *ပမာဏ မမှန်ကန်ပါ*

${MIN_WITHDRAWAL.toLocaleString()} - ${MAX_WITHDRAWAL.toLocaleString()} MMK ${lang === "en" ? "must be" : "ဖြစ်ရပါမည်"}`,
      cancelBtn(lang),
    );
    await deleteUserState(chatId);
    return;
  }

  // Check balance
  const balanceMMK = Number(profile.balance_mmk) || 0;
  if (balanceMMK < amount) {
    await editText(
      chatId,
      msgId,
      `❌ *${lang === "en" ? "Insufficient balance" : "လက်ကျန်ငွေ မလုံလောက်ပါ"}*

${lang === "en" ? "Balance" : "လက်ကျန်"}: ${balanceMMK.toLocaleString()} MMK
${lang === "en" ? "Requested" : "ထုတ်ယူလိုသည်"}: ${amount.toLocaleString()} MMK`,
      backBtn(lang),
    );
    await deleteUserState(chatId);
    return;
  }

  const methodName = paymentMethod === "KBZPAY" ? "KBZPay" : "WavePay";
  const methodIcon = paymentMethod === "KBZPAY" ? "📱" : "📲";

  // Delete current message and send new one for tracking
  await deleteMsg(chatId, msgId);

  // Send status message and save its ID for live updates
  const statusMsgId = await sendMessage(
    chatId,
    `⏳ *${lang === "en" ? "Submitting withdrawal request..." : "ငွေထုတ်ယူမှု တောင်းဆိုနေသည်..."}*

╔══════════════════════════════╗
║                              ║
║    ⏳ *PROCESSING...*        ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
${methodIcon} *Payment:* ${methodName}
💵 *${lang === "en" ? "Amount" : "ထုတ်ယူမည်"}:* ${amount.toLocaleString()} MMK
📊 *Commission (${commRate}%):* -${fee.toLocaleString()} MMK
✅ *${lang === "en" ? "You receive" : "ရရှိမည်"}:* ${receiveAmount.toLocaleString()} MMK
👤 *${lang === "en" ? "Account" : "အကောင့်"}:* ${accountName}
📱 *${lang === "en" ? "Phone" : "ဖုန်း"}:* \`${cleanPhone}\`
━━━━━━━━━━━━━━━━━━━━━━━━━

⏳ *Status:* ${lang === "en" ? "Processing..." : "စောင့်ဆိုင်းနေသည်..."}`,
  );

  // Create withdrawal record with currency=MMK (include account name in admin_notes)
  const { data: newWithdrawal, error } = await supabase
    .from("withdrawals")
    .insert({
      profile_id: profile.id,
      amount_ton: amount, // Using amount_ton field for MMK amount too
      destination_wallet: cleanPhone,
      status: "pending",
      currency: "MMK",
      payment_method: paymentMethod,
      admin_notes: `Account: ${accountName} | ${methodName} | Fee: ${fee.toLocaleString()} MMK (${commRate}%), Receive: ${receiveAmount.toLocaleString()} MMK`,
      telegram_msg_id: statusMsgId,
    })
    .select()
    .single();

  if (error) {
    console.error("MMK Withdrawal creation error:", error);
    if (statusMsgId) {
      await editText(
        chatId,
        statusMsgId,
        `❌ ${lang === "en" ? "Error occurred" : "အမှားဖြစ်ပွားပါသည်"}`,
        backBtn(lang),
      );
    }
    await deleteUserState(chatId);
    return;
  }

  // Notify admin about new MMK withdrawal with inline approve/reject buttons
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/notify-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        type: "admin_new_mmk_withdrawal",
        amount: amount,
        user_telegram_username: profile.telegram_username,
        destination_wallet: cleanPhone,
        payment_method: paymentMethod,
        currency: "MMK",
        account_name: accountName,
        withdrawal_id: newWithdrawal.id,
      }),
    });
    console.log("Admin notified about new MMK withdrawal");
  } catch (e) {
    console.error("Failed to notify admin about MMK withdrawal:", e);
  }

  // Show success message for manual processing
  const newBalance = balanceMMK; // Balance unchanged until approved

  if (statusMsgId) {
    await editText(
      chatId,
      statusMsgId,
      `✅ *${lang === "en" ? "Withdrawal request submitted!" : "ငွေထုတ်ယူမှု တောင်းဆိုပြီး!"}*

╔══════════════════════════════╗
║                              ║
║    📋 *REQUEST SUBMITTED*    ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
${methodIcon} *Payment:* ${methodName}
💵 *${lang === "en" ? "Amount" : "ထုတ်ယူမည်"}:* ${amount.toLocaleString()} MMK
📊 *Commission (${commRate}%):* -${fee.toLocaleString()} MMK
✅ *${lang === "en" ? "You receive" : "ရရှိမည်"}:* ${receiveAmount.toLocaleString()} MMK
👤 *${lang === "en" ? "Account" : "အကောင့်"}:* ${accountName}
📱 *${lang === "en" ? "Phone" : "ဖုန်း"}:* \`${cleanPhone}\`
━━━━━━━━━━━━━━━━━━━━━━━━━

💰 *${lang === "en" ? "Balance" : "လက်ကျန်"}:* ${newBalance.toLocaleString()} MMK
   _(${lang === "en" ? "Will be deducted upon approval" : "အတည်ပြုပြီးမှ ဖြတ်ပါမည်"})_

⏳ *Status:* ${lang === "en" ? "Waiting for admin approval" : "Admin မှ အတည်ပြုရန် စောင့်နေသည်"}

📌 ${lang === "en" ? "Upon approval, funds will be sent to your phone" : "အတည်ပြုပြီးပါက သင့်ဖုန်းသို့ ငွေပို့ပေးပါမည်"}`,
      backBtn(lang),
    );
  }

  await deleteUserState(chatId);
}

async function handleBuyLink(chatId: number, link: string, username?: string) {
  const { data: tx } = await supabase
    .from("transactions")
    .select("*, products(*), seller:profiles!transactions_seller_id_fkey(telegram_username, avg_rating, total_ratings)")
    .eq("unique_link", link)
    .single();

  if (!tx) {
    await sendMessage(chatId, "❌ *Link မရှိတော့ပါ*", mainMenu());
    return;
  }

  // Check if expired
  if (tx.expires_at && new Date(tx.expires_at) < new Date()) {
    await sendMessage(chatId, "❌ *ဤအမှာစာ သက်တမ်းကုန်သွားပါပြီ*", mainMenu());
    return;
  }

  if (tx.status !== "pending_payment") {
    await sendMessage(chatId, "❌ *ဤအရောင်းအဝယ် ပြီးဆုံးပြီး*", mainMenu());
    return;
  }

  const profile = await getProfile(chatId, username);
  const lang = (profile.language || "my") as Language;

  if (tx.seller_id === profile.id) {
    await sendMessage(chatId, "❌ *ကိုယ်တိုင်ဖန်တီးထားသော ပစ္စည်း ဝယ်၍မရပါ*", mainMenu());
    return;
  }

  // Check if another buyer already claimed this link (locked for 1 hour)
  if (tx.buyer_id && tx.buyer_id !== profile.id) {
    await sendMessage(
      chatId,
      `❌ *အခြားသူတစ်ယောက် ဝယ်နေပါပြီ*

━━━━━━━━━━━━━━━
⏰ 1 နာရီအတွင်း ငွေပေးသွင်းခြင်း မရှိပါက
   ပြန်လည်ဝယ်ယူနိုင်ပါမည်
━━━━━━━━━━━━━━━`,
      mainMenu(),
    );
    return;
  }

  // Set 1-hour expiry when buyer initiates purchase
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiry

  await supabase
    .from("transactions")
    .update({
      buyer_id: profile.id,
      buyer_telegram_id: chatId,
      expires_at: expiresAt.toISOString(),
    })
    .eq("id", tx.id);

  // Determine currency from transaction
  const txCurrency = tx.currency || "TON";
  const isMMK = txCurrency === "MMK";
  const currencyIcon = isMMK ? "💵" : "💎";

  // Get appropriate amount and balance
  const amount = isMMK ? Number(tx.amount_mmk || 0) : Number(tx.amount_ton);
  const buyerBalance = isMMK ? Number(profile.balance_mmk || 0) : Number(profile.balance);
  const hasEnoughBalance = buyerBalance >= amount;

  const sellerUsername = tx.seller?.telegram_username ? `@${tx.seller.telegram_username}` : "Seller";
  const sellerRating = tx.seller?.avg_rating
    ? `⭐ ${Number(tx.seller.avg_rating).toFixed(1)} (${tx.seller.total_ratings || 0})`
    : "⭐ အဆင့်သတ်မှတ်မှုမရှိသေး";

  const displayAmount = isMMK ? `${amount.toLocaleString()} MMK` : `${amount} TON`;
  const displayBalance = isMMK ? `${buyerBalance.toLocaleString()} MMK` : `${buyerBalance.toFixed(2)} TON`;

  if (isMMK) {
    // MMK transaction - balance payment only (no QR)
    let caption = `🛒 *${lang === "en" ? "Purchase" : "ဝယ်ယူရန်"}*

╔══════════════════════════════╗
║                              ║
║   ${currencyIcon} *MMK PURCHASE*         ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
${currencyIcon} *${displayAmount}*
🏪 ${sellerUsername}
${sellerRating}
━━━━━━━━━━━━━━━━━━━━━━━━━

💳 ${lang === "en" ? "Your Balance" : "လက်ကျန်"}: *${displayBalance}*`;

    if (hasEnoughBalance) {
      caption += `

✅ *${lang === "en" ? "You can pay with balance!" : "Balance နဲ့ ဝယ်နိုင်ပါတယ်!"}*

👆 ${lang === "en" ? "Click the button below to pay" : "အောက်က ခလုပ်နှိပ်ပြီး ငွေချေပါ"}`;
    } else {
      caption += `

❌ *${lang === "en" ? "Insufficient balance" : "လက်ကျန်ငွေ မလုံလောက်ပါ"}*

💰 ${lang === "en" ? "Please deposit MMK first" : "ပထမဦးစွာ MMK ငွေသွင်းပါ"}`;
    }

    const msgId = await sendMessage(chatId, caption, buyBtns(tx.id, hasEnoughBalance));
    if (msgId) {
      await supabase.from("transactions").update({ buyer_msg_id: msgId }).eq("id", tx.id);
    }
  } else {
    // TON transaction - QR code payment
    const adminWallet = await getAdminWallet();
    if (!adminWallet) {
      await sendMessage(chatId, "❌ Wallet မသတ်မှတ်ရသေးပါ", mainMenu());
      return;
    }

    const comment = `tx_${tx.unique_link}`;
    const qr = generateQR(adminWallet, amount, comment);

    let caption = `🛒 *${lang === "en" ? "Purchase" : "ဝယ်ယူရန်"}*

━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
${currencyIcon} *${displayAmount}*
🏪 ${sellerUsername}
${sellerRating}
━━━━━━━━━━━━━━━`;

    if (hasEnoughBalance) {
      caption += `
💳 ${lang === "en" ? "Balance" : "လက်ကျန်"}: *${displayBalance}*
✅ *${lang === "en" ? "You can pay with balance!" : "Balance နဲ့ ဝယ်နိုင်ပါတယ်!"}*
━━━━━━━━━━━━━━━`;
    }

    caption += `

📱 QR Scan သို့မဟုတ် အောက်တွင်ပါရှိသော Address သို့ ငွေလွဲပါ။

💳 \`${adminWallet}\`

🔐 *Comment တွင် Memo စာသား ကူးထည့်ပေးပါ:*
\`${comment}\`

━━━━━━━━━━━━━━━
⚠️ *Memo မပါရင် ငွေထည့်မရပါ!*
💫 ငွေလွဲပြီး Transaction Confirm ဖြစ်သည်နှင့် အလိုအလျောက် ဆောင်ရွက်ပေးပါမည်။
⏰ သက်တမ်း: *1 နာရီအတွင်း* ငွေပို့ပါ
⚠️ ပစ္စည်းမရမီ "ရရှိပြီး" မနှိပ်ပါ!`;

    const msgId = await sendPhoto(chatId, qr, caption, buyBtns(tx.id, hasEnoughBalance));
    if (msgId) {
      await supabase.from("transactions").update({ buyer_msg_id: msgId }).eq("id", tx.id);
    }
  }
}

// ==================== BUY WITH BALANCE ====================
async function handleBuyWithBalance(
  chatId: number,
  msgId: number,
  txId: string,
  cbId: string,
  telegramId: number,
  username?: string,
) {
  const { data: tx } = await supabase
    .from("transactions")
    .select("*, products(*), seller:profiles!transactions_seller_id_fkey(*)")
    .eq("id", txId)
    .single();

  if (!tx) {
    await answerCb(cbId, "❌ ရှာမတွေ့ပါ", true);
    return;
  }

  if (tx.status !== "pending_payment") {
    await answerCb(cbId, "❌ ဤအရောင်းအဝယ် ပြီးဆုံးပြီး", true);
    return;
  }

  const profile = await getProfile(telegramId, username);
  const lang = (profile.language || "my") as Language;

  // Determine currency
  const txCurrency = tx.currency || "TON";
  const isMMK = txCurrency === "MMK";
  const currencyIcon = isMMK ? "💵" : "💎";

  // Get appropriate amount and balance based on currency
  const amount = isMMK ? Number(tx.amount_mmk || 0) : Number(tx.amount_ton);
  const balance = isMMK ? Number(profile.balance_mmk || 0) : Number(profile.balance);

  if (balance < amount) {
    await answerCb(cbId, "❌ လက်ကျန်ငွေ မလုံလောက်ပါ", true);
    return;
  }

  await answerCb(cbId, "🔄 စစ်ဆေးနေသည်...");

  const displayAmount = isMMK ? `${amount.toLocaleString()} MMK` : `${amount} TON`;

  // Step 1: Show processing animation - use editText for MMK (no photo message)
  if (isMMK) {
    await editText(
      chatId,
      msgId,
      `⏳ *${lang === "en" ? "Processing payment..." : "ငွေပေးချေနေသည်..."}*

━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
${currencyIcon} *${displayAmount}*
━━━━━━━━━━━━━━━

🔄 Balance မှ ဖြတ်တောက်နေသည်...`,
    );
  } else {
    const processingQR = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent("PROCESSING...")}&bgcolor=FFF9C4`;
    await editMessageMedia(
      chatId,
      msgId,
      processingQR,
      `⏳ *${lang === "en" ? "Processing payment..." : "ငွေပေးချေနေသည်..."}*

━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
${currencyIcon} *${displayAmount}*
━━━━━━━━━━━━━━━

🔄 Balance မှ ဖြတ်တောက်နေသည်...`,
    );
  }

  await new Promise((r) => setTimeout(r, 600));

  // Deduct from buyer's balance (correct currency)
  const newBuyerBalance = balance - amount;
  if (isMMK) {
    await supabase.from("profiles").update({ balance_mmk: newBuyerBalance }).eq("id", profile.id);
  } else {
    await supabase.from("profiles").update({ balance: newBuyerBalance }).eq("id", profile.id);
  }

  // Update transaction to payment_received
  await supabase
    .from("transactions")
    .update({
      status: "payment_received",
      ton_tx_hash: `balance_${txCurrency}_${Date.now()}`, // Mark as balance payment with currency
    })
    .eq("id", tx.id);

  const newDisplayBalance = isMMK ? `${newBuyerBalance.toLocaleString()} MMK` : `${newBuyerBalance.toFixed(2)} TON`;

  // Step 2: Show success
  if (isMMK) {
    await editText(
      chatId,
      msgId,
      `🎉 *${lang === "en" ? "Paid with Balance!" : "Balance ဖြင့် ဝယ်ယူပြီး!"}*

╔══════════════════════════════╗
║                              ║
║      ✅ *${lang === "en" ? "PAYMENT COMPLETE" : "ငွေပေးချေပြီး"}*       ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
${currencyIcon} *${displayAmount}*
━━━━━━━━━━━━━━━━━━━━━━━━━

💳 ${lang === "en" ? "Remaining Balance" : "လက်ကျန်"}: *${newDisplayBalance}*

⏳ ${lang === "en" ? "Seller will send the item." : "ရောင်းသူထံမှ ပစ္စည်း ပို့ပေးမည်ဖြစ်ပါသည်။"}
⚠️ *${lang === "en" ? 'Do not click "Received" before receiving the item!' : 'ပစ္စည်းမရရှိမှီ "ရရှိပြီး" မနှိပ်ပါနှင့်'}*`,
      buyerBtns(tx.id, tx.seller?.telegram_username),
    );
  } else {
    const successQR = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent("PAID!")}&bgcolor=90EE90`;
    await editMessageMedia(
      chatId,
      msgId,
      successQR,
      `🎉 *${lang === "en" ? "Paid with Balance!" : "Balance ဖြင့် ဝယ်ယူပြီး!"}*

╔══════════════════════════════╗
║                              ║
║      ✅ *${lang === "en" ? "PAYMENT COMPLETE" : "ငွေပေးချေပြီး"}*       ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
${currencyIcon} *${displayAmount}*
━━━━━━━━━━━━━━━━━━━━━━━━━

💳 ${lang === "en" ? "Remaining Balance" : "လက်ကျန်"}: *${newDisplayBalance}*

⏳ ${lang === "en" ? "Seller will send the item." : "ရောင်းသူထံမှ ပစ္စည်း ပို့ပေးမည်ဖြစ်ပါသည်။"}
⚠️ *${lang === "en" ? 'Do not click "Received" before receiving the item!' : 'ပစ္စည်းမရရှိမှီ "ရရှိပြီး" မနှိပ်ပါနှင့်'}*`,
      buyerBtns(tx.id, tx.seller?.telegram_username),
    );
  }

  // Notify seller
  if (tx.seller?.telegram_id) {
    const buyerUsername = profile.telegram_username
      ? `@${profile.telegram_username}`
      : `ID: ${profile.telegram_id || "Unknown"}`;

    await sendMessage(
      tx.seller.telegram_id,
      `🎉 *${lang === "en" ? "New Order Received!" : "အော်ဒါအသစ် ရရှိပြီး!"}*

╔══════════════════════════════╗
║                              ║
║      💰 *${lang === "en" ? "PAYMENT RECEIVED" : "ငွေလက်ခံပြီး"}*        ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
${currencyIcon} *${displayAmount}*
👤 *${lang === "en" ? "Buyer" : "ဝယ်သူ"}:* ${buyerUsername}
━━━━━━━━━━━━━━━━━━━━━━━━━

✅ ${lang === "en" ? "Buyer paid with balance" : "ဝယ်သူမှ Balance ဖြင့် ငွေပေးချေပြီးပါပြီ"}

📦 *${lang === "en" ? "To send item" : "ပစ္စည်းပို့ရန်"}:*
1️⃣ ${lang === "en" ? "Chat with buyer and send item" : "ဝယ်သူနှင့် Chat လုပ်ပြီး ပစ္စည်းပို့ပါ"}
2️⃣ ${lang === "en" ? 'Click "Sent" when done' : 'ပို့ပြီးပါက "ပို့ပြီး" ခလုပ်နှိပ်ပါ'}

⚠️ *${lang === "en" ? "Warning" : "သတိ"}:* ${lang === "en" ? 'Do not click "Sent" before sending' : 'ပစ္စည်းမပို့မီ "ပို့ပြီး" မနှိပ်ပါနှင့်'}`,
      sellerBtns(tx.id, profile.telegram_username),
    );
  }

  // Notify admin for high-value transactions
  const HIGH_VALUE_THRESHOLD = isMMK ? 500000 : 50; // 500k MMK or 50 TON
  if (amount >= HIGH_VALUE_THRESHOLD) {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/notify-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          type: "admin_high_value_tx",
          amount: amount,
          currency: txCurrency,
          product_title: tx.products?.title,
          buyer_username: profile.telegram_username,
          seller_username: tx.seller?.telegram_username,
          tx_hash: `balance_${txCurrency}_${Date.now()}`,
        }),
      });
      console.log(`Admin notified about high-value balance purchase: ${amount} ${txCurrency}`);
    } catch (e) {
      console.error("Failed to notify admin about high-value tx:", e);
    }
  }
}

// ==================== TRANSACTION ACTIONS ====================
// Helper to get status reason
function getStatusReason(status: string): string {
  switch (status) {
    case "pending_payment":
      return "ငွေမပေးချေရသေးပါ";
    case "payment_received":
      return "ငွေပေးချေပြီးပါပြီ၊ ပစ္စည်းပို့ရန် စောင့်နေပါသည်";
    case "item_sent":
      return "ပစ္စည်းပို့ပြီးပါပြီ၊ ဝယ်သူ အတည်ပြုရန် စောင့်နေပါသည်";
    case "completed":
      return "အရောင်းအဝယ် ပြီးဆုံးပြီးပါပြီ";
    case "cancelled":
      return "ပယ်ဖျက်ထားပြီးပါပြီ";
    case "disputed":
      return "အငြင်းပွားမှု ရှိနေပါသည်";
    default:
      return "လုပ်ဆောင်၍ မရပါ";
  }
}

async function handleItemSent(chatId: number, msgId: number, txId: string, cbId: string, telegramId: number) {
  const { data: tx } = await supabase
    .from("transactions")
    .select(
      "*, products(*), seller:profiles!transactions_seller_id_fkey(*), buyer:profiles!transactions_buyer_id_fkey(*)",
    )
    .eq("id", txId)
    .single();

  if (!tx) {
    await answerCb(cbId, "❌ ရောင်းဝယ်မှု ရှာမတွေ့ပါ", true);
    return;
  }
  if (!tx.products) {
    await answerCb(cbId, "❌ ပစ္စည်း ရှာမတွေ့ပါ (ဖျက်ထားပြီးဖြစ်နိုင်ပါသည်)", true);
    return;
  }
  if (tx.seller?.telegram_id !== telegramId) {
    await answerCb(cbId, "❌ သင်သည် ဤရောင်းဝယ်မှု၏ ရောင်းသူမဟုတ်ပါ", true);
    return;
  }
  if (tx.status !== "payment_received") {
    await answerCb(cbId, `❌ ${getStatusReason(tx.status)}`, true);
    return;
  }

  await supabase
    .from("transactions")
    .update({ status: "item_sent", item_sent_at: new Date().toISOString() })
    .eq("id", txId);
  await answerCb(cbId, "✅ မှတ်တမ်းတင်ပြီး!");

  const buyerUsername = tx.buyer?.telegram_username
    ? `@${tx.buyer.telegram_username}`
    : `ID: ${tx.buyer?.telegram_id || "Unknown"}`;

  await editText(
    chatId,
    msgId,
    `✅ *ပစ္စည်းပို့ပြီး!*

╔══════════════════════════════╗
║                              ║
║     📦 *ITEM SENT*           ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
💵 *${tx.amount_ton} TON*
👤 *ဝယ်သူ:* ${buyerUsername}
━━━━━━━━━━━━━━━━━━━━━━━━━

✅ ပစ္စည်းပို့ကြောင်း မှတ်တမ်းတင်ပြီးပါပြီ

⏳ ဝယ်သူမှ ပစ္စည်းရရှိကြောင်း အတည်ပြုပါက
💰 သင်၏ Balance ထဲသို့ ငွေထည့်သွင်းပေးပါမည်`,
    backBtn(),
  );

  if (tx.buyer?.telegram_id) {
    const sellerUsername = tx.seller?.telegram_username
      ? `@${tx.seller.telegram_username}`
      : `ID: ${tx.seller?.telegram_id || "Unknown"}`;

    const buyerMsg = `📦 *ပစ္စည်းပို့ပြီး!*

╔══════════════════════════════╗
║                              ║
║     📦 *ITEM SENT*           ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
💵 *${tx.amount_ton} TON*
🏪 *ရောင်းသူ:* ${sellerUsername}
━━━━━━━━━━━━━━━━━━━━━━━━━

✅ ရောင်းသူမှ ပစ္စည်းပို့ပြီးပါပြီ

📦 *ပစ္စည်းရရှိပါက:*
1️⃣ ပစ္စည်းစစ်ဆေးပါ
2️⃣ "ရရှိပြီး" ခလုပ်နှိပ်ပါ

⚠️ *သတိ:* ပစ္စည်းမရရှိမီ "ရရှိပြီး" မနှိပ်ပါနှင့်
သင်၏ငွေဆုံးရှုံးနိုင်ပါသည်`;

    // Edit existing buyer message if available, otherwise send new
    if (tx.buyer_msg_id) {
      await editText(tx.buyer.telegram_id, tx.buyer_msg_id, buyerMsg, buyerBtns(txId, tx.seller?.telegram_username));
    } else {
      await sendMessage(tx.buyer.telegram_id, buyerMsg, buyerBtns(txId, tx.seller?.telegram_username));
    }
  }
}

async function handleItemReceived(chatId: number, msgId: number, txId: string, cbId: string, telegramId: number) {
  const { data: tx } = await supabase
    .from("transactions")
    .select("*, products(*), buyer:profiles!transactions_buyer_id_fkey(*)")
    .eq("id", txId)
    .single();

  if (!tx) {
    await answerCb(cbId, "❌ ရောင်းဝယ်မှု ရှာမတွေ့ပါ", true);
    return;
  }
  if (!tx.products) {
    await answerCb(cbId, "❌ ပစ္စည်း ရှာမတွေ့ပါ (ဖျက်ထားပြီးဖြစ်နိုင်ပါသည်)", true);
    return;
  }
  if (tx.buyer?.telegram_id !== telegramId) {
    await answerCb(cbId, "❌ သင်သည် ဤရောင်းဝယ်မှု၏ ဝယ်သူမဟုတ်ပါ", true);
    return;
  }
  if (tx.status !== "item_sent") {
    await answerCb(cbId, `❌ ${getStatusReason(tx.status)}`, true);
    return;
  }

  await answerCb(cbId);

  const confirmText = `⚠️ *အတည်ပြုရန်*

━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
━━━━━━━━━━━━━━━

ရရှိပြီးကြောင်း အတည်ပြုမည်လား?

⚠️ *အမှန်တကယ် ပစ္စည်းရရှိမှသာ အတည်ပြုမည် နှိပ်ပါ။*
*သင်၏ငွေဆုံးရှုံးနိုင်ပါသည်*

*သတိ:* ရောင်းသူထံ ငွေလွှဲမည်
ပြန်ပြင်၍ မရပါ`;

  // Try editText first, if fails (photo message), try editMessageMedia, if still fails send new message
  const textEdited = await editText(chatId, msgId, confirmText, confirmBtns(txId));
  if (!textEdited) {
    // Message might be a photo, try to edit as media
    const confirmQR = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent("CONFIRM?")}&bgcolor=FFEB3B`;
    const mediaEdited = await editMessageMedia(chatId, msgId, confirmQR, confirmText, confirmBtns(txId));
    if (!mediaEdited) {
      // If both fail, send new message
      await sendMessage(chatId, confirmText, confirmBtns(txId));
    }
  }
}

async function handleConfirmReceived(chatId: number, msgId: number, txId: string, cbId: string, telegramId: number) {
  const { data: tx } = await supabase
    .from("transactions")
    .select(
      "*, products(*), seller:profiles!transactions_seller_id_fkey(*), buyer:profiles!transactions_buyer_id_fkey(*)",
    )
    .eq("id", txId)
    .single();

  if (!tx) {
    await answerCb(cbId, "❌ ရောင်းဝယ်မှု ရှာမတွေ့ပါ", true);
    return;
  }
  if (!tx.products) {
    await answerCb(cbId, "❌ ပစ္စည်း ရှာမတွေ့ပါ (ဖျက်ထားပြီးဖြစ်နိုင်ပါသည်)", true);
    return;
  }
  if (tx.status !== "item_sent") {
    await answerCb(cbId, `❌ ${getStatusReason(tx.status)}`, true);
    return;
  }

  await supabase
    .from("transactions")
    .update({ status: "completed", confirmed_at: new Date().toISOString() })
    .eq("id", txId);

  // Process referral earnings - credit to referrer's balance immediately
  await processReferralEarnings(txId, Number(tx.commission_ton), tx.buyer?.id || null);

  // Determine currency and credit seller appropriately
  const txCurrency = tx.currency || "TON";
  const isMMK = txCurrency === "MMK";
  const currencyIcon = isMMK ? "💵" : "💎";

  // Get the amount to credit based on currency
  const creditAmount = isMMK ? Number(tx.amount_mmk || 0) : Number(tx.seller_receives_ton);
  const displayAmount = isMMK ? `${creditAmount.toLocaleString()} MMK` : `${creditAmount.toFixed(2)} TON`;

  // Credit seller with correct currency
  if (tx.seller) {
    let newBal: number;
    if (isMMK) {
      newBal = Number(tx.seller.balance_mmk || 0) + creditAmount;
      await supabase.from("profiles").update({ balance_mmk: newBal }).eq("id", tx.seller.id);
    } else {
      newBal = Number(tx.seller.balance) + creditAmount;
      await supabase.from("profiles").update({ balance: newBal }).eq("id", tx.seller.id);
    }

    const displayNewBal = isMMK ? `${newBal.toLocaleString()} MMK` : `${newBal.toFixed(2)} TON`;

    // Notify admin about completed transaction
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/notify-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          type: "admin_transaction_completed",
          amount: isMMK ? tx.amount_mmk : tx.amount_ton,
          currency: txCurrency,
          product_title: tx.products?.title,
          buyer_username: tx.buyer?.telegram_username,
          seller_username: tx.seller?.telegram_username,
        }),
      });
      console.log("Admin notified about completed transaction:", txId);
    } catch (e) {
      console.error("Failed to notify admin about completed transaction:", e);
    }

    if (tx.seller.telegram_id) {
      // Notify seller and ask to rate buyer
      await sendMessage(
        tx.seller.telegram_id,
        `🎉 *အရောင်းအဝယ် အောင်မြင်ပြီး!*

╔══════════════════════════════╗
║                              ║
║     ✅ *ငွေလက်ခံရရှိပြီး*      ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
${currencyIcon} *+${displayAmount}*
━━━━━━━━━━━━━━━━━━━━━━━━━

💳 လက်ကျန်: *${displayNewBal}*

✅ ဝယ်သူမှ ပစ္စည်းရရှိကြောင်း အတည်ပြုပြီးပါပြီ
💰 သင်၏ Balance ထဲသို့ ငွေထည့်သွင်းပြီးပါပြီ

📤 ငွေထုတ်လိုပါက "ငွေထုတ်" ခလုပ်နှိပ်ပါ`,
        backBtn(),
      );

      // Ask seller to rate buyer
      if (tx.buyer?.id) {
        await sendMessage(
          tx.seller.telegram_id,
          `⭐ *ဝယ်သူကို အဆင့်သတ်မှတ်ပေးပါ*

╔══════════════════════════════╗
║                              ║
║     ⭐ *RATE BUYER*          ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
💵 *${tx.amount_ton} TON*
━━━━━━━━━━━━━━━━━━━━━━━━━

💬 ဝယ်သူအား ဘယ်လောက် အဆင့်ပေးမလဲ?

⭐ သင့်အဆင့်သတ်မှတ်ချက်က အခြားရောင်းသူများအတွက် အကူအညီဖြစ်ပါမည်
📝 အဆင့်သတ်မှတ်ပြီးနောက် မှတ်ချက်ရေးနိုင်ပါသည်`,
          ratingBtns(tx.unique_link, "b"),
        );
      }
    }
  }

  await answerCb(cbId, "✅ အတည်ပြုပြီး!");

  // Prepare success message for buyer with rating prompt
  const successMsg = tx.seller?.id
    ? `🎉 *အရောင်းအဝယ် ပြီးဆုံးပါပြီ!*

╔══════════════════════════════╗
║                              ║
║      ✅ *COMPLETED*          ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
💵 *${tx.amount_ton} TON*
🏷️ ကော်မရှင်: ${tx.commission_ton} TON
━━━━━━━━━━━━━━━━━━━━━━━━━

⭐ *ရောင်းသူကို အဆင့်သတ်မှတ်ပေးပါ*

💬 ရောင်းသူအား ဘယ်လောက် အဆင့်ပေးမလဲ?

⭐ သင့်အဆင့်သတ်မှတ်ချက်က အခြားဝယ်သူများအတွက် အကူအညီဖြစ်ပါမည်
📝 အဆင့်သတ်မှတ်ပြီးနောက် မှတ်ချက်ရေးနိုင်ပါသည်`
    : `✅ *အရောင်းအဝယ် ပြီးဆုံးပါပြီ!*

━━━━━━━━━━━━━━━
📦 ${tx.products?.title}
💵 ${tx.amount_ton} TON
━━━━━━━━━━━━━━━

ကျေးဇူးတင်ပါသည် 🙏`;

  const successBtns = tx.seller?.id ? ratingBtns(tx.unique_link, "s") : backBtn();

  // Try editText first, if fails (photo message), try alternatives
  const textEdited = await editText(chatId, msgId, successMsg, successBtns);
  if (!textEdited) {
    // Message might be a photo, try to edit as media with success image
    const successQR = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent("SUCCESS")}&bgcolor=4CAF50`;
    const mediaEdited = await editMessageMedia(chatId, msgId, successQR, successMsg, successBtns);
    if (!mediaEdited) {
      // If both fail, send new message
      await sendMessage(chatId, successMsg, successBtns);
    }
  }
}

async function handleDispute(chatId: number, msgId: number, txId: string, cbId: string, telegramId: number) {
  const { data: tx } = await supabase
    .from("transactions")
    .select(
      "*, products(*), buyer:profiles!transactions_buyer_id_fkey(*), seller:profiles!transactions_seller_id_fkey(*)",
    )
    .eq("id", txId)
    .single();

  if (!tx) {
    await answerCb(cbId, "❌ ရောင်းဝယ်မှု ရှာမတွေ့ပါ", true);
    return;
  }
  if (!tx.products) {
    await answerCb(cbId, "❌ ပစ္စည်း ရှာမတွေ့ပါ (ဖျက်ထားပြီးဖြစ်နိုင်ပါသည်)", true);
    return;
  }
  if (tx.buyer?.telegram_id !== telegramId) {
    await answerCb(cbId, "❌ သင်သည် ဤရောင်းဝယ်မှု၏ ဝယ်သူမဟုတ်ပါ", true);
    return;
  }
  if (tx.status === "completed") {
    await answerCb(cbId, "❌ အရောင်းအဝယ် ပြီးဆုံးပြီးပါပြီ", true);
    return;
  }
  if (tx.status === "cancelled") {
    await answerCb(cbId, "❌ ပယ်ဖျက်ထားပြီးပါပြီ", true);
    return;
  }
  if (tx.status === "disputed") {
    await answerCb(cbId, "❌ အငြင်းပွားမှု တင်ပြီးပါပြီ", true);
    return;
  }

  await supabase.from("transactions").update({ status: "disputed" }).eq("id", txId);
  await answerCb(cbId, "⚠️ အငြင်းပွားမှု တင်ပြီး", true);

  const buyerUsername = tx.buyer?.telegram_username
    ? `@${tx.buyer.telegram_username}`
    : `ID: ${tx.buyer?.telegram_id || "Unknown"}`;

  // Update buyer's message
  await editText(
    chatId,
    msgId,
    `⚠️ *အငြင်းပွားမှု တင်သွင်းပြီး*

╔══════════════════════════════╗
║                              ║
║    🚨 *DISPUTE OPENED*       ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
💵 *${tx.amount_ton} TON*
━━━━━━━━━━━━━━━━━━━━━━━━━

📋 *အခြေအနေ:* အငြင်းပွားမှု စိစစ်နေပါသည်

⏳ Admin မှ စစ်ဆေးပြီး နှစ်ဘက်စလုံးသို့ ဆက်သွယ်ပါမည်
💬 လိုအပ်ပါက Admin မှ သင့်ထံ မေးမြန်းနိုင်ပါသည်

🔒 ငွေကို Admin က ထိန်းသိမ်းထားပါသည်`,
    backBtn(),
  );

  // Notify seller about the dispute
  if (tx.seller?.telegram_id) {
    await sendMessage(
      tx.seller.telegram_id,
      `⚠️ *အငြင်းပွားမှု ဖွင့်လှစ်ခံရပြီး*

╔══════════════════════════════╗
║                              ║
║    🚨 *DISPUTE OPENED*       ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
💵 *${tx.amount_ton} TON*
👤 *ဝယ်သူ:* ${buyerUsername}
━━━━━━━━━━━━━━━━━━━━━━━━━

📋 *အခြေအနေ:* ဝယ်သူမှ အငြင်းပွားမှု တင်သွင်းထားပါသည်

⏳ Admin မှ စစ်ဆေးပြီး နှစ်ဘက်စလုံးသို့ ဆက်သွယ်ပါမည်
💬 လိုအပ်ပါက Admin မှ သင့်ထံ မေးမြန်းနိုင်ပါသည်

🔒 ငွေကို Admin က ထိန်းသိမ်းထားပါသည်`,
      backBtn(),
    );
  }

  // Notify admin about new dispute with resolution buttons
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/notify-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        type: "admin_new_dispute",
        amount: tx.amount_ton,
        product_title: tx.products?.title,
        user_telegram_username: tx.buyer?.telegram_username,
        seller_username: tx.seller?.telegram_username,
        transaction_link: tx.unique_link,
      }),
    });
    console.log("Admin notified about dispute:", txId);
  } catch (e) {
    console.error("Failed to notify admin about dispute:", e);
  }
}

async function handleCancelTx(chatId: number, msgId: number, txId: string, cbId: string, telegramId: number) {
  const { data: tx } = await supabase
    .from("transactions")
    .select("*, products(*), seller:profiles!transactions_seller_id_fkey(*)")
    .eq("id", txId)
    .single();

  if (!tx) {
    await answerCb(cbId, "❌ ရောင်းဝယ်မှု ရှာမတွေ့ပါ", true);
    return;
  }
  if (!tx.products) {
    await answerCb(cbId, "❌ ပစ္စည်း ရှာမတွေ့ပါ (ဖျက်ထားပြီးဖြစ်နိုင်ပါသည်)", true);
    return;
  }
  if (tx.seller?.telegram_id !== telegramId) {
    await answerCb(cbId, "❌ သင်သည် ဤရောင်းဝယ်မှု၏ ရောင်းသူမဟုတ်ပါ", true);
    return;
  }
  if (tx.status === "completed") {
    await answerCb(cbId, "❌ အရောင်းအဝယ် ပြီးဆုံးပြီးပါပြီ", true);
    return;
  }
  if (tx.status === "cancelled") {
    await answerCb(cbId, "❌ ပယ်ဖျက်ထားပြီးပါပြီ", true);
    return;
  }
  if (tx.status === "item_sent") {
    await answerCb(cbId, "❌ ပစ္စည်းပို့ပြီးပါပြီ၊ ပယ်ဖျက်၍မရပါ", true);
    return;
  }
  if (tx.status === "disputed") {
    await answerCb(cbId, "❌ အငြင်းပွားမှု ရှိနေပါသည်", true);
    return;
  }

  await supabase.from("transactions").update({ status: "cancelled" }).eq("id", txId);
  await answerCb(cbId, "❌ ပယ်ဖျက်ပြီး!");

  await editText(
    chatId,
    msgId,
    `❌ *ပယ်ဖျက်ပြီး*

📦 ${tx.products?.title}`,
    backBtn(),
  );
}

// ==================== ADMIN DISPUTE RESOLUTION ====================
async function handleAdminDisputeResolve(
  chatId: number,
  msgId: number,
  txLink: string,
  resolution: "completed" | "cancelled",
  cbId: string,
  telegramId: number,
) {
  // Verify this user is an admin by checking admin_telegram_id setting
  const { data: adminSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "admin_telegram_id")
    .maybeSingle();

  const adminTelegramId = adminSetting?.value ? parseInt(adminSetting.value) : null;

  if (!adminTelegramId || telegramId !== adminTelegramId) {
    await answerCb(cbId, "❌ Admin သာ ဖြေရှင်းနိုင်ပါသည်", true);
    return;
  }

  // Find the disputed transaction by unique_link
  const { data: tx } = await supabase
    .from("transactions")
    .select(
      "*, products(*), buyer:profiles!transactions_buyer_id_fkey(*), seller:profiles!transactions_seller_id_fkey(*)",
    )
    .eq("unique_link", txLink)
    .single();

  if (!tx) {
    await answerCb(cbId, "❌ ရောင်းဝယ်မှု ရှာမတွေ့ပါ", true);
    return;
  }

  if (tx.status !== "disputed") {
    await answerCb(cbId, "❌ အငြင်းပွားမှု status မဟုတ်တော့ပါ", true);
    return;
  }

  if (resolution === "completed") {
    // Resolve in favor of seller - credit seller and complete transaction
    await supabase
      .from("transactions")
      .update({
        status: "completed",
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", tx.id);

    // Credit seller
    if (tx.seller) {
      const newBal = Number(tx.seller.balance) + Number(tx.seller_receives_ton);
      await supabase.from("profiles").update({ balance: newBal }).eq("id", tx.seller.id);

      // Notify seller
      if (tx.seller.telegram_id) {
        await sendMessage(
          tx.seller.telegram_id,
          `✅ *အငြင်းပွားမှု ဖြေရှင်းပြီး - သင့်ဘက်မှ အနိုင်ရပါပြီ!*

╔══════════════════════════════╗
║                              ║
║    ✅ *DISPUTE RESOLVED*     ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
💰 ရရှိသောငွေ: *+${Number(tx.seller_receives_ton).toFixed(4)} TON*
━━━━━━━━━━━━━━━━━━━━━━━━━

💳 သင့် Balance သို့ ထည့်သွင်းပြီးပါပြီ
📤 ငွေထုတ်လိုပါက "ငွေထုတ်" ရွေးပါ`,
          backBtn(),
        );
      }
    }

    // Notify buyer
    if (tx.buyer?.telegram_id) {
      await sendMessage(
        tx.buyer.telegram_id,
        `⚖️ *အငြင်းပွားမှု ဖြေရှင်းပြီး*

╔══════════════════════════════╗
║                              ║
║    ⚖️ *DISPUTE RESOLVED*     ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
💵 *${tx.amount_ton} TON*
━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Admin ဆုံးဖြတ်ချက်: ရောင်းသူထံ ငွေလွှဲပြီးပါပြီ
ကျေးဇူးတင်ပါသည် 🙏`,
        backBtn(),
      );
    }

    await answerCb(cbId, "✅ ရောင်းသူထံ ငွေလွှဲပြီး!");

    await editText(
      chatId,
      msgId,
      `✅ *အငြင်းပွားမှု ဖြေရှင်းပြီး!*

╔══════════════════════════════╗
║                              ║
║    ✅ *RESOLVED - SELLER*    ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
💵 *${tx.amount_ton} TON*
━━━━━━━━━━━━━━━━━━━━━━━━━

💰 ရောင်းသူထံ *${Number(tx.seller_receives_ton).toFixed(4)} TON* လွှဲပြီးပါပြီ
✅ ဝယ်သူ နှင့် ရောင်းသူ နှစ်ဦးလုံးကို အကြောင်းကြားပြီးပါပြီ`,
    );
  } else {
    // Resolve in favor of buyer - refund buyer and cancel transaction
    await supabase
      .from("transactions")
      .update({
        status: "cancelled",
      })
      .eq("id", tx.id);

    // Refund buyer's balance
    if (tx.buyer) {
      const newBal = Number(tx.buyer.balance) + Number(tx.amount_ton);
      await supabase.from("profiles").update({ balance: newBal }).eq("id", tx.buyer.id);

      // Notify buyer
      if (tx.buyer.telegram_id) {
        await sendMessage(
          tx.buyer.telegram_id,
          `✅ *အငြင်းပွားမှု ဖြေရှင်းပြီး - သင့်ငွေ ပြန်အမ်းပြီး!*

╔══════════════════════════════╗
║                              ║
║    ✅ *REFUND COMPLETE*      ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
💰 ပြန်အမ်းငွေ: *+${Number(tx.amount_ton).toFixed(4)} TON*
━━━━━━━━━━━━━━━━━━━━━━━━━

💳 သင့် Balance သို့ ပြန်ထည့်ပေးပြီးပါပြီ
ကျေးဇူးတင်ပါသည် 🙏`,
          backBtn(),
        );
      }
    }

    // Notify seller
    if (tx.seller?.telegram_id) {
      await sendMessage(
        tx.seller.telegram_id,
        `⚖️ *အငြင်းပွားမှု ဖြေရှင်းပြီး*

╔══════════════════════════════╗
║                              ║
║    ⚖️ *DISPUTE RESOLVED*     ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
💵 *${tx.amount_ton} TON*
━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Admin ဆုံးဖြတ်ချက်: ဝယ်သူထံ ငွေပြန်အမ်းပြီးပါပြီ
အရောင်းအဝယ် ပယ်ဖျက်ခံရပါပြီ`,
        backBtn(),
      );
    }

    await answerCb(cbId, "✅ ဝယ်သူထံ ငွေပြန်အမ်းပြီး!");

    await editText(
      chatId,
      msgId,
      `✅ *အငြင်းပွားမှု ဖြေရှင်းပြီး!*

╔══════════════════════════════╗
║                              ║
║    ✅ *RESOLVED - BUYER*     ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
📦 *${tx.products?.title}*
💵 *${tx.amount_ton} TON*
━━━━━━━━━━━━━━━━━━━━━━━━━

💰 ဝယ်သူထံ *${Number(tx.amount_ton).toFixed(4)} TON* ပြန်အမ်းပြီးပါပြီ
✅ ဝယ်သူ နှင့် ရောင်းသူ နှစ်ဦးလုံးကို အကြောင်းကြားပြီးပါပြီ`,
    );
  }
}

// ==================== ADMIN MMK WITHDRAWAL RESOLUTION ====================
async function handleAdminMMKWithdrawalResolve(
  chatId: number,
  msgId: number,
  withdrawalId: string,
  resolution: "approved" | "rejected",
  cbId: string,
  telegramId: number,
) {
  // Verify this user is an admin by checking admin_telegram_id setting
  const { data: adminSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "admin_telegram_id")
    .maybeSingle();

  const adminTelegramId = adminSetting?.value ? parseInt(adminSetting.value) : null;

  if (!adminTelegramId || telegramId !== adminTelegramId) {
    await answerCb(cbId, "❌ Admin သာ ဖြေရှင်းနိုင်ပါသည်", true);
    return;
  }

  // Find the withdrawal
  const { data: withdrawal } = await supabase
    .from("withdrawals")
    .select("*, profile:profiles!withdrawals_profile_id_fkey(*)")
    .eq("id", withdrawalId)
    .single();

  if (!withdrawal) {
    await answerCb(cbId, "❌ ငွေထုတ်ယူမှု ရှာမတွေ့ပါ", true);
    return;
  }

  if (withdrawal.status !== "pending") {
    await answerCb(cbId, "❌ ငွေထုတ်ယူမှု pending status မဟုတ်တော့ပါ", true);
    return;
  }

  const methodName = withdrawal.payment_method === "KBZPAY" ? "KBZPay" : "WavePay";
  const methodIcon = withdrawal.payment_method === "KBZPAY" ? "📱" : "📲";
  const amount = Number(withdrawal.amount_ton);

  if (resolution === "approved") {
    // Deduct balance and approve withdrawal
    const currentBalance = Number(withdrawal.profile?.balance_mmk) || 0;
    const newBalance = currentBalance - amount;

    await supabase.from("profiles").update({ balance_mmk: newBalance }).eq("id", withdrawal.profile_id);
    await supabase
      .from("withdrawals")
      .update({
        status: "approved",
        processed_at: new Date().toISOString(),
      })
      .eq("id", withdrawalId);

    // Notify user
    if (withdrawal.profile?.telegram_id) {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/notify-user`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            type: "mmk_withdrawal_approved",
            telegram_id: withdrawal.profile.telegram_id,
            amount: amount,
            destination_wallet: withdrawal.destination_wallet,
            payment_method: withdrawal.payment_method,
            new_balance: newBalance,
          }),
        });
      } catch (e) {
        console.error("Failed to notify user about MMK withdrawal approval:", e);
      }
    }

    await answerCb(cbId, "✅ အတည်ပြုပြီး!");

    await editText(
      chatId,
      msgId,
      `✅ *MMK ငွေထုတ်ယူမှု အတည်ပြုပြီး!*

╔══════════════════════════════╗
║                              ║
║   ${methodIcon} *WITHDRAWAL APPROVED*  ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
💵 *ပမာဏ:* ${amount.toLocaleString()} MMK
${methodIcon} *Payment:* ${methodName}
📱 *Phone:* \`${withdrawal.destination_wallet}\`
👤 *User:* ${withdrawal.profile?.telegram_username ? `@${withdrawal.profile.telegram_username}` : "Unknown"}
━━━━━━━━━━━━━━━━━━━━━━━━━

✅ User ထံ အကြောင်းကြားပြီးပါပြီ`,
    );
  } else {
    // Reject withdrawal (don't deduct balance)
    await supabase
      .from("withdrawals")
      .update({
        status: "rejected",
        processed_at: new Date().toISOString(),
        admin_notes: (withdrawal.admin_notes || "") + " | Rejected by admin",
      })
      .eq("id", withdrawalId);

    // Notify user
    if (withdrawal.profile?.telegram_id) {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/notify-user`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            type: "mmk_withdrawal_rejected",
            telegram_id: withdrawal.profile.telegram_id,
            amount: amount,
            destination_wallet: withdrawal.destination_wallet,
            payment_method: withdrawal.payment_method,
            new_balance: Number(withdrawal.profile.balance_mmk) || 0,
          }),
        });
      } catch (e) {
        console.error("Failed to notify user about MMK withdrawal rejection:", e);
      }
    }

    await answerCb(cbId, "❌ ငြင်းပယ်ပြီး!");

    await editText(
      chatId,
      msgId,
      `❌ *MMK ငွေထုတ်ယူမှု ငြင်းပယ်ပြီး*

╔══════════════════════════════╗
║                              ║
║   ${methodIcon} *WITHDRAWAL REJECTED*  ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
💵 *ပမာဏ:* ${amount.toLocaleString()} MMK
${methodIcon} *Payment:* ${methodName}
📱 *Phone:* \`${withdrawal.destination_wallet}\`
👤 *User:* ${withdrawal.profile?.telegram_username ? `@${withdrawal.profile.telegram_username}` : "Unknown"}
━━━━━━━━━━━━━━━━━━━━━━━━━

❌ User ထံ အကြောင်းကြားပြီးပါပြီ`,
    );
  }
}

// ==================== ADMIN MMK DEPOSIT RESOLUTION ====================
async function handleAdminMMKDepositResolve(
  chatId: number,
  msgId: number,
  depositId: string,
  resolution: "approved" | "rejected",
  cbId: string,
  telegramId: number,
) {
  // Verify this user is an admin by checking admin_telegram_id setting
  const { data: adminSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "admin_telegram_id")
    .maybeSingle();

  const adminTelegramId = adminSetting?.value ? parseInt(adminSetting.value) : null;

  if (!adminTelegramId || telegramId !== adminTelegramId) {
    await answerCb(cbId, "❌ Admin သာ ဖြေရှင်းနိုင်ပါသည်", true);
    return;
  }

  // Find the deposit
  const { data: deposit } = await supabase
    .from("deposits")
    .select("*, profile:profiles!deposits_profile_id_fkey(*)")
    .eq("id", depositId)
    .single();

  if (!deposit) {
    await answerCb(cbId, "❌ ငွေသွင်းမှု ရှာမတွေ့ပါ", true);
    return;
  }

  if (deposit.status !== "pending") {
    await answerCb(cbId, "❌ ငွေသွင်းမှု pending status မဟုတ်တော့ပါ", true);
    return;
  }

  const methodName = deposit.payment_method === "KBZPAY" ? "KBZPay" : "WavePay";
  const methodIcon = deposit.payment_method === "KBZPAY" ? "📱" : "📲";
  const amount = Number(deposit.amount_ton);

  if (resolution === "approved") {
    // Credit balance and approve deposit
    const currentBalance = Number(deposit.profile?.balance_mmk) || 0;
    const newBalance = currentBalance + amount;

    await supabase.from("profiles").update({ balance_mmk: newBalance }).eq("id", deposit.profile_id);
    await supabase
      .from("deposits")
      .update({
        status: "confirmed",
        is_confirmed: true,
        confirmed_at: new Date().toISOString(),
        admin_approved_at: new Date().toISOString(),
      })
      .eq("id", depositId);

    // Notify user
    if (deposit.profile?.telegram_id) {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/notify-user`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            type: "mmk_deposit_approved",
            telegram_id: deposit.profile.telegram_id,
            amount: amount,
            unique_code: deposit.unique_code,
            payment_method: deposit.payment_method,
            new_balance: newBalance,
          }),
        });
      } catch (e) {
        console.error("Failed to notify user about MMK deposit approval:", e);
      }
    }

    await answerCb(cbId, "✅ အတည်ပြုပြီး!");

    await editText(
      chatId,
      msgId,
      `✅ *MMK ငွေသွင်းမှု အတည်ပြုပြီး!*

╔══════════════════════════════╗
║                              ║
║   ${methodIcon} *DEPOSIT APPROVED*     ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
💵 *ပမာဏ:* ${amount.toLocaleString()} MMK
${methodIcon} *Payment:* ${methodName}
🔑 *Code:* \`${deposit.unique_code || "N/A"}\`
👤 *User:* ${deposit.profile?.telegram_username ? `@${deposit.profile.telegram_username}` : "Unknown"}
━━━━━━━━━━━━━━━━━━━━━━━━━

💰 User Balance သို့ ထည့်သွင်းပြီးပါပြီ
✅ User ထံ အကြောင်းကြားပြီးပါပြီ`,
    );
  } else {
    // Reject deposit (don't credit balance)
    await supabase
      .from("deposits")
      .update({
        status: "rejected",
        admin_notes: "Rejected by admin",
      })
      .eq("id", depositId);

    // Notify user
    if (deposit.profile?.telegram_id) {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/notify-user`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            type: "mmk_deposit_rejected",
            telegram_id: deposit.profile.telegram_id,
            amount: amount,
            unique_code: deposit.unique_code,
            payment_method: deposit.payment_method,
          }),
        });
      } catch (e) {
        console.error("Failed to notify user about MMK deposit rejection:", e);
      }
    }

    await answerCb(cbId, "❌ ငြင်းပယ်ပြီး!");

    await editText(
      chatId,
      msgId,
      `❌ *MMK ငွေသွင်းမှု ငြင်းပယ်ပြီး*

╔══════════════════════════════╗
║                              ║
║   ${methodIcon} *DEPOSIT REJECTED*     ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━
💵 *ပမာဏ:* ${amount.toLocaleString()} MMK
${methodIcon} *Payment:* ${methodName}
🔑 *Code:* \`${deposit.unique_code || "N/A"}\`
👤 *User:* ${deposit.profile?.telegram_username ? `@${deposit.profile.telegram_username}` : "Unknown"}
━━━━━━━━━━━━━━━━━━━━━━━━━

❌ User ထံ အကြောင်းကြားပြီးပါပြီ`,
    );
  }
}

// ==================== MAIN HANDLERS ====================
async function handleMessage(msg: {
  chat: { id: number };
  from?: { username?: string };
  text?: string;
  message_id: number;
  photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number }>;
}) {
  const chatId = msg.chat.id;
  const username = msg.from?.username;
  const text = msg.text?.trim() || "";
  const inMsgId = msg.message_id;

  console.log(`[${chatId}] ${text}`);
  if (isRateLimited(chatId)) return;

  // Check if user is blocked
  const blockCheck = await isUserBlocked(chatId);
  if (blockCheck.blocked) {
    const reason = blockCheck.reason ? `\n\n📝 *အကြောင်းပြချက်:* ${blockCheck.reason}` : "";
    await sendMessage(chatId, BLOCKED_MESSAGE + reason);
    return;
  }

  // Commands
  if (text === "/start" || text.startsWith("/start ")) {
    const parts = text.split(" ");
    if (parts[1]?.startsWith("buy_")) {
      await handleBuyLink(chatId, parts[1].replace("buy_", ""), username);
    } else if (parts[1]?.startsWith("ref_")) {
      // Handle referral link - new user joining via referral
      const referralCode = parts[1].replace("ref_", "");
      await getProfile(chatId, username, referralCode); // Pass referral code to getProfile
      await showHome(chatId, undefined, username);
    } else {
      await showHome(chatId, undefined, username);
    }
    await deleteUserState(chatId);
    return;
  }

  // /ping - Check if bot is alive
  if (text === "/ping") {
    await sendMessage(
      chatId,
      `🟢 *Bot Alive!*

━━━━━━━━━━━━━━━
✅ Status: Online
⚡ Response: Fast
🕐 Time: ${new Date().toISOString()}
━━━━━━━━━━━━━━━

Bot ကောင်းစွာအလုပ်လုပ်နေပါသည်!`,
      backBtn(),
    );
    return;
  }

  // /help - Show help commands
  if (text === "/help") {
    await sendMessage(
      chatId,
      `📚 *Bot Commands*

━━━━━━━━━━━━━━━
/start - 🏠 ပင်မစာမျက်နှာ
/ping - 🟢 Bot Alive စစ်ဆေးရန်
/balance - 💰 လက်ကျန်ငွေ စစ်ရန်
/referral - 🎁 Referral Link & Stats
/sell <အမည်> <ဈေး> - 📦 ရောင်းမယ်
/help - 📚 Commands များ
━━━━━━━━━━━━━━━

💡 *အသုံးပြုပုံ:*
• /sell iPhone 15 150
• /sell hei 1928`,
      backBtn(),
    );
    return;
  }

  // /balance - Check balance
  if (text === "/balance") {
    const profile = await getProfile(chatId, username);
    const balance = Number(profile?.balance || 0);
    await sendMessage(
      chatId,
      `💰 *လက်ကျန်ငွေ*

━━━━━━━━━━━━━━━
💳 *Balance:* ${balance.toFixed(4)} TON
━━━━━━━━━━━━━━━`,
      backBtn(),
    );
    return;
  }

  // /referral - Show referral link and stats
  if (text === "/referral") {
    // Use showReferral function for consistency
    const msgId = await sendMessage(chatId, "⏳ Loading...", backBtn());
    if (msgId) await showReferral(chatId, msgId, username);
    return;
  }

  // Handle /sell command: /sell <title> <price>
  if (text.startsWith("/sell ")) {
    const sellText = text.replace("/sell ", "").trim();
    const lastSpaceIdx = sellText.lastIndexOf(" ");

    if (lastSpaceIdx > 0) {
      const title = sellText.substring(0, lastSpaceIdx).trim();
      const priceStr = sellText.substring(lastSpaceIdx + 1).trim();
      const price = parseFloat(priceStr);

      if (title && !isNaN(price) && price > 0) {
        await handleCreateProductDirect(chatId, title, price, username);
        return;
      }
    }

    // Show usage if format is wrong
    await sendMessage(
      chatId,
      `❌ *ပုံစံမှား*

━━━━━━━━━━━━━━━
*မှန်ကန်သောပုံစံ:*
\`/sell <ပစ္စည်းအမည်> <ဈေး>\`

*ဥပမာ:*
\`/sell iPhone 15 Pro 150\`
\`/sell hei 1928\`
━━━━━━━━━━━━━━━`,
      backBtn(),
    );
    return;
  }

  if (text.startsWith("/")) {
    await showHome(chatId, undefined, username);
    await deleteUserState(chatId);
    return;
  }

  // All navigation is via inline keyboard callbacks - no text keyboard handlers needed

  // Handle photo upload for MMK deposit screenshot
  if (msg.photo && msg.photo.length > 0) {
    const state = await getUserState(chatId);
    if (state?.action === "dep_mmk_screenshot" && state.data?.uniqueCode) {
      await handleMMKDepositScreenshot(chatId, msg.photo, state.data, username);
      await deleteMsg(chatId, inMsgId);
      return;
    }
  }

  // State handling
  const state = await getUserState(chatId);

  // Step-by-step sell flow
  if (state?.action === "sell_title" && state.msgId) {
    await handleSellTitle(chatId, text, state.msgId, username);
    await deleteMsg(chatId, inMsgId);
    return;
  }

  if (state?.action === "sell_price" && state.msgId) {
    await handleSellPrice(chatId, text, state.msgId, username);
    await deleteMsg(chatId, inMsgId);
    return;
  }

  if (state?.action === "wd_wallet" && state.msgId) {
    await handleWithdrawRequest(chatId, text, state.msgId, username);
    await deleteMsg(chatId, inMsgId);
    return;
  }

  // Custom withdrawal amount input
  if (state?.action === "wd_custom" && state.msgId) {
    const amount = parseFloat(text);
    const balance = Number(state.data?.balance) || 0;
    const minWithdrawal = Number(state.data?.minWithdrawal) || 0.01;

    if (!isNaN(amount) && amount >= minWithdrawal && amount <= balance) {
      await showWithdrawWalletPrompt(chatId, state.msgId, amount);
      await deleteMsg(chatId, inMsgId);
      return;
    } else if (amount < minWithdrawal) {
      await editText(
        chatId,
        state.msgId,
        `❌ *အနည်းဆုံး ပမာဏ: ${minWithdrawal} TON*\n\nထုတ်ယူလိုသော ပမာဏ ထပ်ရိုက်ပါ:`,
        cancelBtn(),
      );
      await deleteMsg(chatId, inMsgId);
      return;
    } else if (amount > balance) {
      await editText(
        chatId,
        state.msgId,
        `❌ *လက်ကျန်ငွေ မလုံလောက်ပါ*\n\nလက်ကျန်: ${balance.toFixed(4)} TON\n\nထုတ်ယူလိုသော ပမာဏ ထပ်ရိုက်ပါ:`,
        cancelBtn(),
      );
      await deleteMsg(chatId, inMsgId);
      return;
    }
  }

  // MMK custom withdrawal amount input
  if (state?.action === "wm_custom" && state.msgId) {
    const amount = parseInt(text);
    const balance = Number(state.data?.balance) || 0;
    const minWithdrawal = 1000; // Minimum 1000 MMK

    if (!isNaN(amount) && amount >= minWithdrawal && amount <= balance) {
      await showWithdrawMMKMethod(chatId, state.msgId, amount, username);
      await deleteMsg(chatId, inMsgId);
      return;
    } else if (amount < minWithdrawal) {
      await editText(
        chatId,
        state.msgId,
        `❌ *အနည်းဆုံး ပမာဏ: ${minWithdrawal.toLocaleString()} MMK*\n\nထုတ်ယူလိုသော ပမာဏ ထပ်ရိုက်ပါ:`,
        cancelBtn(),
      );
      await deleteMsg(chatId, inMsgId);
      return;
    } else if (amount > balance) {
      await editText(
        chatId,
        state.msgId,
        `❌ *လက်ကျန်ငွေ မလုံလောက်ပါ*\n\nလက်ကျန်: ${balance.toLocaleString()} MMK\n\nထုတ်ယူလိုသော ပမာဏ ထပ်ရိုက်ပါ:`,
        cancelBtn(),
      );
      await deleteMsg(chatId, inMsgId);
      return;
    }
  }

  // TON custom withdrawal amount input
  if (state?.action === "wt_custom" && state.msgId) {
    const amount = parseFloat(text);
    const balance = Number(state.data?.balance) || 0;
    const minWithdrawal = 0.5; // Minimum 0.5 TON

    if (!isNaN(amount) && amount >= minWithdrawal && amount <= balance) {
      await showWithdrawWalletPrompt(chatId, state.msgId, amount);
      await deleteMsg(chatId, inMsgId);
      return;
    } else if (amount < minWithdrawal) {
      await editText(
        chatId,
        state.msgId,
        `❌ *အနည်းဆုံး ပမာဏ: ${minWithdrawal} TON*\n\nထုတ်ယူလိုသော ပမာဏ ထပ်ရိုက်ပါ:`,
        cancelBtn(),
      );
      await deleteMsg(chatId, inMsgId);
      return;
    } else if (amount > balance) {
      await editText(
        chatId,
        state.msgId,
        `❌ *လက်ကျန်ငွေ မလုံလောက်ပါ*\n\nလက်ကျန်: ${balance.toFixed(4)} TON\n\nထုတ်ယူလိုသော ပမာဏ ထပ်ရိုက်ပါ:`,
        cancelBtn(),
      );
      await deleteMsg(chatId, inMsgId);
      return;
    }
  }

  // MMK withdrawal account name input (step 1)
  if (state?.action === "wm_account_name" && state.msgId) {
    const accountName = text.trim().substring(0, 100);
    if (!accountName || accountName.length < 2) {
      await editText(chatId, state.msgId, `❌ *အကောင့်နာမည် မှားနေပါသည်*\n\nအကောင့်နာမည် ထပ်ရိုက်ပါ:`, cancelBtn());
      await deleteMsg(chatId, inMsgId);
      return;
    }
    const stateData = state.data as { amount?: number; paymentMethod?: string } | undefined;
    const amount = Number(stateData?.amount) || 0;
    const paymentMethod = String(stateData?.paymentMethod || "KBZPAY");
    await showWithdrawMMKPhonePrompt(chatId, state.msgId, amount, paymentMethod, accountName, username);
    await deleteMsg(chatId, inMsgId);
    return;
  }

  // MMK withdrawal phone number input (step 2)
  if (state?.action === "wm_phone" && state.msgId) {
    await handleMMKWithdrawRequest(chatId, text, state.msgId, username);
    await deleteMsg(chatId, inMsgId);
    return;
  }

  if (state?.action === "dep_custom" && state.msgId) {
    const amount = parseFloat(text);
    if (!isNaN(amount) && amount > 0) {
      await showDepositQR(chatId, state.msgId, amount, username);
      await deleteMsg(chatId, inMsgId);
      return;
    }
  }

  // Rating comment input
  if (state?.action === "rating_comment" && state.msgId && state.data?.ratingId) {
    const ratingId = String(state.data.ratingId);
    const ratingNum = Number(state.data.rating) || 5;
    await handleRatingComment(chatId, text, state.msgId, ratingId, ratingNum);
    await deleteMsg(chatId, inMsgId);
    return;
  }

  await showHome(chatId, undefined, username);
}

async function handleCallback(cb: {
  id: string;
  from: { id: number; username?: string };
  data?: string;
  message?: { chat: { id: number }; message_id: number };
}) {
  const chatId = cb.message?.chat.id;
  const msgId = cb.message?.message_id;
  const data = cb.data || "";
  const telegramId = cb.from.id;
  const username = cb.from.username;

  if (!chatId || !msgId) {
    await answerCb(cb.id);
    return;
  }
  console.log(`[${chatId}] CB: ${data}`);
  if (isRateLimited(chatId)) {
    await answerCb(cb.id, "ခဏစောင့်ပါ...");
    return;
  }

  // Check if user is blocked
  const blockCheck = await isUserBlocked(telegramId);
  if (blockCheck.blocked) {
    await answerCb(cb.id, "🚫 သင့်အကောင့် ပိတ်ထားပါသည်", true);
    return;
  }

  const [type, action, id] = data.split(":");

  // Menu
  if (type === "m") {
    await answerCb(cb.id);
    switch (action) {
      case "home":
        await showHome(chatId, msgId, username);
        break;
      case "sell":
        await showSellPrompt(chatId, msgId, username);
        break;
      case "dep":
        await showDepositOptions(chatId, msgId, username);
        break;
      case "wd":
        await showWithdrawOptions(chatId, msgId, username);
        break;
      case "bal":
        await showBalance(chatId, msgId, username);
        break;
      case "ord":
        await showOrders(chatId, msgId, username);
        break;
      case "mylinks":
        await showMyLinks(chatId, msgId, username);
        break;
      case "hist":
        await showHistory(chatId, msgId, username);
        break;
      case "rating":
        await showMyRating(chatId, msgId, username);
        break;
      case "ref":
        await showReferral(chatId, msgId, username);
        break;
      case "help":
        await showHelp(chatId, msgId);
        break;
      case "lang":
        await showLanguageSelect(chatId, msgId, username);
        break;
    }
    return;
  }

  // Language selection
  if (type === "lang") {
    await answerCb(cb.id);
    const newLang = action as Language;
    if (newLang === "my" || newLang === "en") {
      const profile = await getProfile(telegramId, username);
      await supabase.from("profiles").update({ language: newLang }).eq("id", profile.id);
      await sendMessage(chatId, t(newLang, "lang.changed"));
      await showHome(chatId, msgId, username);
    }
    return;
  }

  // Sell currency selection
  if (type === "sc") {
    await answerCb(cb.id);
    const currency = action; // TON or MMK
    if (currency === "TON" || currency === "MMK") {
      await showSellTitlePrompt(chatId, msgId, currency, username);
    }
    return;
  }

  // Deposit payment method selection
  if (type === "dpm") {
    await answerCb(cb.id);
    const method = action; // TON, KBZPAY, WAVEPAY
    if (method === "TON") {
      await showDepositTONAmounts(chatId, msgId, username);
    } else {
      await showDepositMMKAmounts(chatId, msgId, method, username);
    }
    return;
  }

  // TON deposit amounts
  if (type === "dt") {
    await answerCb(cb.id);
    if (action === "custom") {
      await setUserState(chatId, { action: "dep_ton_custom", msgId, data: { currency: "TON" } });
      await editText(
        chatId,
        msgId,
        `💎 *TON စိတ်ကြိုက် ပမာဏ*

သွင်းလိုသော TON ပမာဏ ရိုက်ထည့်ပါ:
ဥပမာ: \`25.5\``,
        cancelBtn(),
      );
    } else {
      const amt = parseFloat(action);
      if (!isNaN(amt)) await showDepositQR(chatId, msgId, amt, username);
    }
    return;
  }

  // MMK deposit amounts
  if (type === "dm") {
    await answerCb(cb.id);
    const state = await getUserState(chatId);
    const paymentMethod = state?.data?.paymentMethod || "KBZPAY";

    if (action === "custom") {
      await setUserState(chatId, { action: "dep_mmk_custom", msgId, data: { currency: "MMK", paymentMethod } });
      await editText(
        chatId,
        msgId,
        `💵 *MMK စိတ်ကြိုက် ပမာဏ*

သွင်းလိုသော MMK ပမာဏ ရိုက်ထည့်ပါ:
ဥပမာ: \`50000\``,
        cancelBtn(),
      );
    } else {
      const amt = parseInt(action);
      if (!isNaN(amt)) await showDepositMMKInstructions(chatId, msgId, amt, paymentMethod as string, username);
    }
    return;
  }

  // Withdraw currency selection
  if (type === "wc") {
    await answerCb(cb.id);
    if (action === "TON") {
      await showWithdrawTONAmounts(chatId, msgId, username);
    } else if (action === "MMK") {
      await showWithdrawMMKAmounts(chatId, msgId, username);
    }
    return;
  }

  // TON withdraw amounts
  if (type === "wt") {
    await answerCb(cb.id);
    if (action === "custom") {
      const profile = await getProfile(telegramId, username);
      const balance = Number(profile.balance);
      const { data: commSetting } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "commission_rate")
        .maybeSingle();
      const commRate = commSetting ? parseFloat(commSetting.value) : 5;

      await setUserState(chatId, { action: "wt_custom", msgId, data: { balance, commRate, currency: "TON" } });
      await editText(
        chatId,
        msgId,
        `💎 *TON စိတ်ကြိုက် ပမာဏ*

━━━━━━━━━━━━━━━
💳 လက်ကျန်: *${balance.toFixed(4)} TON*
💰 Commission: *${commRate}%*
━━━━━━━━━━━━━━━

ထုတ်ယူလိုသော TON ပမာဏ ရိုက်ထည့်ပါ:`,
        cancelBtn(),
      );
    } else {
      const amt = parseFloat(action);
      if (!isNaN(amt)) await showWithdrawWalletPrompt(chatId, msgId, amt);
    }
    return;
  }

  // MMK withdraw amounts
  if (type === "wm") {
    await answerCb(cb.id);
    if (action === "custom") {
      const profile = await getProfile(telegramId, username);
      const balance = Number(profile.balance_mmk || 0);
      const { data: commSetting } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "commission_rate")
        .maybeSingle();
      const commRate = commSetting ? parseFloat(commSetting.value) : 5;

      await setUserState(chatId, { action: "wm_custom", msgId, data: { balance, commRate, currency: "MMK" } });
      await editText(
        chatId,
        msgId,
        `💵 *MMK စိတ်ကြိုက် ပမာဏ*

━━━━━━━━━━━━━━━
💳 လက်ကျန်: *${balance.toLocaleString()} MMK*
💰 Commission: *${commRate}%*
━━━━━━━━━━━━━━━

ထုတ်ယူလိုသော MMK ပမာဏ ရိုက်ထည့်ပါ:`,
        cancelBtn(),
      );
    } else {
      const amt = parseInt(action);
      if (!isNaN(amt)) await showWithdrawMMKMethod(chatId, msgId, amt, username);
    }
    return;
  }

  // MMK withdraw method selection
  if (type === "wmm") {
    await answerCb(cb.id);
    const state = await getUserState(chatId);
    const amount = Number(state?.data?.amount) || 0;

    await showWithdrawMMKAccountNamePrompt(chatId, msgId, amount, action, username);
    return;
  }

  // Legacy deposit handler (for backward compatibility)
  if (type === "d") {
    await answerCb(cb.id);
    if (action === "custom") {
      await setUserState(chatId, { action: "dep_ton_custom", msgId, data: { currency: "TON" } });
      await editText(
        chatId,
        msgId,
        `💰 *စိတ်ကြိုက် ပမာဏ*

သွင်းလိုသော ပမာဏ ရိုက်ထည့်ပါ:
ဥပမာ: \`25.5\``,
        cancelBtn(),
      );
    } else {
      const amt = parseInt(action);
      if (!isNaN(amt)) await showDepositQR(chatId, msgId, amt, username);
    }
    return;
  }

  // Legacy withdraw handler (for backward compatibility)
  if (type === "w") {
    await answerCb(cb.id);
    if (action === "custom") {
      const profile = await getProfile(telegramId, username);
      const balance = Number(profile.balance);

      const { data: commSetting } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "commission_rate")
        .maybeSingle();
      const commRate = commSetting ? parseFloat(commSetting.value) : 5;

      const { data: minWdSetting } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "min_withdrawal_amount")
        .maybeSingle();
      const minWithdrawal = minWdSetting ? parseFloat(minWdSetting.value) : 0.01;

      await setUserState(chatId, { action: "wd_custom", msgId, data: { balance, commRate, minWithdrawal } });
      await editText(
        chatId,
        msgId,
        `💸 *စိတ်ကြိုက် ပမာဏ*

━━━━━━━━━━━━━━━
💳 လက်ကျန်: *${balance.toFixed(4)} TON*
💰 Commission: *${commRate}%*
━━━━━━━━━━━━━━━

ထုတ်ယူလိုသော ပမာဏ ရိုက်ထည့်ပါ:
ဥပမာ: \`5.5\`

⚠️ အနည်းဆုံး: ${minWithdrawal} TON
⚠️ အများဆုံး: ${balance.toFixed(4)} TON`,
        cancelBtn(),
      );
    } else {
      const amt = parseFloat(action);
      if (!isNaN(amt)) await showWithdrawWalletPrompt(chatId, msgId, amt);
    }
    return;
  }

  // Actions
  if (type === "a") {
    switch (action) {
      case "sent":
        await handleItemSent(chatId, msgId, id, cb.id, telegramId);
        break;
      case "recv":
        await handleItemReceived(chatId, msgId, id, cb.id, telegramId);
        break;
      case "cfm":
        await handleConfirmReceived(chatId, msgId, id, cb.id, telegramId);
        break;
      case "disp":
        await handleDispute(chatId, msgId, id, cb.id, telegramId);
        break;
      case "cancel":
        await handleCancelTx(chatId, msgId, id, cb.id, telegramId);
        break;
      default:
        await answerCb(cb.id);
    }
    return;
  }

  // Rating callback
  // New: r:<rating>:<txKey>:<role> where txKey is transaction.unique_link (preferred) or tx id, role is 's'|'b'
  // Old (back-compat): r:<rating>:<txId>:<ratedId>
  if (type === "r") {
    const rating = parseInt(action);
    const txKey = id;
    const arg3 = data.split(":")[3] || "";

    const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

    // Backward compatible path (old buttons)
    if (isUuid(txKey) && isUuid(arg3)) {
      if (rating >= 1 && rating <= 5) {
        await handleRating(chatId, msgId, rating, txKey, arg3, cb.id, telegramId);
      } else {
        await answerCb(cb.id, "❌ အမှားဖြစ်ပွားပါသည်", true);
      }
      return;
    }

    const role = arg3;
    if (role !== "s" && role !== "b") {
      await answerCb(cb.id, "❌ အမှားဖြစ်ပွားပါသည်", true);
      return;
    }

    const { data: txRow } = await supabase
      .from("transactions")
      .select("id, seller_id, buyer_id")
      .eq(isUuid(txKey) ? "id" : "unique_link", txKey)
      .maybeSingle();

    const txId = txRow?.id;
    const ratedId = role === "s" ? txRow?.seller_id : txRow?.buyer_id;

    if (rating >= 1 && rating <= 5 && txId && ratedId) {
      await handleRating(chatId, msgId, rating, txId, ratedId, cb.id, telegramId);
    } else {
      await answerCb(cb.id, "❌ အမှားဖြစ်ပွားပါသည်", true);
    }
    return;
  }

  // Admin dispute resolution callback: adm:dcomp|dcanc:<txLink>
  if (type === "adm" && (action === "dcomp" || action === "dcanc")) {
    await handleAdminDisputeResolve(
      chatId,
      msgId,
      id,
      action === "dcomp" ? "completed" : "cancelled",
      cb.id,
      telegramId,
    );
    return;
  }

  // Admin MMK withdrawal approval callback: adm:mwdap|mwdrej:<withdrawalId>
  if (type === "adm" && (action === "mwdap" || action === "mwdrej")) {
    await handleAdminMMKWithdrawalResolve(
      chatId,
      msgId,
      id,
      action === "mwdap" ? "approved" : "rejected",
      cb.id,
      telegramId,
    );
    return;
  }

  // Admin MMK deposit approval callback: adm:mdepap|mdeprej:<depositId>
  if (type === "adm" && (action === "mdepap" || action === "mdeprej")) {
    await handleAdminMMKDepositResolve(
      chatId,
      msgId,
      id,
      action === "mdepap" ? "approved" : "rejected",
      cb.id,
      telegramId,
    );
    return;
  }

  // Buy with balance callback: buy:bal:<txId>
  if (type === "buy" && action === "bal") {
    await handleBuyWithBalance(chatId, msgId, id, cb.id, telegramId, username);
    return;
  }

  // Delete confirmation callback: del:yes|no:<originalMsgId>
  if (type === "del") {
    if (action === "yes") {
      await answerCb(cb.id, "🗑️ ဖျက်ပြီး!");
      await deleteMsg(chatId, msgId);
    } else {
      await answerCb(cb.id, "✅ သိမ်းထားပြီး!");
      await editText(
        chatId,
        msgId,
        `✅ *Message သိမ်းထားပါသည်*

ဤ message ကို ဖျက်မည်မဟုတ်ပါ`,
        backBtn(),
      );
    }
    return;
  }

  // Skip comment callback
  if (data === "skip_comment") {
    const state = await getUserState(chatId);
    if (state?.action === "rating_comment" && state.data?.rating) {
      await deleteUserState(chatId);
      const rating = Number(state.data.rating);
      await answerCb(cb.id, "✅ ကျော်လိုက်ပြီး!");

      const thankYouMsg = `✅ *ကျေးဇူးတင်ပါသည်!*

━━━━━━━━━━━━━━━
${"⭐".repeat(rating)} ${rating}/5
━━━━━━━━━━━━━━━

အဆင့်သတ်မှတ်ပေးသည့်အတွက် ကျေးဇူးပါ 🙏`;

      // Try editText first, if fails (photo message), try editMessageMedia, then sendMessage
      const textEdited = await editText(chatId, msgId, thankYouMsg, backBtn());
      if (!textEdited) {
        const thankQR = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent("THANKS")}&bgcolor=90EE90`;
        const mediaEdited = await editMessageMedia(chatId, msgId, thankQR, thankYouMsg, backBtn());
        if (!mediaEdited) {
          await sendMessage(chatId, thankYouMsg, backBtn());
        }
      }
    } else {
      await answerCb(cb.id);
    }
    return;
  }

  await answerCb(cb.id);
}

// ==================== WEBHOOK VALIDATION ====================
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");

function verifyTelegramRequest(req: Request): boolean {
  // Telegram sends the secret_token in this header when configured
  const secretToken = req.headers.get("x-telegram-bot-api-secret-token");

  // If no secret is configured, reject all requests (fail-closed)
  if (!TELEGRAM_WEBHOOK_SECRET) {
    console.warn("TELEGRAM_WEBHOOK_SECRET not configured - rejecting request");
    return false;
  }

  // Verify the token matches
  if (secretToken !== TELEGRAM_WEBHOOK_SECRET) {
    console.warn("Invalid webhook secret token received");
    return false;
  }

  return true;
}

// ==================== SERVER ====================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // SECURITY: Verify request is from Telegram
    if (!verifyTelegramRequest(req)) {
      console.warn("Unauthorized webhook request rejected");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    console.log("Webhook:", JSON.stringify(body).substring(0, 300));

    // Check maintenance mode first
    const maintenance = await isMaintenanceMode();
    if (maintenance.enabled) {
      // Get chat ID from message or callback
      let chatId: number | null = null;
      if (body.message) chatId = body.message.chat.id;
      else if (body.callback_query) {
        chatId = body.callback_query.message?.chat.id;
        // Answer callback to prevent loading state
        if (body.callback_query.id) {
          await answerCb(body.callback_query.id, "🔧 Bot ပြုပြင်နေဆဲ", true);
        }
      }

      if (chatId) {
        const maintText = `╔══════════════════════════════╗
║                              ║
║     🔧 *MAINTENANCE MODE*    ║
║                              ║
╚══════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━

${maintenance.message}

━━━━━━━━━━━━━━━━━━━━━━━━━

⏳ ခဏစောင့်ဆိုင်းပြီး ပြန်လည်ကြိုးစားပါ`;

        await sendMessage(chatId, maintText);
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.message) await handleMessage(body.message);
    else if (body.callback_query) await handleCallback(body.callback_query);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
