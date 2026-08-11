-- 创建公开的 APK 存储桶
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'apk-releases',
  'apk-releases',
  true,
  104857600,  -- 100MB 上限
  ARRAY['application/vnd.android.package-archive', 'application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;

-- 允许任何人读取（公开下载）
CREATE POLICY "apk_releases_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'apk-releases');

-- 仅 service_role 或已认证用户可上传（脚本用 anon key 上传，需放开）
CREATE POLICY "apk_releases_upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'apk-releases');