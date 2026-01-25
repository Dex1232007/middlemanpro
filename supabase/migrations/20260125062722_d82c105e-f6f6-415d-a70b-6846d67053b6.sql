-- Add telegram_msg_id column to track the QR code message for live updates
ALTER TABLE public.deposits 
ADD COLUMN IF NOT EXISTS telegram_msg_id bigint;