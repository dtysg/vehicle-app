
-- 操作日志表
CREATE TABLE IF NOT EXISTS audit_logs (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  operator_id bigint NOT NULL,          -- 操作人 employees.id
  operator_name text NOT NULL,          -- 快照姓名
  operator_role text NOT NULL,          -- 操作时角色 admin/assistant/user
  action      text NOT NULL,            -- 动作类型
  target_type text NOT NULL,            -- 对象类型 vehicle/employee/auth
  target_desc text NOT NULL DEFAULT '', -- 对象描述（车牌/姓名等）
  detail      text NOT NULL DEFAULT ''  -- 详细说明
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
-- anon 可读写（App 使用 anon key）
CREATE POLICY "anon_select_audit" ON audit_logs FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_audit" ON audit_logs FOR INSERT TO anon WITH CHECK (true);

-- 聊天消息表
CREATE TABLE IF NOT EXISTS chat_messages (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sender_id   bigint NOT NULL,          -- 发送人 employees.id
  sender_name text NOT NULL,            -- 快照姓名
  sender_role text NOT NULL,            -- 发送时角色
  content     text NOT NULL,
  channel     text NOT NULL DEFAULT 'general' -- 频道，暂固定 general
);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_chat" ON chat_messages FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_chat" ON chat_messages FOR INSERT TO anon WITH CHECK (true);

-- Realtime 订阅
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE audit_logs;
