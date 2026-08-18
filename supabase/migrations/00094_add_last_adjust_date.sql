ALTER TABLE oil_prices
  ADD COLUMN IF NOT EXISTS last_adjust_date text,
  ADD COLUMN IF NOT EXISTS crude_basket_days integer,
  ADD COLUMN IF NOT EXISTS crude_basket_start text;