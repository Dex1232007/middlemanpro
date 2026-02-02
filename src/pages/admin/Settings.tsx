import { useEffect, useState } from 'react';
import { Save, Loader2, Wallet, Percent, Bot, Copy, Check, RefreshCw, CheckCircle, AlertCircle, Key, Eye, EyeOff, Shield, Trash2, Zap, Hand, Send, ArrowUpRight, Gift, Power, Wrench, Clock, Calendar, CreditCard } from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import type { Setting } from '@/types/database';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';

export default function AdminSettings() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [commissionRate, setCommissionRate] = useState('3');
  const [adminWallet, setAdminWallet] = useState('');
  const [minWithdrawal, setMinWithdrawal] = useState('0.01');
  const [copied, setCopied] = useState(false);
  const [isSettingWebhook, setIsSettingWebhook] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<{
    success?: boolean;
    message?: string;
    bot?: string;
  } | null>(null);
  
  // Bot Token states
  const [botToken, setBotToken] = useState('');
  const [showBotToken, setShowBotToken] = useState(false);
  const [isUpdatingToken, setIsUpdatingToken] = useState(false);
  const [maskedToken, setMaskedToken] = useState('');
  const [savedBotUsername, setSavedBotUsername] = useState('');
  const [tokenStatus, setTokenStatus] = useState<{
    success?: boolean;
    message?: string;
    botUsername?: string;
    botName?: string;
  } | null>(null);

  // Mnemonic states
  const [mnemonic, setMnemonic] = useState('');
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [isUpdatingMnemonic, setIsUpdatingMnemonic] = useState(false);
  const [isMnemonicConfigured, setIsMnemonicConfigured] = useState(false);
  const [mnemonicStatus, setMnemonicStatus] = useState<{
    success?: boolean;
    message?: string;
    warning?: string;
  } | null>(null);

  // Withdrawal mode state
  const [withdrawalMode, setWithdrawalMode] = useState<'manual' | 'auto'>('manual');
  const [isUpdatingWithdrawalMode, setIsUpdatingWithdrawalMode] = useState(false);

  // Bot maintenance mode state
  const [botMaintenance, setBotMaintenance] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('🔧 Bot ပြုပြင်နေဆဲ ဖြစ်ပါသည်။ ခဏစောင့်ပါ။');
  const [isUpdatingMaintenance, setIsUpdatingMaintenance] = useState(false);

  // Scheduled maintenance state
  const [scheduledEnabled, setScheduledEnabled] = useState(false);
  const [scheduleStart, setScheduleStart] = useState('');
  const [scheduleEnd, setScheduleEnd] = useState('');
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  // Admin notification state
  const [adminTelegramId, setAdminTelegramId] = useState('');

  // Referral rates state
  const [referralL1Rate, setReferralL1Rate] = useState('5');
  const [referralL2Rate, setReferralL2Rate] = useState('3');
  const [isSavingReferral, setIsSavingReferral] = useState(false);
  const [isSavingAdminTg, setIsSavingAdminTg] = useState(false);

  // MMK Payment Account Settings
  const [kbzpayAccount, setKbzpayAccount] = useState('');
  const [wavepayAccount, setWavepayAccount] = useState('');
  const [isSavingPaymentAccounts, setIsSavingPaymentAccounts] = useState(false);

  // MMK Payment Method Enable/Disable (for deposits and withdrawals)
  const [kbzpayEnabled, setKbzpayEnabled] = useState(true);
  const [wavepayEnabled, setWavepayEnabled] = useState(true);
  const [isTogglingPaymentMethod, setIsTogglingPaymentMethod] = useState(false);

  // Wallet balance states
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  
  // Manual transfer states
  const [transferDestination, setTransferDestination] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferComment, setTransferComment] = useState('');
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferStatus, setTransferStatus] = useState<{
    success?: boolean;
    message?: string;
    txRef?: string;
  } | null>(null);

  // Webhook URL for Telegram
  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-webhook`;

  useEffect(() => {
    fetchSettings();
    fetchMnemonicStatus();
  }, []);

  const fetchMnemonicStatus = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('manage-mnemonic', {
        body: { action: 'get' }
      });
      
      if (!error && data?.success) {
        setIsMnemonicConfigured(data.isConfigured);
        // If configured, also fetch balance
        if (data.isConfigured) {
          fetchWalletBalance();
        }
      }
    } catch (error) {
      console.error('Error fetching mnemonic status:', error);
    }
  };

  const fetchWalletBalance = async () => {
    setIsLoadingBalance(true);
    try {
      const { data, error } = await supabase.functions.invoke('manage-mnemonic', {
        body: { action: 'get_balance' }
      });
      
      if (!error && data?.success) {
        setWalletBalance(data.balance);
        setWalletAddress(data.walletAddress);
      } else {
        console.error('Balance fetch error:', error || data?.error);
      }
    } catch (error) {
      console.error('Error fetching wallet balance:', error);
    } finally {
      setIsLoadingBalance(false);
    }
  };

  const handleManualTransfer = async () => {
    if (!transferDestination.trim()) {
      toast.error('Destination wallet address ထည့်ပါ');
      return;
    }
    if (!transferAmount || parseFloat(transferAmount) <= 0) {
      toast.error('ပမာဏ ထည့်ပါ');
      return;
    }

    const amount = parseFloat(transferAmount);
    if (walletBalance !== null && amount > walletBalance) {
      toast.error(`လက်ကျန်ငွေ မလုံလောက်ပါ (${walletBalance.toFixed(4)} TON)`);
      return;
    }

    if (!confirm(`${amount} TON ကို ${transferDestination.substring(0, 10)}...${transferDestination.slice(-6)} သို့ ပေးပို့မှာ သေချာပါသလား?`)) {
      return;
    }

    setIsTransferring(true);
    setTransferStatus(null);

    try {
      const { data, error } = await supabase.functions.invoke('manage-mnemonic', {
        body: { 
          action: 'transfer',
          destinationWallet: transferDestination.trim(),
          amount: amount,
          comment: transferComment.trim() || 'Admin Transfer'
        }
      });

      if (error) {
        setTransferStatus({ success: false, message: error.message });
        toast.error('Transfer မအောင်မြင်ပါ');
        return;
      }

      if (data.success) {
        setTransferStatus({ 
          success: true, 
          message: data.message,
          txRef: data.txRef
        });
        toast.success(`${amount} TON ပေးပို့ပြီးပါပြီ`);
        setTransferDestination('');
        setTransferAmount('');
        setTransferComment('');
        // Refresh balance after transfer
        setTimeout(() => fetchWalletBalance(), 3000);
      } else {
        setTransferStatus({ success: false, message: data.error });
        toast.error(data.error || 'Transfer မအောင်မြင်ပါ');
      }
    } catch (error) {
      console.error('Transfer error:', error);
      setTransferStatus({ success: false, message: 'နည်းပညာပြဿနာ ဖြစ်ပေါ်နေပါသည်' });
      toast.error('Transfer မအောင်မြင်ပါ');
    } finally {
      setIsTransferring(false);
    }
  };

  const updateMnemonic = async () => {
    if (!mnemonic.trim()) {
      toast.error('Mnemonic ထည့်ပါ');
      return;
    }

    const words = mnemonic.trim().split(/\s+/);
    if (words.length !== 24) {
      toast.error(`Mnemonic သည် 24 words ဖြစ်ရမည် (လက်ရှိ: ${words.length} words)`);
      return;
    }

    setIsUpdatingMnemonic(true);
    setMnemonicStatus(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('manage-mnemonic', {
        body: { action: 'set', mnemonic: mnemonic.trim() }
      });
      
      if (error) {
        console.error('Update mnemonic error:', error);
        setMnemonicStatus({
          success: false,
          message: error.message || 'Mnemonic ပြောင်းလဲမှု မအောင်မြင်ပါ'
        });
        toast.error('Mnemonic ပြောင်းလဲမှု မအောင်မြင်ပါ');
        return;
      }
      
      if (data.success) {
        setMnemonicStatus({
          success: true,
          message: data.message,
          warning: data.warning
        });
        setIsMnemonicConfigured(true);
        setMnemonic('');
        toast.success('Mnemonic သိမ်းဆည်းပြီးပါပြီ');
      } else {
        setMnemonicStatus({
          success: false,
          message: data.error || 'Mnemonic ပြောင်းလဲမှု မအောင်မြင်ပါ'
        });
        toast.error(data.error || 'Mnemonic ပြောင်းလဲမှု မအောင်မြင်ပါ');
      }
    } catch (error) {
      console.error('Error updating mnemonic:', error);
      setMnemonicStatus({
        success: false,
        message: 'နည်းပညာပြဿနာ ဖြစ်ပေါ်နေပါသည်'
      });
      toast.error('Mnemonic ပြောင်းလဲမှု မအောင်မြင်ပါ');
    } finally {
      setIsUpdatingMnemonic(false);
    }
  };

  const deleteMnemonic = async () => {
    if (!confirm('⚠️ Mnemonic ကို ဖျက်မှာ သေချာပါသလား? ဖျက်ပြီးနောက် automated withdrawals အလုပ်မလုပ်တော့ပါ။')) {
      return;
    }

    setIsUpdatingMnemonic(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('manage-mnemonic', {
        body: { action: 'delete' }
      });
      
      if (error) {
        toast.error('Mnemonic ဖျက်မှု မအောင်မြင်ပါ');
        return;
      }
      
      if (data.success) {
        setIsMnemonicConfigured(false);
        setMnemonicStatus(null);
        toast.success('Mnemonic ဖျက်ပြီးပါပြီ');
      }
    } catch (error) {
      console.error('Error deleting mnemonic:', error);
      toast.error('Mnemonic ဖျက်မှု မအောင်မြင်ပါ');
    } finally {
      setIsUpdatingMnemonic(false);
    }
  };

  const fetchSettings = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('*');

      if (error) throw error;
      
      setSettings(data as Setting[] || []);
      
      // Set form values
      const commission = data?.find(s => s.key === 'commission_rate');
      const wallet = data?.find(s => s.key === 'admin_ton_wallet');
      const masked = data?.find(s => s.key === 'telegram_bot_token_masked');
      const botUsernameVal = data?.find(s => s.key === 'bot_username');
      const withdrawMode = data?.find(s => s.key === 'withdrawal_mode');
      const minWd = data?.find(s => s.key === 'min_withdrawal_amount');
      const adminTgId = data?.find(s => s.key === 'admin_telegram_id');
      const refL1 = data?.find(s => s.key === 'referral_l1_rate');
      const refL2 = data?.find(s => s.key === 'referral_l2_rate');
      const botMaint = data?.find(s => s.key === 'bot_maintenance');
      const maintMsg = data?.find(s => s.key === 'maintenance_message');
      const schedEnabled = data?.find(s => s.key === 'scheduled_maintenance_enabled');
      const schedStart = data?.find(s => s.key === 'scheduled_maintenance_start');
      const schedEnd = data?.find(s => s.key === 'scheduled_maintenance_end');
      const kbzpay = data?.find(s => s.key === 'kbzpay_account');
      const wavepay = data?.find(s => s.key === 'wavepay_account');
      const kbzpayEn = data?.find(s => s.key === 'kbzpay_enabled');
      const wavepayEn = data?.find(s => s.key === 'wavepay_enabled');
      
      if (commission) setCommissionRate(commission.value);
      if (wallet) setAdminWallet(wallet.value);
      if (masked) setMaskedToken(masked.value);
      if (botUsernameVal) setSavedBotUsername(botUsernameVal.value);
      if (withdrawMode) setWithdrawalMode(withdrawMode.value as 'manual' | 'auto');
      if (minWd) setMinWithdrawal(minWd.value);
      if (adminTgId) setAdminTelegramId(adminTgId.value);
      if (refL1) setReferralL1Rate(refL1.value);
      if (refL2) setReferralL2Rate(refL2.value);
      if (botMaint) setBotMaintenance(botMaint.value === 'true');
      if (maintMsg) setMaintenanceMessage(maintMsg.value);
      if (schedEnabled) setScheduledEnabled(schedEnabled.value === 'true');
      if (schedStart) setScheduleStart(schedStart.value);
      if (schedEnd) setScheduleEnd(schedEnd.value);
      if (kbzpay) setKbzpayAccount(kbzpay.value);
      if (wavepay) setWavepayAccount(wavepay.value);
      // Payment method enable/disable (default to true if not set)
      setKbzpayEnabled(kbzpayEn ? kbzpayEn.value === 'true' : true);
      setWavepayEnabled(wavepayEn ? wavepayEn.value === 'true' : true);
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const updateBotToken = async () => {
    if (!botToken.trim()) {
      toast.error('Bot Token ထည့်ပါ');
      return;
    }

    setIsUpdatingToken(true);
    setTokenStatus(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('update-bot-token', {
        body: { botToken: botToken.trim() }
      });
      
      if (error) {
        console.error('Update token error:', error);
        setTokenStatus({
          success: false,
          message: error.message || 'Token ပြောင်းလဲမှု မအောင်မြင်ပါ'
        });
        toast.error('Token ပြောင်းလဲမှု မအောင်မြင်ပါ');
        return;
      }
      
      if (data.success) {
        setTokenStatus({
          success: true,
          message: data.message,
          botUsername: data.botUsername,
          botName: data.botName
        });
        setMaskedToken(botToken.substring(0, 10) + '...' + botToken.substring(botToken.length - 5));
        setSavedBotUsername(data.botUsername || '');
        setBotToken('');
        toast.success('Bot Token အတည်ပြုပြီးပါပြီ');
        
        // Show note about updating secret
        if (data.note) {
          toast.info(data.note, { duration: 8000 });
        }
      } else {
        setTokenStatus({
          success: false,
          message: data.error || 'Token ပြောင်းလဲမှု မအောင်မြင်ပါ'
        });
        toast.error(data.error || 'Token ပြောင်းလဲမှု မအောင်မြင်ပါ');
      }
    } catch (error) {
      console.error('Error updating token:', error);
      setTokenStatus({
        success: false,
        message: 'နည်းပညာပြဿနာ ဖြစ်ပေါ်နေပါသည်'
      });
      toast.error('Token ပြောင်းလဲမှု မအောင်မြင်ပါ');
    } finally {
      setIsUpdatingToken(false);
    }
  };

  const saveSettings = async () => {
    setIsSaving(true);
    try {
      // Update commission rate
      const { error: commError } = await supabase
        .from('settings')
        .update({ value: commissionRate })
        .eq('key', 'commission_rate');

      if (commError) throw commError;

      // Update admin wallet
      const { error: walletError } = await supabase
        .from('settings')
        .update({ value: adminWallet })
        .eq('key', 'admin_ton_wallet');

      if (walletError) throw walletError;

      // Update min withdrawal amount
      const { error: minWdError } = await supabase
        .from('settings')
        .upsert({ key: 'min_withdrawal_amount', value: minWithdrawal }, { onConflict: 'key' });

      if (minWdError) throw minWdError;

      toast.success('ဆက်တင်များ သိမ်းဆည်းပြီးပါပြီ');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('သိမ်းဆည်းမှု မအောင်မြင်ပါ');
    } finally {
      setIsSaving(false);
    }
  };

  const saveAdminTelegramId = async () => {
    if (!adminTelegramId.trim()) {
      toast.error('Admin Telegram ID ထည့်ပါ');
      return;
    }

    setIsSavingAdminTg(true);
    try {
      const { error } = await supabase
        .from('settings')
        .upsert({ key: 'admin_telegram_id', value: adminTelegramId.trim() }, { onConflict: 'key' });

      if (error) throw error;
      toast.success('Admin Telegram ID သိမ်းဆည်းပြီးပါပြီ');
    } catch (error) {
      console.error('Error saving admin telegram id:', error);
      toast.error('သိမ်းဆည်းမှု မအောင်မြင်ပါ');
    } finally {
      setIsSavingAdminTg(false);
    }
  };

  const saveReferralRates = async () => {
    setIsSavingReferral(true);
    try {
      const { error: l1Error } = await supabase
        .from('settings')
        .upsert({ key: 'referral_l1_rate', value: referralL1Rate }, { onConflict: 'key' });

      if (l1Error) throw l1Error;

      const { error: l2Error } = await supabase
        .from('settings')
        .upsert({ key: 'referral_l2_rate', value: referralL2Rate }, { onConflict: 'key' });

      if (l2Error) throw l2Error;

      toast.success('Referral Rates သိမ်းဆည်းပြီးပါပြီ');
    } catch (error) {
      console.error('Error saving referral rates:', error);
      toast.error('သိမ်းဆည်းမှု မအောင်မြင်ပါ');
    } finally {
      setIsSavingReferral(false);
    }
  };

  const savePaymentAccounts = async () => {
    setIsSavingPaymentAccounts(true);
    try {
      const { error: kbzError } = await supabase
        .from('settings')
        .upsert({ key: 'kbzpay_account', value: kbzpayAccount, description: 'KBZPay Account Number' }, { onConflict: 'key' });

      if (kbzError) throw kbzError;

      const { error: waveError } = await supabase
        .from('settings')
        .upsert({ key: 'wavepay_account', value: wavepayAccount, description: 'WavePay Account Number' }, { onConflict: 'key' });

      if (waveError) throw waveError;

      toast.success('Payment Account များ သိမ်းဆည်းပြီးပါပြီ');
    } catch (error) {
      console.error('Error saving payment accounts:', error);
      toast.error('သိမ်းဆည်းမှု မအောင်မြင်ပါ');
    } finally {
      setIsSavingPaymentAccounts(false);
    }
  };

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    toast.success('Webhook URL ကူးယူပြီးပါပြီ');
    setTimeout(() => setCopied(false), 2000);
  };

  const setupWebhook = async () => {
    setIsSettingWebhook(true);
    setWebhookStatus(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('admin-setup-webhook');
      
      if (error) {
        console.error('Webhook setup error:', error);
        setWebhookStatus({
          success: false,
          message: error.message || 'Webhook ပြင်ဆင်မှု မအောင်မြင်ပါ'
        });
        toast.error('Webhook ပြင်ဆင်မှု မအောင်မြင်ပါ');
        return;
      }
      
      setWebhookStatus({
        success: data.success,
        message: data.message,
        bot: data.bot
      });
      
      if (data.success) {
        toast.success('Telegram Webhook ပြင်ဆင်ပြီးပါပြီ');
      } else {
        toast.error(data.message || 'Webhook ပြင်ဆင်မှု မအောင်မြင်ပါ');
      }
    } catch (error) {
      console.error('Error setting up webhook:', error);
      setWebhookStatus({
        success: false,
        message: 'နည်းပညာပြဿနာ ဖြစ်ပေါ်နေပါသည်'
      });
      toast.error('Webhook ပြင်ဆင်မှု မအောင်မြင်ပါ');
    } finally {
      setIsSettingWebhook(false);
    }
  };

  if (isLoading) {
    return (
      <AdminLayout title="ဆက်တင်များ" subtitle="စနစ် ပြင်ဆင်မှုများ">
        <div className="space-y-6">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </AdminLayout>
    );
  }

  const toggleBotMaintenance = async (enabled: boolean) => {
    setIsUpdatingMaintenance(true);
    try {
      const { error } = await supabase
        .from('settings')
        .upsert({ key: 'bot_maintenance', value: enabled ? 'true' : 'false' }, { onConflict: 'key' });
      
      if (error) throw error;
      
      setBotMaintenance(enabled);
      toast.success(enabled ? 'Bot ပိတ်ထားပြီး - Maintenance Mode' : 'Bot ဖွင့်ပြီး - Active Mode');

      // Send notification to admin if configured
      if (adminTelegramId) {
        try {
          await supabase.functions.invoke('notify-user', {
            body: {
              telegramId: parseInt(adminTelegramId),
              message: enabled 
                ? `🔧 *MAINTENANCE MODE ON*\n\n━━━━━━━━━━━━━━━\n⚠️ Bot ပိတ်ထားပါပြီ\n━━━━━━━━━━━━━━━\n\n📅 အချိန်: ${new Date().toLocaleString('my-MM')}\n\n💡 User များ bot ကို အသုံးပြု၍မရတော့ပါ`
                : `✅ *BOT ACTIVE*\n\n━━━━━━━━━━━━━━━\n🟢 Bot ပြန်ဖွင့်ပြီး\n━━━━━━━━━━━━━━━\n\n📅 အချိန်: ${new Date().toLocaleString('my-MM')}\n\n💡 User များ ပုံမှန်အတိုင်း အသုံးပြုနိုင်ပါပြီ`
            }
          });
        } catch (notifyError) {
          console.error('Failed to notify admin:', notifyError);
        }
      }
    } catch (error) {
      console.error('Error updating bot maintenance:', error);
      toast.error('ပြောင်းလဲမှု မအောင်မြင်ပါ');
    } finally {
      setIsUpdatingMaintenance(false);
    }
  };

  const saveMaintenanceMessage = async () => {
    try {
      const { error } = await supabase
        .from('settings')
        .upsert({ key: 'maintenance_message', value: maintenanceMessage }, { onConflict: 'key' });
      
      if (error) throw error;
      toast.success('Maintenance message သိမ်းဆည်းပြီး');
    } catch (error) {
      console.error('Error saving maintenance message:', error);
      toast.error('သိမ်းဆည်းမှု မအောင်မြင်ပါ');
    }
  };

  const saveScheduledMaintenance = async () => {
    if (scheduledEnabled && (!scheduleStart || !scheduleEnd)) {
      toast.error('အစချိန်နှင့် အဆုံးချိန် ထည့်ပါ');
      return;
    }

    if (scheduledEnabled && new Date(scheduleStart) >= new Date(scheduleEnd)) {
      toast.error('အဆုံးချိန်သည် အစချိန်ထက် နောက်ကျရမည်');
      return;
    }

    setIsSavingSchedule(true);
    try {
      await supabase.from('settings').upsert({ key: 'scheduled_maintenance_enabled', value: scheduledEnabled ? 'true' : 'false' }, { onConflict: 'key' });
      await supabase.from('settings').upsert({ key: 'scheduled_maintenance_start', value: scheduleStart }, { onConflict: 'key' });
      await supabase.from('settings').upsert({ key: 'scheduled_maintenance_end', value: scheduleEnd }, { onConflict: 'key' });
      
      toast.success('Scheduled maintenance သိမ်းဆည်းပြီး');

      // Notify admin
      if (adminTelegramId && scheduledEnabled) {
        try {
          const startDate = new Date(scheduleStart).toLocaleString('my-MM');
          const endDate = new Date(scheduleEnd).toLocaleString('my-MM');
          await supabase.functions.invoke('notify-user', {
            body: {
              telegramId: parseInt(adminTelegramId),
              message: `📅 *SCHEDULED MAINTENANCE*\n\n━━━━━━━━━━━━━━━\n🔧 Maintenance အချိန်ဇယား သတ်မှတ်ပြီး\n━━━━━━━━━━━━━━━\n\n⏰ စတင်: ${startDate}\n⏰ ပြီးဆုံး: ${endDate}\n\n💡 ထိုအချိန်တွင် Bot အလိုအလျောက် ပိတ်/ဖွင့်မည်`
            }
          });
        } catch (e) {
          console.error('Failed to notify admin:', e);
        }
      }
    } catch (error) {
      console.error('Error saving scheduled maintenance:', error);
      toast.error('သိမ်းဆည်းမှု မအောင်မြင်ပါ');
    } finally {
      setIsSavingSchedule(false);
    }
  };

  return (
    <AdminLayout title="ဆက်တင်များ" subtitle="စနစ် ပြင်ဆင်မှုများ">
      <div className="space-y-6">
        {/* Bot Maintenance Mode */}
        <Card className={botMaintenance ? 'border-orange-500/50' : 'border-green-500/50'}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {botMaintenance ? <Wrench className="h-5 w-5 text-orange-500" /> : <Power className="h-5 w-5 text-green-500" />}
              Bot ဖွင့်/ပိတ် (Maintenance Mode)
            </CardTitle>
            <CardDescription>
              Bot ကို ခဏတာ ပိတ်ထားချင်ပါက ဤနေရာမှ ပိတ်နိုင်သည်
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg border">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-full ${botMaintenance ? 'bg-orange-500/20' : 'bg-green-500/20'}`}>
                    {botMaintenance ? (
                      <Wrench className="h-6 w-6 text-orange-500" />
                    ) : (
                      <Power className="h-6 w-6 text-green-500" />
                    )}
                  </div>
                  <div>
                    <div className="font-medium">
                      {botMaintenance ? '🔧 Maintenance Mode' : '✅ Bot Active'}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {botMaintenance 
                        ? 'User များ bot ကို အသုံးပြု၍မရပါ' 
                        : 'Bot ပုံမှန်အတိုင်း အလုပ်လုပ်နေသည်'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-medium ${!botMaintenance ? 'text-green-500' : 'text-muted-foreground'}`}>
                    Active
                  </span>
                  <Switch
                    checked={botMaintenance}
                    onCheckedChange={toggleBotMaintenance}
                    disabled={isUpdatingMaintenance}
                  />
                  <span className={`text-sm font-medium ${botMaintenance ? 'text-orange-500' : 'text-muted-foreground'}`}>
                    Maintenance
                  </span>
                </div>
              </div>

              {botMaintenance && (
                <Alert className="border-orange-500/50">
                  <Wrench className="h-4 w-4 text-orange-500" />
                  <AlertTitle className="text-orange-600 dark:text-orange-400">Maintenance Mode Active</AlertTitle>
                  <AlertDescription>
                    Bot ပိတ်ထားသည်။ User များ message ပို့လာပါက အောက်ပါ message ပြပေးမည်။
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="maintenanceMessage">Maintenance Message</Label>
                <div className="flex gap-2">
                  <Textarea
                    id="maintenanceMessage"
                    placeholder="Bot ပြုပြင်နေဆဲ ဖြစ်ပါသည်..."
                    value={maintenanceMessage}
                    onChange={(e) => setMaintenanceMessage(e.target.value)}
                    className="min-h-[80px]"
                  />
                </div>
                <Button onClick={saveMaintenanceMessage} size="sm" variant="outline">
                  <Save className="h-4 w-4 mr-2" />
                  Message သိမ်းမည်
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Scheduled Maintenance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Scheduled Maintenance
            </CardTitle>
            <CardDescription>
              သတ်မှတ်ထားသော အချိန်တွင် Bot အလိုအလျောက် ပိတ်/ဖွင့်မည်
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg border">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-full ${scheduledEnabled ? 'bg-blue-500/20' : 'bg-muted'}`}>
                    <Clock className={`h-6 w-6 ${scheduledEnabled ? 'text-blue-500' : 'text-muted-foreground'}`} />
                  </div>
                  <div>
                    <div className="font-medium">
                      {scheduledEnabled ? '📅 Schedule Active' : 'Schedule Disabled'}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {scheduledEnabled 
                        ? 'သတ်မှတ်ချိန်တွင် အလိုအလျောက် ပိတ်/ဖွင့်မည်' 
                        : 'Schedule ပိတ်ထားသည်'}
                    </div>
                  </div>
                </div>
                <Switch
                  checked={scheduledEnabled}
                  onCheckedChange={setScheduledEnabled}
                />
              </div>

              {scheduledEnabled && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="scheduleStart">
                      <Clock className="h-4 w-4 inline mr-1" />
                      Maintenance စတင်ချိန်
                    </Label>
                    <Input
                      id="scheduleStart"
                      type="datetime-local"
                      value={scheduleStart}
                      onChange={(e) => setScheduleStart(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="scheduleEnd">
                      <Clock className="h-4 w-4 inline mr-1" />
                      Maintenance ပြီးဆုံးချိန်
                    </Label>
                    <Input
                      id="scheduleEnd"
                      type="datetime-local"
                      value={scheduleEnd}
                      onChange={(e) => setScheduleEnd(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {scheduledEnabled && scheduleStart && scheduleEnd && (
                <Alert className="border-blue-500/50">
                  <Calendar className="h-4 w-4 text-blue-500" />
                  <AlertTitle className="text-blue-600 dark:text-blue-400">Schedule Preview</AlertTitle>
                  <AlertDescription>
                    🔧 <strong>{new Date(scheduleStart).toLocaleString('my-MM')}</strong> မှ <strong>{new Date(scheduleEnd).toLocaleString('my-MM')}</strong> အထိ Bot အလိုအလျောက် ပိတ်ထားမည်
                  </AlertDescription>
                </Alert>
              )}

              <Button onClick={saveScheduledMaintenance} disabled={isSavingSchedule} size="sm">
                {isSavingSchedule ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Schedule သိမ်းမည်
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Commission Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Percent className="h-5 w-5" />
              ကော်မရှင် ဆက်တင်
            </CardTitle>
            <CardDescription>
              ရောင်းဝယ်မှုတိုင်းမှ နှုတ်ယူမည့် ကော်မရှင် ရာခိုင်နှုန်း
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="commission">ကော်မရှင် ရာခိုင်နှုန်း (%)</Label>
                <div className="flex gap-4">
                  <Input
                    id="commission"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={commissionRate}
                    onChange={(e) => setCommissionRate(e.target.value)}
                    className="max-w-[200px]"
                  />
                  <span className="flex items-center text-muted-foreground">%</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  ဥပမာ: 3% ဆိုပါက 100 TON ရောင်းချမှုတွင် 3 TON ကော်မရှင် ရရှိမည်
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="minWithdrawal">အနည်းဆုံး ငွေထုတ်ပမာဏ (TON)</Label>
                <div className="flex gap-4">
                  <Input
                    id="minWithdrawal"
                    type="number"
                    min="0.001"
                    max="1000"
                    step="0.01"
                    value={minWithdrawal}
                    onChange={(e) => setMinWithdrawal(e.target.value)}
                    className="max-w-[200px]"
                  />
                  <span className="flex items-center text-muted-foreground">TON</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  ဥပမာ: 0.01 ဆိုပါက 0.01 TON အောက် ထုတ်ယူ၍မရပါ
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* MMK Payment Account Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              MMK Payment Settings
            </CardTitle>
            <CardDescription>
              KBZPay နှင့် WavePay ငွေလက်ခံရန် Account Numbers နှင့် ဖွင့်/ပိတ် ဆက်တင်များ
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Payment Method Enable/Disable Toggles */}
              <div className="p-4 bg-muted/50 rounded-lg border space-y-4">
                <div className="font-medium text-sm text-muted-foreground mb-2">
                  💡 Payment Method ဖွင့်/ပိတ် (Deposit & Withdraw အတွက်)
                </div>
                
                {/* KBZPay Toggle */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-full ${kbzpayEnabled ? 'bg-green-500/20' : 'bg-muted'}`}>
                      <span className="text-lg">📱</span>
                    </div>
                    <div>
                      <div className="font-medium">KBZPay</div>
                      <div className="text-sm text-muted-foreground">
                        {kbzpayEnabled ? 'User များ KBZPay သုံး၍ ငွေသွင်း/ထုတ် နိုင်သည်' : 'KBZPay ပိတ်ထားသည်'}
                      </div>
                    </div>
                  </div>
                  <Switch
                    checked={kbzpayEnabled}
                    disabled={isTogglingPaymentMethod}
                    onCheckedChange={async (checked) => {
                      setIsTogglingPaymentMethod(true);
                      try {
                        const { error } = await supabase
                          .from('settings')
                          .upsert({ key: 'kbzpay_enabled', value: checked ? 'true' : 'false' }, { onConflict: 'key' });
                        if (error) throw error;
                        setKbzpayEnabled(checked);
                        toast.success(checked ? 'KBZPay ဖွင့်ပြီး' : 'KBZPay ပိတ်ပြီး');
                      } catch (error) {
                        console.error('Error toggling KBZPay:', error);
                        toast.error('ပြောင်းလဲမှု မအောင်မြင်ပါ');
                      } finally {
                        setIsTogglingPaymentMethod(false);
                      }
                    }}
                  />
                </div>

                {/* WavePay Toggle */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-full ${wavepayEnabled ? 'bg-green-500/20' : 'bg-muted'}`}>
                      <span className="text-lg">📲</span>
                    </div>
                    <div>
                      <div className="font-medium">WavePay</div>
                      <div className="text-sm text-muted-foreground">
                        {wavepayEnabled ? 'User များ WavePay သုံး၍ ငွေသွင်း/ထုတ် နိုင်သည်' : 'WavePay ပိတ်ထားသည်'}
                      </div>
                    </div>
                  </div>
                  <Switch
                    checked={wavepayEnabled}
                    disabled={isTogglingPaymentMethod}
                    onCheckedChange={async (checked) => {
                      setIsTogglingPaymentMethod(true);
                      try {
                        const { error } = await supabase
                          .from('settings')
                          .upsert({ key: 'wavepay_enabled', value: checked ? 'true' : 'false' }, { onConflict: 'key' });
                        if (error) throw error;
                        setWavepayEnabled(checked);
                        toast.success(checked ? 'WavePay ဖွင့်ပြီး' : 'WavePay ပိတ်ပြီး');
                      } catch (error) {
                        console.error('Error toggling WavePay:', error);
                        toast.error('ပြောင်းလဲမှု မအောင်မြင်ပါ');
                      } finally {
                        setIsTogglingPaymentMethod(false);
                      }
                    }}
                  />
                </div>

                {!kbzpayEnabled && !wavepayEnabled && (
                  <Alert variant="destructive" className="mt-2">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      ⚠️ KBZPay နှင့် WavePay နှစ်ခုလုံး ပိတ်ထားပါသည်။ User များ MMK ငွေသွင်း/ထုတ် မလုပ်နိုင်ပါ။
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              {/* Payment Account Numbers */}
              <div className="space-y-4">
                <div className="font-medium text-sm text-muted-foreground">
                  💳 Account Numbers (User များ ငွေလွှဲရန်)
                </div>

                <div className="space-y-2">
                  <Label htmlFor="kbzpayAccount">
                    <span className="inline-flex items-center gap-2">
                      📱 KBZPay Account
                    </span>
                  </Label>
                  <Input
                    id="kbzpayAccount"
                    type="text"
                    placeholder="09xxxxxxxxx (သို့မဟုတ်) Account Name - 09xxxxxxxxx"
                    value={kbzpayAccount}
                    onChange={(e) => setKbzpayAccount(e.target.value)}
                    disabled={!kbzpayEnabled}
                  />
                  <p className="text-sm text-muted-foreground">
                    User များ MMK deposit တင်ရာတွင် ဤ account ကို ပြပေးပါမည်
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="wavepayAccount">
                    <span className="inline-flex items-center gap-2">
                      📲 WavePay Account
                    </span>
                  </Label>
                  <Input
                    id="wavepayAccount"
                    type="text"
                    placeholder="09xxxxxxxxx (သို့မဟုတ်) Account Name - 09xxxxxxxxx"
                    value={wavepayAccount}
                    onChange={(e) => setWavepayAccount(e.target.value)}
                    disabled={!wavepayEnabled}
                  />
                  <p className="text-sm text-muted-foreground">
                    User များ MMK deposit တင်ရာတွင် ဤ account ကို ပြပေးပါမည်
                  </p>
                </div>

                <Button 
                  onClick={savePaymentAccounts} 
                  disabled={isSavingPaymentAccounts}
                  className="w-fit"
                >
                  {isSavingPaymentAccounts ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Payment Accounts သိမ်းမည်
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Referral Rates Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5" />
              Referral Commission Rates
            </CardTitle>
            <CardDescription>
              Referral program ရဲ့ commission ရာခိုင်နှုန်းများ (ငွေထုတ်ချိန်မှ ပေးမည်)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="referralL1">Level 1 (Direct) Rate (%)</Label>
                  <div className="flex gap-4">
                    <Input
                      id="referralL1"
                      type="number"
                      min="0"
                      max="50"
                      step="0.5"
                      value={referralL1Rate}
                      onChange={(e) => setReferralL1Rate(e.target.value)}
                      className="max-w-[150px]"
                    />
                    <span className="flex items-center text-muted-foreground">%</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    တိုက်ရိုက် Referrer ရရှိမည့် %
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="referralL2">Level 2 (Indirect) Rate (%)</Label>
                  <div className="flex gap-4">
                    <Input
                      id="referralL2"
                      type="number"
                      min="0"
                      max="50"
                      step="0.5"
                      value={referralL2Rate}
                      onChange={(e) => setReferralL2Rate(e.target.value)}
                      className="max-w-[150px]"
                    />
                    <span className="flex items-center text-muted-foreground">%</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Level 2 Referrer ရရှိမည့် %
                  </p>
                </div>
              </div>
              
              <div className="p-3 bg-muted/50 rounded-lg border">
                <p className="text-sm">
                  <Gift className="h-4 w-4 inline mr-1" />
                  ဥပမာ: User က 10 TON ထုတ်ယူပါက L1 Referrer {referralL1Rate}% = {(10 * parseFloat(referralL1Rate || '0') / 100).toFixed(2)} TON, L2 Referrer {referralL2Rate}% = {(10 * parseFloat(referralL2Rate || '0') / 100).toFixed(2)} TON ရရှိမည်
                </p>
              </div>

              <Button onClick={saveReferralRates} disabled={isSavingReferral} size="sm">
                {isSavingReferral ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Referral Rates သိမ်းမည်
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Wallet Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              TON Wallet ဆက်တင်
            </CardTitle>
            <CardDescription>
              ကော်မရှင်နှင့် ငွေသွင်းမှုများ လက်ခံရန် Admin TON Wallet လိပ်စာ
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="wallet">Admin TON Wallet လိပ်စာ</Label>
                <Input
                  id="wallet"
                  placeholder="UQ..."
                  value={adminWallet}
                  onChange={(e) => setAdminWallet(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  ဝယ်သူများက ဤလိပ်စာသို့ TON ပေးချေရမည်
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Withdrawal Mode Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {withdrawalMode === 'auto' ? <Zap className="h-5 w-5" /> : <Hand className="h-5 w-5" />}
              ငွေထုတ်မှု စနစ်
            </CardTitle>
            <CardDescription>
              ငွေထုတ်ယူမှုများကို Manual သို့မဟုတ် Auto စီမံခန့်ခွဲရန်
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg border">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-full ${withdrawalMode === 'auto' ? 'bg-green-500/20' : 'bg-orange-500/20'}`}>
                    {withdrawalMode === 'auto' ? (
                      <Zap className="h-6 w-6 text-green-500" />
                    ) : (
                      <Hand className="h-6 w-6 text-orange-500" />
                    )}
                  </div>
                  <div>
                    <div className="font-medium">
                      {withdrawalMode === 'auto' ? 'Auto Mode' : 'Manual Mode'}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {withdrawalMode === 'auto' 
                        ? 'ငွေထုတ်မှုများ အလိုအလျောက် ပေးပို့မည်' 
                        : 'Admin က တစ်ခုချင်း Approve လုပ်ရမည်'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-medium ${withdrawalMode === 'manual' ? 'text-orange-500' : 'text-muted-foreground'}`}>
                    Manual
                  </span>
                  <Switch
                    checked={withdrawalMode === 'auto'}
                    onCheckedChange={async (checked) => {
                      const newMode = checked ? 'auto' : 'manual';
                      setIsUpdatingWithdrawalMode(true);
                      try {
                        const { error } = await supabase
                          .from('settings')
                          .upsert({ key: 'withdrawal_mode', value: newMode }, { onConflict: 'key' });
                        
                        if (error) throw error;
                        
                        setWithdrawalMode(newMode);
                        toast.success(`Withdrawal mode: ${newMode === 'auto' ? 'Auto' : 'Manual'} သို့ပြောင်းပြီး`);
                      } catch (error) {
                        console.error('Error updating withdrawal mode:', error);
                        toast.error('ပြောင်းလဲမှု မအောင်မြင်ပါ');
                      } finally {
                        setIsUpdatingWithdrawalMode(false);
                      }
                    }}
                    disabled={isUpdatingWithdrawalMode}
                  />
                  <span className={`text-sm font-medium ${withdrawalMode === 'auto' ? 'text-green-500' : 'text-muted-foreground'}`}>
                    Auto
                  </span>
                </div>
              </div>

              {withdrawalMode === 'manual' && (
                <Alert>
                  <Hand className="h-4 w-4" />
                  <AlertTitle>Manual Mode</AlertTitle>
                  <AlertDescription>
                    ငွေထုတ်ယူမှုတိုင်းကို Admin Panel မှ Approve/Reject လုပ်ရမည်။ TON ပေးပို့မှုကို Admin က လက်ဖြင့် ပေးပို့ရမည်။
                  </AlertDescription>
                </Alert>
              )}

              {withdrawalMode === 'auto' && (
                <Alert className="border-green-500/50">
                  <Zap className="h-4 w-4 text-green-500" />
                  <AlertTitle className="text-green-600 dark:text-green-400">Auto Mode</AlertTitle>
                  <AlertDescription>
                    ငွေထုတ်ယူမှုများ အလိုအလျောက် စစ်ဆေးပြီး ပေးပို့မည်။ Mnemonic ပြင်ဆင်ထားရန် လိုအပ်ပါသည်။
                    {!isMnemonicConfigured && (
                      <span className="block mt-1 text-destructive font-medium">
                        ⚠️ Mnemonic မပြင်ဆင်ရသေးပါ - Auto mode အလုပ်မလုပ်ပါ!
                      </span>
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Admin Telegram Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Admin Telegram Notification
            </CardTitle>
            <CardDescription>
              Dispute နှင့် Withdrawal အသစ်များအတွက် Admin သို့ notification ပို့ရန်
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="adminTelegramId">Admin Telegram ID</Label>
                <div className="flex gap-2">
                  <Input
                    id="adminTelegramId"
                    placeholder="123456789"
                    value={adminTelegramId}
                    onChange={(e) => setAdminTelegramId(e.target.value)}
                    className="max-w-[250px]"
                  />
                  <Button 
                    onClick={saveAdminTelegramId} 
                    disabled={isSavingAdminTg}
                    size="sm"
                  >
                    {isSavingAdminTg ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Telegram ID ရယူရန် - Telegram တွင် @userinfobot ကို message ပို့ပါ
                </p>
              </div>
              
              {adminTelegramId && (
                <Alert className="border-green-500/50">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <AlertTitle className="text-green-600 dark:text-green-400">Notification Active</AlertTitle>
                  <AlertDescription>
                    Dispute နှင့် Withdrawal အသစ်များ ID: {adminTelegramId} သို့ ပို့မည်
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>

        {/* TON Mnemonic Settings */}
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <Shield className="h-5 w-5" />
              TON Mnemonic Key
            </CardTitle>
            <CardDescription>
              ⚠️ အရေးကြီး: Automated withdrawals အတွက် Wallet Mnemonic (24 words)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">

              {isMnemonicConfigured && (
                <div className="space-y-2">
                  <Label>လက်ရှိ အခြေအနေ</Label>
                  <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/30 rounded-md">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm text-green-600 dark:text-green-400">
                      Mnemonic သိမ်းဆည်းထားပြီး (●●●● ●●●● ... 24 words)
                    </span>
                  </div>
                </div>
              )}
              
              <div className="space-y-2">
                <Label htmlFor="mnemonic">{isMnemonicConfigured ? 'Mnemonic အသစ်' : 'Mnemonic (24 words)'}</Label>
                <div className="relative">
                  <Textarea
                    id="mnemonic"
                    placeholder="word1 word2 word3 ... word24"
                    value={mnemonic}
                    onChange={(e) => setMnemonic(e.target.value)}
                    className={`min-h-[100px] font-mono text-sm pr-10 ${showMnemonic ? '' : 'text-security-disc'}`}
                    style={!showMnemonic ? { WebkitTextSecurity: 'disc' } as React.CSSProperties : {}}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1 h-8 w-8 p-0"
                    onClick={() => setShowMnemonic(!showMnemonic)}
                  >
                    {showMnemonic ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  TON Wallet ၏ 24 words mnemonic phrase ကို space ခြားပြီး ထည့်ပါ
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={updateMnemonic}
                  disabled={isUpdatingMnemonic || !mnemonic.trim()}
                  variant="destructive"
                  className="w-fit"
                >
                  {isUpdatingMnemonic ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Shield className="mr-2 h-4 w-4" />
                  )}
                  {isMnemonicConfigured ? 'Mnemonic ပြောင်းမည်' : 'Mnemonic သိမ်းမည်'}
                </Button>

                {isMnemonicConfigured && (
                  <Button
                    onClick={deleteMnemonic}
                    disabled={isUpdatingMnemonic}
                    variant="outline"
                    className="w-fit text-destructive hover:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    ဖျက်မည်
                  </Button>
                )}
              </div>
              
              {mnemonicStatus && (
                <Alert variant={mnemonicStatus.success ? "default" : "destructive"} className="mt-2">
                  {mnemonicStatus.success ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  <AlertTitle>
                    {mnemonicStatus.success ? 'အောင်မြင်ပါသည်' : 'မအောင်မြင်ပါ'}
                  </AlertTitle>
                  <AlertDescription>
                    {mnemonicStatus.message}
                    {mnemonicStatus.warning && (
                      <span className="block mt-1 text-amber-600 dark:text-amber-400">
                        {mnemonicStatus.warning}
                      </span>
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Wallet Balance & Manual Transfer */}
        {isMnemonicConfigured && (
          <Card className="border-primary/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-primary">
                <Wallet className="h-5 w-5" />
                Wallet Balance & Transfer
              </CardTitle>
              <CardDescription>
                Mnemonic Wallet ၏ လက်ကျန်ငွေနှင့် တခြား Wallet သို့ ပေးပို့ရန်
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Balance Display */}
                <div className="p-4 bg-gradient-to-r from-primary/10 to-primary/5 rounded-lg border border-primary/20">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">Wallet Balance</p>
                      <div className="flex items-baseline gap-2">
                        {isLoadingBalance ? (
                          <Skeleton className="h-10 w-32" />
                        ) : (
                          <span className="text-3xl font-bold text-primary">
                            {walletBalance !== null ? walletBalance.toFixed(4) : '—'}
                          </span>
                        )}
                        <span className="text-lg text-muted-foreground">TON</span>
                      </div>
                      {walletAddress && (
                        <p className="text-xs font-mono text-muted-foreground mt-2">
                          {walletAddress.substring(0, 12)}...{walletAddress.slice(-8)}
                          <a 
                            href={`https://tonscan.org/address/${walletAddress}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 text-primary hover:underline inline-flex items-center gap-1"
                          >
                            <ArrowUpRight className="h-3 w-3" />
                          </a>
                        </p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={fetchWalletBalance}
                      disabled={isLoadingBalance}
                    >
                      {isLoadingBalance ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* Manual Transfer Form */}
                <div className="space-y-4 pt-4 border-t">
                  <Label className="text-base font-semibold">Manual Transfer</Label>
                  <p className="text-sm text-muted-foreground">
                    ကြိုက်တဲ့ Wallet Address သို့ TON ပေးပို့ရန်
                  </p>
                  
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="transferDestination">Destination Wallet</Label>
                      <Input
                        id="transferDestination"
                        placeholder="UQ... သို့မဟုတ် EQ..."
                        value={transferDestination}
                        onChange={(e) => setTransferDestination(e.target.value)}
                        className="font-mono text-sm"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="transferAmount">Amount (TON)</Label>
                        <Input
                          id="transferAmount"
                          type="number"
                          step="0.0001"
                          min="0.01"
                          placeholder="0.00"
                          value={transferAmount}
                          onChange={(e) => setTransferAmount(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="transferComment">Comment (Optional)</Label>
                        <Input
                          id="transferComment"
                          placeholder="Admin Transfer"
                          value={transferComment}
                          onChange={(e) => setTransferComment(e.target.value)}
                        />
                      </div>
                    </div>

                    <Button
                      onClick={handleManualTransfer}
                      disabled={isTransferring || !transferDestination.trim() || !transferAmount}
                      className="w-full"
                    >
                      {isTransferring ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="mr-2 h-4 w-4" />
                      )}
                      {transferAmount ? `${transferAmount} TON ပေးပို့မည်` : 'TON ပေးပို့မည်'}
                    </Button>

                    {transferStatus && (
                      <Alert variant={transferStatus.success ? "default" : "destructive"} className="mt-2">
                        {transferStatus.success ? (
                          <CheckCircle className="h-4 w-4" />
                        ) : (
                          <AlertCircle className="h-4 w-4" />
                        )}
                        <AlertTitle>
                          {transferStatus.success ? 'ပေးပို့ပြီးပါပြီ' : 'မအောင်မြင်ပါ'}
                        </AlertTitle>
                        <AlertDescription>
                          {transferStatus.message}
                          {transferStatus.txRef && (
                            <span className="block mt-1 font-mono text-xs">
                              Ref: {transferStatus.txRef}
                            </span>
                          )}
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Bot Token API Key Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Bot Token API Key
            </CardTitle>
            <CardDescription>
              Telegram Bot Token ကို ပြောင်းလဲရန်
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {(maskedToken || savedBotUsername) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {maskedToken && (
                    <div className="space-y-2">
                      <Label>လက်ရှိ Token</Label>
                      <div className="px-3 py-2 bg-muted rounded-md font-mono text-sm">
                        {maskedToken}
                      </div>
                    </div>
                  )}
                  {savedBotUsername && (
                    <div className="space-y-2">
                      <Label>Bot Username</Label>
                      <div className="px-3 py-2 bg-primary/10 border border-primary/30 rounded-md font-mono text-sm flex items-center gap-2">
                        <Bot className="h-4 w-4 text-primary" />
                        <a 
                          href={`https://t.me/${savedBotUsername}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          @{savedBotUsername}
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              <div className="space-y-2">
                <Label htmlFor="botToken">Bot Token အသစ်</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="botToken"
                      type={showBotToken ? 'text' : 'password'}
                      placeholder="123456789:ABCdefGHI..."
                      value={botToken}
                      onChange={(e) => setBotToken(e.target.value)}
                      className="pr-10 font-mono text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 p-0"
                      onClick={() => setShowBotToken(!showBotToken)}
                    >
                      {showBotToken ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  BotFather မှ ရရှိသော Token ကို ထည့်ပါ
                </p>
              </div>

              <Button
                onClick={updateBotToken}
                disabled={isUpdatingToken || !botToken.trim()}
                className="w-fit"
              >
                {isUpdatingToken ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Key className="mr-2 h-4 w-4" />
                )}
                Token အတည်ပြုမည်
              </Button>
              
              {tokenStatus && (
                <Alert variant={tokenStatus.success ? "default" : "destructive"} className="mt-2">
                  {tokenStatus.success ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  <AlertTitle>
                    {tokenStatus.success ? 'အောင်မြင်ပါသည်' : 'မအောင်မြင်ပါ'}
                  </AlertTitle>
                  <AlertDescription>
                    {tokenStatus.message}
                    {tokenStatus.botUsername && (
                      <span className="block mt-1 font-mono text-sm">
                        Bot: @{tokenStatus.botUsername} ({tokenStatus.botName})
                      </span>
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Telegram Bot Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              Telegram Webhook ဆက်တင်
            </CardTitle>
            <CardDescription>
              Telegram Bot webhook URL ပြင်ဆင်မှု
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Webhook URL</Label>
                <div className="flex gap-2">
                  <Input
                    value={webhookUrl}
                    readOnly
                    className="font-mono text-xs md:text-sm"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={copyWebhookUrl}
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Telegram မှ ဤ URL သို့ webhook ပို့မည်
                </p>
              </div>
              
              <div className="pt-4 border-t">
                <div className="flex flex-col gap-3">
                  <Label>Webhook ပြင်ဆင်မှု</Label>
                  <p className="text-sm text-muted-foreground">
                    Telegram Bot webhook ကို လုံခြုံသော secret token ဖြင့် ပြင်ဆင်ရန် နှိပ်ပါ
                  </p>
                  
                  <Button
                    onClick={setupWebhook}
                    disabled={isSettingWebhook}
                    className="w-fit"
                  >
                    {isSettingWebhook ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Webhook ပြင်ဆင်မည်
                  </Button>
                  
                  {webhookStatus && (
                    <Alert variant={webhookStatus.success ? "default" : "destructive"} className="mt-2">
                      {webhookStatus.success ? (
                        <CheckCircle className="h-4 w-4" />
                      ) : (
                        <AlertCircle className="h-4 w-4" />
                      )}
                      <AlertTitle>
                        {webhookStatus.success ? 'အောင်မြင်ပါသည်' : 'မအောင်မြင်ပါ'}
                      </AlertTitle>
                      <AlertDescription>
                        {webhookStatus.message}
                        {webhookStatus.bot && (
                          <span className="block mt-1 font-mono text-sm">
                            Bot: {webhookStatus.bot}
                          </span>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button onClick={saveSettings} disabled={isSaving}>
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            သိမ်းဆည်းမည်
          </Button>
        </div>
      </div>
    </AdminLayout>
  );
}