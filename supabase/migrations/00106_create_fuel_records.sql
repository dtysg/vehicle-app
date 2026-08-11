-- 加油记录表
CREATE TABLE IF NOT EXISTS fuel_records (
  id               bigserial PRIMARY KEY,
  plate_number     text        NOT NULL,
  vehicle_model    text        NOT NULL DEFAULT '',
  fuel_type        text        NOT NULL DEFAULT '汽油',  -- 汽油/柴油/LNG
  unit             text        NOT NULL DEFAULT '',
  driver_name      text        NOT NULL DEFAULT '',
  fuel_liters      numeric(8,2) NOT NULL CHECK (fuel_liters > 0),  -- 加油升数
  cost_yuan        numeric(10,2) DEFAULT NULL,           -- 费用（元）
  mileage          integer      DEFAULT NULL,            -- 本次里程（km）
  refuel_date      date         NOT NULL DEFAULT CURRENT_DATE,
  notes            text         NOT NULL DEFAULT '',
  created_by       text         NOT NULL DEFAULT '',
  created_at       timestamptz  NOT NULL DEFAULT now()
);

-- 常用查询索引
CREATE INDEX IF NOT EXISTS idx_fuel_records_date        ON fuel_records (refuel_date DESC);
CREATE INDEX IF NOT EXISTS idx_fuel_records_plate       ON fuel_records (plate_number);
CREATE INDEX IF NOT EXISTS idx_fuel_records_fuel_type   ON fuel_records (fuel_type);
CREATE INDEX IF NOT EXISTS idx_fuel_records_unit        ON fuel_records (unit);

-- RLS
ALTER TABLE fuel_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can read fuel_records"
  ON fuel_records FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "anon can insert fuel_records"
  ON fuel_records FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "anon can update fuel_records"
  ON fuel_records FOR UPDATE TO anon, authenticated USING (true);

CREATE POLICY "anon can delete fuel_records"
  ON fuel_records FOR DELETE TO anon, authenticated USING (true);