
-- 私信表（点对点）
CREATE TABLE IF NOT EXISTS private_messages (
  id            bigserial PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sender_id     bigint NOT NULL,
  sender_name   text NOT NULL,
  sender_role   text NOT NULL,
  receiver_id   bigint NOT NULL,
  receiver_name text NOT NULL,
  content       text NOT NULL,
  is_read       boolean NOT NULL DEFAULT false
);

ALTER TABLE private_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_pm" ON private_messages FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_pm" ON private_messages FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_pm" ON private_messages FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- Realtime 订阅
ALTER PUBLICATION supabase_realtime ADD TABLE private_messages;

-- 未读消息数快速查询索引
CREATE INDEX IF NOT EXISTS idx_pm_receiver ON private_messages (receiver_id, is_read);
CREATE INDEX IF NOT EXISTS idx_pm_conversation ON private_messages (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at);
