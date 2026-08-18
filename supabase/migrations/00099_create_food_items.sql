
-- 食品保质期追踪表
CREATE TABLE food_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  barcode text NOT NULL,
  product_name text NOT NULL,
  brand text,
  category text,
  image_url text,
  expiry_date date NOT NULL,
  quantity integer DEFAULT 1 CHECK (quantity > 0),
  notes text,
  added_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 自动更新 updated_at
CREATE OR REPLACE FUNCTION update_food_items_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER food_items_updated_at
  BEFORE UPDATE ON food_items
  FOR EACH ROW EXECUTE FUNCTION update_food_items_updated_at();

-- 启用 RLS
ALTER TABLE food_items ENABLE ROW LEVEL SECURITY;

-- anon 全权（与现有 employees/oil_prices 策略保持一致）
CREATE POLICY "anon_select_food_items" ON food_items FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_food_items" ON food_items FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_food_items" ON food_items FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_food_items" ON food_items FOR DELETE TO anon USING (true);
