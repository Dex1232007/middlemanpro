-- Create user_states table for storing bot conversation state
CREATE TABLE public.user_states (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  telegram_id bigint NOT NULL UNIQUE,
  action text NOT NULL,
  msg_id integer,
  data jsonb DEFAULT '{}',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_states ENABLE ROW LEVEL SECURITY;

-- Allow service role to manage states (edge functions use service role)
CREATE POLICY "Service role can manage states"
ON public.user_states
FOR ALL
USING (true)
WITH CHECK (true);

-- Add trigger for updated_at
CREATE TRIGGER update_user_states_updated_at
BEFORE UPDATE ON public.user_states
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster lookups
CREATE INDEX idx_user_states_telegram_id ON public.user_states(telegram_id);