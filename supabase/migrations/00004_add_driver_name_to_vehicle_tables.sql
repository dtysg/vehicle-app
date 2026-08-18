ALTER TABLE gasoline_vehicles ADD COLUMN IF NOT EXISTS driver_name TEXT;
ALTER TABLE diesel_vehicles  ADD COLUMN IF NOT EXISTS driver_name TEXT;
ALTER TABLE lng_vehicles     ADD COLUMN IF NOT EXISTS driver_name TEXT;