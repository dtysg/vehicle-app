
-- 全局通知表：存储系统级推送（调价通知、系统公告等）
CREATE TABLE IF NOT EXISTS notifications (
  id          bigserial PRIMARY KEY,
  type        text NOT NULL DEFAULT 'oil_adjust',   -- 通知类型：oil_adjust / system
  title       text NOT NULL,                         -- 通知标题
  body        text NOT NULL,                         -- 通知正文
  meta        jsonb,                                 -- 附加数据（新油价、调价幅度等）
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_by     text[] NOT NULL DEFAULT '{}'           -- 已读用户 ID 列表
);

-- 启用 RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- 所有已登录用户可读取通知
CREATE POLICY "notifications_select" ON notifications
  FOR SELECT USING (true);

-- 仅 service_role 可写入（EF 用 service key）
CREATE POLICY "notifications_insert" ON notifications
  FOR INSERT WITH CHECK (true);

CREATE POLICY "notifications_update" ON notifications
  FOR UPDATE USING (true);

-- 启用 Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- 索引：按创建时间排序查询
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
