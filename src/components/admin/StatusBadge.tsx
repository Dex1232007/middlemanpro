import { Badge } from '@/components/ui/badge';
import type { TransactionStatus, WithdrawalStatus } from '@/types/database';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline';

const transactionStatusConfig: Record<TransactionStatus, { label: string; variant: BadgeVariant }> = {
  pending_payment: { label: 'ငွေစောင့်နေသည်', variant: 'warning' },
  payment_received: { label: 'ငွေရရှိပြီး', variant: 'default' },
  item_sent: { label: 'ပစ္စည်းပို့ပြီး', variant: 'default' },
  completed: { label: 'ပြီးစီးပြီး', variant: 'success' },
  cancelled: { label: 'ပယ်ဖျက်ပြီး', variant: 'secondary' },
  disputed: { label: 'အငြင်းပွားနေသည်', variant: 'destructive' },
};

const withdrawalStatusConfig: Record<WithdrawalStatus, { label: string; variant: BadgeVariant }> = {
  pending: { label: 'စောင့်နေသည်', variant: 'warning' },
  approved: { label: 'အတည်ပြုပြီး', variant: 'default' },
  rejected: { label: 'ငြင်းပယ်ပြီး', variant: 'destructive' },
  completed: { label: 'ပြီးစီးပြီး', variant: 'success' },
};

interface TransactionStatusBadgeProps {
  status: TransactionStatus;
}

interface WithdrawalStatusBadgeProps {
  status: WithdrawalStatus;
}

export function TransactionStatusBadge({ status }: TransactionStatusBadgeProps) {
  const config = transactionStatusConfig[status];
  return (
    <Badge variant={config.variant} className="font-medium">
      {config.label}
    </Badge>
  );
}

export function WithdrawalStatusBadge({ status }: WithdrawalStatusBadgeProps) {
  const config = withdrawalStatusConfig[status];
  return (
    <Badge variant={config.variant} className="font-medium">
      {config.label}
    </Badge>
  );
}
