import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Search, RefreshCw, ExternalLink, Download, Calendar, Filter, Star, Eye, Clock, CheckCircle, Package, ShieldAlert, XCircle, CreditCard, Copy, User, ArrowRight, Loader2 } from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { TransactionStatusBadge } from '@/components/admin/StatusBadge';
import { RatingDisplay } from '@/components/admin/RatingDisplay';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import type { Transaction, TransactionStatus } from '@/types/database';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

interface Rating {
  id: string;
  rating: number;
  comment: string | null;
  rater_id: string;
  rated_id: string;
}

interface TransactionWithRatings extends Transaction {
  ratings?: Rating[];
  currency: string;
  amount_mmk: number | null;
  expires_at?: string | null;
  buyer_msg_id?: number | null;
}

interface PaymentRecord {
  id: string;
  transaction_id: string;
  screenshot_url: string | null;
}

export default function AdminTransactions() {
  const [transactions, setTransactions] = useState<TransactionWithRatings[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [currencyTab, setCurrencyTab] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [minAmount, setMinAmount] = useState<string>('');
  const [maxAmount, setMaxAmount] = useState<string>('');
  const [ratingFilter, setRatingFilter] = useState<string>('all');
  const [isExporting, setIsExporting] = useState(false);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [paymentScreenshots, setPaymentScreenshots] = useState<Record<string, string>>({});
  const [selectedTx, setSelectedTx] = useState<TransactionWithRatings | null>(null);

  // Action dialog states
  const [actionType, setActionType] = useState<'confirm' | 'reject' | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [isActionProcessing, setIsActionProcessing] = useState(false);

  // Store seller/buyer info for display
  const [profiles, setProfiles] = useState<Record<string, { telegram_username: string | null; telegram_id: number | null }>>({});

  useEffect(() => {
    fetchTransactions();
    
    // Subscribe to realtime updates
    const channel = supabase
      .channel('transactions-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions' },
        () => {
          fetchTransactions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchTransactions = async () => {
    setIsLoading(true);
    try {
      // Fetch transactions
      const { data: txData, error: txError } = await supabase
        .from('transactions')
        .select('*')
        .order('created_at', { ascending: false });

      if (txError) throw txError;

      // Fetch all ratings
      const { data: ratingsData, error: ratingsError } = await supabase
        .from('ratings')
        .select('*');

      if (ratingsError) throw ratingsError;

      // Fetch profiles for seller/buyer info
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, telegram_username, telegram_id');

      const profilesMap: Record<string, { telegram_username: string | null; telegram_id: number | null }> = {};
      profilesData?.forEach((p) => {
        profilesMap[p.id] = { telegram_username: p.telegram_username, telegram_id: p.telegram_id };
      });
      setProfiles(profilesMap);

      // Fetch payment screenshots for transactions
      const { data: paymentsData } = await supabase
        .from('payments')
        .select('id, transaction_id, screenshot_url')
        .not('screenshot_url', 'is', null);

      const screenshotsMap: Record<string, string> = {};
      paymentsData?.forEach((p) => {
        if (p.screenshot_url) {
          screenshotsMap[p.transaction_id] = p.screenshot_url;
        }
      });
      setPaymentScreenshots(screenshotsMap);

      // Map ratings to transactions
      const txWithRatings: TransactionWithRatings[] = (txData || []).map((tx) => ({
        ...tx,
        ratings: ratingsData?.filter((r) => r.transaction_id === tx.id) || [],
      }));

      setTransactions(txWithRatings);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Currency stats
  const currencyStats = {
    allCount: transactions.length,
    tonCount: transactions.filter(tx => tx.currency === 'TON').length,
    mmkCount: transactions.filter(tx => tx.currency === 'MMK').length,
    pendingTON: transactions.filter(tx => tx.currency === 'TON' && ['pending_payment', 'payment_received', 'item_sent'].includes(tx.status)).length,
    pendingMMK: transactions.filter(tx => tx.currency === 'MMK' && ['pending_payment', 'payment_received', 'item_sent'].includes(tx.status)).length,
  };

  const filteredTransactions = transactions.filter((tx) => {
    // Currency filter
    const matchesCurrency = currencyTab === 'all' || tx.currency === currencyTab;

    // Search by link, TX hash, or seller/buyer username
    const sellerUsername = tx.seller_id ? profiles[tx.seller_id]?.telegram_username || '' : '';
    const buyerUsername = tx.buyer_id ? profiles[tx.buyer_id]?.telegram_username || '' : '';
    
    const matchesSearch = 
      tx.unique_link.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.ton_tx_hash?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sellerUsername.toLowerCase().includes(searchTerm.toLowerCase()) ||
      buyerUsername.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || tx.status === statusFilter;
    
    const txDate = new Date(tx.created_at);
    const matchesDateFrom = !dateFrom || txDate >= dateFrom;
    const matchesDateTo = !dateTo || txDate <= new Date(dateTo.getTime() + 24 * 60 * 60 * 1000 - 1);
    
    // Amount filters
    const amount = currencyTab === 'MMK' ? Number(tx.amount_mmk || 0) : Number(tx.amount_ton);
    const matchesMinAmount = !minAmount || amount >= parseFloat(minAmount);
    const matchesMaxAmount = !maxAmount || amount <= parseFloat(maxAmount);
    
    // Rating filter
    const hasRating = tx.ratings && tx.ratings.length > 0;
    const avgRating = hasRating ? tx.ratings!.reduce((sum, r) => sum + r.rating, 0) / tx.ratings!.length : 0;
    let matchesRating = true;
    if (ratingFilter === 'with_rating') {
      matchesRating = hasRating;
    } else if (ratingFilter === 'no_rating') {
      matchesRating = !hasRating;
    } else if (ratingFilter === 'high') {
      matchesRating = hasRating && avgRating >= 4;
    } else if (ratingFilter === 'low') {
      matchesRating = hasRating && avgRating < 3;
    }
    
    return matchesCurrency && matchesSearch && matchesStatus && matchesDateFrom && matchesDateTo && matchesMinAmount && matchesMaxAmount && matchesRating;
  });

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setDateFrom(undefined);
    setDateTo(undefined);
    setMinAmount('');
    setMaxAmount('');
    setRatingFilter('all');
  };

  const hasActiveFilters = searchTerm || statusFilter !== 'all' || dateFrom || dateTo || minAmount || maxAmount || ratingFilter !== 'all';

  const handleTransactionAction = async () => {
    if (!selectedTx || !actionType) return;
    
    setIsActionProcessing(true);
    try {
      const shouldCompleteNow = selectedTx.status === 'item_sent' || selectedTx.status === 'disputed';
      const newStatus: TransactionStatus = actionType === 'confirm'
        ? (shouldCompleteNow ? 'completed' : 'payment_received')
        : 'cancelled';
      
      // Update transaction status
      const { error: updateError } = await supabase
        .from('transactions')
        .update({ 
          status: newStatus,
          ...(actionType === 'confirm' && newStatus === 'completed' ? { confirmed_at: new Date().toISOString() } : {}),
        })
        .eq('id', selectedTx.id);
      
      if (updateError) throw updateError;

      // Only when truly completing, add seller amount to balance
      if (actionType === 'confirm' && newStatus === 'completed' && selectedTx.seller_id) {
        const { data: sellerProfile } = await supabase
          .from('profiles')
          .select('balance, balance_mmk')
          .eq('id', selectedTx.seller_id)
          .single();
        
        if (sellerProfile) {
          if (selectedTx.currency === 'MMK') {
            await supabase.from('profiles').update({
              balance_mmk: Number(sellerProfile.balance_mmk) + Number(selectedTx.seller_receives_ton)
            }).eq('id', selectedTx.seller_id);
          } else {
            await supabase.from('profiles').update({
              balance: Number(sellerProfile.balance) + Number(selectedTx.seller_receives_ton)
            }).eq('id', selectedTx.seller_id);
          }
        }
      }

      // Notify both seller and buyer via Telegram
      const sellerUsername = selectedTx.seller_id ? profiles[selectedTx.seller_id]?.telegram_username : null;
      const buyerUsername = selectedTx.buyer_id ? profiles[selectedTx.buyer_id]?.telegram_username : null;
      const buyerTelegramId = selectedTx.buyer_id ? profiles[selectedTx.buyer_id]?.telegram_id : null;

      // Notify seller
      if (selectedTx.seller_id) {
        await supabase.functions.invoke('notify-user', {
          body: {
            type: actionType === 'confirm'
              ? (newStatus === 'payment_received' ? 'transaction_admin_payment_confirmed' : 'transaction_admin_completed')
              : 'transaction_admin_cancelled',
            profile_id: selectedTx.seller_id,
            amount: selectedTx.currency === 'MMK' ? selectedTx.amount_mmk : selectedTx.amount_ton,
            currency: selectedTx.currency,
            admin_notes: actionReason,
            product_title: selectedTx.unique_link,
            buyer_username: buyerUsername,
            seller_username: sellerUsername,
            seller_receives: Number(selectedTx.seller_receives_ton),
            role: 'seller',
            transaction_id: selectedTx.id,
          }
        });
      }

      // Notify buyer (delete old message and send new one with inline keyboard)
      if (selectedTx.buyer_id) {
        await supabase.functions.invoke('notify-user', {
          body: {
            type: actionType === 'confirm'
              ? (newStatus === 'payment_received' ? 'transaction_admin_payment_confirmed' : 'transaction_admin_completed')
              : 'transaction_admin_cancelled',
            profile_id: selectedTx.buyer_id,
            amount: selectedTx.currency === 'MMK' ? selectedTx.amount_mmk : selectedTx.amount_ton,
            currency: selectedTx.currency,
            admin_notes: actionReason,
            product_title: selectedTx.unique_link,
            buyer_username: buyerUsername,
            seller_username: sellerUsername,
            role: 'buyer',
            transaction_id: selectedTx.id,
            buyer_msg_id: selectedTx.buyer_msg_id ? Number(selectedTx.buyer_msg_id) : undefined,
            buyer_telegram_id: buyerTelegramId ? Number(buyerTelegramId) : undefined,
          }
        });
      }

      const statusLabel = newStatus === 'payment_received' ? 'payment_received (စတင်)' : newStatus;
      toast({
        title: actionType === 'confirm' ? '✅ အတည်ပြုပြီးပါပြီ' : '❌ ပယ်ဖျက်ပြီးပါပြီ',
        description: `Transaction ကို ${statusLabel} သို့ပြောင်းပြီးပါပြီ`,
      });
      
      setActionType(null);
      setActionReason('');
      setSelectedTx(null);
      fetchTransactions();
    } catch (error) {
      console.error('Error updating transaction:', error);
      toast({
        title: 'Error',
        description: 'Transaction ပြင်ဆင်မှု မအောင်မြင်ပါ',
        variant: 'destructive',
      });
    } finally {
      setIsActionProcessing(false);
    }
  };

  // Get amount label based on currency
  const getAmountLabel = () => {
    if (currencyTab === 'MMK') return 'ပမာဏ (MMK)';
    if (currencyTab === 'TON') return 'ပမာဏ (TON)';
    return 'ပမာဏ';
  };

  const exportToCSV = () => {
    if (filteredTransactions.length === 0) {
      toast({
        title: "Export မအောင်မြင်ပါ",
        description: "Export လုပ်ရန် data မရှိပါ",
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);
    
    try {
      const headers = ['ရက်စွဲ', 'ပမာဏ (TON)', 'ကော်မရှင်', 'Status', 'TX Hash', 'Link'];
      
      const csvRows = [
        headers.join(','),
        ...filteredTransactions.map(tx => [
          format(new Date(tx.created_at), 'yyyy-MM-dd HH:mm'),
          Number(tx.amount_ton).toFixed(4),
          Number(tx.commission_ton).toFixed(4),
          tx.status,
          tx.ton_tx_hash || '-',
          tx.unique_link,
        ].map(val => `"${val}"`).join(','))
      ];

      const csvContent = csvRows.join('\n');
      const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `transactions_${format(new Date(), 'yyyy-MM-dd_HHmm')}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: "Export အောင်မြင်ပါပြီ",
        description: `${filteredTransactions.length} ခု export လုပ်ပြီးပါပြီ`,
      });
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: "Export မအောင်မြင်ပါ",
        description: "ထပ်မံကြိုးစားပါ",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <AdminLayout 
      title="ရောင်းဝယ်မှုများ" 
      subtitle="အားလုံးသော ရောင်းဝယ်မှု မှတ်တမ်းများ"
    >
      <Tabs value={currencyTab} onValueChange={setCurrencyTab} className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="all" className="flex items-center gap-2">
            အားလုံး
            <Badge variant="secondary" className="text-xs">
              {currencyStats.allCount}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="TON" className="flex items-center gap-2">
            💎 TON
            {currencyStats.pendingTON > 0 && (
              <Badge variant="destructive" className="text-xs">
                {currencyStats.pendingTON}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="MMK" className="flex items-center gap-2">
            💵 MMK
            {currencyStats.pendingMMK > 0 && (
              <Badge variant="destructive" className="text-xs">
                {currencyStats.pendingMMK}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <div className="flex items-center gap-4">
              <CardTitle className="text-lg">ရောင်းဝယ်မှု စာရင်း</CardTitle>
              <span className="text-sm text-muted-foreground">
                ({filteredTransactions.length} ခု)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={exportToCSV}
                disabled={isExporting || filteredTransactions.length === 0}
              >
                <Download className="mr-2 h-4 w-4" />
                {isExporting ? 'Exporting...' : 'CSV Export'}
              </Button>
              <Button variant="outline" size="sm" onClick={fetchTransactions}>
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
                  placeholder="Link, TX Hash, ရောင်းသူ/ဝယ်သူ အမည်ဖြင့် ရှာပါ..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue placeholder="Status ရွေးချယ်ပါ" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">အားလုံး</SelectItem>
                  <SelectItem value="pending_payment">ငွေစောင့်နေသည်</SelectItem>
                  <SelectItem value="payment_received">ငွေရရှိပြီး</SelectItem>
                  <SelectItem value="item_sent">ပစ္စည်းပို့ပြီး</SelectItem>
                  <SelectItem value="completed">ပြီးစီးပြီး</SelectItem>
                  <SelectItem value="cancelled">ပယ်ဖျက်ပြီး</SelectItem>
                  <SelectItem value="disputed">အငြင်းပွားနေသည်</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Row 2: Date Range & Amount Filters */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center flex-wrap">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">ရက်စွဲ:</span>
              </div>
              
              {/* Date From */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "w-[130px] justify-start text-left font-normal",
                      !dateFrom && "text-muted-foreground"
                    )}
                  >
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

              <span className="text-muted-foreground">-</span>

              {/* Date To */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "w-[130px] justify-start text-left font-normal",
                      !dateTo && "text-muted-foreground"
                    )}
                  >
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

              <div className="h-6 w-px bg-border hidden sm:block" />

              {/* Amount Range */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {currencyTab === 'MMK' ? 'ပမာဏ (MMK):' : 'ပမာဏ (TON):'}
                </span>
                <Input
                  type="number"
                  placeholder="အနည်းဆုံး"
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                  className="w-[100px] h-9"
                  min="0"
                  step={currencyTab === 'MMK' ? '1000' : '0.01'}
                />
                <span className="text-muted-foreground">-</span>
                <Input
                  type="number"
                  placeholder="အများဆုံး"
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(e.target.value)}
                  className="w-[100px] h-9"
                  min="0"
                  step={currencyTab === 'MMK' ? '1000' : '0.01'}
                />
              </div>
            </div>

            {/* Row 3: Rating Filter & Clear */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <Star className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Rating:</span>
              </div>
              <Select value={ratingFilter} onValueChange={setRatingFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Rating filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">အားလုံး</SelectItem>
                  <SelectItem value="with_rating">Rating ရှိသည်</SelectItem>
                  <SelectItem value="no_rating">Rating မရှိသေး</SelectItem>
                  <SelectItem value="high">⭐⭐⭐⭐+ (4+)</SelectItem>
                  <SelectItem value="low">⭐⭐ အောက် (&lt;3)</SelectItem>
                </SelectContent>
              </Select>

              {/* Clear Filters Button */}
              {hasActiveFilters && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={clearFilters}
                  className="text-muted-foreground hover:text-foreground"
                >
                  ✕ Filter အားလုံး ရှင်းမည်
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
                    <TableHead>ရောင်းသူ</TableHead>
                    <TableHead>ဝယ်သူ</TableHead>
                    {currencyTab === 'all' && <TableHead>ငွေကြေး</TableHead>}
                    <TableHead>{getAmountLabel()}</TableHead>
                    <TableHead>ကော်မရှင်</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>📷</TableHead>
                    <TableHead>Rating</TableHead>
                    {currencyTab !== 'MMK' && <TableHead>TX Hash</TableHead>}
                    <TableHead className="text-right">Link</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransactions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={currencyTab === 'all' ? 11 : currencyTab === 'MMK' ? 9 : 10} className="h-24 text-center">
                        ရောင်းဝယ်မှု မရှိပါ
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredTransactions.map((tx) => {
                      const sellerUsername = tx.seller_id ? profiles[tx.seller_id]?.telegram_username : null;
                      const buyerUsername = tx.buyer_id ? profiles[tx.buyer_id]?.telegram_username : null;
                      
                      return (
                        <TableRow key={tx.id} className="cursor-pointer" onClick={() => setSelectedTx(tx)}>
                          <TableCell className="font-medium">
                            {format(new Date(tx.created_at), 'yyyy-MM-dd HH:mm')}
                          </TableCell>
                          <TableCell>
                            {sellerUsername ? (
                              <span className="font-medium text-foreground">@{sellerUsername}</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {buyerUsername ? (
                              <span className="font-medium text-foreground">@{buyerUsername}</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          {currencyTab === 'all' && (
                            <TableCell>
                              <Badge variant={tx.currency === 'TON' ? 'default' : 'secondary'}>
                                {tx.currency === 'TON' ? '💎 TON' : '💵 MMK'}
                              </Badge>
                            </TableCell>
                          )}
                          <TableCell>
                            {tx.currency === 'MMK' 
                              ? Number(tx.amount_mmk || 0).toLocaleString() + ' K'
                              : Number(tx.amount_ton).toFixed(4) + ' TON'
                            }
                          </TableCell>
                          <TableCell>{Number(tx.commission_ton).toFixed(4)}</TableCell>
                          <TableCell>
                            <TransactionStatusBadge status={tx.status} />
                          </TableCell>
                          <TableCell>
                            {paymentScreenshots[tx.id] ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); setScreenshotPreview(paymentScreenshots[tx.id]); }}
                                title="Screenshot ကြည့်ရန်"
                              >
                                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-[10px] px-1.5 cursor-pointer hover:bg-primary/20 transition-colors">
                                  📷 SS
                                </Badge>
                              </button>
                            ) : (
                              <span className="text-muted-foreground text-xs">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {tx.ratings && tx.ratings.length > 0 ? (
                              <div className="flex flex-col gap-1">
                                {tx.ratings.map((rating) => (
                                  <RatingDisplay
                                    key={rating.id}
                                    rating={rating.rating}
                                    comment={rating.comment}
                                    size="sm"
                                  />
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">-</span>
                            )}
                          </TableCell>
                          {currencyTab !== 'MMK' && (
                            <TableCell>
                              {tx.ton_tx_hash ? (
                                <a
                                  onClick={(e) => e.stopPropagation()}
                                  href={`https://tonscan.org/tx/${tx.ton_tx_hash}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-primary hover:underline"
                                >
                                  {tx.ton_tx_hash.slice(0, 8)}...
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                          )}
                          <TableCell className="text-right">
                            <code className="rounded bg-muted px-2 py-1 text-xs">
                              {tx.unique_link.slice(0, 12)}...
                            </code>
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
      </Tabs>

      {/* Transaction Detail Dialog */}
      <Dialog open={!!selectedTx} onOpenChange={() => setSelectedTx(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              ရောင်းဝယ်မှု အသေးစိတ်
            </DialogTitle>
            <DialogDescription>
              {selectedTx && (
                <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">
                  {selectedTx.id.slice(0, 8)}...
                </code>
              )}
            </DialogDescription>
          </DialogHeader>

          {selectedTx && (() => {
            const sellerUsername = selectedTx.seller_id ? profiles[selectedTx.seller_id]?.telegram_username : null;
            const buyerUsername = selectedTx.buyer_id ? profiles[selectedTx.buyer_id]?.telegram_username : null;

            // Timeline steps
            const allSteps = [
              { key: 'created', label: 'ဖန်တီးထား', icon: Clock, time: selectedTx.created_at, always: true },
              { key: 'pending_payment', label: 'ငွေစောင့်နေသည်', icon: CreditCard, time: selectedTx.created_at, always: true },
              { key: 'payment_received', label: 'ငွေရရှိပြီး', icon: CheckCircle, time: null, always: true },
              { key: 'item_sent', label: 'ပစ္စည်းပို့ပြီး', icon: Package, time: selectedTx.item_sent_at, always: true },
              { key: 'completed', label: 'ပြီးစီးပြီး', icon: CheckCircle, time: selectedTx.confirmed_at, always: true },
            ];

            const statusOrder = ['pending_payment', 'payment_received', 'item_sent', 'completed'];
            const currentIdx = statusOrder.indexOf(selectedTx.status);
            const isCancelled = selectedTx.status === 'cancelled';
            const isDisputed = selectedTx.status === 'disputed';

            return (
              <div className="space-y-5">
                {/* Status & Amount */}
                <div className="flex items-center justify-between">
                  <TransactionStatusBadge status={selectedTx.status} />
                  <div className="text-right">
                    <div className="text-xl font-bold font-mono">
                      {selectedTx.currency === 'MMK'
                        ? `${Number(selectedTx.amount_mmk || 0).toLocaleString()} Ks`
                        : `${Number(selectedTx.amount_ton).toFixed(4)} TON`}
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {selectedTx.currency === 'TON' ? '💎 TON' : '💵 MMK'}
                    </Badge>
                  </div>
                </div>

                <Separator />

                {/* Seller / Buyer */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground flex items-center gap-1"><User className="h-3 w-3" /> ရောင်းသူ</span>
                    <p className="font-medium text-sm">
                      {sellerUsername ? `@${sellerUsername}` : selectedTx.seller_id?.slice(0, 8) || '-'}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground flex items-center gap-1"><User className="h-3 w-3" /> ဝယ်သူ</span>
                    <p className="font-medium text-sm">
                      {buyerUsername ? `@${buyerUsername}` : selectedTx.buyer_id?.slice(0, 8) || '-'}
                    </p>
                  </div>
                </div>

                {/* Financial Details */}
                <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ပမာဏ</span>
                    <span className="font-mono font-medium">
                      {selectedTx.currency === 'MMK'
                        ? `${Number(selectedTx.amount_mmk || 0).toLocaleString()} Ks`
                        : `${Number(selectedTx.amount_ton).toFixed(4)} TON`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ကော်မရှင်</span>
                    <span className="font-mono">{Number(selectedTx.commission_ton).toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ရောင်းသူရရှိ</span>
                    <span className="font-mono font-medium text-success">{Number(selectedTx.seller_receives_ton).toFixed(4)}</span>
                  </div>
                </div>

                <Separator />

                {/* Status Timeline */}
                <div>
                  <h4 className="text-sm font-semibold mb-3">Status Timeline</h4>
                  
                  {(isCancelled || isDisputed) ? (
                    <div className="space-y-3">
                      <TimelineStep
                        icon={Clock}
                        label="ဖန်တီးထား"
                        time={selectedTx.created_at}
                        isActive
                        isCompleted
                      />
                      <TimelineStep
                        icon={isCancelled ? XCircle : ShieldAlert}
                        label={isCancelled ? 'ပယ်ဖျက်ပြီး' : 'အငြင်းပွားနေသည်'}
                        time={selectedTx.updated_at}
                        isActive
                        isCompleted
                        variant={isCancelled ? 'destructive' : 'warning'}
                      />
                    </div>
                  ) : (
                    <div className="space-y-0">
                      {allSteps.map((step, idx) => {
                        const isCompleted = idx <= currentIdx + 1; // +1 because 'created' is idx 0
                        const isCurrent = idx === currentIdx + 1;
                        return (
                          <TimelineStep
                            key={step.key}
                            icon={step.icon}
                            label={step.label}
                            time={isCompleted ? (step.time || selectedTx.updated_at) : null}
                            isActive={isCompleted}
                            isCompleted={isCompleted && !isCurrent}
                            isCurrent={isCurrent}
                            isLast={idx === allSteps.length - 1}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Screenshot */}
                {paymentScreenshots[selectedTx.id] && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Payment Screenshot</h4>
                      <div className="relative rounded-lg border overflow-hidden bg-muted">
                        <img
                          src={paymentScreenshots[selectedTx.id]}
                          alt="Payment Screenshot"
                          className="w-full h-auto max-h-48 object-contain cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => { setSelectedTx(null); setScreenshotPreview(paymentScreenshots[selectedTx.id]); }}
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Ratings */}
                {selectedTx.ratings && selectedTx.ratings.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Ratings</h4>
                      <div className="space-y-2">
                        {selectedTx.ratings.map((rating) => (
                          <div key={rating.id} className="rounded-lg bg-muted/50 p-3">
                            <RatingDisplay rating={rating.rating} comment={rating.comment} size="sm" />
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* TX Hash & Link */}
                <Separator />
                <div className="space-y-2 text-sm">
                  {selectedTx.ton_tx_hash && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">TX Hash</span>
                      <a
                        href={`https://tonscan.org/tx/${selectedTx.ton_tx_hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-primary hover:underline font-mono text-xs"
                      >
                        {selectedTx.ton_tx_hash.slice(0, 16)}...
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Unique Link</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(selectedTx.unique_link);
                        toast({ title: 'Copied!', description: 'Link ကူးယူပြီးပါပြီ' });
                      }}
                      className="flex items-center gap-1 text-xs font-mono text-primary hover:underline"
                    >
                      {selectedTx.unique_link.slice(0, 16)}...
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Created</span>
                    <span className="text-xs">{format(new Date(selectedTx.created_at), 'yyyy-MM-dd HH:mm:ss')}</span>
                  </div>
                  {selectedTx.expires_at && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Expires</span>
                      <span className="text-xs">{format(new Date(selectedTx.expires_at), 'yyyy-MM-dd HH:mm:ss')}</span>
                    </div>
                  )}
                </div>

                {/* Action Buttons - show for active transactions */}
                {['pending_payment', 'payment_received', 'item_sent', 'disputed'].includes(selectedTx.status) && (
                  <>
                    <Separator />
                    <div className="flex gap-2">
                      <Button
                        className="flex-1"
                        variant="default"
                        onClick={() => setActionType('confirm')}
                      >
                        <CheckCircle className="mr-2 h-4 w-4" />
                        အတည်ပြု
                      </Button>
                      <Button
                        className="flex-1"
                        variant="destructive"
                        onClick={() => setActionType('reject')}
                      >
                        <XCircle className="mr-2 h-4 w-4" />
                        ပယ်ဖျက် (Cancel)
                      </Button>
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Screenshot Preview Dialog */}
      <Dialog open={!!screenshotPreview} onOpenChange={() => setScreenshotPreview(null)}>
        <DialogContent className="sm:max-w-2xl p-2">
          <DialogHeader className="sr-only">
            <DialogTitle>Payment Screenshot</DialogTitle>
          </DialogHeader>
          {screenshotPreview && (
            <div className="relative">
              <img
                src={screenshotPreview}
                alt="Payment Screenshot"
                className="w-full h-auto max-h-[80vh] object-contain rounded-lg"
              />
              <a
                href={screenshotPreview}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute top-2 right-2 bg-background/80 backdrop-blur-sm rounded-full p-2 hover:bg-background transition-colors"
              >
                <Eye className="h-4 w-4" />
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Action Reason Dialog */}
      <Dialog open={!!actionType} onOpenChange={(open) => { if (!open) { setActionType(null); setActionReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === 'confirm' ? '✅ Transaction အတည်ပြုမည်' : '❌ Transaction ပယ်ဖျက်မည်'}
            </DialogTitle>
            <DialogDescription>
              {actionType === 'confirm' 
                ? (selectedTx?.status === 'item_sent' || selectedTx?.status === 'disputed'
                  ? 'Transaction ကို completed အဖြစ် ပြောင်းပြီး ရောင်းသူ balance ထဲသို့ ငွေထည့်ပေးမည်။'
                  : 'Transaction ကို payment_received အဖြစ် ပြောင်းပြီး ရောင်းဝယ်မှုကို စတင်ပေးမည်။')
                : 'Transaction ကို cancelled အဖြစ် ပြောင်းမည်။'}
              {' '}အကြောင်းပြချက်ကို user ဆီ Telegram မှတဆင့် ပို့ပေးပါမည်။
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="actionReason">အကြောင်းပြချက် / မှတ်ချက်</Label>
              <Textarea
                id="actionReason"
                placeholder={actionType === 'confirm' 
                  ? 'ဥပမာ: စစ်ဆေးပြီး မှန်ကန်ပါသည်၊ ပစ္စည်းလက်ခံပြီး...'
                  : 'ဥပမာ: ငွေမမှန်ကန်ပါ၊ လိမ်လည်မှု သံသယ...'}
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                rows={3}
              />
            </div>
            {selectedTx && (
              <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ပမာဏ</span>
                  <span className="font-mono font-bold">
                    {selectedTx.currency === 'MMK'
                      ? `${Number(selectedTx.amount_mmk || 0).toLocaleString()} Ks`
                      : `${Number(selectedTx.amount_ton).toFixed(4)} TON`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <TransactionStatusBadge status={selectedTx.status} />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setActionType(null); setActionReason(''); }}>
              ပယ်ဖျက်
            </Button>
            <Button
              variant={actionType === 'confirm' ? 'default' : 'destructive'}
              onClick={handleTransactionAction}
              disabled={isActionProcessing || !actionReason.trim()}
            >
              {isActionProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {actionType === 'confirm' ? 'အတည်ပြုမည်' : 'ပယ်ဖျက်မည်'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

/* Timeline Step Component */
function TimelineStep({ 
  icon: Icon, label, time, isActive, isCompleted, isCurrent, isLast, variant 
}: { 
  icon: React.ElementType; 
  label: string; 
  time: string | null; 
  isActive: boolean; 
  isCompleted: boolean; 
  isCurrent?: boolean; 
  isLast?: boolean;
  variant?: 'destructive' | 'warning';
}) {
  return (
    <div className="flex items-start gap-3 relative">
      {/* Vertical line */}
      {!isLast && (
        <div className={cn(
          "absolute left-[13px] top-[26px] w-0.5 h-[calc(100%+4px)]",
          isActive && !isCurrent ? "bg-primary" : "bg-border"
        )} />
      )}
      {/* Icon circle */}
      <div className={cn(
        "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
        variant === 'destructive' && "border-destructive bg-destructive/10 text-destructive",
        variant === 'warning' && "border-warning bg-warning/10 text-warning",
        !variant && isCompleted && "border-primary bg-primary text-primary-foreground",
        !variant && isCurrent && "border-primary bg-primary/10 text-primary animate-pulse",
        !variant && !isActive && "border-muted-foreground/30 bg-muted text-muted-foreground/50",
      )}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      {/* Text */}
      <div className="pb-6 pt-0.5">
        <p className={cn(
          "text-sm font-medium leading-none",
          !isActive && "text-muted-foreground"
        )}>
          {label}
        </p>
        {time && isActive && (
          <p className="text-xs text-muted-foreground mt-1">
            {format(new Date(time), 'yyyy-MM-dd HH:mm:ss')}
          </p>
        )}
      </div>
    </div>
  );
}
