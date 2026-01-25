-- Remove the foreign key constraint from profiles table
-- This allows telegram users to have profiles without auth.users entry
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;

-- Make user_id nullable for telegram-only users
ALTER TABLE public.profiles ALTER COLUMN user_id DROP NOT NULL;