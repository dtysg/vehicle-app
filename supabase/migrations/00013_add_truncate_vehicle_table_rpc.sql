-- 创建安全的 TRUNCATE 辅助函数，仅允许清空三张车辆表（拒绝其他表名）
CREATE OR REPLACE FUNCTION truncate_vehicle_table(tbl text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF tbl NOT IN ('gasoline_vehicles', 'diesel_vehicles', 'lng_vehicles') THEN
    RAISE EXCEPTION '不允许的表名: %', tbl;
  END IF;
  -- RESTART IDENTITY 重置 id 自增序列，CASCADE 清理外键依赖（如有）
  EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', tbl);
END;
$$;