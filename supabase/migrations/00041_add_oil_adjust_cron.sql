
-- 调价日自动触发：每逢调价窗口开启当天 UTC 02:00（北京时间 10:00）自动调用 oilprice-admin-update
-- 成品油固定每14个工作日调价一次；pg_cron 每天检测，由 EF 内部逻辑判断是否调价日
SELECT cron.schedule(
  'oilprice-auto-adjust',
  '0 2 * * *',  -- 每天 UTC 02:00 = 北京时间 10:00
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/oilprice-admin-update',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{"force": false, "source": "pg_cron"}'::jsonb
  );
  $$
);
