
-- 启用 pg_cron / pg_net 扩展
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 创建心跳函数：轻量级查询，唤醒数据库，防止自动暂停
CREATE OR REPLACE FUNCTION keepalive_ping()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  _cnt integer;
BEGIN
  -- 查询 employees 表，既能保活又能顺便验证数据可访问
  SELECT COUNT(*) INTO _cnt FROM employees;
  -- 记录一条心跳日志到 app_secrets（利用现有表，不新建表）
  INSERT INTO app_secrets (key, value)
  VALUES ('keepalive_last_ping', to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS'))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
END;
$$;

-- 每3天凌晨2点（UTC）= 北京时间上午10点，执行一次心跳
-- 使用 cron.schedule：同名 job 会自动更新，不会重复创建
SELECT cron.schedule(
  'db-keepalive-every-3days',
  '0 2 */3 * *',
  'SELECT keepalive_ping();'
);
