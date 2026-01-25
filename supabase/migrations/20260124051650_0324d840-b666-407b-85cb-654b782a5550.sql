-- Create ratings table for buyer/seller reviews
CREATE TABLE public.ratings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  rater_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rated_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Prevent duplicate ratings for same transaction by same user
  UNIQUE(transaction_id, rater_id)
);

-- Enable RLS
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view ratings"
  ON public.ratings FOR SELECT
  USING (true);

CREATE POLICY "Users can create ratings for their transactions"
  ON public.ratings FOR INSERT
  WITH CHECK (
    rater_id IN (SELECT id FROM profiles WHERE telegram_id IS NOT NULL)
  );

CREATE POLICY "Admins can manage all ratings"
  ON public.ratings FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Create index for faster lookups
CREATE INDEX idx_ratings_rated_id ON public.ratings(rated_id);
CREATE INDEX idx_ratings_transaction_id ON public.ratings(transaction_id);

-- Add avg_rating column to profiles for caching
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avg_rating NUMERIC DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS total_ratings INTEGER DEFAULT 0;

-- Function to update profile rating stats
CREATE OR REPLACE FUNCTION public.update_profile_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.profiles
  SET 
    avg_rating = (SELECT ROUND(AVG(rating)::numeric, 1) FROM public.ratings WHERE rated_id = NEW.rated_id),
    total_ratings = (SELECT COUNT(*) FROM public.ratings WHERE rated_id = NEW.rated_id)
  WHERE id = NEW.rated_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Trigger to auto-update rating stats
CREATE TRIGGER update_rating_stats
AFTER INSERT ON public.ratings
FOR EACH ROW
EXECUTE FUNCTION public.update_profile_rating();

-- Enable realtime for ratings
ALTER PUBLICATION supabase_realtime ADD TABLE public.ratings;