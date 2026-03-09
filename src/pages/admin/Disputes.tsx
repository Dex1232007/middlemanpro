import { useEffect, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { 
  RefreshCw, CheckCircle, XCircle, AlertTriangle, User, Package, 
  Search, Clock, MessageSquare, Eye, Copy, ExternalLink, Filter,
  ShieldAlert, Loader2, ImageIcon
} from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { TransactionStatusBadge } from '@/components/admin/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import type { TransactionStatus } from '@/types/database';

interface DisputeTransaction {
  id: string;
  product_id: string | null;
  seller_id: string | null;
  buyer_id: string | null;
  buyer_telegram_id: number | null;
  amount_ton: number;
  amount_mmk: number | null;
  commission_ton: number;
  seller_receives_ton: number;
  status: TransactionStatus;
  ton_tx_hash: string | null;
  unique_link: string;
  item_sent_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  currency: string;
  buyer_msg_id: number | null;
  products?: {
    title: string;
    description: string | null;
    price_ton: number;
  } | null;
  buyer?: {
    id: string;
    telegram_username: string | null;
    telegram_id: number | null;
    avg_rating: number | null;
    total_ratings: number | null;
  } | null;
  seller?: {
    id: string;
    telegram_username: string | null;
    telegram_id: number | null;
    balance: number;
    balance_mmk: number;
    avg_rating: number | null;
    total_ratings: number | null;
  } | null;
}

interface PaymentInfo {
  id: string;
  screenshot_url: string | null;
  payment_method: string;
  unique_code: string;
  amount_mmk: number;
  status: string;
}

export default function AdminDisputes() {
  const [disputes, setDisputes] = useState<DisputeTransaction[]>([]);
  const [resolvedDisputes, setResolvedDisputes] = useState<DisputeTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDispute, setSelectedDispute] = useState<DisputeTransaction | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [adminNotes, setAdminNotes] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('pending');
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);

  useEffect(() => {
    fetchDisputes();

    const channel = supabase
      .channel('disputes-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => {
        fetchDisputes();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchDisputes = async () => {
    setIsLoading(true);
    try {
      const selectQuery = `
        *,
        products (title, description, price_ton),
        buyer:profiles!transactions_buyer_id_fkey (id, telegram_username, telegram_id, avg_rating, total_ratings),
        seller:profiles!transactions_seller_id_fkey (id, telegram_username, telegram_id, balance, balance_mmk, avg_rating, total_ratings)
      `;

      const [pendingRes, resolvedRes] = await Promise.all([
        supabase.from('transactions').select(selectQuery).eq('status', 'disputed').order('created_at', { ascending: false }),
        supabase.from('transactions').select(selectQuery).in('status', ['completed', 'cancelled']).not('updated_at', 'eq', 'created_at').order('updated_at', { ascending: false }).limit(20),
      ]);

      if (pendingRes.error) throw pendingRes.error;
      setDisputes((pendingRes.data as DisputeTransaction[]) || []);
      
      // Filter resolved that were previously disputed (approximate by checking updated_at != created_at)
      setResolvedDisputes((resolvedRes.data as DisputeTransaction[]) || []);
    } catch (error) {
      console.error('Error fetching disputes:', error);
      toast.error('အငြင်းပွားမှုများ ရယူ၍ မရပါ');
    } finally {
      setIsLoading(false);
    }
  };

  const openDisputeDetail = async (dispute: DisputeTransaction) => {
    setSelectedDispute(dispute);
    setAdminNotes('');
    setPaymentInfo(null);
    
    // Fetch payment info if exists
    const { data: payment } = await supabase
      .from('payments')
      .select('id, screenshot_url, payment_method, unique_code, amount_mmk, status')
      .eq('transaction_id', dispute.id)
      .maybeSingle();
    
    if (payment) setPaymentInfo(payment as PaymentInfo);
  };

  const resolveDispute = async (resolution: 'completed' | 'cancelled') => {
    if (!selectedDispute) return;

    setIsProcessing(true);
    try {
      if (resolution === 'completed' && selectedDispute.seller) {
        // Complete transaction - add funds to seller's balance based on currency
        if (selectedDispute.currency === 'MMK') {
          const newBalance = Number(selectedDispute.seller.balance_mmk) + Number(selectedDispute.seller_receives_ton);
          await supabase.from('profiles').update({ balance_mmk: newBalance }).eq('id', selectedDispute.seller.id);
        } else {
          const newBalance = Number(selectedDispute.seller.balance) + Number(selectedDispute.seller_receives_ton);
          await supabase.from('profiles').update({ balance: newBalance }).eq('id', selectedDispute.seller.id);
        }
      }

      // Update transaction status
      const { error } = await supabase
        .from('transactions')
        .update({
          status: resolution,
          confirmed_at: resolution === 'completed' ? new Date().toISOString() : null,
        })
        .eq('id', selectedDispute.id);

      if (error) throw error;

      // Delete old buyer message if available
      if (selectedDispute.buyer?.telegram_id && selectedDispute.buyer_msg_id) {
        // Will be handled via notify-user
      }

      // Send notifications to both parties
      try {
        if (selectedDispute.buyer?.telegram_id) {
          await supabase.functions.invoke('notify-user', {
            body: {
              type: 'dispute_resolved_buyer',
              telegram_id: selectedDispute.buyer.telegram_id,
              resolution,
              amount: selectedDispute.currency === 'MMK' ? selectedDispute.amount_mmk : selectedDispute.amount_ton,
              currency: selectedDispute.currency,
              product_title: selectedDispute.products?.title,
              admin_notes: adminNotes || undefined,
              seller_username: selectedDispute.seller?.telegram_username,
              buyer_msg_id: selectedDispute.buyer_msg_id ? Number(selectedDispute.buyer_msg_id) : undefined,
              buyer_telegram_id: selectedDispute.buyer.telegram_id,
            },
          });
        }

        if (selectedDispute.seller?.telegram_id) {
          await supabase.functions.invoke('notify-user', {
            body: {
              type: 'dispute_resolved_seller',
              telegram_id: selectedDispute.seller.telegram_id,
              resolution,
              amount: selectedDispute.seller_receives_ton,
              currency: selectedDispute.currency,
              product_title: selectedDispute.products?.title,
              admin_notes: adminNotes || undefined,
              buyer_username: selectedDispute.buyer?.telegram_username,
            },
          });
        }
      } catch (notifyError) {
        console.error('Notification error:', notifyError);
      }

      toast.success(
        resolution === 'completed'
          ? '✅ ရောင်းသူဘက်မှ ဖြေရှင်းပြီး - ငွေပေးပို့ပြီး'
          : '❌ ဝယ်သူဘက်မှ ဖြေရှင်းပြီး - ပယ်ဖျက်ပြီး'
      );

      setSelectedDispute(null);
      setAdminNotes('');
      fetchDisputes();
    } catch (error) {
      console.error('Error resolving dispute:', error);
      toast.error('ဖြေရှင်းမှု မအောင်မြင်ပါ');
    } finally {
      setIsProcessing(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('ကူးယူပြီးပါပြီ');
  };

  const getAmountDisplay = (dispute: DisputeTransaction) => {
    if (dispute.currency === 'MMK') {
      return `${Number(dispute.amount_mmk || 0).toLocaleString()} MMK`;
    }
    return `${Number(dispute.amount_ton).toFixed(4)} TON`;
  };

  const getSellerReceivesDisplay = (dispute: DisputeTransaction) => {
    if (dispute.currency === 'MMK') {
      return `${Number(dispute.seller_receives_ton).toLocaleString()} MMK`;
    }
    return `${Number(dispute.seller_receives_ton).toFixed(4)} TON`;
  };

  const filteredDisputes = (activeTab === 'pending' ? disputes : resolvedDisputes).filter((d) => {
    const matchesSearch = !searchTerm || 
      d.products?.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.buyer?.telegram_username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.seller?.telegram_username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.unique_link.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCurrency = currencyFilter === 'all' || d.currency === currencyFilter;
    return matchesSearch && matchesCurrency;
  });

  const getDisputeDuration = (dispute: DisputeTransaction) => {
    return formatDistanceToNow(new Date(dispute.updated_at), { addSuffix: false });
  };

  return (
    <AdminLayout
      title="အငြင်းပွားမှုများ"
      subtitle="ဖြေရှင်းရန် လိုအပ်သော အငြင်းပွားမှုများ"
    >
      <div className="space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="rounded-lg bg-destructive/10 p-3">
                <ShieldAlert className="h-6 w-6 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold">{disputes.length}</p>
                <p className="text-sm text-muted-foreground">စောင့်ဆိုင်းဆဲ</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="rounded-lg bg-primary/10 p-3">
                <Clock className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {disputes.length > 0 
                    ? getDisputeDuration(disputes[disputes.length - 1])
                    : '-'}
                </p>
                <p className="text-sm text-muted-foreground">အကြာဆုံး</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="rounded-lg bg-accent/50 p-3">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{resolvedDisputes.length}</p>
                <p className="text-sm text-muted-foreground">ဖြေရှင်းပြီး</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="pending" className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  စောင့်ဆိုင်းဆဲ
                  {disputes.length > 0 && (
                    <Badge variant="destructive" className="text-xs">{disputes.length}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="resolved" className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  ဖြေရှင်းပြီး
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="outline" size="sm" onClick={fetchDisputes}>
              <RefreshCw className="mr-2 h-4 w-4" />
              ပြန်လည်ရယူ
            </Button>
          </CardHeader>
          <CardContent>
            {/* Filters */}
            <div className="mb-4 flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="ပစ္စည်း၊ အမည်၊ လင့်ဖြင့် ရှာပါ..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={currencyFilter} onValueChange={setCurrencyFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Currency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">အားလုံး</SelectItem>
                  <SelectItem value="TON">💎 TON</SelectItem>
                  <SelectItem value="MMK">💵 MMK</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-20" />
                ))}
              </div>
            ) : filteredDisputes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <CheckCircle className="mb-4 h-12 w-12 text-green-500" />
                <p className="text-lg font-medium text-foreground">
                  {activeTab === 'pending' ? 'အငြင်းပွားမှု မရှိပါ' : 'ဖြေရှင်းပြီးသား မှတ်တမ်းမရှိပါ'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {activeTab === 'pending' ? 'ဖြေရှင်းရန် လိုအပ်သော အငြင်းပွားမှု မရှိပါ' : ''}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredDisputes.map((dispute) => (
                  <div
                    key={dispute.id}
                    className="group cursor-pointer rounded-lg border p-4 transition-all hover:border-primary/50 hover:shadow-md"
                    onClick={() => openDisputeDetail(dispute)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Package className="h-4 w-4 text-muted-foreground" />
                          <span className="font-semibold">{dispute.products?.title || 'N/A'}</span>
                          <Badge variant={dispute.currency === 'MMK' ? 'secondary' : 'outline'} className="text-xs">
                            {dispute.currency === 'MMK' ? '💵 MMK' : '💎 TON'}
                          </Badge>
                          <TransactionStatusBadge status={dispute.status} />
                        </div>
                        <div className="flex items-center gap-6 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <User className="h-3.5 w-3.5" />
                            ဝယ်သူ: <span className="font-medium text-foreground">@{dispute.buyer?.telegram_username || 'Unknown'}</span>
                            {dispute.buyer?.avg_rating ? (
                              <span className="text-yellow-500">⭐{dispute.buyer.avg_rating}</span>
                            ) : null}
                          </span>
                          <span className="flex items-center gap-1">
                            <User className="h-3.5 w-3.5" />
                            ရောင်းသူ: <span className="font-medium text-foreground">@{dispute.seller?.telegram_username || 'Unknown'}</span>
                            {dispute.seller?.avg_rating ? (
                              <span className="text-yellow-500">⭐{dispute.seller.avg_rating}</span>
                            ) : null}
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg font-bold">{getAmountDisplay(dispute)}</p>
                        <p className="text-xs text-muted-foreground">
                          {activeTab === 'pending' ? (
                            <span className="flex items-center gap-1 justify-end text-destructive">
                              <Clock className="h-3 w-3" />
                              {getDisputeDuration(dispute)} ကြာပြီ
                            </span>
                          ) : (
                            format(new Date(dispute.updated_at), 'yyyy-MM-dd HH:mm')
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detail & Resolve Dialog */}
      <Dialog open={!!selectedDispute} onOpenChange={(open) => { if (!open) { setSelectedDispute(null); setAdminNotes(''); } }}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              အငြင်းပွားမှု အသေးစိတ်
            </DialogTitle>
          </DialogHeader>

          {selectedDispute && (
            <ScrollArea className="flex-1 pr-4">
              <div className="space-y-4">
                {/* Product Info */}
                <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold flex items-center gap-2">
                      <Package className="h-4 w-4" />
                      {selectedDispute.products?.title || 'N/A'}
                    </h4>
                    <Badge variant={selectedDispute.currency === 'MMK' ? 'secondary' : 'outline'}>
                      {selectedDispute.currency}
                    </Badge>
                  </div>
                  {selectedDispute.products?.description && (
                    <p className="text-sm text-muted-foreground">{selectedDispute.products.description}</p>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex justify-between bg-background rounded p-2">
                      <span className="text-muted-foreground">ပမာဏ</span>
                      <span className="font-bold">{getAmountDisplay(selectedDispute)}</span>
                    </div>
                    <div className="flex justify-between bg-background rounded p-2">
                      <span className="text-muted-foreground">ရောင်းသူ ရမည်</span>
                      <span className="font-bold">{getSellerReceivesDisplay(selectedDispute)}</span>
                    </div>
                    <div className="flex justify-between bg-background rounded p-2">
                      <span className="text-muted-foreground">ကော်မရှင်</span>
                      <span className="font-mono">{Number(selectedDispute.commission_ton).toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between bg-background rounded p-2">
                      <span className="text-muted-foreground">Link</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); copyToClipboard(selectedDispute.unique_link); }}
                        className="font-mono text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        {selectedDispute.unique_link.slice(0, 12)}...
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Parties */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border p-3 space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">🛒 ဝယ်သူ</p>
                    <p className="font-medium">@{selectedDispute.buyer?.telegram_username || 'Unknown'}</p>
                    {selectedDispute.buyer?.avg_rating ? (
                      <p className="text-sm text-yellow-600">⭐ {selectedDispute.buyer.avg_rating} ({selectedDispute.buyer.total_ratings} reviews)</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">အဆင့်သတ်မှတ်ချက် မရှိသေး</p>
                    )}
                  </div>
                  <div className="rounded-lg border p-3 space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">🏪 ရောင်းသူ</p>
                    <p className="font-medium">@{selectedDispute.seller?.telegram_username || 'Unknown'}</p>
                    {selectedDispute.seller?.avg_rating ? (
                      <p className="text-sm text-yellow-600">⭐ {selectedDispute.seller.avg_rating} ({selectedDispute.seller.total_ratings} reviews)</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">အဆင့်သတ်မှတ်ချက် မရှိသေး</p>
                    )}
                  </div>
                </div>

                {/* Timeline */}
                <div className="rounded-lg border p-4">
                  <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    အချိန်မှတ်တမ်း
                  </h4>
                  <div className="space-y-3 relative before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                    <div className="flex items-start gap-3 pl-5 relative">
                      <div className="absolute left-0 top-1 h-3.5 w-3.5 rounded-full bg-green-500 ring-2 ring-background" />
                      <div>
                        <p className="text-sm font-medium">ရောင်းဝယ်မှု ဖန်တီး</p>
                        <p className="text-xs text-muted-foreground">{format(new Date(selectedDispute.created_at), 'yyyy-MM-dd HH:mm:ss')}</p>
                      </div>
                    </div>
                    {selectedDispute.item_sent_at && (
                      <div className="flex items-start gap-3 pl-5 relative">
                        <div className="absolute left-0 top-1 h-3.5 w-3.5 rounded-full bg-blue-500 ring-2 ring-background" />
                        <div>
                          <p className="text-sm font-medium">ပစ္စည်းပို့ပြီး</p>
                          <p className="text-xs text-muted-foreground">{format(new Date(selectedDispute.item_sent_at), 'yyyy-MM-dd HH:mm:ss')}</p>
                        </div>
                      </div>
                    )}
                    <div className="flex items-start gap-3 pl-5 relative">
                      <div className="absolute left-0 top-1 h-3.5 w-3.5 rounded-full bg-destructive ring-2 ring-background" />
                      <div>
                        <p className="text-sm font-medium text-destructive">အငြင်းပွား</p>
                        <p className="text-xs text-muted-foreground">{format(new Date(selectedDispute.updated_at), 'yyyy-MM-dd HH:mm:ss')}</p>
                        <p className="text-xs text-destructive mt-1">⏳ {getDisputeDuration(selectedDispute)} ကြာပြီ</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Payment Screenshot */}
                {paymentInfo?.screenshot_url && (
                  <div className="rounded-lg border p-4">
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <ImageIcon className="h-4 w-4" />
                      ငွေပေးချေမှု ပုံ
                    </h4>
                    <div className="flex items-center gap-3">
                      <img
                        src={paymentInfo.screenshot_url}
                        alt="Payment"
                        className="h-20 w-20 rounded-lg object-cover cursor-pointer border hover:ring-2 hover:ring-primary"
                        onClick={() => setScreenshotPreview(paymentInfo.screenshot_url)}
                      />
                      <div className="text-sm space-y-1">
                        <p>Payment: <span className="font-medium">{paymentInfo.payment_method}</span></p>
                        <p>Code: <span className="font-mono text-xs">{paymentInfo.unique_code}</span></p>
                        <p>Amount: <span className="font-bold">{Number(paymentInfo.amount_mmk).toLocaleString()} MMK</span></p>
                      </div>
                    </div>
                  </div>
                )}

                {/* TX Hash */}
                {selectedDispute.ton_tx_hash && (
                  <div className="rounded-lg border p-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">TX Hash</p>
                      <p className="font-mono text-xs">{selectedDispute.ton_tx_hash.slice(0, 24)}...</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => copyToClipboard(selectedDispute.ton_tx_hash!)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                )}

                {/* Resolution Section (only for pending disputes) */}
                {selectedDispute.status === 'disputed' && (
                  <>
                    <Separator />
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label htmlFor="adminNotes" className="flex items-center gap-2">
                          <MessageSquare className="h-4 w-4" />
                          Admin မှတ်ချက် (user များဆီ ပို့ပေးပါမည်)
                        </Label>
                        <Textarea
                          id="adminNotes"
                          placeholder="ဖြေရှင်းချက်အကြောင်းပြချက်ကို ရေးပါ..."
                          value={adminNotes}
                          onChange={(e) => setAdminNotes(e.target.value)}
                          rows={2}
                        />
                      </div>

                      <div className="flex gap-3">
                        <Button
                          className="flex-1"
                          variant="default"
                          onClick={() => resolveDispute('completed')}
                          disabled={isProcessing}
                        >
                          {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                          <div className="text-left">
                            <p className="text-sm">ရောင်းသူ ဘက်မှ</p>
                            <p className="text-[10px] opacity-80">ငွေ → ရောင်းသူ Balance ({getSellerReceivesDisplay(selectedDispute)})</p>
                          </div>
                        </Button>
                        <Button
                          className="flex-1"
                          variant="destructive"
                          onClick={() => resolveDispute('cancelled')}
                          disabled={isProcessing}
                        >
                          {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                          <div className="text-left">
                            <p className="text-sm">ဝယ်သူ ဘက်မှ</p>
                            <p className="text-[10px] opacity-80">ရောင်းဝယ်မှု ပယ်ဖျက်</p>
                          </div>
                        </Button>
                      </div>

                      <p className="text-xs text-destructive text-center">
                        ⚠️ သတိ: ဤဆုံးဖြတ်ချက်သည် ပြန်လည်ပြင်ဆင်၍ မရပါ
                      </p>
                    </div>
                  </>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Screenshot Preview */}
      <Dialog open={!!screenshotPreview} onOpenChange={() => setScreenshotPreview(null)}>
        <DialogContent className="sm:max-w-2xl p-2">
          <DialogHeader className="sr-only">
            <DialogTitle>Payment Screenshot</DialogTitle>
          </DialogHeader>
          {screenshotPreview && (
            <img
              src={screenshotPreview}
              alt="Payment Screenshot"
              className="w-full h-auto max-h-[80vh] object-contain rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
