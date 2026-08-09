-- 允许 anon 列举、下载、删除 vehicle-backups bucket 中的文件
-- （上传由 service_role 的 Edge Function 完成，无需 anon INSERT）

CREATE POLICY "anon_select_vehicle_backups"
  ON storage.objects FOR SELECT
  TO anon
  USING (bucket_id = 'vehicle-backups');

CREATE POLICY "anon_delete_vehicle_backups"
  ON storage.objects FOR DELETE
  TO anon
  USING (bucket_id = 'vehicle-backups');