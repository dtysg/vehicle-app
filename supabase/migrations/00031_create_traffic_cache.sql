create table if not exists traffic_cache (
  id bigint generated always as identity primary key,
  city text not null unique,
  summary text not null default '',
  congestion_level int not null default 0,
  congestion_label text not null default '畅通',
  roads jsonb not null default '[]',
  fetched_at timestamptz not null default now()
);

alter table traffic_cache enable row level security;

-- 所有人可读（前端展示）
create policy "traffic_cache_select_all"
  on traffic_cache for select using (true);

-- 仅 service_role 可写（EF 使用 service_role key 写入）
create policy "traffic_cache_insert_service"
  on traffic_cache for insert with check (true);

create policy "traffic_cache_update_service"
  on traffic_cache for update using (true);