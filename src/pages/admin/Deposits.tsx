import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Search, RefreshCw, Clock, CheckCircle, XCircle, Download, Calendar, Filter, Check, X, Eye } from 'lucide-react';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';

interface Deposit {
  id: string;
  profile_id: string;
  amount_ton: number;
  ton_tx_hash: string | null;
  is_confirmed: boolean;
  confirmed_at: string | null;
  created_at: string;
  expires_at: string | null;
  status: string;
  unique_code: string | null;
  currency: string;
  payment_method: string | null;
  screenshot_url: string | null;
  admin_notes: string | null;
  profile?: {
    telegram_username: string | null;
    telegram_id: number | null;
  };
}

function DepositStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'confirmed':
      return (
        <Badge className="bg-success/20 text-success border-success/30">
          <CheckCircle className="mr-1 h-3 w-3" />
          အတည်ပြုပြီး
        </Badge>
      );
    case 'expired':
      return (
        <Badge className="bg-destructive/20 text-destructive border-destructive/30">
          <XCircle className="mr-1 h-3 w-3" />
          သက်တမ်းကုန်
        </Badge>
      );
    case 'rejected':
      return (
        <Badge className="bg-destructive/20 text-destructive border-destructive/30">
          <XCircle className="mr-1 h-3 w-3" />
          ငြင်းပယ်
        </Badge>
      );
    case 'pending':
    default:
      return (
        <Badge className="bg-warning/20 text-warning border-warning/30">
          <Clock className="mr-1 h-3 w-3" />
          စောင့်ဆိုင်းနေ
        </Badge>
      );
  }
}

