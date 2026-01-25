import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '@/contexts/TelegramContext';
import { useTonConnectUI, useTonAddress } from '@tonconnect/ui-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Wallet, ShoppingBag, Store, Loader2, Star } from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';

type Profile = Database['public']['Tables']['profiles']['Row'];

export default function MiniAppHome() {
  const { user, startParam, webApp } = useTelegram();
  const [tonConnectUI] = useTonConnectUI();
  const userFriendlyAddress = useTonAddress();
  const navigate = useNavigate();
  
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user?.id) {
      fetchProfile();
    } else {
      setIsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    // If there's a start_param (product link), redirect to buy page
    if (startParam && !isLoading && profile) {
      navigate(`/app/buy/${startParam}`);
    }
  }, [startParam, isLoading, profile]);

  const fetchProfile = async () => {
    if (!user?.id) return;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('telegram_id', user.id)
        .maybeSingle();

      if (error) throw error;
      setProfile(data);
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnectWallet = async () => {
    try {
      await tonConnectUI.openModal();
    } catch (error) {
      console.error('Wallet connect error:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      {/* Header */}
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-foreground">MiddleMan Pro</h1>
        <p className="text-sm text-muted-foreground">လုံခြုံစိတ်ချရသော ရောင်းဝယ်ရေး</p>
      </div>

      {/* User Info */}
      {user && (
        <Card className="mb-4">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-lg">
                {user.first_name.charAt(0)}
              </div>
              <div className="flex-1">
                <p className="font-medium">{user.first_name} {user.last_name}</p>
                <p className="text-sm text-muted-foreground">@{user.username}</p>
              </div>
              {profile && (
                <div className="flex items-center gap-1 text-amber-500">
                  <Star className="h-4 w-4 fill-current" />
                  <span className="text-sm font-medium">{profile.avg_rating?.toFixed(1) || '0.0'}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Balance Card */}
      {profile && (
        <Card className="mb-4 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
          <CardContent className="pt-4">
            <p className="text-sm opacity-80">လက်ကျန်ငွေ</p>
            <p className="text-3xl font-bold">{Number(profile.balance).toFixed(2)} TON</p>
          </CardContent>
        </Card>
      )}

      {/* Wallet Connection */}
      <Card className="mb-6">
        <CardContent className="pt-4">
          {userFriendlyAddress ? (
            <div className="flex items-center gap-3">
              <Wallet className="h-5 w-5 text-success" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-muted-foreground">ချိတ်ဆက်ထားသော Wallet</p>
                <p className="font-mono text-sm truncate">{userFriendlyAddress}</p>
              </div>
            </div>
          ) : (
            <Button onClick={handleConnectWallet} className="w-full" size="lg">
              <Wallet className="mr-2 h-5 w-5" />
              TON Wallet ချိတ်ဆက်ရန်
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-4">
        <Card 
          className="cursor-pointer transition-all hover:scale-[1.02] hover:shadow-lg"
          onClick={() => navigate('/app/sell')}
        >
          <CardHeader className="pb-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
              <Store className="h-6 w-6" />
            </div>
          </CardHeader>
          <CardContent>
            <CardTitle className="text-lg">ရောင်းရန်</CardTitle>
            <CardDescription>ပစ္စည်းတင်ရောင်းမယ်</CardDescription>
          </CardContent>
        </Card>

        <Card 
          className="cursor-pointer transition-all hover:scale-[1.02] hover:shadow-lg"
          onClick={() => navigate('/app/orders')}
        >
          <CardHeader className="pb-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ShoppingBag className="h-6 w-6" />
            </div>
          </CardHeader>
          <CardContent>
            <CardTitle className="text-lg">အော်ဒါများ</CardTitle>
            <CardDescription>ရောင်းဝယ်မှု မှတ်တမ်း</CardDescription>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
