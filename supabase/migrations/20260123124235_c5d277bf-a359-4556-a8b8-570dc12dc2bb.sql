-- Fix 1: Restrict user_states policy to service_role only
DROP POLICY IF EXISTS "Service role can manage states" ON public.user_states;

CREATE POLICY "Service role only access"
ON public.user_states
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Fix 2: Move pgcrypto extension from public to extensions schema
DROP EXTENSION IF EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;