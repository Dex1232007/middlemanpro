export type TransactionStatus = 'pending_payment' | 'payment_received' | 'item_sent' | 'completed' | 'cancelled' | 'disputed';

export type WithdrawalStatus = 'pending' | 'approved' | 'rejected' | 'completed';

export type AppRole = 'admin' | 'user';

export interface Profile {
  id: string;
  user_id: string;
  telegram_id: number | null;
  telegram_username: string | null;
  ton_wallet_address: string | null;
  balance: number;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  product_id: string | null;
  seller_id: string | null;
  buyer_id: string | null;
  buyer_telegram_id: number | null;
  amount_ton: number;
  commission_ton: number;
  seller_receives_ton: number;
  status: TransactionStatus;
  ton_tx_hash: string | null;
  unique_link: string;
  item_sent_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  seller?: Profile;
  buyer?: Profile;
  product?: Product;
}

export interface Product {
  id: string;
  seller_id: string;
  title: string;
  description: string | null;
  price_ton: number;
  unique_link: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  seller?: Profile;
}

export interface Withdrawal {
  id: string;
  profile_id: string;
  amount_ton: number;
  destination_wallet: string;
  status: WithdrawalStatus;
  ton_tx_hash: string | null;
  admin_notes: string | null;
  created_at: string;
  processed_at: string | null;
  currency: string;
  payment_method: string | null;
  telegram_msg_id: number | null;
  profile?: Profile;
}

export interface Deposit {
  id: string;
  profile_id: string;
  amount_ton: number;
  ton_tx_hash: string | null;
  is_confirmed: boolean;
  created_at: string;
  confirmed_at: string | null;
  profile?: Profile;
}

export interface Setting {
  id: string;
  key: string;
  value: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
  created_at: string;
}

export interface DashboardStats {
  totalTransactions: number;
  pendingTransactions: number;
  completedTransactions: number;
  totalVolume: number;
  totalCommission: number;
  totalUsers: number;
  pendingWithdrawals: number;
}
