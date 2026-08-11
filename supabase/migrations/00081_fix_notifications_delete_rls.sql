-- 修复：notifications 删除策略改为允许 public（anon），与 SELECT/UPDATE 策略一致
-- 原策略 allow_delete_notifications 仅允许 authenticated，但 app 用员工简码登录不走 Supabase Auth，永远是 anon
DROP POLICY IF EXISTS "allow_delete_notifications" ON notifications;

CREATE POLICY "allow_delete_notifications"
  ON notifications FOR DELETE
  TO public
  USING (true);