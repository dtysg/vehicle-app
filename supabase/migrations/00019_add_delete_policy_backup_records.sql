-- 允许 anon 删除 backup_records（前端清空操作）
CREATE POLICY "anon delete backup_records"
  ON backup_records FOR DELETE
  TO anon
  USING (true);