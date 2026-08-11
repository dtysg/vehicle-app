-- 添加模拟调价专用字段
-- prev_* 保存模拟前的真实价格，用于对比展示
-- is_simul 标记当前行是否处于模拟状态（true时 oilprice-admin-update 不覆盖）
ALTER TABLE oil_prices
  ADD COLUMN IF NOT EXISTS prev_p92 text DEFAULT '',
  ADD COLUMN IF NOT EXISTS prev_p95 text DEFAULT '',
  ADD COLUMN IF NOT EXISTS prev_p98 text DEFAULT '',
  ADD COLUMN IF NOT EXISTS prev_p0  text DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_simul boolean DEFAULT false;

-- 初始值：所有现有行均为真实数据
UPDATE oil_prices SET is_simul = false WHERE is_simul IS NULL;