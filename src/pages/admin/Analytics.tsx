import { useEffect, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
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
  revenue: number;
  transactions: number;
  users: number;
}

interface SummaryStats {
  totalRevenue: number;
  totalTransactions: number;
  totalUsers: number;
  revenueChange: number;
  transactionsChange: number;
  usersChange: number;
}

export default function AdminAnalytics() {
  const [isLoading, setIsLoading] = useState(true);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [summary, setSummary] = useState<SummaryStats>({
    totalRevenue: 0,
    totalTransactions: 0,
    totalUsers: 0,
    revenueChange: 0,
    transactionsChange: 0,
    usersChange: 0,
  });
  const [dateRange, setDateRange] = useState('30');

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
        .select('amount_ton, commission_ton, created_at, status')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .eq('status', 'completed');

      // Fetch previous period for comparison
      const { data: prevTransactions } = await supabase
        .from('transactions')
        .select('amount_ton, commission_ton, created_at, status')
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

        const revenue = dayTransactions.reduce((sum, t) => sum + Number(t.commission_ton || 0), 0);

        return {
          date: format(date, 'MM/dd'),
          revenue: Math.round(revenue * 100) / 100,
          transactions: dayTransactions.length,
          users: dayUsers.length,
        };
      });

      setDailyStats(dailyData);

      // Calculate summary
      const currentRevenue = transactions?.reduce((sum, t) => sum + Number(t.commission_ton || 0), 0) || 0;
      const prevRevenue = prevTransactions?.reduce((sum, t) => sum + Number(t.commission_ton || 0), 0) || 0;
      
      const currentTxCount = transactions?.length || 0;
      const prevTxCount = prevTransactions?.length || 0;
      
      const currentUsers = users?.length || 0;
      const prevUsersCount = prevUsers?.length || 0;

      const calcChange = (current: number, prev: number) => {
        if (prev === 0) return current > 0 ? 100 : 0;
        return Math.round(((current - prev) / prev) * 100);
      };

      setSummary({
        totalRevenue: Math.round(currentRevenue * 100) / 100,
        totalTransactions: currentTxCount,
        totalUsers: currentUsers,
        revenueChange: calcChange(currentRevenue, prevRevenue),
        transactionsChange: calcChange(currentTxCount, prevTxCount),
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
        <div className={`flex items-center text-xs ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
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
        {/* Date Range Selector */}
        <div className="flex items-center justify-between">
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

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            title="စုစုပေါင်း ဝင်ငွေ (Commission)"
            value={summary.totalRevenue.toFixed(2)}
            change={summary.revenueChange}
            icon={Wallet}
            suffix=" TON"
          />
          <StatCard
            title="ပြီးစီးသော အရောင်းအဝယ်"
            value={summary.totalTransactions}
            change={summary.transactionsChange}
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
            <CardTitle>💰 နေ့စဉ် Commission ဝင်ငွေ</CardTitle>
            <CardDescription>ပြီးစီးသော အရောင်းအဝယ်များမှ ရရှိသော commission</CardDescription>
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
                    tickFormatter={(value) => `${value} TON`}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                    formatter={(value: number) => [`${value.toFixed(4)} TON`, 'Revenue']}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="revenue" 
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
              <CardTitle>📊 အရောင်းအဝယ် အရေအတွက်</CardTitle>
              <CardDescription>နေ့စဉ် ပြီးစီးသော အရောင်းအဝယ် အရေအတွက်</CardDescription>
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
                      dataKey="transactions" 
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
            <CardTitle>📈 ခြုံငုံသုံးသပ်ချက်</CardTitle>
            <CardDescription>Revenue နှင့် Transaction Volume နှိုင်းယှဉ်ချက်</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyStats}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="date" 
                    className="text-xs"
                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <YAxis 
                    yAxisId="left"
                    className="text-xs"
                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                    tickFormatter={(value) => `${value} TON`}
                  />
                  <YAxis 
                    yAxisId="right"
                    orientation="right"
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
                  <Line 
                    yAxisId="left"
                    type="monotone" 
                    dataKey="revenue" 
                    name="Revenue (TON)"
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line 
                    yAxisId="right"
                    type="monotone" 
                    dataKey="transactions" 
                    name="Transactions"
                    stroke="hsl(var(--chart-3))" 
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
