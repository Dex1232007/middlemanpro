import { useEffect, useState } from 'react';
import { 
  ArrowLeftRight, 
  Users, 
  Wallet, 
  TrendingUp,
  Clock,
  CheckCircle,
  AlertTriangle,
  MessageSquareWarning,
  PiggyBank,
  Calendar,
  RefreshCw,
  X
} from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { StatsCard } from '@/components/admin/StatsCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TransactionStatusBadge } from '@/components/admin/StatusBadge';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { format, subDays, startOfDay, eachDayOfInterval, differenceInDays } from 'date-fns';
import { Link } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
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
  Legend,
} from 'recharts';

interface DashboardStats {
  totalTransactions: number;
  pendingTransactions: number;
  completedTransactions: number;
  disputedTransactions: number;
  totalVolumeTON: number;
  totalVolumeMMK: number;
  totalCommissionTON: number;
  totalCommissionMMK: number;
  totalUsers: number;
  pendingWithdrawals: number;
  pendingDeposits: number;
  confirmedDeposits: number;
}

interface Transaction {
  id: string;
  amount_ton: number;
  status: 'pending_payment' | 'payment_received' | 'item_sent' | 'completed' | 'cancelled' | 'disputed';
  created_at: string;
}

interface ChartData {
  date: string;
  deposits: number;
  withdrawals: number;
  depositAmount: number;
  withdrawalAmount: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(subDays(new Date(), 6));
  const [dateTo, setDateTo] = useState<Date | undefined>(new Date());

  useEffect(() => {
    fetchDashboardData();
  }, [dateFrom, dateTo]);

