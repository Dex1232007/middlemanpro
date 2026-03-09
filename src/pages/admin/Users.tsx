import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Search, RefreshCw, Wallet, MessageCircle, Plus, Minus, Loader2, Ban, CheckCircle, Filter } from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import type { Profile } from '@/types/database';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RatingDisplay, RatingSummary } from '@/components/admin/RatingDisplay';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { TransactionStatusBadge } from '@/components/admin/StatusBadge';

type StatusFilter = 'all' | 'active' | 'blocked';

export interface UserRating {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  rater_id: string;
  transaction_id: string;
  rater?: {
    telegram_username: string | null;
  };
}

export interface ExtendedProfile extends Profile {
  is_blocked?: boolean;
  blocked_at?: string | null;
  blocked_reason?: string | null;
  avg_rating?: number | null;
  total_ratings?: number | null;
  balance_mmk?: number;
  language?: string;
  referral_code?: string | null;
  total_referral_earnings?: number | null;
}

export default function AdminUsers() {
  const [users, setUsers] = useState<ExtendedProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedUser, setSelectedUser] = useState<ExtendedProfile | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogAction, setDialogAction] = useState<'add' | 'deduct'>('add');
  const [dialogCurrency, setDialogCurrency] = useState<'TON' | 'MMK'>('TON');
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Block dialog states
  const [isBlockDialogOpen, setIsBlockDialogOpen] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [isBlocking, setIsBlocking] = useState(false);

  // Profile detail dialog states
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
  const [profileRatings, setProfileRatings] = useState<UserRating[]>([]);
  const [profileTransactions, setProfileTransactions] = useState<any[]>([]);
  const [profileDeposits, setProfileDeposits] = useState<any[]>([]);
  const [profileWithdrawals, setProfileWithdrawals] = useState<any[]>([]);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [profileTab, setProfileTab] = useState('overview');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUsers((data as ExtendedProfile[]) || []);
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const openBalanceDialog = (user: ExtendedProfile, action: 'add' | 'deduct', currency: 'TON' | 'MMK' = 'TON') => {
    setSelectedUser(user);
    setDialogAction(action);
    setDialogCurrency(currency);
    setAmount('');
    setIsDialogOpen(true);
  };

  const openBlockDialog = (user: ExtendedProfile) => {
    setSelectedUser(user);
    setBlockReason('');
    setIsBlockDialogOpen(true);
  };

  const openProfileDialog = async (user: ExtendedProfile) => {
    setSelectedUser(user);
    setIsProfileDialogOpen(true);
    setProfileTab('overview');
    setIsLoadingProfile(true);
    
    try {
      // Fetch all data in parallel
      const [ratingsRes, txRes, depositsRes, withdrawalsRes] = await Promise.all([
        // Ratings
        supabase.from('ratings').select('id, rating, comment, created_at, rater_id, transaction_id')
          .eq('rated_id', user.id).order('created_at', { ascending: false }),
        // Transactions (as seller or buyer)
        supabase.from('transactions').select('*')
          .or(`seller_id.eq.${user.id},buyer_id.eq.${user.id}`)
          .order('created_at', { ascending: false }).limit(50),
        // Deposits
        supabase.from('deposits').select('*')
          .eq('profile_id', user.id).order('created_at', { ascending: false }).limit(50),
        // Withdrawals
        supabase.from('withdrawals').select('*')
          .eq('profile_id', user.id).order('created_at', { ascending: false }).limit(50),
      ]);

      // Fetch rater profiles for ratings
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
    } catch (error) {
      console.error('Error fetching profile data:', error);
    } finally {
      setIsLoadingProfile(false);
    }
  };

  const handleBlockUser = async () => {
    if (!selectedUser) return;

    setIsBlocking(true);
    try {
      const isCurrentlyBlocked = selectedUser.is_blocked;
      
      const { error } = await supabase
        .from('profiles')
        .update({
          is_blocked: !isCurrentlyBlocked,
          blocked_at: !isCurrentlyBlocked ? new Date().toISOString() : null,
          blocked_reason: !isCurrentlyBlocked ? blockReason || null : null,
        })
        .eq('id', selectedUser.id);

      if (error) throw error;

      toast.success(
        isCurrentlyBlocked
          ? `@${selectedUser.telegram_username || 'User'} ကို unblock လုပ်ပြီးပါပြီ`
          : `@${selectedUser.telegram_username || 'User'} ကို block လုပ်ပြီးပါပြီ`
      );

      setIsBlockDialogOpen(false);
      fetchUsers();
    } catch (error) {
      console.error('Error blocking user:', error);
      toast.error('Block/Unblock မအောင်မြင်ပါ');
    } finally {
      setIsBlocking(false);
    }
  };

  const handleBalanceUpdate = async () => {
    if (!selectedUser || !amount) return;

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error('ပမာဏ မမှန်ကန်ပါ');
      return;
    }

    setIsProcessing(true);
    try {
      const balanceField = dialogCurrency === 'MMK' ? 'balance_mmk' : 'balance';
      const currentBalance = dialogCurrency === 'MMK' 
        ? Number((selectedUser as any).balance_mmk || 0) 
        : Number(selectedUser.balance);
      let newBalance: number;

      if (dialogAction === 'add') {
        newBalance = currentBalance + amountNum;
      } else {
        if (amountNum > currentBalance) {
          toast.error('လက်ကျန်ငွေထက် ပိုများပါသည်');
          setIsProcessing(false);
          return;
        }
        newBalance = currentBalance - amountNum;
      }

      const { error } = await supabase
        .from('profiles')
        .update({ [balanceField]: newBalance })
        .eq('id', selectedUser.id);

      if (error) throw error;

      const unit = dialogCurrency === 'MMK' ? 'MMK' : 'TON';
      const decimals = dialogCurrency === 'MMK' ? 0 : 4;
      toast.success(
        dialogAction === 'add'
          ? `${amountNum.toFixed(decimals)} ${unit} ထည့်ပြီးပါပြီ`
          : `${amountNum.toFixed(decimals)} ${unit} နုတ်ပြီးပါပြီ`
      );

      setIsDialogOpen(false);
      fetchUsers();
    } catch (error) {
      console.error('Error updating balance:', error);
      toast.error('Balance ပြင်ဆင်မှု မအောင်မြင်ပါ');
    } finally {
      setIsProcessing(false);
    }
  };

  const filteredUsers = users.filter((user) => {
    // Status filter
    if (statusFilter === 'active' && user.is_blocked) return false;
    if (statusFilter === 'blocked' && !user.is_blocked) return false;
    
    // Search filter
    return (
      user.telegram_username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.telegram_id?.toString().includes(searchTerm) ||
      user.ton_wallet_address?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const blockedCount = users.filter(u => u.is_blocked).length;
  const activeCount = users.filter(u => !u.is_blocked).length;

  return (
    <AdminLayout 
      title="အသုံးပြုသူများ" 
      subtitle="စနစ်တွင် စာရင်းသွင်းထားသော အသုံးပြုသူများ"
    >
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-lg">အသုံးပြုသူ စာရင်း</CardTitle>
          <Button variant="outline" size="sm" onClick={fetchUsers}>
            <RefreshCw className="mr-2 h-4 w-4" />
            ပြန်လည်ရယူ
          </Button>
        </CardHeader>
        <CardContent>
          {/* Search and Filters */}
          <div className="mb-6 flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Username, Telegram ID သို့မဟုတ် Wallet ဖြင့် ရှာပါ..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={(value: StatusFilter) => setStatusFilter(value)}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <Filter className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Status စစ်ရန်" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">အားလုံး ({users.length})</SelectItem>
                <SelectItem value="active">Active ({activeCount})</SelectItem>
                <SelectItem value="blocked">Blocked ({blockedCount})</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Telegram</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead>Wallet လိပ်စာ</TableHead>
                    <TableHead>လက်ကျန် (TON)</TableHead>
                    <TableHead>လက်ကျန် (MMK)</TableHead>
                    <TableHead>စာရင်းသွင်းသည့်ရက်</TableHead>
                    <TableHead className="text-right">လုပ်ဆောင်မှု</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-24 text-center">
                        အသုံးပြုသူ မရှိပါ
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map((user) => (
                      <TableRow key={user.id} className={`cursor-pointer ${user.is_blocked ? 'bg-destructive/5' : ''}`} onClick={() => openProfileDialog(user)}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <MessageCircle className="h-4 w-4 text-primary" />
                            <div>
                              <p className="font-medium">
                                @{user.telegram_username || 'unknown'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                ID: {user.telegram_id || 'N/A'}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {user.is_blocked ? (
                            <Badge variant="destructive" className="gap-1">
                              <Ban className="h-3 w-3" />
                              Blocked
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1 border-emerald-500 text-emerald-600">
                              <CheckCircle className="h-3 w-3" />
                              Active
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <button 
                            onClick={() => openProfileDialog(user)}
                            className="hover:opacity-80 transition-opacity cursor-pointer"
                          >
                            <RatingSummary 
                              avgRating={user.avg_rating ?? null} 
                              totalRatings={user.total_ratings ?? null} 
                            />
                          </button>
                        </TableCell>
                        <TableCell>
                          {user.ton_wallet_address ? (
                            <div className="flex items-center gap-2">
                              <Wallet className="h-4 w-4 text-muted-foreground" />
                              <code className="rounded bg-muted px-2 py-1 text-xs">
                                {user.ton_wallet_address.slice(0, 8)}...{user.ton_wallet_address.slice(-6)}
                              </code>
                            </div>
                          ) : (
                            <Badge variant="secondary">မရှိသေး</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="font-mono font-medium">
                            {Number(user.balance).toFixed(4)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="font-mono font-medium">
                            {Number((user as any).balance_mmk || 0).toLocaleString()}
                          </span>
                        </TableCell>
                        <TableCell>
                          {format(new Date(user.created_at), 'yyyy-MM-dd')}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-green-600 hover:bg-green-50"
                              onClick={() => openBalanceDialog(user, 'add', 'TON')}
                              title="TON ထည့်"
                            >
                              <Plus className="mr-1 h-3 w-3" />
                              TON
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 hover:bg-red-50"
                              onClick={() => openBalanceDialog(user, 'deduct', 'TON')}
                              title="TON နုတ်"
                            >
                              <Minus className="mr-1 h-3 w-3" />
                              TON
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-green-600 hover:bg-green-50"
                              onClick={() => openBalanceDialog(user, 'add', 'MMK')}
                              title="MMK ထည့်"
                            >
                              <Plus className="mr-1 h-3 w-3" />
                              MMK
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 hover:bg-red-50"
                              onClick={() => openBalanceDialog(user, 'deduct', 'MMK')}
                              title="MMK နုတ်"
                            >
                              <Minus className="mr-1 h-3 w-3" />
                              MMK
                            </Button>
                            <Button
                              size="sm"
                              variant={user.is_blocked ? 'outline' : 'destructive'}
                              onClick={() => openBlockDialog(user)}
                            >
                              {user.is_blocked ? (
                                <>
                                  <CheckCircle className="mr-1 h-4 w-4" />
                                  Unblock
                                </>
                              ) : (
                                <>
                                  <Ban className="mr-1 h-4 w-4" />
                                  Block
                                </>
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Balance Update Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogCurrency} {dialogAction === 'add' ? 'လက်ကျန်ငွေ ထည့်မည်' : 'လက်ကျန်ငွေ နုတ်မည်'}
            </DialogTitle>
            <DialogDescription asChild>
              {selectedUser && (
                <div className="space-y-2 mt-2">
                  <div className="p-3 bg-muted rounded-lg space-y-1">
                    <div className="flex justify-between">
                      <span>အသုံးပြုသူ:</span>
                      <strong>@{selectedUser.telegram_username || 'unknown'}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>လက်ရှိ {dialogCurrency} လက်ကျန်:</span>
                      <strong>
                        {dialogCurrency === 'MMK' 
                          ? `${Number((selectedUser as any).balance_mmk || 0).toLocaleString()} MMK`
                          : `${Number(selectedUser.balance).toFixed(4)} TON`
                        }
                      </strong>
                    </div>
                  </div>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="amount">ပမာဏ ({dialogCurrency})</Label>
              <Input
                id="amount"
                type="number"
                step={dialogCurrency === 'MMK' ? '1' : '0.0001'}
                min="0"
                placeholder={dialogCurrency === 'MMK' ? '1000' : '0.1'}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              ပယ်ဖျက်
            </Button>
            <Button
              variant={dialogAction === 'add' ? 'default' : 'destructive'}
              onClick={handleBalanceUpdate}
              disabled={isProcessing || !amount}
            >
              {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {dialogAction === 'add' ? 'ထည့်မည်' : 'နုတ်မည်'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Block/Unblock Dialog */}
      <Dialog open={isBlockDialogOpen} onOpenChange={setIsBlockDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedUser?.is_blocked ? 'အသုံးပြုသူ Unblock လုပ်မည်' : 'အသုံးပြုသူ Block လုပ်မည်'}
            </DialogTitle>
            <DialogDescription asChild>
              {selectedUser && (
                <div className="space-y-2 mt-2">
                  <div className="p-3 bg-muted rounded-lg space-y-1">
                    <div className="flex justify-between">
                      <span>အသုံးပြုသူ:</span>
                      <strong>@{selectedUser.telegram_username || 'unknown'}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Telegram ID:</span>
                      <strong>{selectedUser.telegram_id || 'N/A'}</strong>
                    </div>
                    {selectedUser.is_blocked && selectedUser.blocked_reason && (
                      <div className="flex justify-between">
                        <span>Block အကြောင်းပြချက်:</span>
                        <strong>{selectedUser.blocked_reason}</strong>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>

          {!selectedUser?.is_blocked && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="blockReason">Block အကြောင်းပြချက် (Optional)</Label>
                <Textarea
                  id="blockReason"
                  placeholder="ဥပမာ: စည်းကမ်းချိုးဖောက်မှု၊ လိမ်လည်မှု..."
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBlockDialogOpen(false)}>
              ပယ်ဖျက်
            </Button>
            <Button
              variant={selectedUser?.is_blocked ? 'default' : 'destructive'}
              onClick={handleBlockUser}
              disabled={isBlocking}
            >
              {isBlocking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {selectedUser?.is_blocked ? 'Unblock လုပ်မည်' : 'Block လုပ်မည်'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* User Profile Detail Dialog */}
      <Dialog open={isProfileDialogOpen} onOpenChange={setIsProfileDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-primary" />
              @{selectedUser?.telegram_username || 'unknown'} ၏ အသေးစိတ်
            </DialogTitle>
            <DialogDescription>User profile, transactions, deposits, withdrawals, ratings</DialogDescription>
          </DialogHeader>

          {selectedUser && (
            <div className="flex-1 overflow-hidden flex flex-col">
              {/* Profile Summary Card */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div className="rounded-lg bg-muted/50 p-3 text-center">
                  <p className="text-lg font-bold font-mono">{Number(selectedUser.balance).toFixed(4)}</p>
                  <p className="text-[10px] text-muted-foreground">💎 TON Balance</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3 text-center">
                  <p className="text-lg font-bold font-mono">{Number((selectedUser as any).balance_mmk || 0).toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground">💵 MMK Balance</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3 text-center">
                  <RatingSummary avgRating={selectedUser.avg_rating ?? null} totalRatings={selectedUser.total_ratings ?? null} />
                </div>
                <div className="rounded-lg bg-muted/50 p-3 text-center">
                  <p className="text-sm font-medium">{format(new Date(selectedUser.created_at), 'yyyy-MM-dd')}</p>
                  <p className="text-[10px] text-muted-foreground">စာရင်းသွင်းရက်</p>
                </div>
              </div>

              {/* Tabs */}
              <Tabs value={profileTab} onValueChange={setProfileTab} className="flex-1 overflow-hidden flex flex-col">
                <TabsList className="grid w-full grid-cols-5">
                  <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
                  <TabsTrigger value="transactions" className="text-xs flex gap-1">
                    Tx <Badge variant="secondary" className="text-[9px] h-4 px-1">{profileTransactions.length}</Badge>
                  </TabsTrigger>
                  <TabsTrigger value="deposits" className="text-xs flex gap-1">
                    Dep <Badge variant="secondary" className="text-[9px] h-4 px-1">{profileDeposits.length}</Badge>
                  </TabsTrigger>
                  <TabsTrigger value="withdrawals" className="text-xs flex gap-1">
                    WD <Badge variant="secondary" className="text-[9px] h-4 px-1">{profileWithdrawals.length}</Badge>
                  </TabsTrigger>
                  <TabsTrigger value="ratings" className="text-xs flex gap-1">
                    ⭐ <Badge variant="secondary" className="text-[9px] h-4 px-1">{profileRatings.length}</Badge>
                  </TabsTrigger>
                </TabsList>

                <ScrollArea className="flex-1 mt-3" style={{ maxHeight: '400px' }}>
                  {isLoadingProfile ? (
                    <div className="space-y-3 p-2">
                      {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14" />)}
                    </div>
                  ) : (
                    <>
                      {/* Overview Tab */}
                      <TabsContent value="overview" className="mt-0 space-y-3 pr-4">
                        <div className="rounded-lg border p-3 space-y-2 text-sm">
                          <div className="flex justify-between"><span className="text-muted-foreground">Telegram ID</span><span className="font-mono">{selectedUser.telegram_id || 'N/A'}</span></div>
                          <div className="flex justify-between"><span className="text-muted-foreground">Username</span><span>@{selectedUser.telegram_username || 'unknown'}</span></div>
                          <div className="flex justify-between"><span className="text-muted-foreground">Language</span><span>{(selectedUser as any).language || 'my'}</span></div>
                          {selectedUser.ton_wallet_address && (
                            <div className="flex justify-between items-center">
                              <span className="text-muted-foreground">Wallet</span>
                              <button onClick={() => { navigator.clipboard.writeText(selectedUser.ton_wallet_address!); toast.success('Copied!'); }} className="flex items-center gap-1 font-mono text-xs text-primary hover:underline">
                                {selectedUser.ton_wallet_address.slice(0, 10)}...{selectedUser.ton_wallet_address.slice(-6)}
                                <Copy className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                          {(selectedUser as any).referral_code && (
                            <div className="flex justify-between"><span className="text-muted-foreground">Referral Code</span><code className="text-xs bg-muted px-2 py-0.5 rounded">{(selectedUser as any).referral_code}</code></div>
                          )}
                          <Separator />
                          <div className="flex justify-between"><span className="text-muted-foreground">Status</span>{selectedUser.is_blocked ? <Badge variant="destructive">Blocked</Badge> : <Badge variant="outline" className="border-emerald-500 text-emerald-600">Active</Badge>}</div>
                          {selectedUser.is_blocked && selectedUser.blocked_reason && (
                            <div className="flex justify-between"><span className="text-muted-foreground">Block Reason</span><span className="text-destructive text-xs">{selectedUser.blocked_reason}</span></div>
                          )}
                        </div>

                        {/* Quick stats */}
                        <div className="grid grid-cols-3 gap-2">
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
                        </div>
                      </TabsContent>

                      {/* Transactions Tab */}
                      <TabsContent value="transactions" className="mt-0 pr-4">
                        {profileTransactions.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground">Transaction မရှိသေးပါ</div>
                        ) : (
                          <div className="space-y-2">
                            {profileTransactions.map(tx => (
                              <div key={tx.id} className="rounded-lg border p-3 space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <TransactionStatusBadge status={tx.status} />
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
                                {tx.seller_id === selectedUser.id && (
                                  <Badge className="text-[9px]" variant="secondary">ရောင်းသူ</Badge>
                                )}
                                {tx.buyer_id === selectedUser.id && (
                                  <Badge className="text-[9px]" variant="secondary">ဝယ်သူ</Badge>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </TabsContent>

                      {/* Deposits Tab */}
                      <TabsContent value="deposits" className="mt-0 pr-4">
                        {profileDeposits.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground">Deposit မရှိသေးပါ</div>
                        ) : (
                          <div className="space-y-2">
                            {profileDeposits.map(dep => (
                              <div key={dep.id} className="rounded-lg border p-3">
                                <div className="flex items-center justify-between mb-1">
                                  <Badge variant={dep.status === 'confirmed' ? 'default' : dep.status === 'rejected' ? 'destructive' : 'secondary'} className="text-[10px]">
                                    {dep.status === 'confirmed' ? '✅ အတည်ပြုပြီး' : dep.status === 'rejected' ? '❌ ငြင်းပယ်' : dep.status === 'expired' ? '⏰ သက်တမ်းကုန်' : '⏳ စောင့်နေ'}
                                  </Badge>
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

                      {/* Withdrawals Tab */}
                      <TabsContent value="withdrawals" className="mt-0 pr-4">
                        {profileWithdrawals.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground">Withdrawal မရှိသေးပါ</div>
                        ) : (
                          <div className="space-y-2">
                            {profileWithdrawals.map(wd => (
                              <div key={wd.id} className="rounded-lg border p-3">
                                <div className="flex items-center justify-between mb-1">
                                  <Badge variant={wd.status === 'completed' ? 'default' : wd.status === 'rejected' ? 'destructive' : 'secondary'} className="text-[10px]">
                                    {wd.status === 'completed' ? '✅ ပြီးစီး' : wd.status === 'approved' ? '👍 Approved' : wd.status === 'rejected' ? '❌ ငြင်းပယ်' : '⏳ စောင့်နေ'}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground">{format(new Date(wd.created_at), 'MM-dd HH:mm')}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="font-mono font-bold text-sm">
                                    {wd.currency === 'MMK' ? `${Number(wd.amount_ton).toLocaleString()} Ks` : `${Number(wd.amount_ton).toFixed(4)} TON`}
                                  </span>
                                  <div className="flex gap-1 items-center">
                                    {wd.payment_method && (
                                      <Badge variant="outline" className="text-[9px]">{wd.payment_method}</Badge>
                                    )}
                                  </div>
                                </div>
                                <p className="text-[10px] text-muted-foreground mt-1 font-mono truncate">
                                  → {wd.destination_wallet}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </TabsContent>

                      {/* Ratings Tab */}
                      <TabsContent value="ratings" className="mt-0 pr-4">
                        {profileRatings.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground">Rating မရှိသေးပါ</div>
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
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
