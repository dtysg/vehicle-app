-- 先清除旧 job（忽略不存在错误）
SELECT cron.unschedule('oilprice-adjust-hook-2026-07-31') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'oilprice-adjust-hook-2026-07-31'
);
SELECT cron.unschedule('oilprice-adjust-hook-daily-check') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'oilprice-adjust-hook-daily-check'
);

-- 7月31日 北京时间10:00（UTC 02:00）一次性调价钩子
SELECT cron.schedule(
  'oilprice-adjust-hook-2026-07-31',
  '0 2 31 7 *',
  $cmd$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/oilprice-adjust-hook',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer " || current_setting(''app.supabase_service_key'')}'::jsonb,
    body := '{"adjust_date":"2026-07-31"}'::jsonb
  )
  $cmd$
);

-- 每天 02:00 检查是否为调价日，匹配则触发
SELECT cron.schedule(
  'oilprice-adjust-hook-daily-check',
  '0 2 * * *',
  $cmd$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/oilprice-adjust-hook',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := ('{"adjust_date":"' || to_char(NOW() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') || '"}')::jsonb
  )
  FROM oil_prices
  WHERE city = '天津'
    AND next_adjust_date = to_char(NOW() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')
  LIMIT 1
  $cmd$
);