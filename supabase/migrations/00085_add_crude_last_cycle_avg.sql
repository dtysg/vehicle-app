ALTER TABLE oil_prices ADD COLUMN IF NOT EXISTS crude_last_cycle_avg numeric;
-- 用当前 EIA 10日均价作为初始值（7月18日调价时的参考基准估算）
UPDATE oil_prices SET crude_last_cycle_avg = 75.5 WHERE crude_last_cycle_avg IS NULL;