-- 重建 cron 任务，使用硬编码 Supabase URL（current_setting 可能未配置）
SELECT cron.unschedule('weather-tianjin-refresh');

SELECT cron.schedule(
  'weather-tianjin-refresh',
  '*/30 * * * *',
  $cmd$
  SELECT net.http_post(
    url     := 'https://jwnxfwrdpcdwbcxlbpjf.supabase.co/functions/v1/weather-1d',
    body    := '{"areaCn":"天津","needalarm":"1","force":true}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoyMTAwMDQwMjA2LCJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUiLCJzdWIiOiJzZXJ2aWNlX3JvbGUifQ.V9eFvkkQsRPdP6Q8PAQ1M1PTGsmohWrweBrkyVvdsN0'
    )
  );
  $cmd$
);