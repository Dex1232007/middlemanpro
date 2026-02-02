-- Create storage bucket for deposit screenshots
INSERT INTO storage.buckets (id, name, public)
VALUES ('deposit-screenshots', 'deposit-screenshots', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload screenshots
CREATE POLICY "Users can upload deposit screenshots"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'deposit-screenshots');

-- Allow public read access for admin viewing
CREATE POLICY "Public can view deposit screenshots"
ON storage.objects
FOR SELECT
USING (bucket_id = 'deposit-screenshots');