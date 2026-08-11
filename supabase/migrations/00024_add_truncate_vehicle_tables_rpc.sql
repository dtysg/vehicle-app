
-- SECURITY DEFINER RPC：清空三张车辆表，仅由 service role 调用
CREATE OR REPLACE FUNCTION public.truncate_vehicle_tables()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  TRUNCATE TABLE public.gasoline_vehicles RESTART IDENTITY CASCADE;
  TRUNCATE TABLE public.diesel_vehicles   RESTART IDENTITY CASCADE;
  TRUNCATE TABLE public.lng_vehicles      RESTART IDENTITY CASCADE;
END;
$$;

-- 仅允许 service_role 调用（前端不可直接访问）
REVOKE EXECUTE ON FUNCTION public.truncate_vehicle_tables() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.truncate_vehicle_tables() TO service_role;
