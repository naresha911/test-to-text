CREATE POLICY "Users read own paper images" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'paper-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users upload own paper images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'paper-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users update own paper images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'paper-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete own paper images" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'paper-images' AND auth.uid()::text = (storage.foldername(name))[1]);