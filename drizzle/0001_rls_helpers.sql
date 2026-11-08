-- 0001 (M0): RLS template helpers. No tenant tables yet; the first tenant table (M1) uses this pattern:
--   ALTER TABLE t ENABLE ROW LEVEL SECURITY; ALTER TABLE t FORCE ROW LEVEL SECURITY;
--   CREATE POLICY t_tenant ON t USING (tenant_id = app_current_tenant())
--                              WITH CHECK (tenant_id = app_current_tenant());
-- With no tenant set, app_current_tenant() is NULL, so the policy matches no row (fail closed).
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

GRANT EXECUTE ON FUNCTION app_current_tenant() TO rentcar_app, rentcar_backup;
