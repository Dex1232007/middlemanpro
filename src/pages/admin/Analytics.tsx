import { useEffect, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  Legend
} from 'recharts';
import { TrendingUp, TrendingDown, Users, ArrowLeftRight, Wallet, Calendar } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format, subDays, startOfDay, endOfDay, eachDayOfInterval } from 'date-fns';

interface DailyStats {
  date: string;
  revenueTON: number;
  revenueMMK: number;
  transactionsTON: number;
  transactionsMMK: number;
  users: number;
}

interface SummaryStats {
  totalRevenueTON: number;
  totalRevenueMMK: number;
  totalTransactionsTON: number;
  totalTransactionsMMK: number;
  totalUsers: number;
  revenueTONChange: number;
  revenueMMKChange: number;
  transactionsTONChange: number;
  transactionsMMKChange: number;
  usersChange: number;
}

export default function AdminAnalytics() {
  const [isLoading, setIsLoading] = useState(true);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [summary, setSummary] = useState<SummaryStats>({
    totalRevenueTON: 0,
    totalRevenueMMK: 0,
    totalTransactionsTON: 0,
    totalTransactionsMMK: 0,
    totalUsers: 0,
    revenueTONChange: 0,
    revenueMMKChange: 0,
    transactionsTONChange: 0,
    transactionsMMKChange: 0,
    usersChange: 0,
  });
  const [dateRange, setDateRange] = useState('30');
  const [currencyTab, setCurrencyTab] = useState<'TON' | 'MMK'>('TON');

  useEffect(() => {
    fetchAnalytics();
  }, [dateRange]);

  const fetchAnalytics = async () => {
    setIsLoading(true);
    try {
      const days = parseInt(dateRange);
      const endDate = new Date();
      const startDate = subDays(endDate, days);
      const previousStartDate = subDays(startDate, days);

      // Fetch completed transactions for the period
      const { data: transactions } = await supabase
        .from('transactions')
        .select('amount_ton, amount_mmk, commission_ton, created_at, status, currency')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .eq('status', 'completed');

      // Fetch previous period for comparison
      const { data: prevTransactions } = await supabase
        .from('transactions')
        .select('amount_ton, amount_mmk, commission_ton, created_at, status, currency')
        .gte('created_at', previousStartDate.toISOString())
        .lt('created_at', startDate.toISOString())
        .eq('status', 'completed');

      // Fetch users
      const { data: users } = await supabase
        .from('profiles')
        .select('id, created_at')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());

      const { data: prevUsers } = await supabase
        .from('profiles')
        .select('id, created_at')
        .gte('created_at', previousStartDate.toISOString())
        .lt('created_at', startDate.toISOString());

      // Generate daily stats
      const dateInterval = eachDayOfInterval({ start: startDate, end: endDate });
      const dailyData: DailyStats[] = dateInterval.map(date => {
        const dayStart = startOfDay(date);
        const dayEnd = endOfDay(date);
        
        const dayTransactions = transactions?.filter(t => {
          const txDate = new Date(t.created_at);
          return txDate >= dayStart && txDate <= dayEnd;
        }) || [];

        const dayUsers = users?.filter(u => {
          const userDate = new Date(u.created_at);
          return userDate >= dayStart && userDate <= dayEnd;
        }) || [];

        const tonTx = dayTransactions.filter(t => t.currency === 'TON');
        const mmkTx = dayTransactions.filter(t => t.currency === 'MMK');

        const revenueTON = tonTx.reduce((sum, t) => sum + Number(t.commission_ton || 0), 0);
        const revenueMMK = mmkTx.reduce((sum, t) => sum + Number(t.commission_ton || 0), 0);

        return {
          date: format(date, 'MM/dd'),
          revenueTON: Math.round(revenueTON * 100) / 100,
          revenueMMK: Math.round(revenueMMK * 100) / 100,
          transactionsTON: tonTx.length,
          transactionsMMK: mmkTx.length,
          users: dayUsers.length,
        };
      });

      setDailyStats(dailyData);

      // Calculate summary - separate by currency
      const tonTx = transactions?.filter(t => t.currency === 'TON') || [];
      const mmkTx = transactions?.filter(t => t.currency === 'MMK') || [];
      const prevTonTx = prevTransactions?.filter(t => t.currency === 'TON') || [];
      const prevMmkTx = prevTransactions?.filter(t => t.currency === 'MMK') || [];

      const currentRevenueTON = tonTx.reduce((sum, t) => sum + Number(t.commission_ton || 0), 0);
      const currentRevenueMMK = mmkTx.reduce((sum, t) => sum + Number(t.commission_ton || 0), 0);
      const prevRevenueTON = prevTonTx.reduce((sum, t) => sum + Number(t.commission_ton || 0), 0);
      const prevRevenueMMK = prevMmkTx.reduce((sum, t) => sum + Number(t.commission_ton || 0), 0);
      
      const currentUsers = users?.length || 0;
      const prevUsersCount = prevUsers?.length || 0;

      const calcChange = (current: number, prev: number) => {
        if (prev === 0) return current > 0 ? 100 : 0;
        return Math.round(((current - prev) / prev) * 100);
      };

      setSummary({
        totalRevenueTON: Math.round(currentRevenueTON * 100) / 100,
        totalRevenueMMK: Math.round(currentRevenueMMK * 100) / 100,
        totalTransactionsTON: tonTx.length,
        totalTransactionsMMK: mmkTx.length,
        totalUsers: currentUsers,
        revenueTONChange: calcChange(currentRevenueTON, prevRevenueTON),
        revenueMMKChange: calcChange(currentRevenueMMK, prevRevenueMMK),
        transactionsTONChange: calcChange(tonTx.length, prevTonTx.length),
        transactionsMMKChange: calcChange(mmkTx.length, prevMmkTx.length),
        usersChange: calcChange(currentUsers, prevUsersCount),
      });

    } catch (error) {
      console.error('Analytics fetch error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const StatCard = ({ 
    title, 
    value, 
    change, 
    icon: Icon, 
    suffix = '' 
  }: { 
    title: string; 
    value: number | string; 
    change: number; 
    icon: React.ElementType;
    suffix?: string;
  }) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}{suffix}</div>
        <div className={`flex items-center text-xs ${change >= 0 ? 'text-success' : 'text-destructive'}`}>
          {change >= 0 ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
          {change >= 0 ? '+' : ''}{change}% ယခင်ကာလနှင့် နှိုင်းယှဉ်
        </div>
      </CardContent>
    </Card>
  );

  if (isLoading) {
    return (
      <AdminLayout title="Analytics" subtitle="စာရင်းအင်း ခွဲခြမ်းစိတ်ဖြာမှု">
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
          <Skeleton className="h-80" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Skeleton className="h-80" />
            <Skeleton className="h-80" />
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Analytics" subtitle="စာရင်းအင်း ခွဲခြမ်းစိတ်ဖြာမှု">
      <div className="space-y-6">
        {/* Date Range Selector & Currency Tab */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <Tabs value={currencyTab} onValueChange={(v) => setCurrencyTab(v as 'TON' | 'MMK')}>
            <TabsList>
              <TabsTrigger value="TON" className="flex items-center gap-2">
                💎 TON
              </TabsTrigger>
              <TabsTrigger value="MMK" className="flex items-center gap-2">
                💵 MMK
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>လွန်ခဲ့သော {dateRange} ရက်အတွင်း</span>
            </div>
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">၇ ရက်</SelectItem>
                <SelectItem value="14">၁၄ ရက်</SelectItem>
                <SelectItem value="30">၃၀ ရက်</SelectItem>
                <SelectItem value="60">၆၀ ရက်</SelectItem>
                <SelectItem value="90">၉၀ ရက်</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            title={`${currencyTab === 'TON' ? '💎 TON' : '💵 MMK'} ဝင်ငွေ (Commission)`}
            value={currencyTab === 'TON' 
              ? summary.totalRevenueTON.toFixed(2)
              : summary.totalRevenueMMK.toLocaleString()
            }
            change={currencyTab === 'TON' ? summary.revenueTONChange : summary.revenueMMKChange}
            icon={Wallet}
            suffix={currencyTab === 'TON' ? ' TON' : ' K'}
          />
          <StatCard
            title={`${currencyTab === 'TON' ? '💎' : '💵'} ပြီးစီးသော အရောင်းအဝယ်`}
            value={currencyTab === 'TON' ? summary.totalTransactionsTON : summary.totalTransactionsMMK}
            change={currencyTab === 'TON' ? summary.transactionsTONChange : summary.transactionsMMKChange}
            icon={ArrowLeftRight}
          />
          <StatCard
            title="အသုံးပြုသူ အသစ်"
            value={summary.totalUsers}
            change={summary.usersChange}
            icon={Users}
          />
        </div>

        {/* Revenue Chart */}
        <Card>
          <CardHeader>
            <CardTitle>💰 နေ့စဉ် {currencyTab} Commission ဝင်ငွေ</CardTitle>
            <CardDescription>ပြီးစီးသော {currencyTab} အရောင်းအဝယ်များမှ ရရှိသော commission</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyStats}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="date" 
                    className="text-xs"
                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <YAxis 
                    className="text-xs"
                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                    tickFormatter={(value) => currencyTab === 'TON' ? `${value} TON` : `${value} K`}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                    formatter={(value: number) => [
                      currencyTab === 'TON' ? `${value.toFixed(4)} TON` : `${value.toLocaleString()} K`, 
                      'Revenue'
                    ]}
                  />
                  <Area 
                    type="monotone" 
                    dataKey={currencyTab === 'TON' ? 'revenueTON' : 'revenueMMK'} 
                    stroke="hsl(var(--primary))" 
                    fillOpacity={1} 
                    fill="url(#colorRevenue)" 
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Transaction Volume & User Growth */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Transaction Volume */}
          <Card>
            <CardHeader>
              <CardTitle>📊 {currencyTab} အရောင်းအဝယ် အရေအတွက်</CardTitle>
              <CardDescription>နေ့စဉ် ပြီးစီးသော {currencyTab} အရောင်းအဝယ် အရေအတွက်</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyStats}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="date" 
                      className="text-xs"
                      tick={{ fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <YAxis 
                      className="text-xs"
                      tick={{ fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                      formatter={(value: number) => [value, 'Transactions']}
                    />
                    <Bar 
                      dataKey={currencyTab === 'TON' ? 'transactionsTON' : 'transactionsMMK'} 
                      fill="hsl(var(--primary))" 
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* User Growth */}
          <Card>
            <CardHeader>
              <CardTitle>👥 အသုံးပြုသူ တိုးတက်မှု</CardTitle>
              <CardDescription>နေ့စဉ် စာရင်းသွင်းသော အသုံးပြုသူ အသစ်များ</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyStats}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="date" 
                      className="text-xs"
                      tick={{ fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <YAxis 
                      className="text-xs"
                      tick={{ fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                      formatter={(value: number) => [value, 'New Users']}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="users" 
                      stroke="hsl(var(--chart-2))" 
                      strokeWidth={2}
                      dot={{ fill: 'hsl(var(--chart-2))', strokeWidth: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Combined Chart */}
        <Card>
          <CardHeader>
            <CardTitle>📈 ခြုံငုံသုံးသပ်ချက် - TON vs MMK</CardTitle>
            <CardDescription>TON နှင့် MMK Transaction Volume နှိုင်းယှဉ်ချက်</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyStats}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="date" 
                    className="text-xs"
                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <YAxis 
                    className="text-xs"
                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Legend />
                  <Bar 
                    dataKey="transactionsTON" 
                    name="💎 TON"
                    fill="hsl(var(--primary))" 
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar 
                    dataKey="transactionsMMK" 
                    name="💵 MMK"
                    fill="hsl(var(--chart-2))" 
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
