
-- 删除原来的锁死策略，改为允许 anon 插入
-- 应用层已通过 isPermanentAdmin 控制访问权限
DROP POLICY IF EXISTS "anon_no_insert" ON app_versions;
DROP POLICY IF EXISTS "anon_no_update" ON app_versions;
DROP POLICY IF EXISTS "anon_no_delete" ON app_versions;

CREATE POLICY "anon_insert" ON app_versions FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_update" ON app_versions FOR UPDATE USING (true);
CREATE POLICY "anon_delete" ON app_versions FOR DELETE USING (true);
