-- 先删旧任务（若存在），再重建
SELECT cron.unschedule('weather-tianjin-refresh') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'weather-tianjin-refresh'
);

SELECT cron.schedule(
  'weather-tianjin-refresh',
  '*/30 * * * *',
  $cmd$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/weather-1d',
    body    := '{"areaCn":"天津","needalarm":"1","force":true}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    )
  );
  $cmd$
);