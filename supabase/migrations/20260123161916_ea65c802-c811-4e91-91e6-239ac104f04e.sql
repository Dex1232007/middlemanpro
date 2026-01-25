-- Allow admins to INSERT new settings rows (required for upsert when a key doesn't exist)
CREATE POLICY "Admins can insert settings"
ON public.settings
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
