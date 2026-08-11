-- 重建 cron 任务，硬编码正确的 service_role key 和 URL
SELECT cron.unschedule('weather-tianjin-refresh');

SELECT cron.schedule(
  'weather-tianjin-refresh',
  '*/30 * * * *',
  $cmd$
  SELECT net.http_post(
    url     := 'https://jwnxfwrdpcdwbcxlbpjf.supabase.co/functions/v1/weather-1d',
    body    := '{"areaCn":"天津","needalarm":"1","force":true}'::jsonb,
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoyMTAwMDQwMjA2LCJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUiLCJzdWIiOiJzZXJ2aWNlX3JvbGUifQ.V9eFvkkQsRPdP6Q8PAQ1M1PTGsmohWrweBrkyVvdsN0"}'::jsonb
  );
  $cmd$
);