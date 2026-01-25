import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTelegram } from '@/contexts/TelegramContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertCircle, ArrowLeft, Package, Check, Send, AlertTriangle, Star } from 'lucide-react';
import { format } from 'date-fns';
import type { Database } from '@/integrations/supabase/types';

type Transaction = Database['public']['Tables']['transactions']['Row'];
type Profile = Database['public']['Tables']['profiles']['Row'];

interface TransactionWithDetails extends Transaction {
  product?: {
    title: string;
    description: string | null;
  };
  buyer?: Profile;
  seller?: Profile;
  myRole?: 'buyer' | 'seller';
}

const statusConfig: Record<string, { 
  label: string; 
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  description: string;
}> = {
  pending_payment: { 
    label: 'ငွေစောင့်နေသည်', 
    variant: 'outline',
    description: 'ဝယ်သူ ငွေပေးချေရန် စောင့်နေသည်'
  },
  payment_received: { 
    label: 'ငွေရရှိပြီး', 
    variant: 'default',
    description: 'ရောင်းသူ ပစ္စည်းပို့ရန် စောင့်နေသည်'
  },
  item_sent: { 
    label: 'ပစ္စည်းပို့ပြီး', 
    variant: 'default',
    description: 'ဝယ်သူ ပစ္စည်းရရှိကြောင်း အတည်ပြုရန်'
  },
  completed: { 
    label: 'ပြီးစီးပြီး', 
    variant: 'secondary',
    description: 'ရောင်းဝယ်မှု အောင်မြင်စွာ ပြီးဆုံးပြီ'
  },
  cancelled: { 
    label: 'ပယ်ဖျက်ပြီး', 
    variant: 'destructive',
    description: 'ရောင်းဝယ်မှု ပယ်ဖျက်ပြီး'
  },
  disputed: { 
    label: 'အငြင်းပွား', 
    variant: 'destructive',
    description: 'Admin စစ်ဆေးနေသည်'
  },
};

