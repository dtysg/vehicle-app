-- 删除 gasoline_vehicles 表中与 diesel_vehicles 重复的车牌（这些车的 fuel_type 本就是柴油，属于错误导入）
DELETE FROM gasoline_vehicles
WHERE TRIM(UPPER(plate_number)) IN (
  SELECT TRIM(UPPER(d.plate_number))
  FROM diesel_vehicles d
  WHERE TRIM(UPPER(d.plate_number)) = TRIM(UPPER(gasoline_vehicles.plate_number))
);