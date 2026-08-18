-- 允许已认证用户删除通知（管理员在客户端额外验证）
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- 查看已有策略
DO $$
BEGIN
  -- 删除策略（如已存在先删再建）
  DROP POLICY IF EXISTS "allow_delete_notifications" ON notifications;
  
  -- 新增：允许已认证用户删除（业务层控制只有管理员能看到删除按钮）
  CREATE POLICY "allow_delete_notifications"
    ON notifications FOR DELETE
    TO authenticated
    USING (true);
    
  -- 确保 SELECT 策略存在
  DROP POLICY IF EXISTS "allow_read_notifications" ON notifications;
  CREATE POLICY "allow_read_notifications"
    ON notifications FOR SELECT
    TO authenticated
    USING (true);
END $$;