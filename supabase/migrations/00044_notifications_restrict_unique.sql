-- 为 traffic_restrict 类型的通知按日期建唯一约束，防止每天重复写入
CREATE UNIQUE INDEX IF NOT EXISTS notifications_restrict_date_unique
  ON notifications (type, (meta->>'date'))
  WHERE type = 'traffic_restrict';

-- 补充 INSERT RLS（若不存在）
DO $$
BEGIN
  DROP POLICY IF EXISTS "allow_insert_notifications" ON notifications;
  CREATE POLICY "allow_insert_notifications"
    ON notifications FOR INSERT
    TO authenticated
    WITH CHECK (true);
END $$;