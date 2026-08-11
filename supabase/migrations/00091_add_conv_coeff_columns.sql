-- 新增折算系数字段（升/吨，来自发改委官方文件）
ALTER TABLE oil_prices
  ADD COLUMN IF NOT EXISTS conv_coeff_92   numeric(8,2),  -- 92# 汽油折算系数
  ADD COLUMN IF NOT EXISTS conv_coeff_95   numeric(8,2),  -- 95# 汽油折算系数
  ADD COLUMN IF NOT EXISTS conv_coeff_0    numeric(8,2),  -- 0# 柴油折算系数
  ADD COLUMN IF NOT EXISTS conv_fuel_type  text,          -- 油品类型（纯汽油/乙醇汽油）
  ADD COLUMN IF NOT EXISTS conv_data_src   text;          -- 数据来源说明
COMMENT ON COLUMN oil_prices.conv_coeff_92  IS '92#汽油折算系数（升/吨），来自官方折算系数表';
COMMENT ON COLUMN oil_prices.conv_coeff_95  IS '95#汽油折算系数（升/吨）';
COMMENT ON COLUMN oil_prices.conv_coeff_0   IS '0#柴油折算系数（升/吨）';
COMMENT ON COLUMN oil_prices.conv_fuel_type IS '适用油品类型：纯汽油/乙醇汽油';
COMMENT ON COLUMN oil_prices.conv_data_src  IS '数据来源：官方文件/行业通用标准';