import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Search, RefreshCw, ExternalLink, Download, Calendar, Filter, Star } from 'lucide-react';
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
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
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
}

export default function AdminTransactions() {
  const [transactions, setTransactions] = useState<TransactionWithRatings[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [isExporting, setIsExporting] = useState(false);

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

  const filteredTransactions = transactions.filter((tx) => {
    const matchesSearch = 
      tx.unique_link.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.ton_tx_hash?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || tx.status === statusFilter;
    
    const txDate = new Date(tx.created_at);
    const matchesDateFrom = !dateFrom || txDate >= dateFrom;
    const matchesDateTo = !dateTo || txDate <= new Date(dateTo.getTime() + 24 * 60 * 60 * 1000 - 1);
    
    return matchesSearch && matchesStatus && matchesDateFrom && matchesDateTo;
  });

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setDateFrom(undefined);
    setDateTo(undefined);
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
                  placeholder="Link သို့မဟုတ် TX Hash ဖြင့် ရှာပါ..."
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

            {/* Row 2: Date Range Filters */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">ရက်စွဲ:</span>
              </div>
              
              {/* Date From */}
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

              {/* Date To */}
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

              {/* Clear Filters Button */}
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
                    <TableHead>ပမာဏ (TON)</TableHead>
                    <TableHead>ကော်မရှင်</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead>TX Hash</TableHead>
                    <TableHead className="text-right">Link</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransactions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center">
                        ရောင်းဝယ်မှု မရှိပါ
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredTransactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="font-medium">
                          {format(new Date(tx.created_at), 'yyyy-MM-dd HH:mm')}
                        </TableCell>
                        <TableCell>{Number(tx.amount_ton).toFixed(4)}</TableCell>
                        <TableCell>{Number(tx.commission_ton).toFixed(4)}</TableCell>
                        <TableCell>
                          <TransactionStatusBadge status={tx.status} />
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
                        <TableCell>
                          {tx.ton_tx_hash ? (
                            <a
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
                        <TableCell className="text-right">
                          <code className="rounded bg-muted px-2 py-1 text-xs">
                            {tx.unique_link.slice(0, 12)}...
                          </code>
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
