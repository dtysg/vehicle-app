-- 启用 pg_cron 和 pg_net 扩展
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 自动备份历史记录表
CREATE TABLE backup_records (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  triggered_by text NOT NULL DEFAULT 'auto',  -- 'auto' | 'manual'
  stats       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {gasoline, diesel, lng, employees, total}
  status      text NOT NULL DEFAULT 'success'       -- 'success' | 'failed'
);

-- RLS
ALTER TABLE backup_records ENABLE ROW LEVEL SECURITY;
-- 所有认证用户可读（管理员查看历史），仅 service_role 可写（Edge Function）
CREATE POLICY "authenticated read backup_records"
  ON backup_records FOR SELECT TO authenticated USING (true);

-- Push Token 存储表（每个员工一条，以 emp_code 为唯一键 upsert）
CREATE TABLE push_tokens (
  id          bigserial PRIMARY KEY,
  emp_code    text NOT NULL UNIQUE,
  token       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
-- 认证用户可读写自己的 token
CREATE POLICY "authenticated manage push_tokens"
  ON push_tokens FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 每天 02:00 UTC（北京时间 10:00）自动执行备份+推送
SELECT cron.schedule(
  'daily-auto-backup',
  '0 2 * * *',
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