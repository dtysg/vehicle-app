-- 允许已登录用户（authenticated role）写入 oil_prices 表
CREATE POLICY "oil_prices_authenticated_write"
  ON oil_prices
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);