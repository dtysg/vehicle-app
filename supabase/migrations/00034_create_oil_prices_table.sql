
-- 全国各省市油价表（管理员通过AI搜索写入，App读取展示）
CREATE TABLE IF NOT EXISTS oil_prices (
  id          BIGSERIAL PRIMARY KEY,
  city        TEXT NOT NULL UNIQUE,          -- 省市名，如"天津"
  p92         TEXT NOT NULL DEFAULT '',      -- 92#汽油 元/升
  p95         TEXT NOT NULL DEFAULT '',      -- 95#汽油 元/升
  p98         TEXT NOT NULL DEFAULT '',      -- 98#汽油 元/升
  p0          TEXT NOT NULL DEFAULT '',      -- 0#柴油 元/升
  pm10        TEXT NOT NULL DEFAULT '',      -- -10#柴油
  pm20        TEXT NOT NULL DEFAULT '',      -- -20#柴油
  pm35        TEXT NOT NULL DEFAULT '',      -- -35#柴油
  update_date TEXT NOT NULL DEFAULT '',      -- 本次调价日期 YYYY-MM-DD
  trend       NUMERIC(6,2) NOT NULL DEFAULT 0,   -- 本次涨跌幅度 元/升
  trend_date  TEXT NOT NULL DEFAULT '',
  next_adjust_date TEXT NOT NULL DEFAULT '', -- 下次调价窗口日期
  next_trend  NUMERIC(6,3) NOT NULL DEFAULT 0,   -- 预计涨跌幅度
  next_trend_text TEXT NOT NULL DEFAULT '',  -- 预计涨跌描述
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- 最后更新时间
  source      TEXT NOT NULL DEFAULT 'admin'  -- 数据来源标记
);

-- 按 fetched_at 排序索引（用于查最新）
CREATE INDEX IF NOT EXISTS idx_oil_prices_city ON oil_prices(city);

-- RLS
ALTER TABLE oil_prices ENABLE ROW LEVEL SECURITY;

-- 所有登录用户可读
CREATE POLICY "oil_prices_read" ON oil_prices
  FOR SELECT USING (auth.role() = 'authenticated');

-- 只有 service_role 可写（EF 用 service_role key 写入）
CREATE POLICY "oil_prices_admin_write" ON oil_prices
  FOR ALL USING (auth.role() = 'service_role');
