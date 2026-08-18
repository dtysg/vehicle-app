CREATE OR REPLACE FUNCTION protect_admin_active()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    NEW.is_active := true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_admin_active ON employees;
CREATE TRIGGER trg_protect_admin_active
BEFORE UPDATE ON employees
FOR EACH ROW EXECUTE FUNCTION protect_admin_active();