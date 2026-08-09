-- 员工简码表：存储员工姓名和对应的登录简码
CREATE TABLE IF NOT EXISTS public.employees (
  id         serial PRIMARY KEY,
  real_name  text NOT NULL,           -- 真实姓名
  emp_code   text NOT NULL UNIQUE,    -- 员工简码（登录凭证）
  role       text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 插入管理员账号（杜天宇）和若干示例普通员工
INSERT INTO public.employees (real_name, emp_code, role) VALUES
  ('杜天宇', 'DTY001', 'admin')
ON CONFLICT (emp_code) DO NOTHING;

-- RLS：允许匿名查询（登录时用 anon key 查表）
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read for login" ON public.employees
  FOR SELECT TO anon, authenticated USING (true);
