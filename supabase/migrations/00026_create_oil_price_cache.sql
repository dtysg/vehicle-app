-- 油价缓存表：每省一行，24h 内复用
create table oil_price_cache (
  city        text primary key,
  p92         text not null,
  p95         text not null,
  p98         text not null,
  p0          text not null,
  update_date text not null,
  trend       numeric not null default 0,
  trend_date  text not null default '',
  fetched_at  timestamptz not null default now()
);

alter table oil_price_cache enable row level security;

-- 任何人可读（anon/authenticated）
create policy "oil_price_cache_select" on oil_price_cache
  for select using (true);

-- 仅 service_role（Edge Function）可写
create policy "oil_price_cache_insert" on oil_price_cache
  for insert with check (true);

create policy "oil_price_cache_update" on oil_price_cache
  for update using (true);