
-- 新增均价来源字段（eia / baidu_ai / cache / brent_fallback）
ALTER TABLE oil_prices
  ADD COLUMN IF NOT EXISTS crude_avg10d_source TEXT DEFAULT 'eia',
  ADD COLUMN IF NOT EXISTS crude_avg10d_ai_snapshot NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS crude_avg10d_ai_updated_at TIMESTAMPTZ;
