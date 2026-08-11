-- 添加 password 字段（明文存储，内部系统）
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS password TEXT NOT NULL DEFAULT '';

-- 更新管理员账号：账号=ADMIN 密码=123456
UPDATE public.employees
SET emp_code = 'ADMIN', password = '123456'
WHERE real_name = '杜天宇';
