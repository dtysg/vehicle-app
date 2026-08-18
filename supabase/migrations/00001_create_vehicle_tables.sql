
-- 创建汽油车辆表
CREATE TABLE gasoline_vehicles (
  id bigserial PRIMARY KEY,
  seq_no integer NOT NULL,
  unit text NOT NULL,
  plate_number text NOT NULL,
  vehicle_model text,
  body_color text,
  fuel_type text,
  gas_grade text,
  oil_card text
);

-- 创建柴油车辆表
CREATE TABLE diesel_vehicles (
  id bigserial PRIMARY KEY,
  seq_no integer NOT NULL,
  unit text NOT NULL,
  plate_number text NOT NULL,
  vehicle_model text,
  body_color text,
  fuel_type text,
  oil_card text
);

-- 创建LNG车辆表
CREATE TABLE lng_vehicles (
  id bigserial PRIMARY KEY,
  seq_no integer NOT NULL,
  unit text NOT NULL,
  plate_number text NOT NULL,
  vehicle_model text,
  body_color text,
  fuel_type text,
  oil_card text,
  remark text
);

-- 启用RLS
ALTER TABLE gasoline_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE diesel_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE lng_vehicles ENABLE ROW LEVEL SECURITY;

-- 所有用户只读
CREATE POLICY "任何人可查询汽油车辆" ON gasoline_vehicles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "任何人可查询柴油车辆" ON diesel_vehicles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "任何人可查询LNG车辆" ON lng_vehicles FOR SELECT TO anon, authenticated USING (true);
