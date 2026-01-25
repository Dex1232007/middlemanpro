import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { RefreshCw, CheckCircle, XCircle, AlertTriangle, User, Package } from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { TransactionStatusBadge } from '@/components/admin/StatusBadge';
import { Button } from '@/components/ui/button';
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
  commission_ton: number;
  seller_receives_ton: number;
  status: TransactionStatus;
  ton_tx_hash: string | null;
  unique_link: string;
  item_sent_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  products?: {
    title: string;
    description: string | null;
    price_ton: number;
  } | null;
  buyer?: {
    telegram_username: string | null;
    telegram_id: number | null;
  } | null;
  seller?: {
    telegram_username: string | null;
    telegram_id: number | null;
    id: string;
    balance: number;
  } | null;
}

export default function AdminDisputes() {
  const [disputes, setDisputes] = useState<DisputeTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDispute, setSelectedDispute] = useState<DisputeTransaction | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    fetchDisputes();

    // Subscribe to realtime updates
    const channel = supabase
      .channel('disputes-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions' },
        () => {
          fetchDisputes();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchDisputes = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select(`
          *,
          products (title, description, price_ton),
          buyer:profiles!transactions_buyer_id_fkey (telegram_username, telegram_id),
          seller:profiles!transactions_seller_id_fkey (id, telegram_username, telegram_id, balance)
        `)
        .eq('status', 'disputed')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDisputes((data as DisputeTransaction[]) || []);
    } catch (error) {
      console.error('Error fetching disputes:', error);
      toast.error('အငြင်းပွားမှုများ ရယူ၍ မရပါ');
    } finally {
      setIsLoading(false);
    }
  };

  const resolveDispute = async (resolution: 'completed' | 'cancelled') => {
    if (!selectedDispute) return;

    setIsProcessing(true);
    try {
      if (resolution === 'completed' && selectedDispute.seller) {
        // Complete transaction - add funds to seller's balance
        const newBalance = Number(selectedDispute.seller.balance) + Number(selectedDispute.seller_receives_ton);
        
        const { error: balanceError } = await supabase
          .from('profiles')
          .update({ balance: newBalance })
          .eq('id', selectedDispute.seller.id);

        if (balanceError) throw balanceError;
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

      // Send notifications to both parties
      try {
        // Notify buyer
        if (selectedDispute.buyer?.telegram_id) {
          await supabase.functions.invoke('notify-user', {
            body: {
              type: 'dispute_resolved_buyer',
              telegram_id: selectedDispute.buyer.telegram_id,
              resolution,
              amount: selectedDispute.amount_ton,
              product_title: selectedDispute.products?.title,
            },
          });
        }

        // Notify seller
        if (selectedDispute.seller?.telegram_id) {
          await supabase.functions.invoke('notify-user', {
            body: {
              type: 'dispute_resolved_seller',
              telegram_id: selectedDispute.seller.telegram_id,
              resolution,
              amount: selectedDispute.seller_receives_ton,
              product_title: selectedDispute.products?.title,
            },
          });
        }
      } catch (notifyError) {
        console.error('Notification error:', notifyError);
      }

      toast.success(
        resolution === 'completed'
          ? 'ဝယ်သူဘက်မှ ဖြေရှင်းပြီး - ရောင်းသူထံ ငွေပေးပို့ပြီး'
          : 'ရောင်းသူဘက်မှ ဖြေရှင်းပြီး - အရောင်းအဝယ် ပယ်ဖျက်ပြီး'
      );

      setIsDialogOpen(false);
      setSelectedDispute(null);
      fetchDisputes();
    } catch (error) {
      console.error('Error resolving dispute:', error);
      toast.error('ဖြေရှင်းမှု မအောင်မြင်ပါ');
    } finally {
      setIsProcessing(false);
    }
  };

  const openResolveDialog = (dispute: DisputeTransaction) => {
    setSelectedDispute(dispute);
    setIsDialogOpen(true);
  };

  return (
    <AdminLayout
      title="အငြင်းပွားမှုများ"
      subtitle="ဖြေရှင်းရန် လိုအပ်သော အငြင်းပွားမှုများ"
    >
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <CardTitle className="text-lg">အငြင်းပွားမှု စာရင်း</CardTitle>
            {disputes.length > 0 && (
              <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-medium text-destructive-foreground">
                {disputes.length}
              </span>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={fetchDisputes}>
            <RefreshCw className="mr-2 h-4 w-4" />
            ပြန်လည်ရယူ
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          ) : disputes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle className="mb-4 h-12 w-12 text-success" />
              <p className="text-lg font-medium text-foreground">အငြင်းပွားမှု မရှိပါ</p>
              <p className="text-sm text-muted-foreground">ဖြေရှင်းရန် လိုအပ်သော အငြင်းပွားမှု မရှိပါ</p>
            </div>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ရက်စွဲ</TableHead>
                    <TableHead>ပစ္စည်း</TableHead>
                    <TableHead>ပမာဏ</TableHead>
                    <TableHead>ဝယ်သူ</TableHead>
                    <TableHead>ရောင်းသူ</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">လုပ်ဆောင်ချက်</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {disputes.map((dispute) => (
                    <TableRow key={dispute.id}>
                      <TableCell className="font-medium">
                        {format(new Date(dispute.created_at), 'yyyy-MM-dd HH:mm')}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4 text-muted-foreground" />
                          <span className="max-w-[150px] truncate">
                            {dispute.products?.title || 'N/A'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {Number(dispute.amount_ton).toFixed(4)} TON
                        </div>
                        <div className="text-xs text-muted-foreground">
                          ရောင်းသူရ: {Number(dispute.seller_receives_ton).toFixed(4)} TON
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <span>@{dispute.buyer?.telegram_username || 'Unknown'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <span>@{dispute.seller?.telegram_username || 'Unknown'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <TransactionStatusBadge status={dispute.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => openResolveDialog(dispute)}
                        >
                          ဖြေရှင်းမည်
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resolve Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              အငြင်းပွားမှု ဖြေရှင်းမည်
            </DialogTitle>
            <DialogDescription>
              {selectedDispute && (
                <div className="mt-2 space-y-2 text-left">
                  <div className="rounded-lg bg-muted p-3">
                    <p className="font-medium">{selectedDispute.products?.title}</p>
                    <p className="text-sm">ပမာဏ: <strong>{Number(selectedDispute.amount_ton).toFixed(4)} TON</strong></p>
                    <p className="text-sm">ရောင်းသူရမည်: <strong>{Number(selectedDispute.seller_receives_ton).toFixed(4)} TON</strong></p>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span>ဝယ်သူ: @{selectedDispute.buyer?.telegram_username}</span>
                    <span>ရောင်းသူ: @{selectedDispute.seller?.telegram_username}</span>
                  </div>
                  <p className="text-destructive">
                    ⚠️ သတိ: ဤဆုံးဖြတ်ချက်သည် ပြန်လည်ပြင်ဆင်၍ မရပါ
                  </p>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4">
            <Button
              className="w-full justify-start"
              variant="outline"
              onClick={() => resolveDispute('completed')}
              disabled={isProcessing}
            >
              <CheckCircle className="mr-3 h-5 w-5 text-success" />
              <div className="text-left">
                <p className="font-medium">ဝယ်သူဘက်မှ ဖြေရှင်း</p>
                <p className="text-xs text-muted-foreground">
                  ရောင်းသူထံ ငွေပေးပို့မည် ({selectedDispute ? Number(selectedDispute.seller_receives_ton).toFixed(4) : 0} TON)
                </p>
              </div>
            </Button>
            <Button
              className="w-full justify-start"
              variant="outline"
              onClick={() => resolveDispute('cancelled')}
              disabled={isProcessing}
            >
              <XCircle className="mr-3 h-5 w-5 text-destructive" />
              <div className="text-left">
                <p className="font-medium">ရောင်းသူဘက်မှ ဖြေရှင်း</p>
                <p className="text-xs text-muted-foreground">
                  အရောင်းအဝယ် ပယ်ဖျက်မည်
                </p>
              </div>
            </Button>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsDialogOpen(false);
                setSelectedDispute(null);
              }}
              disabled={isProcessing}
            >
              ပယ်ဖျက်
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
