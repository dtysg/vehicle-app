
-- 管理员手动锁定本期均价
ALTER TABLE oil_prices
  ADD COLUMN IF NOT EXISTS crude_avg10d_manual   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS crude_avg10d_locked   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS crude_avg10d_locked_at TIMESTAMPTZ;
