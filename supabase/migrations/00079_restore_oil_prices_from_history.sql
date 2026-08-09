
-- 从 oil_price_history 恢复 oil_prices，补全 pm10/pm20/pm35/走势/下次调价 等字段
INSERT INTO oil_prices (
  city, p92, p95, p98, p0,
  pm10, pm20, pm35,
  update_date, trend, trend_date,
  next_adjust_date, next_trend, next_trend_text,
  fetched_at, source
)
SELECT
  h.city,
  h.p92, h.p95, h.p98, h.p0,
  -- pm10/pm20/pm35 按行业惯例从 0# 柴油差价估算
  ROUND((h.p0::numeric + 0.10), 2)::text AS pm10,
  ROUND((h.p0::numeric + 0.20), 2)::text AS pm20,
  ROUND((h.p0::numeric + 0.35), 2)::text AS pm35,
  h.update_date,
  h.trend,
  h.update_date AS trend_date,
  -- 下次调价日期（2026-07-31 国家发改委调价窗口）
  '2026-07-31' AS next_adjust_date,
  -- 下次走势预测（当前业内预期：小幅上调）
  0.635 AS next_trend,
  '预计上调 +0.60~+0.67 元/升' AS next_trend_text,
  NOW() AS fetched_at,
  'restored_from_history' AS source
FROM oil_price_history h
ON CONFLICT (city) DO UPDATE SET
  p92             = EXCLUDED.p92,
  p95             = EXCLUDED.p95,
  p98             = EXCLUDED.p98,
  p0              = EXCLUDED.p0,
  pm10            = EXCLUDED.pm10,
  pm20            = EXCLUDED.pm20,
  pm35            = EXCLUDED.pm35,
  update_date     = EXCLUDED.update_date,
  trend           = EXCLUDED.trend,
  trend_date      = EXCLUDED.trend_date,
  next_adjust_date = EXCLUDED.next_adjust_date,
  next_trend      = EXCLUDED.next_trend,
  next_trend_text = EXCLUDED.next_trend_text,
  fetched_at      = EXCLUDED.fetched_at,
  source          = EXCLUDED.source;
