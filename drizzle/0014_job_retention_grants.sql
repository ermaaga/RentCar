-- 0014 (M1): retention jobs (docs/06-backend-api.md 8.2 retention_daily, 05-database 5.7 and 5.16).
-- The runtime role may delete expired credential tokens and old job runs, in the system scope only:
-- the restrictive policies keep tenant-scope deletes impossible even though tenant_isolation is FOR ALL.
GRANT DELETE ON credential_tokens, job_runs TO rentcar_app;

CREATE POLICY system_delete_only ON credential_tokens AS RESTRICTIVE FOR DELETE TO rentcar_app
  USING (app_scope() = 'system');
CREATE POLICY system_delete_only ON job_runs AS RESTRICTIVE FOR DELETE TO rentcar_app
  USING (app_scope() = 'system');
