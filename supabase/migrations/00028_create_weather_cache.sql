create table if not exists weather_cache (
  city        text primary key,
  weather     text not null default '',
  temp        text not null default '--',
  humidity    text not null default '--',
  wind_dir    text not null default '',
  wind_power  text not null default '',
  feels_like  text not null default '',
  fetched_at  timestamptz not null default now()
);

alter table weather_cache enable row level security;
create policy "public_select_weather" on weather_cache for select using (true);
create policy "service_upsert_weather" on weather_cache for insert with check (false);
create policy "service_update_weather" on weather_cache for update using (false);