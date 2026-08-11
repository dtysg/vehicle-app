-- 允许匿名用户读取油价（油价为公开数据）
DROP POLICY IF EXISTS oil_prices_read ON oil_prices;
CREATE POLICY oil_prices_read ON oil_prices
  FOR SELECT
  USING (true);
