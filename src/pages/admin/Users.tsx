import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Search, RefreshCw, Wallet, MessageCircle, Plus, Minus, Loader2, Ban, CheckCircle, Filter } from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import type { Profile } from '@/types/database';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type StatusFilter = 'all' | 'active' | 'blocked';

interface ExtendedProfile extends Profile {
  is_blocked?: boolean;
  blocked_at?: string | null;
  blocked_reason?: string | null;
}

export default function AdminUsers() {
  const [users, setUsers] = useState<ExtendedProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedUser, setSelectedUser] = useState<ExtendedProfile | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogAction, setDialogAction] = useState<'add' | 'deduct'>('add');
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Block dialog states
  const [isBlockDialogOpen, setIsBlockDialogOpen] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [isBlocking, setIsBlocking] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUsers((data as ExtendedProfile[]) || []);
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const openBalanceDialog = (user: ExtendedProfile, action: 'add' | 'deduct') => {
    setSelectedUser(user);
    setDialogAction(action);
    setAmount('');
    setIsDialogOpen(true);
  };

  const openBlockDialog = (user: ExtendedProfile) => {
    setSelectedUser(user);
    setBlockReason('');
    setIsBlockDialogOpen(true);
  };

  const handleBlockUser = async () => {
    if (!selectedUser) return;

    setIsBlocking(true);
    try {
      const isCurrentlyBlocked = selectedUser.is_blocked;
      
      const { error } = await supabase
        .from('profiles')
        .update({
          is_blocked: !isCurrentlyBlocked,
          blocked_at: !isCurrentlyBlocked ? new Date().toISOString() : null,
          blocked_reason: !isCurrentlyBlocked ? blockReason || null : null,
        })
        .eq('id', selectedUser.id);

      if (error) throw error;

      toast.success(
        isCurrentlyBlocked
          ? `@${selectedUser.telegram_username || 'User'} ကို unblock လုပ်ပြီးပါပြီ`
          : `@${selectedUser.telegram_username || 'User'} ကို block လုပ်ပြီးပါပြီ`
      );

      setIsBlockDialogOpen(false);
      fetchUsers();
    } catch (error) {
      console.error('Error blocking user:', error);
      toast.error('Block/Unblock မအောင်မြင်ပါ');
    } finally {
      setIsBlocking(false);
    }
  };

  const handleBalanceUpdate = async () => {
    if (!selectedUser || !amount) return;

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error('ပမာဏ မမှန်ကန်ပါ');
      return;
    }

    setIsProcessing(true);
    try {
      const currentBalance = Number(selectedUser.balance);
      let newBalance: number;

      if (dialogAction === 'add') {
        newBalance = currentBalance + amountNum;
      } else {
        if (amountNum > currentBalance) {
          toast.error('လက်ကျန်ငွေထက် ပိုများပါသည်');
          setIsProcessing(false);
          return;
        }
        newBalance = currentBalance - amountNum;
      }

      const { error } = await supabase
        .from('profiles')
        .update({ balance: newBalance })
        .eq('id', selectedUser.id);

      if (error) throw error;

      toast.success(
        dialogAction === 'add'
          ? `${amountNum.toFixed(4)} TON ထည့်ပြီးပါပြီ`
          : `${amountNum.toFixed(4)} TON နုတ်ပြီးပါပြီ`
      );

      setIsDialogOpen(false);
      fetchUsers();
    } catch (error) {
      console.error('Error updating balance:', error);
      toast.error('Balance ပြင်ဆင်မှု မအောင်မြင်ပါ');
    } finally {
      setIsProcessing(false);
    }
  };

  const filteredUsers = users.filter((user) => {
    // Status filter
    if (statusFilter === 'active' && user.is_blocked) return false;
    if (statusFilter === 'blocked' && !user.is_blocked) return false;
    
    // Search filter
    return (
      user.telegram_username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.telegram_id?.toString().includes(searchTerm) ||
      user.ton_wallet_address?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const blockedCount = users.filter(u => u.is_blocked).length;
  const activeCount = users.filter(u => !u.is_blocked).length;

  return (
    <AdminLayout 
      title="အသုံးပြုသူများ" 
      subtitle="စနစ်တွင် စာရင်းသွင်းထားသော အသုံးပြုသူများ"
    >
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-lg">အသုံးပြုသူ စာရင်း</CardTitle>
          <Button variant="outline" size="sm" onClick={fetchUsers}>
            <RefreshCw className="mr-2 h-4 w-4" />
            ပြန်လည်ရယူ
          </Button>
        </CardHeader>
        <CardContent>
          {/* Search and Filters */}
          <div className="mb-6 flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Username, Telegram ID သို့မဟုတ် Wallet ဖြင့် ရှာပါ..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={(value: StatusFilter) => setStatusFilter(value)}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <Filter className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Status စစ်ရန်" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">အားလုံး ({users.length})</SelectItem>
                <SelectItem value="active">Active ({activeCount})</SelectItem>
                <SelectItem value="blocked">Blocked ({blockedCount})</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Telegram</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Wallet လိပ်စာ</TableHead>
                    <TableHead>လက်ကျန် (TON)</TableHead>
                    <TableHead>စာရင်းသွင်းသည့်ရက်</TableHead>
                    <TableHead className="text-right">လုပ်ဆောင်မှု</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-24 text-center">
                        အသုံးပြုသူ မရှိပါ
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map((user) => (
                      <TableRow key={user.id} className={user.is_blocked ? 'bg-destructive/5' : ''}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <MessageCircle className="h-4 w-4 text-primary" />
                            <div>
                              <p className="font-medium">
                                @{user.telegram_username || 'unknown'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                ID: {user.telegram_id || 'N/A'}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {user.is_blocked ? (
                            <Badge variant="destructive" className="gap-1">
                              <Ban className="h-3 w-3" />
                              Blocked
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1 text-green-600 border-green-600">
                              <CheckCircle className="h-3 w-3" />
                              Active
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {user.ton_wallet_address ? (
                            <div className="flex items-center gap-2">
                              <Wallet className="h-4 w-4 text-muted-foreground" />
                              <code className="rounded bg-muted px-2 py-1 text-xs">
                                {user.ton_wallet_address.slice(0, 8)}...{user.ton_wallet_address.slice(-6)}
                              </code>
                            </div>
                          ) : (
                            <Badge variant="secondary">မရှိသေး</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="font-mono font-medium">
                            {Number(user.balance).toFixed(4)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {format(new Date(user.created_at), 'yyyy-MM-dd')}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-green-600 hover:bg-green-50"
                              onClick={() => openBalanceDialog(user, 'add')}
                            >
                              <Plus className="mr-1 h-4 w-4" />
                              ထည့်
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 hover:bg-red-50"
                              onClick={() => openBalanceDialog(user, 'deduct')}
                            >
                              <Minus className="mr-1 h-4 w-4" />
                              နုတ်
                            </Button>
                            <Button
                              size="sm"
                              variant={user.is_blocked ? 'outline' : 'destructive'}
                              onClick={() => openBlockDialog(user)}
                            >
                              {user.is_blocked ? (
                                <>
                                  <CheckCircle className="mr-1 h-4 w-4" />
                                  Unblock
                                </>
                              ) : (
                                <>
                                  <Ban className="mr-1 h-4 w-4" />
                                  Block
                                </>
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Balance Update Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogAction === 'add' ? 'လက်ကျန်ငွေ ထည့်မည်' : 'လက်ကျန်ငွေ နုတ်မည်'}
            </DialogTitle>
            <DialogDescription asChild>
              {selectedUser && (
                <div className="space-y-2 mt-2">
                  <div className="p-3 bg-muted rounded-lg space-y-1">
                    <div className="flex justify-between">
                      <span>အသုံးပြုသူ:</span>
                      <strong>@{selectedUser.telegram_username || 'unknown'}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>လက်ရှိ လက်ကျန်:</span>
                      <strong>{Number(selectedUser.balance).toFixed(4)} TON</strong>
                    </div>
                  </div>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="amount">ပမာဏ (TON)</Label>
              <Input
                id="amount"
                type="number"
                step="0.0001"
                min="0"
                placeholder="0.1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              ပယ်ဖျက်
            </Button>
            <Button
              variant={dialogAction === 'add' ? 'default' : 'destructive'}
              onClick={handleBalanceUpdate}
              disabled={isProcessing || !amount}
            >
              {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {dialogAction === 'add' ? 'ထည့်မည်' : 'နုတ်မည်'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Block/Unblock Dialog */}
      <Dialog open={isBlockDialogOpen} onOpenChange={setIsBlockDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedUser?.is_blocked ? 'အသုံးပြုသူ Unblock လုပ်မည်' : 'အသုံးပြုသူ Block လုပ်မည်'}
            </DialogTitle>
            <DialogDescription asChild>
              {selectedUser && (
                <div className="space-y-2 mt-2">
                  <div className="p-3 bg-muted rounded-lg space-y-1">
                    <div className="flex justify-between">
                      <span>အသုံးပြုသူ:</span>
                      <strong>@{selectedUser.telegram_username || 'unknown'}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Telegram ID:</span>
                      <strong>{selectedUser.telegram_id || 'N/A'}</strong>
                    </div>
                    {selectedUser.is_blocked && selectedUser.blocked_reason && (
                      <div className="flex justify-between">
                        <span>Block အကြောင်းပြချက်:</span>
                        <strong>{selectedUser.blocked_reason}</strong>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>

          {!selectedUser?.is_blocked && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="blockReason">Block အကြောင်းပြချက် (Optional)</Label>
                <Textarea
                  id="blockReason"
                  placeholder="ဥပမာ: စည်းကမ်းချိုးဖောက်မှု၊ လိမ်လည်မှု..."
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBlockDialogOpen(false)}>
              ပယ်ဖျက်
            </Button>
            <Button
              variant={selectedUser?.is_blocked ? 'default' : 'destructive'}
              onClick={handleBlockUser}
              disabled={isBlocking}
            >
              {isBlocking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {selectedUser?.is_blocked ? 'Unblock လုပ်မည်' : 'Block လုပ်မည်'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
