import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Search, RefreshCw, Check, X, Loader2, Zap, Hand, Play, Download, Calendar, Filter, Copy } from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { WithdrawalStatusBadge } from '@/components/admin/StatusBadge';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import type { Withdrawal, WithdrawalStatus } from '@/types/database';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { toast as toastHook } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface WithdrawalWithProfile extends Omit<Withdrawal, 'profile'> {
  profile?: {
    telegram_username: string | null;
    telegram_id: number | null;
  } | null;
}

export default function AdminWithdrawals() {
  const [withdrawals, setWithdrawals] = useState<WithdrawalWithProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<WithdrawalWithProfile | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogAction, setDialogAction] = useState<'approve' | 'reject'>('approve');
  const [adminNotes, setAdminNotes] = useState('');
  const [txHash, setTxHash] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [commissionRate, setCommissionRate] = useState(5);
  const [withdrawalMode, setWithdrawalMode] = useState<'manual' | 'auto'>('manual');
  const [isAutoProcessing, setIsAutoProcessing] = useState(false);

  useEffect(() => {
    fetchWithdrawals();

    // Subscribe to realtime updates
    const channel = supabase
      .channel('withdrawals-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'withdrawals' },
        () => {
          fetchWithdrawals();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchWithdrawals = async () => {
    setIsLoading(true);
    try {
      // Fetch commission rate
      const { data: commSetting } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'commission_rate')
        .single();
      
      if (commSetting) {
        setCommissionRate(parseFloat(commSetting.value) || 5);
      }

      // Fetch withdrawal mode
      const { data: modeSetting } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'withdrawal_mode')
        .single();
      
      if (modeSetting) {
        setWithdrawalMode(modeSetting.value as 'manual' | 'auto');
      }

      const { data, error } = await supabase
        .from('withdrawals')
        .select('*, profile:profiles(telegram_username, telegram_id)')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setWithdrawals(data as WithdrawalWithProfile[] || []);
    } catch (error) {
      console.error('Error fetching withdrawals:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const openActionDialog = (withdrawal: WithdrawalWithProfile, action: 'approve' | 'reject') => {
    setSelectedWithdrawal(withdrawal);
    setDialogAction(action);
    setAdminNotes('');
    setTxHash('');
    setIsDialogOpen(true);
  };

  const handleAutoProcess = async () => {
    setIsAutoProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('auto-withdraw');
      
      if (error) {
        console.error('Auto-withdraw error:', error);
        toast.error('Auto-withdraw မအောင်မြင်ပါ');
        return;
      }
      
      if (data?.success) {
        toast.success(`${data.processed || 0} ခု ပြီးစီးပြီး, ${data.failed || 0} ခု မအောင်မြင်`);
        fetchWithdrawals();
      } else {
        toast.error(data?.error || 'Auto-withdraw မအောင်မြင်ပါ');
      }
    } catch (error) {
      console.error('Auto-withdraw error:', error);
      toast.error('Auto-withdraw မအောင်မြင်ပါ');
    } finally {
      setIsAutoProcessing(false);
    }
  };

  const handleAction = async () => {
    if (!selectedWithdrawal) return;

    setIsProcessing(true);
    try {
      const newStatus: WithdrawalStatus = dialogAction === 'approve' ? 'approved' : 'rejected';
      
      // Get user's current profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('balance, telegram_id')
        .eq('id', selectedWithdrawal.profile_id)
        .single();

      if (profileError) throw profileError;

      const currentBalance = Number(profile?.balance || 0);
      const withdrawAmount = Number(selectedWithdrawal.amount_ton);

      // If approving, deduct from user's balance
      // Note: Balance is only deducted here, NOT when user creates the withdrawal request
      if (dialogAction === 'approve') {
        if (currentBalance < withdrawAmount) {
          toast.error('အသုံးပြုသူ၏ လက်ကျန်ငွေ မလုံလောက်ပါ');
          setIsProcessing(false);
          return;
        }

        // Deduct balance only on admin approval
        const { error: balanceError } = await supabase
          .from('profiles')
          .update({ balance: currentBalance - withdrawAmount })
          .eq('id', selectedWithdrawal.profile_id);

        if (balanceError) throw balanceError;
      }
      // Note: No balance change needed for rejection since balance was never deducted
      
      // Update withdrawal status
      const { error } = await supabase
        .from('withdrawals')
        .update({
          status: newStatus,
          admin_notes: adminNotes || null,
          ton_tx_hash: txHash || null,
          processed_at: new Date().toISOString(),
        })
        .eq('id', selectedWithdrawal.id);

      if (error) throw error;

      // Send notification via edge function
      try {
        await supabase.functions.invoke('notify-user', {
          body: {
            type: dialogAction === 'approve' ? 'withdrawal_approved' : 'withdrawal_rejected',
            profile_id: selectedWithdrawal.profile_id,
            amount: selectedWithdrawal.amount_ton,
            tx_hash: txHash || null,
            admin_notes: adminNotes || null,
          },
        });
      } catch (notifyError) {
        console.error('Notification error:', notifyError);
        // Don't fail the whole operation if notification fails
      }

      toast.success(
        dialogAction === 'approve' 
          ? 'ငွေထုတ်ယူမှု အတည်ပြုပြီးပါပြီ' 
          : 'ငွေထုတ်ယူမှု ငြင်းပယ်ပြီးပါပြီ'
      );
      
      setIsDialogOpen(false);
      fetchWithdrawals();
    } catch (error) {
      console.error('Error processing withdrawal:', error);
      toast.error('လုပ်ဆောင်မှု မအောင်မြင်ပါ');
    } finally {
      setIsProcessing(false);
    }
  };

  const filteredWithdrawals = withdrawals.filter((wd) => {
    const username = wd.profile?.telegram_username || '';
    const matchesSearch = wd.destination_wallet.toLowerCase().includes(searchTerm.toLowerCase()) ||
      username.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || wd.status === statusFilter;
    
    const wdDate = new Date(wd.created_at);
    const matchesDateFrom = !dateFrom || wdDate >= dateFrom;
    const matchesDateTo = !dateTo || wdDate <= new Date(dateTo.getTime() + 24 * 60 * 60 * 1000 - 1);
    
    return matchesSearch && matchesStatus && matchesDateFrom && matchesDateTo;
  });

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setDateFrom(undefined);
    setDateTo(undefined);
  };

  const exportToCSV = () => {
    if (filteredWithdrawals.length === 0) {
      toastHook({
        title: "Export မအောင်မြင်ပါ",
        description: "Export လုပ်ရန် data မရှိပါ",
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);
    
    try {
      const headers = ['ရက်စွဲ', 'Username', 'ပမာဏ (TON)', `Commission (${commissionRate}%)`, 'ရရှိမည်', 'Wallet', 'Status', 'TX Hash'];
      
      const csvRows = [
        headers.join(','),
        ...filteredWithdrawals.map(wd => {
          const amount = Number(wd.amount_ton);
          const fee = amount * (commissionRate / 100);
          const receiveAmount = amount - fee;
          const username = wd.profile?.telegram_username ? `@${wd.profile.telegram_username}` : '-';
          return [
            format(new Date(wd.created_at), 'yyyy-MM-dd HH:mm'),
            username,
            amount.toFixed(4),
            fee.toFixed(4),
            receiveAmount.toFixed(4),
            wd.destination_wallet,
            wd.status,
            wd.ton_tx_hash || '-',
          ].map(val => `"${val}"`).join(',');
        })
      ];

      const csvContent = csvRows.join('\n');
      const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `withdrawals_${format(new Date(), 'yyyy-MM-dd_HHmm')}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toastHook({
        title: "Export အောင်မြင်ပါပြီ",
        description: `${filteredWithdrawals.length} ခု export လုပ်ပြီးပါပြီ`,
      });
    } catch (error) {
      console.error('Export error:', error);
      toastHook({
        title: "Export မအောင်မြင်ပါ",
        description: "ထပ်မံကြိုးစားပါ",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const pendingCount = withdrawals.filter(w => w.status === 'pending').length;

  return (
    <AdminLayout 
      title="ငွေထုတ်ယူမှုများ" 
      subtitle="အသုံးပြုသူများ၏ ငွေထုတ်ယူမှု တောင်းဆိုချက်များ"
    >
      {/* Mode Indicator */}
      <div className="mb-4">
        <Alert className={withdrawalMode === 'auto' ? 'border-green-500/50' : 'border-orange-500/50'}>
          {withdrawalMode === 'auto' ? (
            <Zap className="h-4 w-4 text-green-500" />
          ) : (
            <Hand className="h-4 w-4 text-orange-500" />
          )}
          <AlertTitle className="flex items-center gap-2">
            {withdrawalMode === 'auto' ? 'Auto Mode' : 'Manual Mode'}
            <Badge variant={withdrawalMode === 'auto' ? 'default' : 'secondary'}>
              {withdrawalMode === 'auto' ? 'အလိုအလျောက်' : 'လက်ဖြင့်'}
            </Badge>
          </AlertTitle>
          <AlertDescription>
            {withdrawalMode === 'auto' 
              ? 'Pending withdrawals များကို auto-withdraw function မှ အလိုအလျောက် process လုပ်ပါမည်။' 
              : 'Pending withdrawals တစ်ခုချင်းကို Admin က Approve/Reject လုပ်ရမည်။'}
          </AlertDescription>
        </Alert>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div className="flex items-center gap-3">
            <CardTitle className="text-lg">ငွေထုတ်ယူမှု စာရင်း</CardTitle>
            <span className="text-sm text-muted-foreground">
              ({filteredWithdrawals.length} ခု)
            </span>
            {pendingCount > 0 && (
              <Badge variant="destructive">{pendingCount} pending</Badge>
            )}
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={exportToCSV}
              disabled={isExporting || filteredWithdrawals.length === 0}
            >
              <Download className="mr-2 h-4 w-4" />
              {isExporting ? 'Exporting...' : 'CSV Export'}
            </Button>
            {withdrawalMode === 'auto' && pendingCount > 0 && (
              <Button 
                variant="default" 
                size="sm" 
                onClick={handleAutoProcess}
                disabled={isAutoProcessing}
                className="bg-green-600 hover:bg-green-700"
              >
                {isAutoProcessing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                Process All
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={fetchWithdrawals}>
              <RefreshCw className="mr-2 h-4 w-4" />
              ပြန်လည်ရယူ
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-6 space-y-4">
            {/* Row 1: Search and Status */}
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Wallet သို့မဟုတ် Username ဖြင့် ရှာပါ..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder="Status ရွေး" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">အားလုံး</SelectItem>
                  <SelectItem value="pending">စောင့်ဆိုင်းနေ</SelectItem>
                  <SelectItem value="approved">အတည်ပြုပြီး</SelectItem>
                  <SelectItem value="completed">ပြီးစီးပြီး</SelectItem>
                  <SelectItem value="rejected">ငြင်းပယ်ပြီး</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Row 2: Date Range Filters */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">ရက်စွဲ:</span>
              </div>
              
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full sm:w-[160px] justify-start text-left font-normal",
                      !dateFrom && "text-muted-foreground"
                    )}
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {dateFrom ? format(dateFrom, "yyyy-MM-dd") : "မှ"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-popover" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={dateFrom}
                    onSelect={setDateFrom}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>

              <span className="hidden sm:inline text-muted-foreground">-</span>

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full sm:w-[160px] justify-start text-left font-normal",
                      !dateTo && "text-muted-foreground"
                    )}
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {dateTo ? format(dateTo, "yyyy-MM-dd") : "ထိ"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-popover" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={dateTo}
                    onSelect={setDateTo}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>

              {(searchTerm || statusFilter !== 'all' || dateFrom || dateTo) && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={clearFilters}
                  className="text-muted-foreground hover:text-foreground"
                >
                  ✕ Filter ရှင်းမည်
                </Button>
              )}
            </div>
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
                    <TableHead>ရက်စွဲ</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>ပမာဏ</TableHead>
                    <TableHead>Commission ({commissionRate}%)</TableHead>
                    <TableHead>ရရှိမည်</TableHead>
                    <TableHead>Wallet</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">လုပ်ဆောင်မှု</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredWithdrawals.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-24 text-center">
                        ငွေထုတ်ယူမှု မရှိပါ
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredWithdrawals.map((wd) => {
                      const amount = Number(wd.amount_ton);
                      const fee = amount * (commissionRate / 100);
                      const receiveAmount = amount - fee;
                      const username = wd.profile?.telegram_username;

                      return (
                        <TableRow key={wd.id}>
                          <TableCell className="font-medium">
                            {format(new Date(wd.created_at), 'yyyy-MM-dd HH:mm')}
                          </TableCell>
                          <TableCell>
                            {username ? (
                              <span className="font-medium text-foreground">@{username}</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="font-mono font-semibold">
                            {amount.toFixed(4)} TON
                          </TableCell>
                          <TableCell className="font-mono text-destructive">
                            -{fee.toFixed(4)} TON
                          </TableCell>
                          <TableCell className="font-mono text-success font-semibold">
                            {receiveAmount.toFixed(4)} TON
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <code className="rounded bg-muted px-2 py-1 text-xs">
                                {wd.destination_wallet.slice(0, 8)}...{wd.destination_wallet.slice(-6)}
                              </code>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                onClick={() => {
                                  navigator.clipboard.writeText(wd.destination_wallet);
                                  toast.success('Wallet address copied!');
                                }}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell>
                            <WithdrawalStatusBadge status={wd.status} />
                          </TableCell>
                          <TableCell className="text-right">
                            {wd.status === 'pending' && (
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-success hover:bg-success/10"
                                  onClick={() => openActionDialog(wd, 'approve')}
                                >
                                  <Check className="mr-1 h-4 w-4" />
                                  အတည်ပြု
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-destructive hover:bg-destructive/10"
                                  onClick={() => openActionDialog(wd, 'reject')}
                                >
                                  <X className="mr-1 h-4 w-4" />
                                  ငြင်းပယ်
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogAction === 'approve' ? 'ငွေထုတ်ယူမှု အတည်ပြုမည်' : 'ငွေထုတ်ယူမှု ငြင်းပယ်မည်'}
            </DialogTitle>
            <DialogDescription asChild>
              {selectedWithdrawal && (
                <div className="space-y-2 mt-2">
                  <div className="p-3 bg-muted rounded-lg space-y-1">
                    <div className="flex justify-between">
                      <span>ထုတ်ယူပမာဏ:</span>
                      <strong>{Number(selectedWithdrawal.amount_ton).toFixed(4)} TON</strong>
                    </div>
                    <div className="flex justify-between text-destructive">
                      <span>Commission ({commissionRate}%):</span>
                      <strong>-{(Number(selectedWithdrawal.amount_ton) * commissionRate / 100).toFixed(4)} TON</strong>
                    </div>
                    <div className="flex justify-between text-success border-t pt-1">
                      <span>ရရှိမည်:</span>
                      <strong>{(Number(selectedWithdrawal.amount_ton) * (100 - commissionRate) / 100).toFixed(4)} TON</strong>
                    </div>
                    </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Wallet:</span>
                    <code className="flex-1 truncate">{selectedWithdrawal.destination_wallet}</code>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0"
                      onClick={() => {
                        navigator.clipboard.writeText(selectedWithdrawal.destination_wallet);
                        toast.success('Wallet address copied!');
                      }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {dialogAction === 'approve' && (
              <div className="space-y-2">
                <Label htmlFor="txHash">TX Hash (optional)</Label>
                <Input
                  id="txHash"
                  placeholder="TON transaction hash"
                  value={txHash}
                  onChange={(e) => setTxHash(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="notes">မှတ်ချက် (optional)</Label>
              <Textarea
                id="notes"
                placeholder="Admin မှတ်ချက်..."
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              ပယ်ဖျက်
            </Button>
            <Button
              variant={dialogAction === 'approve' ? 'default' : 'destructive'}
              onClick={handleAction}
              disabled={isProcessing}
            >
              {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {dialogAction === 'approve' ? 'အတည်ပြုမည်' : 'ငြင်းပယ်မည်'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
