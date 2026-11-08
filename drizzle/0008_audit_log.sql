-- 0008 (M1): append-only audit log (docs/05-database.md 5.14). Four levels of protection:
-- (1) the runtime role has SELECT and INSERT only; (2) no UPDATE/DELETE policy for tenants;
-- (3) a trigger refuses UPDATE, DELETE and TRUNCATE for everyone, the owner included;
-- (4) the only exception is a retention purge by the owner, which is not reachable by the app.
CREATE TABLE audit_log (
  id              uuid        PRIMARY KEY,
  tenant_id       uuid        REFERENCES tenants (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  actor_type      text        NOT NULL CHECK (actor_type IN ('user', 'system', 'public')),
  actor_user_id   uuid,
  actor_username  text,
  actor_role      text,
  action          text        NOT NULL CHECK (char_length(action) BETWEEN 1 AND 100),
  entity_type     text        NOT NULL CHECK (char_length(entity_type) BETWEEN 1 AND 50),
  entity_id       uuid,
  entity_ref      text,
  changes         jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(changes) <= 16384),
  request_id      text
);

CREATE INDEX audit_log_viewer ON audit_log (tenant_id, created_at DESC, id DESC);
CREATE INDEX audit_log_entity ON audit_log (tenant_id, entity_type, entity_id, created_at DESC);
CREATE INDEX audit_log_created_brin ON audit_log USING brin (created_at);

CREATE FUNCTION append_only_guard() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on audit_log is not allowed', TG_OP
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON audit_log TO rentcar_owner USING (true) WITH CHECK (true);
CREATE POLICY backup_read ON audit_log FOR SELECT TO rentcar_backup USING (true);
CREATE POLICY tenant_read ON audit_log FOR SELECT TO rentcar_app
  USING (tenant_id IS NOT NULL AND tenant_id = (SELECT app_tenant_id()));
CREATE POLICY tenant_insert ON audit_log FOR INSERT TO rentcar_app
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = (SELECT app_tenant_id()));
CREATE POLICY system_insert ON audit_log FOR INSERT TO rentcar_app
  WITH CHECK (tenant_id IS NULL AND app_scope() = 'system');
CREATE POLICY system_read ON audit_log FOR SELECT TO rentcar_app
  USING (app_scope() = 'system');

GRANT SELECT, INSERT ON audit_log TO rentcar_app;
GRANT SELECT ON audit_log TO rentcar_backup;
