-- 删除旧的 authenticated 写入策略
DROP POLICY IF EXISTS "oil_prices_authenticated_write" ON oil_prices;

-- 明确拆分 INSERT / UPDATE / DELETE，确保 upsert 路径全部覆盖
CREATE POLICY "oil_prices_auth_insert"
  ON oil_prices FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "oil_prices_auth_update"
  ON oil_prices FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "oil_prices_auth_delete"
  ON oil_prices FOR DELETE TO authenticated
  USING (true);