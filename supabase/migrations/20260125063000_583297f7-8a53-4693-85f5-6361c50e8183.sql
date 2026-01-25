-- Add telegram_msg_id column to withdrawals table for live status updates
ALTER TABLE public.withdrawals 
ADD COLUMN IF NOT EXISTS telegram_msg_id bigint;