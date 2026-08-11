-- 删除错误的 RLS 策略（with_check=false 拒绝所有写入）
DROP POLICY IF EXISTS "service_upsert_weather" ON weather_cache;
DROP POLICY IF EXISTS "service_update_weather" ON weather_cache;

-- 重建正确的写入策略：仅允许 service_role（EF 写缓存）
CREATE POLICY "service_upsert_weather" ON weather_cache
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_update_weather" ON weather_cache
  FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');