export default function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { user, webApp } = useTelegram();
  const navigate = useNavigate();
  
  const [transaction, setTransaction] = useState<TransactionWithDetails | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (orderId && user?.id) {
      fetchData();
    } else {
      setIsLoading(false);
    }
  }, [orderId, user?.id]);

  useEffect(() => {
    if (webApp?.BackButton) {
      webApp.BackButton.show();
      webApp.BackButton.onClick(() => navigate('/app/orders'));
      return () => {
        webApp.BackButton.hide();
      };
    }
  }, [webApp, navigate]);

  // Realtime subscription
  useEffect(() => {
    if (!orderId) return;

    const channel = supabase
      .channel(`order-${orderId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'transactions', filter: `id=eq.${orderId}` },
        () => {
          fetchData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orderId]);

  const fetchData = async () => {
    if (!orderId || !user?.id) return;

    try {
      // Get my profile first
      const { data: myProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('telegram_id', user.id)
        .maybeSingle();

      if (!myProfile) {
        setError('Profile မရှိပါ');
        setIsLoading(false);
        return;
      }

      setProfile(myProfile);

      // Get transaction
      const { data: txData, error: txError } = await supabase
        .from('transactions')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();

      if (txError) throw txError;
      if (!txData) {
        setError('အော်ဒါ ရှာမတွေ့ပါ');
        setIsLoading(false);
        return;
      }

      // Determine my role
      const myRole = txData.buyer_id === myProfile.id ? 'buyer' : 
                     txData.seller_id === myProfile.id ? 'seller' : undefined;

      if (!myRole) {
        setError('ဒီအော်ဒါကို ကြည့်ခွင့် မရှိပါ');
        setIsLoading(false);
        return;
      }

      // Fetch product
      let product;
      if (txData.product_id) {
        const { data: productData } = await supabase
          .from('products')
          .select('title, description')
          .eq('id', txData.product_id)
          .maybeSingle();
        product = productData || undefined;
      }

      // Fetch other party
      const otherPartyId = myRole === 'buyer' ? txData.seller_id : txData.buyer_id;
      let otherParty;
      if (otherPartyId) {
        const { data: partyData } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', otherPartyId)
          .maybeSingle();
        
        if (myRole === 'buyer') {
          (txData as TransactionWithDetails).seller = partyData || undefined;
        } else {
          (txData as TransactionWithDetails).buyer = partyData || undefined;
        }
      }

      setTransaction({
        ...txData,
        product,
        myRole,
      });
    } catch (error) {
      console.error('Error fetching order:', error);
      setError('အော်ဒါ ရယူရာတွင် အမှားရှိနေသည်');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAction = async (action: 'item_sent' | 'confirm_received' | 'dispute') => {
    if (!transaction || !user) return;

    setIsProcessing(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/miniapp-action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transactionId: transaction.id,
          action,
          telegramId: user.id,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Action failed');
      }

      webApp?.HapticFeedback.notificationOccurred('success');
      fetchData(); // Refresh
    } catch (error) {
      console.error('Action error:', error);
      webApp?.showAlert('လုပ်ဆောင်မှု မအောင်မြင်ပါ');
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !transaction) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h1 className="text-xl font-bold">{error}</h1>
        <Button onClick={() => navigate('/app/orders')} className="mt-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          အော်ဒါများ
        </Button>
      </div>
    );
  }

  const status = statusConfig[transaction.status] || { 
    label: transaction.status, 
    variant: 'outline' as const,
    description: ''
  };

  const isBuyer = transaction.myRole === 'buyer';
  const isSeller = transaction.myRole === 'seller';

  return (
    <div className="min-h-screen bg-background p-4">
      {/* Status Header */}
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">အော်ဒါ အသေးစိတ်</CardTitle>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <CardDescription>{status.description}</CardDescription>
        </CardHeader>
      </Card>

      {/* Product Info */}
      <Card className="mb-4">
        <CardContent className="pt-4">
          <h3 className="font-semibold">{transaction.product?.title || 'ပစ္စည်း'}</h3>
          {transaction.product?.description && (
            <p className="text-sm text-muted-foreground">{transaction.product.description}</p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">ပမာဏ:</span>
              <p className="font-bold text-lg text-primary">{Number(transaction.amount_ton).toFixed(2)} TON</p>
            </div>
            <div>
              <span className="text-muted-foreground">ရက်စွဲ:</span>
              <p>{format(new Date(transaction.created_at), 'yyyy-MM-dd HH:mm')}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Other Party Info */}
      <Card className="mb-4">
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted font-bold">
              {isBuyer 
                ? transaction.seller?.telegram_username?.charAt(0) || 'S'
                : transaction.buyer?.telegram_username?.charAt(0) || 'B'
              }
            </div>
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">
                {isBuyer ? 'ရောင်းသူ' : 'ဝယ်သူ'}
              </p>
              <p className="font-medium">
                @{isBuyer 
                  ? transaction.seller?.telegram_username 
                  : transaction.buyer?.telegram_username
                }
              </p>
            </div>
            {(isBuyer ? transaction.seller : transaction.buyer) && (
              <div className="flex items-center gap-1 text-amber-500">
                <Star className="h-4 w-4 fill-current" />
                <span className="text-sm font-medium">
                  {(isBuyer 
                    ? transaction.seller?.avg_rating 
                    : transaction.buyer?.avg_rating
                  )?.toFixed(1) || '0.0'}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="space-y-3">
        {/* Seller: Mark as Sent */}
        {isSeller && transaction.status === 'payment_received' && (
          <Button 
            onClick={() => handleAction('item_sent')} 
            disabled={isProcessing}
            className="w-full"
            size="lg"
          >
            {isProcessing ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Send className="mr-2 h-5 w-5" />
            )}
            ပစ္စည်းပို့ပြီးကြောင်း အတည်ပြုမည်
          </Button>
        )}

        {/* Buyer: Confirm Received */}
        {isBuyer && transaction.status === 'item_sent' && (
          <Button 
            onClick={() => handleAction('confirm_received')} 
            disabled={isProcessing}
            className="w-full"
            size="lg"
          >
            {isProcessing ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Check className="mr-2 h-5 w-5" />
            )}
            ပစ္စည်းရရှိပြီးကြောင်း အတည်ပြုမည်
          </Button>
        )}

        {/* Dispute Button */}
        {['payment_received', 'item_sent'].includes(transaction.status) && (
          <Button 
            onClick={() => {
              webApp?.showConfirm('အငြင်းပွားမှု တင်မည်လား?', (confirmed) => {
                if (confirmed) handleAction('dispute');
              });
            }} 
            disabled={isProcessing}
            variant="destructive"
            className="w-full"
            size="lg"
          >
            <AlertTriangle className="mr-2 h-5 w-5" />
            အငြင်းပွားမှု တင်မည်
          </Button>
        )}
      </div>
    </div>
  );
}
