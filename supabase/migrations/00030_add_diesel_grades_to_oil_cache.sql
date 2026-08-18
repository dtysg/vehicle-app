alter table oil_price_cache
  add column if not exists pm10 text not null default '',
  add column if not exists pm20 text not null default '',
  add column if not exists pm35 text not null default '';