import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Search, RefreshCw, Clock, CheckCircle, XCircle, Download, Calendar, Filter } from 'lucide-react';
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
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

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

export default function AdminDeposits() {
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [isExporting, setIsExporting] = useState(false);

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
    
    const depDate = new Date(dep.created_at);
    const matchesDateFrom = !dateFrom || depDate >= dateFrom;
    const matchesDateTo = !dateTo || depDate <= new Date(dateTo.getTime() + 24 * 60 * 60 * 1000 - 1);
    
    return matchesSearch && matchesStatus && matchesDateFrom && matchesDateTo;
  });

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setDateFrom(undefined);
    setDateTo(undefined);
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

  // Calculate stats
  const stats = {
    total: deposits.length,
    pending: deposits.filter(d => d.status === 'pending').length,
    confirmed: deposits.filter(d => d.status === 'confirmed').length,
    expired: deposits.filter(d => d.status === 'expired').length,
    totalAmount: deposits
      .filter(d => d.status === 'confirmed')
      .reduce((sum, d) => sum + Number(d.amount_ton), 0),
  };

  return (
    <AdminLayout 
      title="ငွေသွင်းမှုများ" 
      subtitle="အသုံးပြုသူများ၏ ငွေသွင်းမှု မှတ်တမ်းများ"
    >
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">စုစုပေါင်း</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-warning">{stats.pending}</div>
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
            <div className="text-2xl font-bold font-mono">{stats.totalAmount.toFixed(2)} TON</div>
            <p className="text-xs text-muted-foreground">စုစုပေါင်းပမာဏ</p>
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
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder="Status ရွေး" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">အားလုံး</SelectItem>
                  <SelectItem value="pending">စောင့်ဆိုင်းနေ</SelectItem>
                  <SelectItem value="confirmed">အတည်ပြုပြီး</SelectItem>
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
                    <TableHead>ပမာဏ (TON)</TableHead>
                    <TableHead>အသုံးပြုသူ</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>သက်တမ်း</TableHead>
                    <TableHead>TX Hash</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDeposits.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center">
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
                        <TableCell className="font-mono font-bold">
                          {Number(dep.amount_ton).toFixed(4)}
                        </TableCell>
                        <TableCell>
                          {dep.profile?.telegram_username ? (
                            <span className="text-sm">@{dep.profile.telegram_username}</span>
                          ) : dep.profile?.telegram_id ? (
                            <span className="text-xs text-muted-foreground">{dep.profile.telegram_id}</span>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell>
                          <DepositStatusBadge status={dep.status} />
                        </TableCell>
                        <TableCell>
                          {dep.expires_at ? (
                            <span className={`text-xs ${new Date(dep.expires_at) < new Date() ? 'text-destructive' : 'text-muted-foreground'}`}>
                              {format(new Date(dep.expires_at), 'HH:mm')}
                            </span>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell>
                          {dep.ton_tx_hash && dep.status === 'confirmed' ? (
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
    </AdminLayout>
  );
}