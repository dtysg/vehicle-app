
-- 1. 删除 pg_cron 金价定时任务
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname ILIKE '%gold%' OR command ILIKE '%gold%';

-- 2. 删除金价相关 trigger（如有）
DROP TRIGGER IF EXISTS trigger_gold_price_refresh ON gold_cache CASCADE;

-- 3. 删除 gold_cache 表（含所有依赖）
DROP TABLE IF EXISTS gold_cache CASCADE;
