ALTER TABLE oil_prices
  ADD COLUMN IF NOT EXISTS crude_brent    numeric,
  ADD COLUMN IF NOT EXISTS crude_wti      numeric,
  ADD COLUMN IF NOT EXISTS crude_change_rate numeric,
  ADD COLUMN IF NOT EXISTS crude_calc_text   text,
  ADD COLUMN IF NOT EXISTS crude_updated_at  timestamptz;

COMMENT ON COLUMN oil_prices.crude_brent        IS '布伦特原油当前价格（美元/桶）';
COMMENT ON COLUMN oil_prices.crude_wti          IS 'WTI原油当前价格（美元/桶）';
COMMENT ON COLUMN oil_prices.crude_change_rate  IS '10工作日原油变化率（%，发改委定价机制）';
COMMENT ON COLUMN oil_prices.crude_calc_text    IS '规则测算文本，如 "变化率+8.3%，预计上调+0.62元/升"';
COMMENT ON COLUMN oil_prices.crude_updated_at   IS '原油数据最后更新时间';