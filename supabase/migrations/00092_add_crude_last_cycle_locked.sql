
-- 为上期均价增加持久化锁定字段，防止 EF/刷新覆盖手动写入值
ALTER TABLE oil_prices
  ADD COLUMN IF NOT EXISTS crude_last_cycle_locked BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS crude_last_cycle_manual  NUMERIC(8,3);

COMMENT ON COLUMN oil_prices.crude_last_cycle_locked IS '管理员手动锁定上期均价标志，为 true 时 EF 不覆盖 crude_last_cycle_avg';
COMMENT ON COLUMN oil_prices.crude_last_cycle_manual  IS '管理员手动设定的上期均价值（$/桶）';
