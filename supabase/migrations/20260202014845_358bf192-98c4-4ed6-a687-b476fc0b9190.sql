-- Add MMK balance to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS balance_mmk numeric DEFAULT 0 NOT NULL;

-- Add language preference to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS language text DEFAULT 'my' NOT NULL;

-- Create payment_methods table
CREATE TABLE IF NOT EXISTS public.payment_methods (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  currency text NOT NULL DEFAULT 'MMK',
  is_active boolean NOT NULL DEFAULT true,
  account_info text,
  instructions text,
  icon text,
  sort_order integer DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on payment_methods
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

-- Everyone can view active payment methods
CREATE POLICY "Anyone can view active payment methods" 
ON public.payment_methods 
FOR SELECT 
USING (is_active = true);

-- Admins can manage payment methods
CREATE POLICY "Admins can manage payment methods" 
ON public.payment_methods 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add currency and payment_method to deposits table
ALTER TABLE public.deposits 
ADD COLUMN IF NOT EXISTS currency text DEFAULT 'TON' NOT NULL,
ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'TON',
ADD COLUMN IF NOT EXISTS admin_approved_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS admin_notes text,
ADD COLUMN IF NOT EXISTS screenshot_url text;

-- Add currency to withdrawals table
ALTER TABLE public.withdrawals 
ADD COLUMN IF NOT EXISTS currency text DEFAULT 'TON' NOT NULL,
ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'TON';

-- Add currency to products table (sellers can choose TON or MMK)
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS currency text DEFAULT 'TON' NOT NULL;

-- Add currency to transactions table
ALTER TABLE public.transactions 
ADD COLUMN IF NOT EXISTS currency text DEFAULT 'TON' NOT NULL,
ADD COLUMN IF NOT EXISTS amount_mmk numeric DEFAULT 0;

-- Insert default payment methods
INSERT INTO public.payment_methods (name, code, currency, account_info, instructions, icon, sort_order) VALUES
('TON', 'TON', 'TON', NULL, 'QR Code scan ပြီး ငွေလွှဲပါ', '💎', 0),
('KBZPay', 'KBZPAY', 'MMK', NULL, 'အောက်ပါ Account သို့ ငွေလွှဲပြီး Screenshot ပို့ပါ', '📱', 1),
('WavePay', 'WAVEPAY', 'MMK', NULL, 'အောက်ပါ Account သို့ ငွေလွှဲပြီး Screenshot ပို့ပါ', '📲', 2)
ON CONFLICT (code) DO NOTHING;

-- Create trigger for updated_at on payment_methods
CREATE TRIGGER update_payment_methods_updated_at
BEFORE UPDATE ON public.payment_methods
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();