
-- 用户角色枚举
CREATE TYPE public.user_role AS ENUM ('user', 'admin');

-- profiles 表
CREATE TABLE public.profiles (
  id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone     text,
  real_name text,               -- 真实姓名，首次登录后填写
  role      public.user_role NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 自动同步新用户到 profiles
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, phone, role)
  VALUES (NEW.id, NEW.phone, 'user'::public.user_role);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- get_user_role 安全函数（避免 RLS 自引用死循环）
CREATE OR REPLACE FUNCTION get_user_role(uid uuid)
RETURNS user_role
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = uid;
$$;

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins have full access to profiles" ON profiles
  FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin'::user_role);

CREATE POLICY "Users can view their own profile" ON profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id)
  WITH CHECK (role IS NOT DISTINCT FROM get_user_role(auth.uid()));

-- 公开视图
CREATE VIEW public_profiles AS
  SELECT id, real_name, role FROM profiles;
