import { useEffect, useState } from 'react';
import { Gift, Users, TrendingUp, Trophy, Medal, Award, Crown, Loader2 } from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { StatsCard } from '@/components/admin/StatsCard';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

interface ReferrerData {
  id: string;
  telegram_username: string | null;
  telegram_id: number | null;
  total_referral_earnings: number;
  l1_count: number;
  l2_count: number;
  balance: number;
}

interface ReferralStats {
  totalReferrers: number;
  totalEarnings: number;
  totalL1Referrals: number;
  totalL2Referrals: number;
}

export default function AdminReferrals() {
  const [leaderboard, setLeaderboard] = useState<ReferrerData[]>([]);
  const [stats, setStats] = useState<ReferralStats>({
    totalReferrers: 0,
    totalEarnings: 0,
    totalL1Referrals: 0,
    totalL2Referrals: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchReferralData();
  }, []);

  const fetchReferralData = async () => {
    setIsLoading(true);
    try {
      // Fetch profiles with referral earnings > 0 or have referrals
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, telegram_username, telegram_id, total_referral_earnings, balance')
        .or('total_referral_earnings.gt.0,referral_code.neq.null')
        .order('total_referral_earnings', { ascending: false });

      if (profilesError) throw profilesError;

      // Fetch referral counts for each profile
      const { data: referrals, error: referralsError } = await supabase
        .from('referrals')
        .select('referrer_id, level');

      if (referralsError) throw referralsError;

      // Calculate counts per referrer
      const referralCounts: Record<string, { l1: number; l2: number }> = {};
      referrals?.forEach((ref) => {
        if (!referralCounts[ref.referrer_id]) {
          referralCounts[ref.referrer_id] = { l1: 0, l2: 0 };
        }
        if (ref.level === 1) {
          referralCounts[ref.referrer_id].l1++;
        } else {
          referralCounts[ref.referrer_id].l2++;
        }
      });

      // Build leaderboard with counts
      const leaderboardData: ReferrerData[] = (profiles || [])
        .filter(p => (p.total_referral_earnings || 0) > 0 || referralCounts[p.id])
        .map(p => ({
          id: p.id,
          telegram_username: p.telegram_username,
          telegram_id: p.telegram_id,
          total_referral_earnings: Number(p.total_referral_earnings || 0),
          l1_count: referralCounts[p.id]?.l1 || 0,
          l2_count: referralCounts[p.id]?.l2 || 0,
          balance: Number(p.balance || 0),
        }))
        .sort((a, b) => b.total_referral_earnings - a.total_referral_earnings)
        .slice(0, 10);

      setLeaderboard(leaderboardData);

      // Calculate stats
      const totalEarnings = (profiles || []).reduce((sum, p) => sum + Number(p.total_referral_earnings || 0), 0);
      const totalL1 = referrals?.filter(r => r.level === 1).length || 0;
      const totalL2 = referrals?.filter(r => r.level === 2).length || 0;
      const uniqueReferrers = new Set(referrals?.map(r => r.referrer_id)).size;

      setStats({
        totalReferrers: uniqueReferrers,
        totalEarnings,
        totalL1Referrals: totalL1,
        totalL2Referrals: totalL2,
      });

    } catch (error) {
      console.error('Error fetching referral data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Crown className="h-5 w-5 text-yellow-500" />;
      case 2:
        return <Medal className="h-5 w-5 text-gray-400" />;
      case 3:
        return <Award className="h-5 w-5 text-amber-600" />;
      default:
        return <span className="text-muted-foreground font-medium">#{rank}</span>;
    }
  };

  if (isLoading) {
    return (
      <AdminLayout title="Referral Leaderboard" subtitle="Top Referrers နှင့် Earnings">
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
          <Skeleton className="h-96" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Referral Leaderboard" subtitle="Top Referrers နှင့် Earnings">
      <div className="space-y-6">
        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <StatsCard
            title="စုစုပေါင်း Referrers"
            value={stats.totalReferrers.toString()}
            icon={<Users className="h-6 w-6" />}
            subtitle="Active referrers"
          />
          <StatsCard
            title="စုစုပေါင်း Earnings"
            value={`${stats.totalEarnings.toFixed(2)} TON`}
            icon={<Gift className="h-6 w-6" />}
            subtitle="Total paid out"
          />
          <StatsCard
            title="Level 1 Referrals"
            value={stats.totalL1Referrals.toString()}
            icon={<TrendingUp className="h-6 w-6" />}
            subtitle="Direct referrals"
          />
          <StatsCard
            title="Level 2 Referrals"
            value={stats.totalL2Referrals.toString()}
            icon={<Trophy className="h-6 w-6" />}
            subtitle="Indirect referrals"
          />
        </div>

        {/* Leaderboard Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-yellow-500" />
              Top 10 Referrers
            </CardTitle>
            <CardDescription>
              အများဆုံး Referral Earnings ရရှိသူများ
            </CardDescription>
          </CardHeader>
          <CardContent>
            {leaderboard.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Gift className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">Referral Data မရှိသေးပါ</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Referral earnings ရှိသူများ ပေါ်လာပါမည်
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Rank</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead className="text-center">L1 Referrals</TableHead>
                    <TableHead className="text-center">L2 Referrals</TableHead>
                    <TableHead className="text-right">Total Earnings</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaderboard.map((referrer, index) => (
                    <TableRow key={referrer.id} className={index < 3 ? 'bg-muted/30' : ''}>
                      <TableCell>
                        <div className="flex items-center justify-center">
                          {getRankIcon(index + 1)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {referrer.telegram_username ? `@${referrer.telegram_username}` : `User ${referrer.telegram_id || 'N/A'}`}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            ID: {referrer.id.substring(0, 8)}...
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">
                          {referrer.l1_count}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">
                          {referrer.l2_count}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-semibold text-primary">
                          {referrer.total_referral_earnings.toFixed(4)} TON
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {referrer.balance.toFixed(4)} TON
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
