-- 北京时间 22:00 = UTC 14:00，更新 cron job 执行时间
SELECT cron.schedule(
  'daily-auto-backup',
  '0 14 * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/auto-backup-notify',
    headers := jsonb_build_object(
      'Content-type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'publishable_key')
    ),
    body    := concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);