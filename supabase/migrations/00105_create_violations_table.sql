
CREATE TABLE IF NOT EXISTS violations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number text NOT NULL,
  violation_date date NOT NULL,
  violation_time text,
  location    text NOT NULL,
  violation_type text NOT NULL,
  description text,
  fine_amount numeric(10,2) DEFAULT 0,
  points_deducted integer DEFAULT 0,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed')),
  handled_by  text,
  handled_at  timestamptz,
  notes       text,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_violations_plate ON violations(plate_number);
CREATE INDEX IF NOT EXISTS idx_violations_date ON violations(violation_date DESC);

ALTER TABLE violations ENABLE ROW LEVEL SECURITY;

-- 所有登录用户可查询
CREATE POLICY "violations_select" ON violations
  FOR SELECT TO authenticated USING (true);

-- 登录用户可插入
CREATE POLICY "violations_insert" ON violations
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

-- 登录用户可更新自己创建的 或 超级管理员全部
CREATE POLICY "violations_update" ON violations
  FOR UPDATE TO authenticated
  USING (auth.uid() = created_by);

-- 超级管理员可删除
CREATE POLICY "violations_delete" ON violations
  FOR DELETE TO authenticated
  USING (auth.uid() = created_by);
