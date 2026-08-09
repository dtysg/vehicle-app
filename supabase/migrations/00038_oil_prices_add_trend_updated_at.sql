ALTER TABLE oil_prices ADD COLUMN IF NOT EXISTS trend_updated_at timestamptz DEFAULT NULL;

-- 先删旧 cron job（若存在），再重建
SELECT cron.unschedule('oilprice-trend-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'oilprice-trend-daily'
);

SELECT cron.schedule(
  'oilprice-trend-daily',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url    := current_setting('app.supabase_url') || '/functions/v1/oilprice-trend-update',
    body   := '{"force":false}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    )
  ) AS request_id;
  $$
);