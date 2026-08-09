
ALTER TABLE employees ADD COLUMN IF NOT EXISTS avatar_url text;

-- Storage bucket for avatars
INSERT INTO storage.buckets (id, name, public)
VALUES ('app-d6jn0ph0piwx_avatars', 'app-d6jn0ph0piwx_avatars', true)
ON CONFLICT (id) DO NOTHING;

-- RLS: authenticated (employee session uses anon key, so we use anon role)
CREATE POLICY "avatar_upload_policy" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'app-d6jn0ph0piwx_avatars');

CREATE POLICY "avatar_update_policy" ON storage.objects
  FOR UPDATE TO anon
  USING (bucket_id = 'app-d6jn0ph0piwx_avatars');

CREATE POLICY "avatar_select_policy" ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'app-d6jn0ph0piwx_avatars');

CREATE POLICY "avatar_delete_policy" ON storage.objects
  FOR DELETE TO anon
  USING (bucket_id = 'app-d6jn0ph0piwx_avatars');
