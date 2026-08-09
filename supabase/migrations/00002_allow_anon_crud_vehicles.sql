
-- 允许匿名用户对三张车辆表执行 INSERT / UPDATE / DELETE
ALTER TABLE gasoline_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE diesel_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE lng_vehicles ENABLE ROW LEVEL SECURITY;

-- gasoline_vehicles
DROP POLICY IF EXISTS "anon_insert_gasoline" ON gasoline_vehicles;
DROP POLICY IF EXISTS "anon_update_gasoline" ON gasoline_vehicles;
DROP POLICY IF EXISTS "anon_delete_gasoline" ON gasoline_vehicles;
CREATE POLICY "anon_insert_gasoline" ON gasoline_vehicles FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_gasoline" ON gasoline_vehicles FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_gasoline" ON gasoline_vehicles FOR DELETE TO anon USING (true);

-- diesel_vehicles
DROP POLICY IF EXISTS "anon_insert_diesel" ON diesel_vehicles;
DROP POLICY IF EXISTS "anon_update_diesel" ON diesel_vehicles;
DROP POLICY IF EXISTS "anon_delete_diesel" ON diesel_vehicles;
CREATE POLICY "anon_insert_diesel" ON diesel_vehicles FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_diesel" ON diesel_vehicles FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_diesel" ON diesel_vehicles FOR DELETE TO anon USING (true);

-- lng_vehicles
DROP POLICY IF EXISTS "anon_insert_lng" ON lng_vehicles;
DROP POLICY IF EXISTS "anon_update_lng" ON lng_vehicles;
DROP POLICY IF EXISTS "anon_delete_lng" ON lng_vehicles;
CREATE POLICY "anon_insert_lng" ON lng_vehicles FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_lng" ON lng_vehicles FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_lng" ON lng_vehicles FOR DELETE TO anon USING (true);
