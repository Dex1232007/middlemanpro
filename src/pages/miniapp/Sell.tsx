import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '@/contexts/TelegramContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Loader2, ArrowLeft, Plus, Package, Copy, Check } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import type { Database } from '@/integrations/supabase/types';

type Product = Database['public']['Tables']['products']['Row'];
type Profile = Database['public']['Tables']['profiles']['Row'];

export default function SellPage() {
  const { user, webApp } = useTelegram();
  const navigate = useNavigate();
  
  const [profile, setProfile] = useState<Profile | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  
  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');

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
      webApp.BackButton.onClick(() => {
        if (showForm) {
          setShowForm(false);
        } else {
          navigate('/app');
        }
      });
      return () => {
        webApp.BackButton.hide();
      };
    }
  }, [webApp, navigate, showForm]);

  const fetchData = async () => {
    if (!user?.id) return;

    try {
      // Get profile
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('telegram_id', user.id)
        .maybeSingle();

      setProfile(profileData);

      if (profileData) {
        // Get products
        const { data: productsData } = await supabase
          .from('products')
          .select('*')
          .eq('seller_id', profileData.id)
          .eq('is_active', true)
          .order('created_at', { ascending: false });

        setProducts(productsData || []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const generateUniqueLink = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 10; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const handleCreateProduct = async () => {
    if (!profile || !title.trim() || !price) {
      webApp?.showAlert('ခေါင်းစဉ်နှင့် ဈေးနှုန်း ထည့်ပါ');
      return;
    }

    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      webApp?.showAlert('ဈေးနှုန်း မှန်ကန်စွာ ထည့်ပါ');
      return;
    }

    setIsCreating(true);
    try {
      const uniqueLink = generateUniqueLink();

      const { data, error } = await supabase
        .from('products')
        .insert({
          seller_id: profile.id,
          title: title.trim(),
          description: description.trim() || null,
          price_ton: priceNum,
          unique_link: uniqueLink,
        })
        .select()
        .single();

      if (error) throw error;

      webApp?.HapticFeedback.notificationOccurred('success');
      setProducts([data, ...products]);
      setShowForm(false);
      setTitle('');
      setDescription('');
      setPrice('');
      
      toast({
        title: "ပစ္စည်း ဖန်တီးပြီးပါပြီ",
        description: "Link ကို share လုပ်နိုင်ပါပြီ",
      });
    } catch (error) {
      console.error('Error creating product:', error);
      webApp?.showAlert('ပစ္စည်း ဖန်တီးရာတွင် အမှားရှိနေသည်');
    } finally {
      setIsCreating(false);
    }
  };

  const copyProductLink = (link: string) => {
    const fullUrl = `https://t.me/${import.meta.env.VITE_BOT_USERNAME || 'your_bot'}?startapp=${link}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedLink(link);
    webApp?.HapticFeedback.impactOccurred('light');
    setTimeout(() => setCopiedLink(null), 2000);
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (showForm) {
    return (
      <div className="min-h-screen bg-background p-4">
        <h1 className="text-2xl font-bold mb-6">ပစ္စည်းအသစ် တင်ရန်</h1>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">ခေါင်းစဉ် *</Label>
            <Input
              id="title"
              placeholder="ပစ္စည်းအမည် ထည့်ပါ"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">ဖော်ပြချက်</Label>
            <Textarea
              id="description"
              placeholder="ပစ္စည်းအကြောင်း ရေးပါ (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="price">ဈေးနှုန်း (TON) *</Label>
            <Input
              id="price"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>

          <Button
            onClick={handleCreateProduct}
            disabled={isCreating || !title.trim() || !price}
            className="w-full"
            size="lg"
          >
            {isCreating ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Plus className="mr-2 h-5 w-5" />
            )}
            ပစ္စည်း ဖန်တီးမည်
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">ရောင်းရန်</h1>
        <Button onClick={() => setShowForm(true)} size="sm">
          <Plus className="mr-1 h-4 w-4" />
          ပစ္စည်းအသစ်
        </Button>
      </div>

      {products.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <CardTitle className="text-lg mb-2">ပစ္စည်း မရှိသေးပါ</CardTitle>
            <CardDescription className="mb-4">
              ပစ္စည်းအသစ် တင်ပြီး ရောင်းရန် link ရယူပါ
            </CardDescription>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="mr-2 h-4 w-4" />
              ပထမဆုံး ပစ္စည်းတင်မည်
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {products.map((product) => (
            <Card key={product.id}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">{product.title}</h3>
                    {product.description && (
                      <p className="text-sm text-muted-foreground line-clamp-1">
                        {product.description}
                      </p>
                    )}
                    <p className="text-lg font-bold text-primary mt-1">
                      {Number(product.price_ton).toFixed(2)} TON
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyProductLink(product.unique_link)}
                  >
                    {copiedLink === product.unique_link ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
