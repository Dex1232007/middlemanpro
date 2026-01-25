-- Add is_blocked column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN is_blocked boolean NOT NULL DEFAULT false;

-- Add blocked_at timestamp
ALTER TABLE public.profiles 
ADD COLUMN blocked_at timestamp with time zone DEFAULT NULL;

-- Add blocked_reason text
ALTER TABLE public.profiles 
ADD COLUMN blocked_reason text DEFAULT NULL;