function CurrencyBadge({ currency }: { currency: string }) {
  if (currency === 'MMK') {
    return (
      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
        💵 MMK
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/30">
      💎 TON
    </Badge>
  );
}

function PaymentMethodBadge({ method }: { method: string | null }) {
  if (!method || method === 'TON') return null;
  
  const methodInfo: Record<string, { icon: string; label: string; color: string }> = {
    'KBZPAY': { icon: '📱', label: 'KBZPay', color: 'bg-red-500/10 text-red-600 border-red-500/30' },
    'WAVEPAY': { icon: '📲', label: 'WavePay', color: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30' },
  };
  
  const info = methodInfo[method] || { icon: '💳', label: method, color: 'bg-muted' };
  
  return (
    <Badge variant="outline" className={info.color}>
      {info.icon} {info.label}
    </Badge>
  );
}

export default function AdminDeposits() {
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedDeposit, setSelectedDeposit] = useState<Deposit | null>(null);
  const [approvalNotes, setApprovalNotes] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    fetchDeposits();

    // Subscribe to realtime updates
    const channel = supabase
      .channel('deposits-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'deposits' },
        () => {
          fetchDeposits();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchDeposits = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('deposits')
        .select(`
          *,
          profile:profiles(telegram_username, telegram_id)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDeposits(data as Deposit[] || []);
    } catch (error) {
      console.error('Error fetching deposits:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredDeposits = deposits.filter((dep) => {
    const matchesSearch = 
      (dep.unique_code?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (dep.ton_tx_hash?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (dep.profile?.telegram_username?.toLowerCase() || '').includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || dep.status === statusFilter;
    const matchesCurrency = currencyFilter === 'all' || dep.currency === currencyFilter;
    
    const depDate = new Date(dep.created_at);
    const matchesDateFrom = !dateFrom || depDate >= dateFrom;
    const matchesDateTo = !dateTo || depDate <= new Date(dateTo.getTime() + 24 * 60 * 60 * 1000 - 1);
    
    return matchesSearch && matchesStatus && matchesCurrency && matchesDateFrom && matchesDateTo;
  });

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setCurrencyFilter('all');
    setDateFrom(undefined);
    setDateTo(undefined);
  };

  // Handle MMK deposit approval
  const handleApproveDeposit = async (deposit: Deposit) => {
    setIsProcessing(true);
    try {
      // Update deposit status
      await supabase
        .from('deposits')
        .update({
          status: 'confirmed',
          is_confirmed: true,
          confirmed_at: new Date().toISOString(),
          admin_notes: approvalNotes || null,
        })
        .eq('id', deposit.id);

      // Credit user's MMK balance
      const { data: profile } = await supabase
        .from('profiles')
        .select('balance_mmk, telegram_id')
        .eq('id', deposit.profile_id)
        .single();

      let newBalance = 0;
      if (profile) {
        newBalance = Number(profile.balance_mmk || 0) + Number(deposit.amount_ton);
        await supabase
          .from('profiles')
          .update({ balance_mmk: newBalance })
          .eq('id', deposit.profile_id);
      }

      // Send Telegram notification to user
      if (profile?.telegram_id) {
        try {
          await supabase.functions.invoke('notify-user', {
            body: {
              type: 'mmk_deposit_approved',
              telegram_id: profile.telegram_id,
              amount: deposit.amount_ton,
              currency: 'MMK',
              payment_method: deposit.payment_method,
              unique_code: deposit.unique_code,
              new_balance: newBalance,
              admin_notes: approvalNotes || null,
            },
          });
        } catch (notifyError) {
          console.error('Failed to send notification:', notifyError);
        }
      }

      toast({
        title: "အတည်ပြုပြီး",
        description: `${Number(deposit.amount_ton).toLocaleString()} MMK ထည့်သွင်းပြီးပါပြီ`,
      });

      setSelectedDeposit(null);
      setApprovalNotes('');
      fetchDeposits();
    } catch (error) {
      console.error('Error approving deposit:', error);
      toast({
        title: "အမှား",
        description: "ငွေသွင်းမှု အတည်ပြုရာတွင် အမှားဖြစ်ပွားပါပြီ",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle MMK deposit rejection
  const handleRejectDeposit = async (deposit: Deposit) => {
    setIsProcessing(true);
    try {
      // Get user telegram_id first
      const { data: profile } = await supabase
        .from('profiles')
        .select('telegram_id')
        .eq('id', deposit.profile_id)
        .single();

      await supabase
        .from('deposits')
        .update({
          status: 'rejected',
          admin_notes: approvalNotes || 'ငြင်းပယ်ခံရပါပြီ',
        })
        .eq('id', deposit.id);

      // Send Telegram notification to user
      if (profile?.telegram_id) {
        try {
          await supabase.functions.invoke('notify-user', {
            body: {
              type: 'mmk_deposit_rejected',
              telegram_id: profile.telegram_id,
              amount: deposit.amount_ton,
              currency: 'MMK',
              payment_method: deposit.payment_method,
              unique_code: deposit.unique_code,
              admin_notes: approvalNotes || 'ငြင်းပယ်ခံရပါပြီ',
            },
          });
        } catch (notifyError) {
          console.error('Failed to send notification:', notifyError);
        }
      }

      toast({
        title: "ငြင်းပယ်ပြီး",
        description: "ငွေသွင်းမှု ငြင်းပယ်ပြီးပါပြီ",
      });

      setSelectedDeposit(null);
      setApprovalNotes('');
      fetchDeposits();
    } catch (error) {
      console.error('Error rejecting deposit:', error);
      toast({
        title: "အမှား",
        description: "ငွေသွင်းမှု ငြင်းပယ်ရာတွင် အမှားဖြစ်ပွားပါပြီ",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const exportToCSV = () => {
    if (filteredDeposits.length === 0) {
      toast({
        title: "Export မအောင်မြင်ပါ",
        description: "Export လုပ်ရန် data မရှိပါ",
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);
    
    try {
      const headers = ['ရက်စွဲ', 'Code', 'ပမာဏ (TON)', 'အသုံးပြုသူ', 'Status', 'TX Hash'];
      
      const csvRows = [
        headers.join(','),
        ...filteredDeposits.map(dep => [
          format(new Date(dep.created_at), 'yyyy-MM-dd HH:mm'),
          dep.unique_code || '-',
          Number(dep.amount_ton).toFixed(4),
          dep.profile?.telegram_username || dep.profile?.telegram_id || '-',
          dep.status,
          dep.ton_tx_hash || '-',
        ].map(val => `"${val}"`).join(','))
      ];

      const csvContent = csvRows.join('\n');
      const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `deposits_${format(new Date(), 'yyyy-MM-dd_HHmm')}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: "Export အောင်မြင်ပါပြီ",
        description: `${filteredDeposits.length} ခု export လုပ်ပြီးပါပြီ`,
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

  // Calculate stats by currency
  const stats = {
    total: deposits.length,
    pending: deposits.filter(d => d.status === 'pending').length,
    confirmed: deposits.filter(d => d.status === 'confirmed').length,
    expired: deposits.filter(d => d.status === 'expired').length,
    pendingTON: deposits.filter(d => d.status === 'pending' && d.currency === 'TON').length,
    pendingMMK: deposits.filter(d => d.status === 'pending' && d.currency === 'MMK').length,
    totalAmountTON: deposits
      .filter(d => d.status === 'confirmed' && d.currency === 'TON')
      .reduce((sum, d) => sum + Number(d.amount_ton), 0),
    totalAmountMMK: deposits
      .filter(d => d.status === 'confirmed' && d.currency === 'MMK')
      .reduce((sum, d) => sum + Number(d.amount_ton), 0),
  };

  return (
    <AdminLayout 
      title="ငွေသွင်းမှုများ" 
      subtitle="အသုံးပြုသူများ၏ ငွေသွင်းမှု မှတ်တမ်းများ"
    >
      {/* Currency Tabs Filter */}
      <div className="mb-6">
        <Tabs value={currencyFilter} onValueChange={setCurrencyFilter} className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="all" className="flex items-center gap-2">
              အားလုံး
              {stats.pending > 0 && (
                <Badge variant="secondary" className="h-5 min-w-5 px-1.5 text-xs">
                  {stats.pending}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="TON" className="flex items-center gap-2">
              💎 TON
              {stats.pendingTON > 0 && (
                <Badge variant="secondary" className="h-5 min-w-5 px-1.5 text-xs bg-blue-500/20 text-blue-600">
                  {stats.pendingTON}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="MMK" className="flex items-center gap-2">
              💵 MMK
              {stats.pendingMMK > 0 && (
                <Badge variant="secondary" className="h-5 min-w-5 px-1.5 text-xs bg-emerald-500/20 text-emerald-600">
                  {stats.pendingMMK}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{filteredDeposits.length}</div>
            <p className="text-xs text-muted-foreground">
              {currencyFilter === 'all' ? 'စုစုပေါင်း' : `${currencyFilter} စုစုပေါင်း`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-warning">
              {currencyFilter === 'all' ? stats.pending : currencyFilter === 'TON' ? stats.pendingTON : stats.pendingMMK}
            </div>
            <p className="text-xs text-muted-foreground">စောင့်ဆိုင်းနေ</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-success">{stats.confirmed}</div>
            <p className="text-xs text-muted-foreground">အတည်ပြုပြီး</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            {currencyFilter === 'MMK' ? (
              <>
                <div className="text-2xl font-bold font-mono">{stats.totalAmountMMK.toLocaleString()} Ks</div>
                <p className="text-xs text-muted-foreground">MMK စုစုပေါင်း</p>
              </>
            ) : currencyFilter === 'TON' ? (
              <>
                <div className="text-2xl font-bold font-mono">{stats.totalAmountTON.toFixed(2)} TON</div>
                <p className="text-xs text-muted-foreground">TON စုစုပေါင်း</p>
              </>
            ) : (
              <>
                <div className="text-lg font-bold font-mono">
                  {stats.totalAmountTON.toFixed(2)} TON
                </div>
                <div className="text-sm font-mono text-muted-foreground">
                  {stats.totalAmountMMK.toLocaleString()} Ks
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div className="flex items-center gap-4">
            <CardTitle className="text-lg">ငွေသွင်းမှု စာရင်း</CardTitle>
            <span className="text-sm text-muted-foreground">
              ({filteredDeposits.length} ခု)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={exportToCSV}
              disabled={isExporting || filteredDeposits.length === 0}
            >
              <Download className="mr-2 h-4 w-4" />
              {isExporting ? 'Exporting...' : 'CSV Export'}
            </Button>
            <Button variant="outline" size="sm" onClick={fetchDeposits}>
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
                  placeholder="Code, TX Hash, Username ဖြင့် ရှာပါ..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder="Status ရွေး" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">အားလုံး</SelectItem>
                  <SelectItem value="pending">စောင့်ဆိုင်းနေ</SelectItem>
                  <SelectItem value="confirmed">အတည်ပြုပြီး</SelectItem>
                  <SelectItem value="rejected">ငြင်းပယ်</SelectItem>
                  <SelectItem value="expired">သက်တမ်းကုန်</SelectItem>
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
                    <TableHead>Code</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead>ပမာဏ</TableHead>
                    <TableHead>အသုံးပြုသူ</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>TX/Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDeposits.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-24 text-center">
                        ငွေသွင်းမှု မရှိပါ
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredDeposits.map((dep) => (
                      <TableRow key={dep.id}>
                        <TableCell className="font-medium">
                          {format(new Date(dep.created_at), 'yyyy-MM-dd HH:mm')}
                        </TableCell>
                        <TableCell>
                          {dep.unique_code ? (
                            <code className="rounded bg-primary/10 px-2 py-1 text-xs font-bold text-primary">
                              {dep.unique_code}
                            </code>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <CurrencyBadge currency={dep.currency || 'TON'} />
                        </TableCell>
                        <TableCell className="font-mono font-bold">
                          {dep.currency === 'MMK' 
                            ? `${Number(dep.amount_ton).toLocaleString()} Ks`
                            : `${Number(dep.amount_ton).toFixed(4)} TON`
                          }
                        </TableCell>
                        <TableCell>
                          {dep.profile?.telegram_username ? (
                            <span className="text-sm font-medium">@{dep.profile.telegram_username}</span>
                          ) : dep.profile?.telegram_id ? (
                            <span className="text-xs text-muted-foreground">{dep.profile.telegram_id}</span>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <PaymentMethodBadge method={dep.payment_method} />
                            {dep.screenshot_url && (
                              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-[10px] px-1.5">
                                📷
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <DepositStatusBadge status={dep.status} />
                        </TableCell>
                        <TableCell>
                          {dep.currency === 'MMK' && dep.status === 'pending' ? (
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs bg-success/10 hover:bg-success/20 text-success border-success/30"
                                onClick={() => setSelectedDeposit(dep)}
                              >
                                <Check className="h-3 w-3 mr-1" />
                                Approve
                              </Button>
                            </div>
                          ) : dep.ton_tx_hash && dep.status === 'confirmed' ? (
                            <a
                              href={`https://tonscan.org/tx/${dep.ton_tx_hash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary hover:underline"
                            >
                              {dep.ton_tx_hash.slice(0, 8)}...
                            </a>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
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

      {/* MMK Deposit Approval Dialog */}
      <Dialog open={!!selectedDeposit} onOpenChange={() => setSelectedDeposit(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>MMK ငွေသွင်းမှု စစ်ဆေးရန်</DialogTitle>
            <DialogDescription>
              ငွေသွင်းမှု အချက်အလက်များကို စစ်ဆေးပြီး အတည်ပြု သို့မဟုတ် ငြင်းပယ်ပါ
            </DialogDescription>
          </DialogHeader>
          
          {selectedDeposit && (
            <div className="space-y-4">
              {/* Screenshot Preview */}
              {selectedDeposit.screenshot_url && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Payment Screenshot</label>
                  <div className="relative rounded-lg border overflow-hidden bg-muted">
                    <a 
                      href={selectedDeposit.screenshot_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="block"
                    >
                      <img 
                        src={selectedDeposit.screenshot_url} 
                        alt="Payment Screenshot" 
                        className="w-full h-auto max-h-64 object-contain cursor-pointer hover:opacity-90 transition-opacity"
                      />
                    </a>
                    <a
                      href={selectedDeposit.screenshot_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute top-2 right-2 bg-background/80 backdrop-blur-sm rounded-full p-1.5 hover:bg-background transition-colors"
                    >
                      <Eye className="h-4 w-4" />
                    </a>
                  </div>
                </div>
              )}

              {!selectedDeposit.screenshot_url && (
                <div className="rounded-lg border border-dashed p-4 text-center text-muted-foreground">
                  <span className="text-sm">📷 Screenshot မတင်ရသေးပါ</span>
                </div>
              )}

              <div className="rounded-lg bg-muted p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ပမာဏ:</span>
                  <span className="font-bold">{Number(selectedDeposit.amount_ton).toLocaleString()} MMK</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Code:</span>
                  <code className="font-mono text-primary">{selectedDeposit.unique_code}</code>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">User:</span>
                  <span>@{selectedDeposit.profile?.telegram_username || selectedDeposit.profile?.telegram_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment:</span>
                  <PaymentMethodBadge method={selectedDeposit.payment_method} />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">မှတ်ချက် (Optional)</label>
                <Textarea
                  placeholder="Admin notes..."
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
          )}

          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button
              variant="destructive"
              onClick={() => selectedDeposit && handleRejectDeposit(selectedDeposit)}
              disabled={isProcessing}
            >
              <X className="h-4 w-4 mr-1" />
              ငြင်းပယ်
            </Button>
            <Button
              onClick={() => selectedDeposit && handleApproveDeposit(selectedDeposit)}
              disabled={isProcessing}
              className="bg-success hover:bg-success/90"
            >
              <Check className="h-4 w-4 mr-1" />
              {isProcessing ? 'Processing...' : 'အတည်ပြု'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}