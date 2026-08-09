SELECT net.http_post(
  url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/weather-1d',
  headers := jsonb_build_object(
    'Content-Type',  'application/json',
    'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
  ),
  body    := '{"areaCn":"天津","needalarm":"1","cityLabel":"天津","force":true}'::jsonb
) AS request_id;