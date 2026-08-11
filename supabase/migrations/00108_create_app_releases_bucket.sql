
-- 创建 APK 发布存储桶（公开可读）
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'app-releases',
  'app-releases',
  true,   -- 公开读，APK 下载链接直接可访问
  209715200,  -- 200MB 限制（APK 通常 50-100MB）
  ARRAY['application/vnd.android.package-archive', 'application/octet-stream']
);

-- 所有人可读（公开下载）
CREATE POLICY "public_read_apk"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'app-releases');

-- anon 可上传（应用层由 isPermanentAdmin 控制权限）
CREATE POLICY "anon_upload_apk"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'app-releases');

-- anon 可覆盖（重新发布时替换）
CREATE POLICY "anon_update_apk"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'app-releases');
