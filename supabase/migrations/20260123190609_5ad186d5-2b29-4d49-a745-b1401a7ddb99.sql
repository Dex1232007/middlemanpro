-- Add expires_at and buyer_msg_id columns to transactions table for order expiration
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS buyer_msg_id BIGINT;

-- Create index for efficient expired transaction queries
CREATE INDEX IF NOT EXISTS idx_transactions_expires_at ON public.transactions(expires_at) WHERE status = 'pending_payment';