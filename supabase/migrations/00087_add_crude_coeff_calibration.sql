-- 原油系数标定历史表
-- 每次实际调价后，将"当时的原油价差"和"实际调价幅度"写入此表
-- 系统据此动态推算最优系数区间
CREATE TABLE IF NOT EXISTS crude_coeff_calibration (
  id              bigserial PRIMARY KEY,
  adjust_date     text NOT NULL,          -- 调价日 YYYY-MM-DD
  city            text NOT NULL DEFAULT '天津', -- 参考城市（天津作为基准）
  crude_brent     numeric NOT NULL,        -- 调价时布伦特现价
  crude_base      numeric NOT NULL,        -- 发改委基准均价（上期均价）
  raw_diff        numeric NOT NULL,        -- 价差 = crude_brent - crude_base
  actual_delta    numeric NOT NULL,        -- 实际调价幅度（元/升，上调为正）
  coeff           numeric NOT NULL,        -- 倒推系数 = actual_delta / raw_diff
  change_rate     numeric,                 -- 变化率%
  recorded_at     timestamptz DEFAULT now(),
  note            text                     -- 备注（如数据来源）
);

-- 唯一约束：同一城市同一调价日只记录一次
CREATE UNIQUE INDEX IF NOT EXISTS idx_crude_calib_city_date
  ON crude_coeff_calibration(city, adjust_date);

-- 在 oil_prices 表添加系数字段（存当前动态标定系数）
ALTER TABLE oil_prices
  ADD COLUMN IF NOT EXISTS crude_coeff_low  numeric DEFAULT 0.051,
  ADD COLUMN IF NOT EXISTS crude_coeff_high numeric DEFAULT 0.061,
  ADD COLUMN IF NOT EXISTS crude_coeff_n    integer DEFAULT 1;   -- 标定期数

-- 写入第一条已知标定数据（2026-07-28 调价，幅度+0.58~+0.69，取中值+0.635）
-- 价差 = 11.39（86.89 - 75.5），系数 = 0.635/11.39 ≈ 0.0557
INSERT INTO crude_coeff_calibration
  (adjust_date, city, crude_brent, crude_base, raw_diff, actual_delta, coeff, change_rate, note)
VALUES
  ('2026-07-28', '天津', 86.89, 75.50, 11.39, 0.635, 0.0557, 15.09, '首条实测标定，调价区间+0.58~+0.69，取中值0.635')
ON CONFLICT (city, adjust_date) DO NOTHING;