CREATE TYPE public.dispute_sender_role AS ENUM ('buyer', 'seller', 'admin');

CREATE TABLE IF NOT EXISTS public.dispute_messages (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    sender_role public.dispute_sender_role NOT NULL,
    message_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.dispute_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all dispute messages" 
ON public.dispute_messages 
FOR SELECT 
USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert dispute messages" 
ON public.dispute_messages 
FOR INSERT 
WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view dispute messages for their transactions" 
ON public.dispute_messages 
FOR SELECT 
USING (
    transaction_id IN (
        SELECT id FROM public.transactions 
        WHERE buyer_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
           OR seller_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    )
);

CREATE POLICY "Users can insert dispute messages for their transactions" 
ON public.dispute_messages 
FOR INSERT 
WITH CHECK (
    transaction_id IN (
        SELECT id FROM public.transactions 
        WHERE buyer_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
           OR seller_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    )
);