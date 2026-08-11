-- 补充天气完整字段
ALTER TABLE weather_cache
  ADD COLUMN IF NOT EXISTS wind_speed    text,
  ADD COLUMN IF NOT EXISTS pressure      text,
  ADD COLUMN IF NOT EXISTS visibility    text,
  ADD COLUMN IF NOT EXISTS uv_index      text,
  ADD COLUMN IF NOT EXISTS air_quality   text,
  ADD COLUMN IF NOT EXISTS sunrise       text,
  ADD COLUMN IF NOT EXISTS sunset        text,
  ADD COLUMN IF NOT EXISTS moon_phase    text,
  ADD COLUMN IF NOT EXISTS precip        text,
  ADD COLUMN IF NOT EXISTS hour1d        jsonb,
  ADD COLUMN IF NOT EXISTS forecast7d    jsonb;

-- 允许已认证用户读取 weather_cache（若 RLS 已开启）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'weather_cache' AND policyname = 'weather_cache_read'
  ) THEN
    CREATE POLICY weather_cache_read ON weather_cache FOR SELECT TO authenticated USING (true);
  END IF;
END $$;