-- Add expires_at column to deposits table
ALTER TABLE public.deposits ADD COLUMN expires_at timestamp with time zone;

-- Add status column to deposits (pending, confirmed, expired)
ALTER TABLE public.deposits ADD COLUMN status text NOT NULL DEFAULT 'pending';

-- Add unique_code for deposit identification  
ALTER TABLE public.deposits ADD COLUMN unique_code text;

-- Create index for faster lookups
CREATE INDEX idx_deposits_unique_code ON public.deposits(unique_code);
CREATE INDEX idx_deposits_status ON public.deposits(status);
CREATE INDEX idx_deposits_expires_at ON public.deposits(expires_at);

-- Update existing confirmed deposits
UPDATE public.deposits SET status = 'confirmed' WHERE is_confirmed = true;