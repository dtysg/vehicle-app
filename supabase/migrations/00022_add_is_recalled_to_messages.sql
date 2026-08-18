
-- 全体频道消息撤回字段
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_recalled boolean NOT NULL DEFAULT false;
-- 私信撤回字段
ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS is_recalled boolean NOT NULL DEFAULT false;
