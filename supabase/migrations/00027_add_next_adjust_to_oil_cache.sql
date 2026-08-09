alter table oil_price_cache
  add column if not exists next_adjust_date text not null default '',
  add column if not exists next_trend       numeric not null default 0,
  add column if not exists next_trend_text  text not null default '';