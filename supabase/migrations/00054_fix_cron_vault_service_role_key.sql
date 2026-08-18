-- 存入 service_role_key（若已存在则跳过）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') THEN
    PERFORM vault.create_secret(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoyMTAwMDQwMjA2LCJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUiLCJzdWIiOiJzZXJ2aWNlX3JvbGUifQ.V9eFvkkQsRPdP6Q8PAQ1M1PTGsmohWrweBrkyVvdsN0',
      'service_role_key'
    );
  END IF;
END $$;

-- 重建 gold-price 定时任务（每天北京时间09:30 = UTC 01:30，用 vault 读取凭据）
SELECT cron.unschedule('gold-price-daily-refresh');
SELECT cron.schedule(
  'gold-price-daily-refresh',
  '30 1 * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/gold-price',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body    := '{"force": true}'::jsonb
  ) AS request_id;
  $$
);

-- 同步修复 oilprice-trend-daily cron（同样用 vault 方案）
SELECT cron.unschedule('oilprice-trend-daily');
SELECT cron.schedule(
  'oilprice-trend-daily',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/oilprice-trend-update',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body    := '{"force": false}'::jsonb
  ) AS request_id;
  $$
);

-- 同步修复 oilprice-auto-adjust cron
SELECT cron.unschedule('oilprice-auto-adjust');
SELECT cron.schedule(
  'oilprice-auto-adjust',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/oilprice-admin-update',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body    := '{"force": false, "source": "pg_cron"}'::jsonb
  ) AS request_id;
  $$
);