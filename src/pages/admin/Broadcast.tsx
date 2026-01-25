import { useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Send, Users, Wallet, Loader2, CheckCircle, XCircle } from 'lucide-react';

type TargetType = 'all' | 'active' | 'with_balance';

export default function Broadcast() {
  const [message, setMessage] = useState('');
  const [target, setTarget] = useState<TargetType>('all');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    sent: number;
    failed: number;
    total: number;
  } | null>(null);
  const { toast } = useToast();

  const handleBroadcast = async () => {
    if (!message.trim()) {
      toast({
        title: 'မက်ဆေ့ချ် လိုအပ်ပါသည်',
        description: 'ကြေညာချက်ရေးပါ',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await supabase.functions.invoke('broadcast-message', {
        body: { message: message.trim(), target },
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      const data = response.data;

      setResult({
        success: true,
        sent: data.sent,
        failed: data.failed,
        total: data.total,
      });

      toast({
        title: 'ပို့ပြီးပါပြီ',
        description: `${data.sent}/${data.total} ယောက်ဆီ ပို့ပြီးပါပြီ`,
      });

      if (data.sent > 0) {
        setMessage('');
      }
    } catch (error) {
      console.error('Broadcast error:', error);
      toast({
        title: 'အမှား',
        description: 'ကြေညာချက် ပို့၍မရပါ',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminLayout title="ကြေညာချက် ပို့မည်" subtitle="User များအားလုံးဆီ Telegram မှတဆင့် မက်ဆေ့ချ် ပို့ပါ">
      <div className="space-y-6">

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Message Form */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                မက်ဆေ့ချ် ရေးပါ
              </CardTitle>
              <CardDescription>
                Markdown format သုံးနိုင်ပါသည် (*bold*, _italic_)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="message">ကြေညာချက်</Label>
                <Textarea
                  id="message"
                  placeholder="ဥပမာ: စနစ် ပြုပြင်မွမ်းမံမှုကြောင့် ယာယီ ပိတ်ထားပါမည်..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={6}
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  {message.length} / 4000 စာလုံး
                </p>
              </div>

              <div className="space-y-3">
                <Label>ပို့မည့်သူများ</Label>
                <RadioGroup
                  value={target}
                  onValueChange={(val) => setTarget(val as TargetType)}
                  className="space-y-2"
                >
                  <div className="flex items-center space-x-3 rounded-lg border border-border p-3">
                    <RadioGroupItem value="all" id="all" />
                    <Label htmlFor="all" className="flex-1 cursor-pointer">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-primary" />
                        <span>အားလုံး</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Block မခံရသော user အားလုံးဆီ ပို့မည်
                      </p>
                    </Label>
                  </div>

                  <div className="flex items-center space-x-3 rounded-lg border border-border p-3">
                    <RadioGroupItem value="with_balance" id="with_balance" />
                    <Label htmlFor="with_balance" className="flex-1 cursor-pointer">
                      <div className="flex items-center gap-2">
                        <Wallet className="h-4 w-4 text-primary" />
                        <span>လက်ကျန်ငွေရှိသူများ</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Balance ရှိသော user များဆီသာ ပို့မည်
                      </p>
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              <Button
                onClick={handleBroadcast}
                disabled={loading || !message.trim()}
                className="w-full"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ပို့နေသည်...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    ကြေညာချက် ပို့မည်
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Preview & Results */}
          <div className="space-y-6">
            {/* Message Preview */}
            <Card>
              <CardHeader>
                <CardTitle>Preview</CardTitle>
                <CardDescription>User များမြင်ရမည့်ပုံစံ</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg bg-muted p-4 font-mono text-sm">
                  <p className="font-bold">📢 Admin မှ ကြေညာချက်</p>
                  <p className="my-2 text-muted-foreground">━━━━━━━━━━━━━━━</p>
                  <p className="whitespace-pre-wrap">
                    {message || 'ကြေညာချက် ရေးပါ...'}
                  </p>
                  <p className="my-2 text-muted-foreground">━━━━━━━━━━━━━━━</p>
                  <p className="text-xs italic text-muted-foreground">Middleman Bot</p>
                </div>
              </CardContent>
            </Card>

            {/* Results */}
            {result && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {result.sent > 0 ? (
                      <CheckCircle className="h-5 w-5 text-primary" />
                    ) : (
                      <XCircle className="h-5 w-5 text-destructive" />
                    )}
                    ရလဒ်
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div className="rounded-lg bg-muted p-3">
                      <p className="text-2xl font-bold text-foreground">{result.total}</p>
                      <p className="text-xs text-muted-foreground">စုစုပေါင်း</p>
                    </div>
                    <div className="rounded-lg bg-primary/10 p-3">
                      <p className="text-2xl font-bold text-primary">{result.sent}</p>
                      <p className="text-xs text-muted-foreground">ပို့ပြီး</p>
                    </div>
                    <div className="rounded-lg bg-destructive/10 p-3">
                      <p className="text-2xl font-bold text-destructive">{result.failed}</p>
                      <p className="text-xs text-muted-foreground">မရ</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
