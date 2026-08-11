-- 调价历史记录表：每期调价时自动追加一条记录
CREATE TABLE IF NOT EXISTS oil_price_history (
  id          bigserial PRIMARY KEY,
  city        text NOT NULL,
  p92         text NOT NULL DEFAULT '',
  p95         text NOT NULL DEFAULT '',
  p98         text NOT NULL DEFAULT '',
  p0          text NOT NULL DEFAULT '',
  trend       numeric NOT NULL DEFAULT 0,   -- 本次涨跌幅（+上涨 -下降）
  update_date text NOT NULL DEFAULT '',      -- 调价日期 YYYY-MM-DD
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- 唯一约束：同一城市+同一调价日只记录一次
CREATE UNIQUE INDEX IF NOT EXISTS oil_price_history_city_date
  ON oil_price_history (city, update_date);

-- RLS：公开可读
ALTER TABLE oil_price_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "oil_price_history_read" ON oil_price_history FOR SELECT USING (true);
CREATE POLICY "oil_price_history_write" ON oil_price_history FOR INSERT WITH CHECK (true);
CREATE POLICY "oil_price_history_update" ON oil_price_history FOR UPDATE USING (true);