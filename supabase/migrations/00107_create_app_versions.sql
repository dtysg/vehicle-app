
-- App 版本管理表：存储 APK 版本信息和下载链接
CREATE TABLE app_versions (
  id           serial PRIMARY KEY,
  version_name text    NOT NULL,          -- 展示版本号，如 "1.0.6"
  version_code integer NOT NULL UNIQUE,   -- 数字版本号，用于比较大小
  apk_url      text    NOT NULL,          -- APK 下载地址（可以是任何 URL）
  release_notes text   NOT NULL DEFAULT '优化性能，修复已知问题',
  is_force      boolean NOT NULL DEFAULT false,  -- 是否强制更新
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 启用 RLS
ALTER TABLE app_versions ENABLE ROW LEVEL SECURITY;

-- 所有人均可读（匿名用户也可以检查版本）
CREATE POLICY "public_read" ON app_versions FOR SELECT USING (true);

-- 只有管理员可以发布新版本（通过后端操作，不对 anon 开放写入）
CREATE POLICY "anon_no_insert" ON app_versions FOR INSERT WITH CHECK (false);
CREATE POLICY "anon_no_update" ON app_versions FOR UPDATE USING (false);
CREATE POLICY "anon_no_delete" ON app_versions FOR DELETE USING (false);
