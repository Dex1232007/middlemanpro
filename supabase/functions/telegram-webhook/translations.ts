// ==================== LANGUAGE TRANSLATIONS ====================
export type Language = 'my' | 'en'

export const translations: Record<Language, Record<string, string>> = {
  my: {
    // Main Menu
    'menu.order': '📦 Order ပြုလုပ်မည်',
    'menu.deposit': '💰 ငွေသွင်း',
    'menu.withdraw': '💸 ငွေထုတ်',
    'menu.balance': '💳 လက်ကျန်',
    'menu.orders': '📋 အမှာစာများ',
    'menu.mylinks': '🛍️ ကျွန်ုပ်၏လင့်များ',
    'menu.history': '📜 မှတ်တမ်း',
    'menu.rating': '⭐ ကျွန်ုပ်၏အဆင့်',
    'menu.referral': '🎁 Referral',
    'menu.help': '❓ အကူအညီ',
    'menu.language': '🌐 ဘာသာစကား',
    'menu.home': '🏠 ပင်မစာမျက်နှာ',
    'menu.cancel': '❌ ပယ်ဖျက်',
    'menu.back': '🔙 နောက်သို့',
    
    // Welcome
    'welcome.title': '🎉 *ကြိုဆိုပါသည်!*',
    'welcome.balance': '💳 *လက်ကျန်:*',
    'welcome.balance_ton': 'TON',
    'welcome.balance_mmk': 'MMK',
    'welcome.tagline': '🔐 TON/MMK ဖြင့် လုံခြုံစွာ ရောင်းဝယ်ပါ',
    
    // Deposit
    'deposit.title': '💰 *ငွေသွင်းရန်*',
    'deposit.select_method': '💳 *Payment Method ရွေးပါ:*',
    'deposit.ton_auto': '💎 TON (Auto Credit)',
    'deposit.kbzpay': '📱 KBZPay (Manual)',
    'deposit.wavepay': '📲 WavePay (Manual)',
    'deposit.select_amount': 'သွင်းလိုသော ပမာဏ ရွေးပါ:',
    'deposit.custom': '💰 စိတ်ကြိုက်ပမာဏ',
    'deposit.qr_scan': '📱 QR Scan သို့မဟုတ် Address သို့ ငွေလွှဲပါ။',
    'deposit.memo_required': '⚠️ *Memo မပါရင် ငွေထည့်မရပါ!*',
    'deposit.auto_credit': '💫 ငွေလွှဲပြီး Auto Credit ရရှိမည်',
    'deposit.expiry': '⏰ သက်တမ်း: *၃၀ မိနစ်အတွင်း* ငွေပို့ပါ',
    'deposit.mmk_instructions': '📱 *KBZPay/WavePay ငွေလွှဲနည်း:*',
    'deposit.mmk_step1': '1️⃣ အောက်ပါ Account သို့ ငွေလွှဲပါ',
    'deposit.mmk_step2': '2️⃣ ငွေလွှဲပြီး Screenshot ရိုက်ပါ',
    'deposit.mmk_step3': '3️⃣ Screenshot ကို ဤနေရာမှ ပို့ပါ',
    'deposit.mmk_pending': '⏳ Admin စစ်ဆေးပြီး Credit ပေးပါမည်',
    'deposit.send_screenshot': '📸 *ငွေလွှဲပြီး Screenshot ပို့ပါ:*',
    'deposit.waiting_approval': '⏳ Admin စစ်ဆေးနေပါသည်...',
    'deposit.approved': '✅ ငွေသွင်းမှု အတည်ပြုပြီး!',
    'deposit.rejected': '❌ ငွေသွင်းမှု ငြင်းပယ်ခံရပါပြီ',
    
    // Withdraw
    'withdraw.title': '💸 *ငွေထုတ်ရန်*',
    'withdraw.select_currency': '💳 *ထုတ်ယူမည့် ငွေကြေး ရွေးပါ:*',
    'withdraw.ton_balance': '💎 TON Balance',
    'withdraw.mmk_balance': '💵 MMK Balance',
    'withdraw.select_amount': '📤 ထုတ်ယူလိုသော ပမာဏ ရွေးပါ:',
    'withdraw.all': '💰 အားလုံး',
    'withdraw.custom': '✏️ စိတ်ကြိုက်ပမာဏ',
    'withdraw.enter_wallet': '📱 *သင်၏ TON Wallet လိပ်စာ ထည့်ပါ:*',
    'withdraw.enter_phone': '📱 *သင်၏ KBZPay/WavePay ဖုန်းနံပါတ် ထည့်ပါ:*',
    'withdraw.select_method': '💳 *ထုတ်ယူမည့် နည်းလမ်း ရွေးပါ:*',
    'withdraw.commission': '💰 *Commission:*',
    'withdraw.receive': '✅ *လက်ခံရရှိမည်:*',
    'withdraw.no_balance': '❌ *လက်ကျန်ငွေ မရှိပါ*',
    'withdraw.success': '✅ ငွေထုတ်ယူမှု တင်သွင်းပြီးပါပြီ',
    'withdraw.pending': '⏳ Admin စစ်ဆေးပြီး ပေးပို့ပါမည်',
    
    // Balance
    'balance.title': '💳 *လက်ကျန်ငွေ*',
    'balance.ton': '💎 *TON:*',
    'balance.mmk': '💵 *MMK:*',
    
    // Language
    'lang.title': '🌐 *ဘာသာစကား ရွေးပါ*',
    'lang.current': '📍 *လက်ရှိ:*',
    'lang.myanmar': '🇲🇲 မြန်မာ',
    'lang.english': '🇺🇸 English',
    'lang.changed': '✅ ဘာသာစကား ပြောင်းလဲပြီးပါပြီ!',
    
    // Common
    'common.loading': '⏳ ခဏစောင့်ပါ...',
    'common.error': '❌ အမှားတစ်ခု ဖြစ်ပွားပါပြီ',
    'common.success': '✅ အောင်မြင်ပါပြီ',
    'common.confirm': '✅ အတည်ပြု',
    'common.cancel': '❌ ပယ်ဖျက်',
    'common.amount': 'ပမာဏ',
    'common.phone': 'ဖုန်းနံပါတ်',
    'common.wallet': 'Wallet',
    
    // Terms and Conditions
    'terms.no_username': '⚠️ *Username လိုအပ်ပါသည်*\n\nBot အသုံးပြုရန် Telegram Username သတ်မှတ်ထားရန် လိုအပ်ပါသည်။\n\n📱 *သတ်မှတ်နည်း:*\nTelegram Settings → Edit Profile → Username\n\n✅ Username သတ်မှတ်ပြီးပါက /start ပြန်နှိပ်ပါ။',
    'terms.accept_btn': '✅ လက်ခံပါသည်',
  },
  
  en: {
    // Main Menu
    'menu.order': '📦 Create Order',
    'menu.deposit': '💰 Deposit',
    'menu.withdraw': '💸 Withdraw',
    'menu.balance': '💳 Balance',
    'menu.orders': '📋 My Orders',
    'menu.mylinks': '🛍️ My Links',
    'menu.history': '📜 History',
    'menu.rating': '⭐ My Rating',
    'menu.referral': '🎁 Referral',
    'menu.help': '❓ Help',
    'menu.language': '🌐 Language',
    'menu.home': '🏠 Home',
    'menu.cancel': '❌ Cancel',
    'menu.back': '🔙 Back',
    
    // Welcome
    'welcome.title': '🎉 *Welcome!*',
    'welcome.balance': '💳 *Balance:*',
    'welcome.balance_ton': 'TON',
    'welcome.balance_mmk': 'MMK',
    'welcome.tagline': '🔐 Trade safely with TON/MMK',
    
    // Deposit
    'deposit.title': '💰 *Deposit*',
    'deposit.select_method': '💳 *Select Payment Method:*',
    'deposit.ton_auto': '💎 TON (Auto Credit)',
    'deposit.kbzpay': '📱 KBZPay (Manual)',
    'deposit.wavepay': '📲 WavePay (Manual)',
    'deposit.select_amount': 'Select amount to deposit:',
    'deposit.custom': '💰 Custom Amount',
    'deposit.qr_scan': '📱 Scan QR or send to the address below.',
    'deposit.memo_required': '⚠️ *Memo is required!*',
    'deposit.auto_credit': '💫 Auto credit after payment confirmed',
    'deposit.expiry': '⏰ Expires in *30 minutes*',
    'deposit.mmk_instructions': '📱 *KBZPay/WavePay Transfer:*',
    'deposit.mmk_step1': '1️⃣ Transfer to the account below',
    'deposit.mmk_step2': '2️⃣ Take a screenshot after transfer',
    'deposit.mmk_step3': '3️⃣ Send the screenshot here',
    'deposit.mmk_pending': '⏳ Admin will verify and credit',
    'deposit.send_screenshot': '📸 *Send payment screenshot:*',
    'deposit.waiting_approval': '⏳ Waiting for admin approval...',
    'deposit.approved': '✅ Deposit approved!',
    'deposit.rejected': '❌ Deposit rejected',
    
    // Withdraw
    'withdraw.title': '💸 *Withdraw*',
    'withdraw.select_currency': '💳 *Select currency to withdraw:*',
    'withdraw.ton_balance': '💎 TON Balance',
    'withdraw.mmk_balance': '💵 MMK Balance',
    'withdraw.select_amount': '📤 Select amount to withdraw:',
    'withdraw.all': '💰 All',
    'withdraw.custom': '✏️ Custom Amount',
    'withdraw.enter_wallet': '📱 *Enter your TON Wallet address:*',
    'withdraw.enter_phone': '📱 *Enter your KBZPay/WavePay phone number:*',
    'withdraw.select_method': '💳 *Select withdrawal method:*',
    'withdraw.commission': '💰 *Commission:*',
    'withdraw.receive': '✅ *You will receive:*',
    'withdraw.no_balance': '❌ *No balance available*',
    'withdraw.success': '✅ Withdrawal request submitted',
    'withdraw.pending': '⏳ Admin will process and send',
    
    // Balance
    'balance.title': '💳 *Your Balance*',
    'balance.ton': '💎 *TON:*',
    'balance.mmk': '💵 *MMK:*',
    
    // Language
    'lang.title': '🌐 *Select Language*',
    'lang.current': '📍 *Current:*',
    'lang.myanmar': '🇲🇲 မြန်မာ',
    'lang.english': '🇺🇸 English',
    'lang.changed': '✅ Language changed successfully!',
    
    // Common
    'common.loading': '⏳ Please wait...',
    'common.error': '❌ An error occurred',
    'common.success': '✅ Success',
    'common.confirm': '✅ Confirm',
    'common.cancel': '❌ Cancel',
    'common.amount': 'Amount',
    'common.phone': 'Phone Number',
    'common.wallet': 'Wallet',
    
    // Terms and Conditions
    'terms.no_username': '⚠️ *Username Required*\n\nYou must set a Telegram Username to use this bot.\n\n📱 *How to set:*\nTelegram Settings → Edit Profile → Username\n\n✅ After setting username, press /start again.',
    'terms.accept_btn': '✅ Accept',
  }
}

export function t(lang: Language, key: string, params?: Record<string, string | number>): string {
  let text = translations[lang]?.[key] || translations['my'][key] || key
  
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v))
    }
  }
  
  return text
}
