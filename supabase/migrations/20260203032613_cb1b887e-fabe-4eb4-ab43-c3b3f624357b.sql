-- Add linked_transaction_id to deposits table for buy-with-deposit flow
ALTER TABLE public.deposits 
ADD COLUMN IF NOT EXISTS linked_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_deposits_linked_transaction ON public.deposits(linked_transaction_id) 
WHERE linked_transaction_id IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.deposits.linked_transaction_id IS 'Links this deposit to a transaction for auto-confirmation after deposit approval';