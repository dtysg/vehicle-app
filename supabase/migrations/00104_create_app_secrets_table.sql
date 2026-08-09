
-- 系统密钥表（管理员专用，应用层鉴权）
CREATE TABLE IF NOT EXISTS app_secrets (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE app_secrets ENABLE ROW LEVEL SECURITY;

-- 与其他表保持一致，anon 可读写（应用层 role 鉴权）
CREATE POLICY "anon_read" ON app_secrets
  FOR SELECT USING (true);

CREATE POLICY "anon_write" ON app_secrets
  FOR INSERT WITH CHECK (true);

CREATE POLICY "anon_update" ON app_secrets
  FOR UPDATE USING (true) WITH CHECK (true);
