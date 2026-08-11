-- 创建 vehicle-backups Storage bucket（私有，仅 service_role 可读写）
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vehicle-backups',
  'vehicle-backups',
  false,
  52428800,  -- 50MB
  ARRAY['application/json']
);

-- RLS: 只允许已认证用户（管理员通过 service_role key 操作，前端用 anon 无权访问）
CREATE POLICY "service_role_all_vehicle_backups"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'vehicle-backups')
  WITH CHECK (bucket_id = 'vehicle-backups');