import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Eye, Copy, ArrowDownToLine, Star } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { RatingDisplay, RatingSummary } from './RatingDisplay';
import { TransactionStatusBadge } from './StatusBadge';
import type { ExtendedProfile, UserRating } from '@/pages/admin/Users';

interface UserProfileDialogProps {
  user: ExtendedProfile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserProfileDialog({ user, open, onOpenChange }: UserProfileDialogProps) {
  const [profileRatings, setProfileRatings] = useState<UserRating[]>([]);
  const [profileTransactions, setProfileTransactions] = useState<any[]>([]);
  const [profileDeposits, setProfileDeposits] = useState<any[]>([]);
  const [profileWithdrawals, setProfileWithdrawals] = useState<any[]>([]);
  const [referralEarnings, setReferralEarnings] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    if (open && user) {
      setActiveTab('overview');
      fetchProfileData(user);
    }
  }, [open, user?.id]);

  const fetchProfileData = async (u: ExtendedProfile) => {
    setIsLoading(true);
    try {
      const [ratingsRes, txRes, depositsRes, withdrawalsRes, refEarningsRes] = await Promise.all([
        supabase.from('ratings').select('id, rating, comment, created_at, rater_id, transaction_id')
          .eq('rated_id', u.id).order('created_at', { ascending: false }),
        supabase.from('transactions').select('*')
          .or(`seller_id.eq.${u.id},buyer_id.eq.${u.id}`)
          .order('created_at', { ascending: false }).limit(50),
        supabase.from('deposits').select('*')
          .eq('profile_id', u.id).order('created_at', { ascending: false }).limit(50),
        supabase.from('withdrawals').select('*')
          .eq('profile_id', u.id).order('created_at', { ascending: false }).limit(50),
        supabase.from('referral_earnings').select('*')
          .eq('referrer_id', u.id).order('created_at', { ascending: false }).limit(50),
      ]);

      // Fetch rater profiles
      const raterIds = [...new Set((ratingsRes.data || []).map(r => r.rater_id))];
      let raterMap: Record<string, { telegram_username: string | null }> = {};
      if (raterIds.length > 0) {
        const { data: raterProfiles } = await supabase
          .from('profiles').select('id, telegram_username').in('id', raterIds);
        raterProfiles?.forEach(p => { raterMap[p.id] = { telegram_username: p.telegram_username }; });
      }

      // Fetch seller/buyer profiles for transactions
      const txData = txRes.data || [];
      const profileIds = [...new Set(txData.flatMap(tx => [tx.seller_id, tx.buyer_id].filter(Boolean)))];
      let txProfileMap: Record<string, string> = {};
      if (profileIds.length > 0) {
        const { data: txProfiles } = await supabase
          .from('profiles').select('id, telegram_username').in('id', profileIds as string[]);
        txProfiles?.forEach(p => { txProfileMap[p.id] = p.telegram_username || 'unknown'; });
      }

      setProfileRatings((ratingsRes.data || []).map(r => ({ ...r, rater: raterMap[r.rater_id] || { telegram_username: null } })));
      setProfileTransactions(txData.map(tx => ({ ...tx, _sellerName: txProfileMap[tx.seller_id || ''], _buyerName: txProfileMap[tx.buyer_id || ''] })));
      setProfileDeposits(depositsRes.data || []);
      setProfileWithdrawals(withdrawalsRes.data || []);
      setReferralEarnings(refEarningsRes.data || []);
    } catch (error) {
      console.error('Error fetching profile data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied!');
  };

  if (!user) return null;

  const totalRefEarnings = referralEarnings.reduce((sum, e) => sum + Number(e.amount_ton), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-primary" />
            @{user.telegram_username || 'unknown'} ၏ အသေးစိတ်
          </DialogTitle>
          <DialogDescription>User profile, transactions, deposits, withdrawals, ratings</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Profile Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-lg font-bold font-mono">{Number(user.balance).toFixed(4)}</p>
              <p className="text-[10px] text-muted-foreground">💎 TON</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-lg font-bold font-mono">{Number(user.balance_mmk || 0).toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">💵 MMK</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 flex flex-col items-center justify-center">
              <RatingSummary avgRating={user.avg_rating ?? null} totalRatings={user.total_ratings ?? null} />
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-sm font-medium">{format(new Date(user.created_at), 'yyyy-MM-dd')}</p>
              <p className="text-[10px] text-muted-foreground">စာရင်းသွင်းရက်</p>
            </div>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
              <TabsTrigger value="transactions" className="text-xs">
                Tx {!isLoading && <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-1">{profileTransactions.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="deposits" className="text-xs">
                Dep {!isLoading && <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-1">{profileDeposits.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="withdrawals" className="text-xs">
                WD {!isLoading && <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-1">{profileWithdrawals.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="ratings" className="text-xs">
                ⭐ {!isLoading && <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-1">{profileRatings.length}</Badge>}
              </TabsTrigger>
            </TabsList>

            <ScrollArea className="flex-1 mt-3" style={{ maxHeight: '400px' }}>
              {isLoading ? (
                <div className="space-y-3 p-2">
                  {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14" />)}
                </div>
              ) : (
                <>
                  {/* Overview */}
                  <TabsContent value="overview" className="mt-0 space-y-3 pr-4">
                    <div className="rounded-lg border p-3 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Telegram ID</span>
                        <span className="font-mono">{user.telegram_id || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Username</span>
                        <span>@{user.telegram_username || 'unknown'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Language</span>
                        <span>{user.language || 'my'}</span>
                      </div>
                      {user.ton_wallet_address && (
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Wallet</span>
                          <button
                            onClick={() => copyToClipboard(user.ton_wallet_address!)}
                            className="flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                          >
                            {user.ton_wallet_address.slice(0, 10)}...{user.ton_wallet_address.slice(-6)}
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                      {user.referral_code && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Referral Code</span>
                          <button
                            onClick={() => copyToClipboard(user.referral_code!)}
                            className="flex items-center gap-1"
                          >
                            <code className="text-xs bg-muted px-2 py-0.5 rounded">{user.referral_code}</code>
                            <Copy className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </div>
                      )}
                      <Separator />
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Status</span>
                        {user.is_blocked
                          ? <Badge variant="destructive">Blocked</Badge>
                          : <Badge variant="outline" className="border-emerald-500 text-emerald-600">Active</Badge>}
                      </div>
                      {user.is_blocked && user.blocked_reason && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Block Reason</span>
                          <span className="text-destructive text-xs max-w-[200px] text-right">{user.blocked_reason}</span>
                        </div>
                      )}
                    </div>

                    {/* Quick stats */}
                    <div className="grid grid-cols-4 gap-2">
                      <div className="rounded-lg border p-2 text-center">
                        <p className="text-lg font-bold">{profileTransactions.length}</p>
                        <p className="text-[10px] text-muted-foreground">Transactions</p>
                      </div>
                      <div className="rounded-lg border p-2 text-center">
                        <p className="text-lg font-bold">{profileDeposits.length}</p>
                        <p className="text-[10px] text-muted-foreground">Deposits</p>
                      </div>
                      <div className="rounded-lg border p-2 text-center">
                        <p className="text-lg font-bold">{profileWithdrawals.length}</p>
                        <p className="text-[10px] text-muted-foreground">Withdrawals</p>
                      </div>
                      <div className="rounded-lg border p-2 text-center">
                        <p className="text-lg font-bold">{referralEarnings.length}</p>
                        <p className="text-[10px] text-muted-foreground">Referrals</p>
                      </div>
                    </div>

                    {/* Referral Earnings Summary */}
                    {(totalRefEarnings > 0 || Number(user.total_referral_earnings || 0) > 0) && (
                      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">🎁 Referral Earnings</span>
                          <span className="font-mono font-bold text-primary">
                            {Number(user.total_referral_earnings || totalRefEarnings).toFixed(4)} TON
                          </span>
                        </div>
                        {referralEarnings.length > 0 && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {referralEarnings.length} ကြိမ် ရရှိခဲ့သည်
                          </p>
                        )}
                      </div>
                    )}
                  </TabsContent>

                  {/* Transactions */}
                  <TabsContent value="transactions" className="mt-0 pr-4">
                    {profileTransactions.length === 0 ? (
                      <EmptyState text="Transaction မရှိသေးပါ" />
                    ) : (
                      <div className="space-y-2">
                        {profileTransactions.map(tx => (
                          <div key={tx.id} className="rounded-lg border p-3 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <TransactionStatusBadge status={tx.status} />
                                {tx.seller_id === user.id && <Badge className="text-[9px] h-4" variant="outline">ရောင်းသူ</Badge>}
                                {tx.buyer_id === user.id && <Badge className="text-[9px] h-4" variant="outline">ဝယ်သူ</Badge>}
                              </div>
                              <span className="text-xs text-muted-foreground">{format(new Date(tx.created_at), 'MM-dd HH:mm')}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="font-mono font-bold">
                                {tx.currency === 'MMK' ? `${Number(tx.amount_mmk || 0).toLocaleString()} Ks` : `${Number(tx.amount_ton).toFixed(4)} TON`}
                              </span>
                              <Badge variant="outline" className="text-[10px]">{tx.currency === 'TON' ? '💎 TON' : '💵 MMK'}</Badge>
                            </div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <span>ရောင်းသူ: @{tx._sellerName || '-'}</span>
                              <ArrowDownToLine className="h-3 w-3 mx-1" />
                              <span>ဝယ်သူ: @{tx._buyerName || '-'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  {/* Deposits */}
                  <TabsContent value="deposits" className="mt-0 pr-4">
                    {profileDeposits.length === 0 ? (
                      <EmptyState text="Deposit မရှိသေးပါ" />
                    ) : (
                      <div className="space-y-2">
                        {profileDeposits.map(dep => (
                          <div key={dep.id} className="rounded-lg border p-3">
                            <div className="flex items-center justify-between mb-1">
                              <DepositStatusBadge status={dep.status} />
                              <span className="text-xs text-muted-foreground">{format(new Date(dep.created_at), 'MM-dd HH:mm')}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="font-mono font-bold text-sm">
                                {dep.currency === 'MMK' ? `${Number(dep.amount_ton).toLocaleString()} Ks` : `${Number(dep.amount_ton).toFixed(4)} TON`}
                              </span>
                              <div className="flex gap-1">
                                {dep.payment_method && dep.payment_method !== 'TON' && (
                                  <Badge variant="outline" className="text-[9px]">{dep.payment_method}</Badge>
                                )}
                                {dep.unique_code && (
                                  <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{dep.unique_code}</code>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  {/* Withdrawals */}
                  <TabsContent value="withdrawals" className="mt-0 pr-4">
                    {profileWithdrawals.length === 0 ? (
                      <EmptyState text="Withdrawal မရှိသေးပါ" />
                    ) : (
                      <div className="space-y-2">
                        {profileWithdrawals.map(wd => (
                          <div key={wd.id} className="rounded-lg border p-3">
                            <div className="flex items-center justify-between mb-1">
                              <WithdrawalStatusBadge status={wd.status} />
                              <span className="text-xs text-muted-foreground">{format(new Date(wd.created_at), 'MM-dd HH:mm')}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="font-mono font-bold text-sm">
                                {wd.currency === 'MMK' ? `${Number(wd.amount_ton).toLocaleString()} Ks` : `${Number(wd.amount_ton).toFixed(4)} TON`}
                              </span>
                              {wd.payment_method && (
                                <Badge variant="outline" className="text-[9px]">{wd.payment_method}</Badge>
                              )}
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1 font-mono truncate">→ {wd.destination_wallet}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  {/* Ratings */}
                  <TabsContent value="ratings" className="mt-0 pr-4">
                    {profileRatings.length === 0 ? (
                      <EmptyState text="Rating မရှိသေးပါ" />
                    ) : (
                      <div className="space-y-2">
                        {profileRatings.map((rating) => (
                          <div key={rating.id} className="rounded-lg border p-3">
                            <div className="flex items-center justify-between mb-1">
                              <RatingDisplay rating={rating.rating} showComment={false} />
                              <span className="text-xs text-muted-foreground">{format(new Date(rating.created_at), 'MM-dd HH:mm')}</span>
                            </div>
                            {rating.comment && (
                              <p className="text-sm text-muted-foreground italic border-l-2 border-primary/30 pl-2 mt-1">"{rating.comment}"</p>
                            )}
                            <p className="text-[10px] text-muted-foreground mt-1">Rating ပေးသူ: @{rating.rater?.telegram_username || 'unknown'}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                </>
              )}
            </ScrollArea>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="text-center py-8 text-muted-foreground text-sm">{text}</div>;
}

function DepositStatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: 'default' | 'destructive' | 'secondary'; label: string }> = {
    confirmed: { variant: 'default', label: '✅ အတည်ပြုပြီး' },
    rejected: { variant: 'destructive', label: '❌ ငြင်းပယ်' },
    expired: { variant: 'secondary', label: '⏰ သက်တမ်းကုန်' },
  };
  const { variant, label } = config[status] || { variant: 'secondary' as const, label: '⏳ စောင့်နေ' };
  return <Badge variant={variant} className="text-[10px]">{label}</Badge>;
}

function WithdrawalStatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: 'default' | 'destructive' | 'secondary'; label: string }> = {
    completed: { variant: 'default', label: '✅ ပြီးစီး' },
    approved: { variant: 'default', label: '👍 Approved' },
    rejected: { variant: 'destructive', label: '❌ ငြင်းပယ်' },
  };
  const { variant, label } = config[status] || { variant: 'secondary' as const, label: '⏳ စောင့်နေ' };
  return <Badge variant={variant} className="text-[10px]">{label}</Badge>;
}
