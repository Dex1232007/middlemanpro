-- Add referral_code to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES public.profiles(id),
ADD COLUMN IF NOT EXISTS total_referral_earnings NUMERIC DEFAULT 0;

-- Create index for referral_code lookups
CREATE INDEX IF NOT EXISTS idx_profiles_referral_code ON public.profiles(referral_code);

-- Create referrals table to track referral relationships
CREATE TABLE public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referred_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level IN (1, 2)),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(referrer_id, referred_id)
);

-- Create referral_earnings table to track commission earnings
CREATE TABLE public.referral_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  from_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  from_transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  amount_ton NUMERIC NOT NULL,
  level INTEGER NOT NULL CHECK (level IN (1, 2)),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_earnings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for referrals
CREATE POLICY "Admins can view all referrals"
ON public.referrals FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view own referrals"
ON public.referrals FOR SELECT
USING (referrer_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()));

-- RLS Policies for referral_earnings
CREATE POLICY "Admins can view all referral earnings"
ON public.referral_earnings FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view own referral earnings"
ON public.referral_earnings FOR SELECT
USING (referrer_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()));

-- Create indexes for performance
CREATE INDEX idx_referrals_referrer ON public.referrals(referrer_id);
CREATE INDEX idx_referrals_referred ON public.referrals(referred_id);
CREATE INDEX idx_referral_earnings_referrer ON public.referral_earnings(referrer_id);
CREATE INDEX idx_referral_earnings_transaction ON public.referral_earnings(from_transaction_id);

-- Insert default referral settings
INSERT INTO public.settings (key, value, description)
VALUES 
  ('referral_l1_rate', '10', 'Level 1 referral commission rate (%)'),
  ('referral_l2_rate', '5', 'Level 2 referral commission rate (%)')
ON CONFLICT (key) DO NOTHING;