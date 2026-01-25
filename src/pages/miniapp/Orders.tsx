import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '@/contexts/TelegramContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Package, ShoppingCart } from 'lucide-react';
import { format } from 'date-fns';
import type { Database } from '@/integrations/supabase/types';

type Transaction = Database['public']['Tables']['transactions']['Row'];
type Profile = Database['public']['Tables']['profiles']['Row'];

interface TransactionWithDetails extends Transaction {
  product?: {
    title: string;
  };
  otherParty?: {
    telegram_username: string;
  };
  role: 'buyer' | 'seller';
}

const statusLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending_payment: { label: 'ငွေစောင့်နေသည်', variant: 'outline' },
  payment_received: { label: 'ငွေရရှိပြီး', variant: 'default' },
  item_sent: { label: 'ပစ္စည်းပို့ပြီး', variant: 'default' },
  completed: { label: 'ပြီးစီးပြီး', variant: 'secondary' },
  cancelled: { label: 'ပယ်ဖျက်ပြီး', variant: 'destructive' },
  disputed: { label: 'အငြင်းပွား', variant: 'destructive' },
};

export default function OrdersPage() {
  const { user, webApp } = useTelegram();
  const navigate = useNavigate();
  
  const [profile, setProfile] = useState<Profile | null>(null);
  const [transactions, setTransactions] = useState<TransactionWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'buying' | 'selling'>('buying');

  useEffect(() => {
    if (user?.id) {
      fetchData();
    } else {
      setIsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (webApp?.BackButton) {
      webApp.BackButton.show();
      webApp.BackButton.onClick(() => navigate('/app'));
      return () => {
        webApp.BackButton.hide();
      };
    }
  }, [webApp, navigate]);

  const fetchData = async () => {
    if (!user?.id) return;

    try {
      // Get profile
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('telegram_id', user.id)
        .maybeSingle();

      if (!profileData) {
        setIsLoading(false);
        return;
      }

      setProfile(profileData);

      // Get transactions as buyer
      const { data: buyerTxs } = await supabase
        .from('transactions')
        .select('*')
        .eq('buyer_id', profileData.id)
        .order('created_at', { ascending: false });

      // Get transactions as seller
      const { data: sellerTxs } = await supabase
        .from('transactions')
        .select('*')
        .eq('seller_id', profileData.id)
        .order('created_at', { ascending: false });

      // Combine and add role
      const allTxs: TransactionWithDetails[] = [
        ...(buyerTxs || []).map(tx => ({ ...tx, role: 'buyer' as const })),
        ...(sellerTxs || []).map(tx => ({ ...tx, role: 'seller' as const })),
      ];

      // Fetch product details
      const productIds = [...new Set(allTxs.filter(tx => tx.product_id).map(tx => tx.product_id))];
      if (productIds.length > 0) {
        const { data: products } = await supabase
          .from('products')
          .select('id, title')
          .in('id', productIds);

        if (products) {
          allTxs.forEach(tx => {
            const product = products.find(p => p.id === tx.product_id);
            if (product) {
              tx.product = { title: product.title };
            }
          });
        }
      }

      setTransactions(allTxs);
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredTransactions = transactions.filter(tx => 
    activeTab === 'buying' ? tx.role === 'buyer' : tx.role === 'seller'
  );

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <h1 className="text-2xl font-bold mb-4">အော်ဒါများ</h1>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'buying' | 'selling')}>
        <TabsList className="grid w-full grid-cols-2 mb-4">
          <TabsTrigger value="buying" className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4" />
            ဝယ်ယူမှု
          </TabsTrigger>
          <TabsTrigger value="selling" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            ရောင်းချမှု
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab}>
          {filteredTransactions.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                {activeTab === 'buying' ? (
                  <ShoppingCart className="h-12 w-12 text-muted-foreground mb-4" />
                ) : (
                  <Package className="h-12 w-12 text-muted-foreground mb-4" />
                )}
                <p className="text-muted-foreground">
                  {activeTab === 'buying' ? 'ဝယ်ယူမှု မရှိသေးပါ' : 'ရောင်းချမှု မရှိသေးပါ'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredTransactions.map((tx) => {
                const status = statusLabels[tx.status] || { label: tx.status, variant: 'outline' as const };
                
                return (
                  <Card 
                    key={tx.id}
                    className="cursor-pointer hover:bg-accent/5 transition-colors"
                    onClick={() => navigate(`/app/order/${tx.id}`)}
                  >
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold truncate">
                            {tx.product?.title || 'ပစ္စည်း'}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {format(new Date(tx.created_at), 'yyyy-MM-dd HH:mm')}
                          </p>
                          <p className="text-lg font-bold text-primary mt-1">
                            {Number(tx.amount_ton).toFixed(2)} TON
                          </p>
                        </div>
                        <Badge variant={status.variant}>
                          {status.label}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
