-- 允许 anon 角色对 employees 表进行 INSERT / UPDATE / DELETE
-- （本系统通过自定义账号密码鉴权，不走 Supabase Auth，只用 anon key）

CREATE POLICY "Allow anon insert employees"
  ON employees FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anon update employees"
  ON employees FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow anon delete employees"
  ON employees FOR DELETE
  TO anon
  USING (true);