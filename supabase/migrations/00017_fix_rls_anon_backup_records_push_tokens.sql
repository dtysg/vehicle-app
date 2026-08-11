-- backup_records: 允许 anon（前端匿名 key）读取
DROP POLICY IF EXISTS "authenticated read backup_records" ON backup_records;
CREATE POLICY "anon read backup_records"
  ON backup_records FOR SELECT
  TO anon
  USING (true);

-- push_tokens: 允许 anon 增删改查（前端注册/查询 push token）
DROP POLICY IF EXISTS "authenticated manage push_tokens" ON push_tokens;
CREATE POLICY "anon manage push_tokens"
  ON push_tokens FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);