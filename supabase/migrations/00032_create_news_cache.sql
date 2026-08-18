
CREATE TABLE news_cache (
  id integer PRIMARY KEY DEFAULT 1,
  headlines jsonb NOT NULL DEFAULT '[]',
  fetched_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE news_cache ENABLE ROW LEVEL SECURITY;

-- 所有人可读
CREATE POLICY "news_cache_select_all" ON news_cache
  FOR SELECT USING (true);

-- 仅 service_role 可写
CREATE POLICY "news_cache_upsert_service" ON news_cache
  FOR INSERT WITH CHECK (true);

CREATE POLICY "news_cache_update_service" ON news_cache
  FOR UPDATE USING (true);
