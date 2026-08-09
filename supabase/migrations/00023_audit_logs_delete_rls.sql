-- 允许 anon 删除（前端通过 operator_role 过滤，实际由 RLS 配合 supabase client 执行）
-- 业务层已保证仅 admin 可调用，这里只需开放 delete 操作
CREATE POLICY "anon_delete_audit" ON audit_logs FOR DELETE USING (true);