  const fetchDashboardData = async () => {
    try {
      // Fetch transactions
      const { data: transactions, error: txError } = await supabase
        .from('transactions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

      if (txError) throw txError;

      // Fetch all transactions for stats
      const { data: allTransactions, error: allTxError } = await supabase
        .from('transactions')
        .select('status, amount_ton, amount_mmk, commission_ton, currency');

      if (allTxError) throw allTxError;

      // Fetch users count
      const { count: usersCount, error: usersError } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });

      if (usersError) throw usersError;

      // Fetch pending withdrawals
      const { count: pendingWithdrawals, error: wdError } = await supabase
        .from('withdrawals')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      if (wdError) throw wdError;

      // Fetch deposit stats
      const { data: deposits, error: depError } = await supabase
        .from('deposits')
        .select('status');

      if (depError) throw depError;

      const pendingDeposits = deposits?.filter(d => d.status === 'pending').length || 0;
      const confirmedDeposits = deposits?.filter(d => d.status === 'confirmed').length || 0;

      // Fetch chart data based on date range
      const startDate = dateFrom || subDays(new Date(), 6);
      const endDate = dateTo || new Date();
      
      const dateInterval = eachDayOfInterval({
        start: startOfDay(startDate),
        end: startOfDay(endDate),
      });

      const { data: depositsForChart } = await supabase
        .from('deposits')
        .select('created_at, amount_ton, status')
        .gte('created_at', startOfDay(startDate).toISOString())
        .lte('created_at', new Date(startOfDay(endDate).getTime() + 86399999).toISOString());

      const { data: withdrawalsForChart } = await supabase
        .from('withdrawals')
        .select('created_at, amount_ton, status')
        .gte('created_at', startOfDay(startDate).toISOString())
        .lte('created_at', new Date(startOfDay(endDate).getTime() + 86399999).toISOString());

      const chartDataBuilt: ChartData[] = dateInterval.map(day => {
        const dayStart = startOfDay(day);
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

        const dayDeposits = depositsForChart?.filter(d => {
          const createdAt = new Date(d.created_at);
          return createdAt >= dayStart && createdAt < dayEnd && d.status === 'confirmed';
        }) || [];

        const dayWithdrawals = withdrawalsForChart?.filter(w => {
          const createdAt = new Date(w.created_at);
          return createdAt >= dayStart && createdAt < dayEnd && (w.status === 'approved' || w.status === 'completed');
        }) || [];

        return {
          date: format(day, 'MM/dd'),
          deposits: dayDeposits.length,
          withdrawals: dayWithdrawals.length,
          depositAmount: dayDeposits.reduce((sum, d) => sum + Number(d.amount_ton), 0),
          withdrawalAmount: dayWithdrawals.reduce((sum, w) => sum + Number(w.amount_ton), 0),
        };
      });

      setChartData(chartDataBuilt);

      // Calculate stats
      const completedTx = allTransactions?.filter(t => t.status === 'completed') || [];
      const pendingTx = allTransactions?.filter(t => 
        t.status === 'pending_payment' || t.status === 'payment_received' || t.status === 'item_sent'
      ) || [];
      const disputedTx = allTransactions?.filter(t => t.status === 'disputed') || [];

      // Separate by currency
      const completedTON = completedTx.filter(t => t.currency === 'TON');
      const completedMMK = completedTx.filter(t => t.currency === 'MMK');

      const totalVolumeTON = completedTON.reduce((sum, t) => sum + Number(t.amount_ton), 0);
      const totalVolumeMMK = completedMMK.reduce((sum, t) => sum + Number(t.amount_mmk || 0), 0);
      const totalCommissionTON = completedTON.reduce((sum, t) => sum + Number(t.commission_ton), 0);
      const totalCommissionMMK = completedMMK.reduce((sum, t) => sum + Number(t.commission_ton), 0); // commission stored in commission_ton field

      setStats({
        totalTransactions: allTransactions?.length || 0,
        pendingTransactions: pendingTx.length,
        completedTransactions: completedTx.length,
        disputedTransactions: disputedTx.length,
        totalVolumeTON,
        totalVolumeMMK,
        totalCommissionTON,
        totalCommissionMMK,
        totalUsers: usersCount || 0,
        pendingWithdrawals: pendingWithdrawals || 0,
        pendingDeposits,
        confirmedDeposits,
      });

      setRecentTransactions(transactions as Transaction[] || []);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <AdminLayout title="Dashboard" subtitle="စနစ်အကျဉ်းချုပ်">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Dashboard" subtitle="စနစ်အကျဉ်းချုပ်">
      {/* Stats Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <StatsCard
          title="စုစုပေါင်း ရောင်းဝယ်မှု"
          value={stats?.totalTransactions || 0}
          subtitle={`${stats?.pendingTransactions || 0} ခု စောင့်နေသည်`}
          icon={<ArrowLeftRight className="h-6 w-6" />}
        />
        <StatsCard
          title="စုစုပေါင်း အသုံးပြုသူ"
          value={stats?.totalUsers || 0}
          icon={<Users className="h-6 w-6" />}
        />
        <StatsCard
          title="💎 TON Volume"
          value={`${stats?.totalVolumeTON?.toFixed(2) || '0.00'} TON`}
          subtitle={`ကော်မရှင်: ${stats?.totalCommissionTON?.toFixed(2) || '0.00'} TON`}
          icon={<TrendingUp className="h-6 w-6" />}
        />
        <StatsCard
          title="💵 MMK Volume"
          value={`${(stats?.totalVolumeMMK || 0).toLocaleString()} K`}
          subtitle={`ကော်မရှင်: ${(stats?.totalCommissionMMK || 0).toLocaleString()} K`}
          icon={<Wallet className="h-6 w-6" />}
        />
      </div>

      {/* Quick Stats */}
      <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-5">
        <Card className="border-l-4 border-l-warning">
          <CardContent className="flex items-center gap-4 p-6">
            <Clock className="h-8 w-8 text-warning" />
            <div>
              <p className="text-2xl font-bold">{stats?.pendingTransactions || 0}</p>
              <p className="text-sm text-muted-foreground">စောင့်နေသော ရောင်းဝယ်မှု</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-success">
          <CardContent className="flex items-center gap-4 p-6">
            <CheckCircle className="h-8 w-8 text-success" />
            <div>
              <p className="text-2xl font-bold">{stats?.completedTransactions || 0}</p>
              <p className="text-sm text-muted-foreground">ပြီးစီးပြီးသော ရောင်းဝယ်မှု</p>
            </div>
          </CardContent>
        </Card>
        <Link to="/admin/deposits">
          <Card className="border-l-4 border-l-primary transition-colors hover:bg-accent/50">
            <CardContent className="flex items-center gap-4 p-6">
              <PiggyBank className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{stats?.confirmedDeposits || 0}</p>
                <p className="text-sm text-muted-foreground">ငွေသွင်းမှု ({stats?.pendingDeposits} စောင့်နေ)</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link to="/admin/disputes">
          <Card className="border-l-4 border-l-orange-500 transition-colors hover:bg-accent/50">
            <CardContent className="flex items-center gap-4 p-6">
              <MessageSquareWarning className="h-8 w-8 text-orange-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.disputedTransactions || 0}</p>
                <p className="text-sm text-muted-foreground">အငြင်းပွားမှုများ</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link to="/admin/withdrawals">
          <Card className="border-l-4 border-l-destructive transition-colors hover:bg-accent/50">
            <CardContent className="flex items-center gap-4 p-6">
              <AlertTriangle className="h-8 w-8 text-destructive" />
              <div>
                <p className="text-2xl font-bold">{stats?.pendingWithdrawals || 0}</p>
                <p className="text-sm text-muted-foreground">စောင့်နေသော ငွေထုတ်ယူမှု</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Chart Date Filter */}
      <Card className="mt-6">
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <CardTitle className="text-lg">Chart ရက်စွဲ ရွေးချယ်ရန်</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "justify-start text-left font-normal",
                      !dateFrom && "text-muted-foreground"
                    )}
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {dateFrom ? format(dateFrom, 'yyyy-MM-dd') : 'မှ'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 z-50" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={dateFrom}
                    onSelect={setDateFrom}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              <span className="text-muted-foreground">-</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "justify-start text-left font-normal",
                      !dateTo && "text-muted-foreground"
                    )}
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {dateTo ? format(dateTo, 'yyyy-MM-dd') : 'အထိ'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 z-50" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={dateTo}
                    onSelect={setDateTo}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDateFrom(subDays(new Date(), 6));
                  setDateTo(new Date());
                }}
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                ၇ ရက်
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDateFrom(subDays(new Date(), 29));
                  setDateTo(new Date());
                }}
              >
                ၃၀ ရက်
              </Button>
              {(dateFrom || dateTo) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDateFrom(undefined);
                    setDateTo(undefined);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            {dateFrom && dateTo 
              ? `${format(dateFrom, 'yyyy-MM-dd')} မှ ${format(dateTo, 'yyyy-MM-dd')} အထိ (${differenceInDays(dateTo, dateFrom) + 1} ရက်)`
              : 'ရက်စွဲ ရွေးချယ်ပါ'}
          </p>
        </CardHeader>
      </Card>

      {/* Charts */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Volume Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              ငွေသွင်း/ထုတ် ပမာဏ
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="depositGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="withdrawalGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="date" 
                    className="text-xs fill-muted-foreground"
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis 
                    className="text-xs fill-muted-foreground"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => `${value}`}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    labelStyle={{ color: 'hsl(var(--foreground))' }}
                    formatter={(value: number) => [`${value.toFixed(2)} TON`, '']}
                  />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="depositAmount"
                    name="ငွေသွင်း"
                    stroke="hsl(var(--primary))"
                    fill="url(#depositGradient)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="withdrawalAmount"
                    name="ငွေထုတ်"
                    stroke="hsl(var(--destructive))"
                    fill="url(#withdrawalGradient)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Count Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5 text-primary" />
              ငွေသွင်း/ထုတ် အရေအတွက်
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="date" 
                    className="text-xs fill-muted-foreground"
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis 
                    className="text-xs fill-muted-foreground"
                    tick={{ fontSize: 12 }}
                    allowDecimals={false}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    labelStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Legend />
                  <Bar
                    dataKey="deposits"
                    name="ငွေသွင်း"
                    fill="hsl(var(--primary))"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="withdrawals"
                    name="ငွေထုတ်"
                    fill="hsl(var(--destructive))"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Transactions */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-lg">နောက်ဆုံး ရောင်းဝယ်မှုများ</CardTitle>
        </CardHeader>
        <CardContent>
          {recentTransactions.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              ရောင်းဝယ်မှု မရှိသေးပါ
            </p>
          ) : (
            <div className="space-y-4">
              {recentTransactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="space-y-1">
                    <p className="font-medium">
                      {Number(tx.amount_ton).toFixed(4)} TON
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(tx.created_at), 'yyyy-MM-dd HH:mm')}
                    </p>
                  </div>
                  <TransactionStatusBadge status={tx.status} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </AdminLayout>
  );
}