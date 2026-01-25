import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTelegram } from '@/contexts/TelegramContext';
import { useTonConnectUI, useTonAddress, useTonWallet } from '@tonconnect/ui-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertCircle, Star, Wallet, Check, ArrowLeft, Shield } from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';

type Product = Database['public']['Tables']['products']['Row'];
type Profile = Database['public']['Tables']['profiles']['Row'];

interface ProductWithSeller extends Product {
  seller?: Profile;
}

export default function BuyPage() {
  const { productLink } = useParams<{ productLink: string }>();
  const { user, webApp } = useTelegram();
  const [tonConnectUI] = useTonConnectUI();
  const userFriendlyAddress = useTonAddress();
  const wallet = useTonWallet();
  const navigate = useNavigate();
  
  const [product, setProduct] = useState<ProductWithSeller | null>(null);
  const [buyerProfile, setBuyerProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (productLink) {
      fetchProduct();
    }
  }, [productLink]);

  useEffect(() => {
    if (user?.id) {
      fetchBuyerProfile();
    }
  }, [user?.id]);

  useEffect(() => {
    // Setup back button
    if (webApp?.BackButton) {
      webApp.BackButton.show();
      webApp.BackButton.onClick(() => navigate('/app'));
      return () => {
        webApp.BackButton.hide();
      };
    }
  }, [webApp, navigate]);

  const fetchProduct = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('unique_link', productLink)
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;
      
      if (!data) {
        setError('ပစ္စည်းကို ရှာမတွေ့ပါ');
        setIsLoading(false);
        return;
      }

      // Fetch seller info
      const { data: sellerData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.seller_id)
        .maybeSingle();

      setProduct({ ...data, seller: sellerData || undefined });
    } catch (error) {
      console.error('Error fetching product:', error);
      setError('ပစ္စည်း ရယူရာတွင် အမှားရှိနေသည်');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchBuyerProfile = async () => {
    if (!user?.id) return;

    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('telegram_id', user.id)
        .maybeSingle();

      setBuyerProfile(data);
    } catch (error) {
      console.error('Error fetching buyer profile:', error);
    }
  };

  const handleConnectWallet = async () => {
    try {
      await tonConnectUI.openModal();
    } catch (error) {
      console.error('Wallet connect error:', error);
    }
  };

  const handleBuyWithBalance = async () => {
    if (!product || !buyerProfile || !user) return;

    const balance = Number(buyerProfile.balance);
    const price = Number(product.price_ton);

    if (balance < price) {
      webApp?.showAlert('လက်ကျန်ငွေ မလုံလောက်ပါ');
      return;
    }

    setIsPurchasing(true);
    try {
      // Call edge function to process balance purchase
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/miniapp-purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          productLink,
          buyerTelegramId: user.id,
          paymentMethod: 'balance',
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Purchase failed');
      }

      webApp?.HapticFeedback.notificationOccurred('success');
      webApp?.showAlert('ဝယ်ယူမှု အောင်မြင်ပါပြီ!');
      navigate(`/app/order/${result.transactionId}`);
    } catch (error) {
      console.error('Purchase error:', error);
      webApp?.showAlert('ဝယ်ယူမှု မအောင်မြင်ပါ');
    } finally {
      setIsPurchasing(false);
    }
  };

  const handleBuyWithTon = async () => {
    if (!product || !wallet || !user) return;

    setIsPurchasing(true);
    try {
      // Get admin wallet address from settings
      const { data: settings } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'admin_ton_wallet')
        .maybeSingle();

      if (!settings?.value) {
        throw new Error('Admin wallet not configured');
      }

      const amount = Math.floor(Number(product.price_ton) * 1e9); // Convert to nanoTON
      const comment = `BUY:${productLink}:${user.id}`;

      // Send transaction via TON Connect
      const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 600, // 10 minutes
        messages: [
          {
            address: settings.value,
            amount: amount.toString(),
            payload: btoa(comment), // Base64 encode the comment
          },
        ],
      };

      await tonConnectUI.sendTransaction(transaction);
      
      webApp?.HapticFeedback.notificationOccurred('success');
      webApp?.showAlert('ငွေလွှဲပြီးပါပြီ! အတည်ပြုမှု စောင့်ပါ');
      navigate('/app/orders');
    } catch (error) {
      console.error('TON payment error:', error);
      webApp?.showAlert('ငွေလွှဲမှု မအောင်မြင်ပါ');
    } finally {
      setIsPurchasing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h1 className="text-xl font-bold">{error}</h1>
        <Button onClick={() => navigate('/app')} className="mt-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          ပြန်သွားရန်
        </Button>
      </div>
    );
  }

  const hasEnoughBalance = buyerProfile && Number(buyerProfile.balance) >= Number(product.price_ton);

  return (
    <div className="min-h-screen bg-background p-4">
      {/* Product Card */}
      <Card className="mb-4">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-xl">{product.title}</CardTitle>
              <CardDescription>{product.description}</CardDescription>
            </div>
            <Badge variant="outline" className="shrink-0">
              <Shield className="mr-1 h-3 w-3" />
              Escrow
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-primary">
            {Number(product.price_ton).toFixed(2)} TON
          </div>
        </CardContent>
      </Card>

      {/* Seller Info */}
      {product.seller && (
        <Card className="mb-4">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted font-bold">
                {product.seller.telegram_username?.charAt(0) || 'S'}
              </div>
              <div className="flex-1">
                <p className="font-medium">@{product.seller.telegram_username}</p>
                <p className="text-sm text-muted-foreground">ရောင်းသူ</p>
              </div>
              <div className="flex items-center gap-1 text-amber-500">
                <Star className="h-4 w-4 fill-current" />
                <span className="text-sm font-medium">
                  {product.seller.avg_rating?.toFixed(1) || '0.0'}
                </span>
                <span className="text-xs text-muted-foreground">
                  ({product.seller.total_ratings || 0})
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* How It Works */}
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Escrow ဘယ်လိုအလုပ်လုပ်သလဲ?
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-success" />
              <span>သင့်ငွေကို ကျွန်ုပ်တို့ လုံခြုံစွာ သိမ်းထားမည်</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-success" />
              <span>ပစ္စည်းရရှိပြီးမှ ရောင်းသူကို ပေးမည်</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-success" />
              <span>ပြဿနာရှိပါက ငွေပြန်အမ်းနိုင်သည်</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment Options */}
      <div className="space-y-3">
        {/* Balance Payment */}
        {buyerProfile && (
          <Button
            onClick={handleBuyWithBalance}
            disabled={!hasEnoughBalance || isPurchasing}
            variant={hasEnoughBalance ? 'default' : 'outline'}
            className="w-full"
            size="lg"
          >
            {isPurchasing ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Wallet className="mr-2 h-5 w-5" />
            )}
            လက်ကျန်ငွေဖြင့် ဝယ်ရန် ({Number(buyerProfile.balance).toFixed(2)} TON)
          </Button>
        )}

        {/* TON Connect Payment */}
        {userFriendlyAddress ? (
          <Button
            onClick={handleBuyWithTon}
            disabled={isPurchasing}
            variant="outline"
            className="w-full"
            size="lg"
          >
            {isPurchasing ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Wallet className="mr-2 h-5 w-5" />
            )}
            TON Wallet ဖြင့် ဝယ်ရန်
          </Button>
        ) : (
          <Button
            onClick={handleConnectWallet}
            variant="outline"
            className="w-full"
            size="lg"
          >
            <Wallet className="mr-2 h-5 w-5" />
            TON Wallet ချိတ်ဆက်ရန်
          </Button>
        )}
      </div>
    </div>
  );
}
