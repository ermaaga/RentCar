-- 0011 (M1): platform archives (docs/05-database.md 5.19, 5.20, 5.21, 5.22). Ids and codes only,
-- no personal data. Append-only where stated; readable by the system scope only.

-- Generic guard: refuses UPDATE, DELETE and TRUNCATE for every role (the owner included).
-- Retention purges run through the owner's definer functions, added later, not here.
-- Same guard as 0008, generalised to report the table name.
CREATE OR REPLACE FUNCTION append_only_guard() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on % is not allowed', TG_OP, TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;

-- security_event (5.19): codes and a coarse IP only; no tenant_id column (a context, not an owner).
CREATE TABLE security_event (
  id                 uuid        PRIMARY KEY,
  created_at         timestamptz NOT NULL DEFAULT now(),
  event              text        NOT NULL CHECK (char_length(event) BETWEEN 1 AND 100),
  realm              text        NOT NULL CHECK (realm IN ('tenant', 'system', 'public', 'job')),
  subject_tenant_id  uuid,
  actor_id           uuid,
  outcome            text        NOT NULL,
  reason_code        text,
  ip_prefix          text,
  ip_hmac            text        CHECK (ip_hmac ~ '^[0-9a-f]{64}$'),
  request_id         text
);
CREATE INDEX security_event_created ON security_event (created_at DESC);
CREATE INDEX security_event_event ON security_event (event, created_at DESC);
CREATE TRIGGER security_event_no_update BEFORE UPDATE ON security_event FOR EACH ROW EXECUTE FUNCTION append_only_guard();
CREATE TRIGGER security_event_no_delete BEFORE DELETE ON security_event FOR EACH ROW EXECUTE FUNCTION append_only_guard();
CREATE TRIGGER security_event_no_truncate BEFORE TRUNCATE ON security_event FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();
ALTER TABLE security_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_event FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON security_event TO rentcar_owner USING (true) WITH CHECK (true);
CREATE POLICY backup_read ON security_event FOR SELECT TO rentcar_backup USING (true);
CREATE POLICY insert_any ON security_event FOR INSERT TO rentcar_app WITH CHECK (true);
CREATE POLICY system_read ON security_event FOR SELECT TO rentcar_app USING (app_scope() = 'system');
GRANT SELECT, INSERT ON security_event TO rentcar_app;
GRANT SELECT ON security_event TO rentcar_backup;

-- platform_audit (5.20): systemadmin actions on tenants and accounts.
CREATE TABLE platform_audit (
  id                 uuid        PRIMARY KEY,
  created_at         timestamptz NOT NULL DEFAULT now(),
  actor_user_id      uuid        REFERENCES users (id),
  action             text        NOT NULL CHECK (action IN (
                       'tenant.created', 'tenant.suspended', 'tenant.terminated', 'tenant.hard_deleted',
                       'admin.reset', 'admin.replaced', 'subscription.created', 'subscription.updated',
                       'subscription.cancelled')),
  subject_tenant_id  uuid,
  entity_ref         text,
  changes            jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(changes) <= 16384),
  request_id         text
);
CREATE TRIGGER platform_audit_no_update BEFORE UPDATE ON platform_audit FOR EACH ROW EXECUTE FUNCTION append_only_guard();
CREATE TRIGGER platform_audit_no_delete BEFORE DELETE ON platform_audit FOR EACH ROW EXECUTE FUNCTION append_only_guard();
CREATE TRIGGER platform_audit_no_truncate BEFORE TRUNCATE ON platform_audit FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();
ALTER TABLE platform_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON platform_audit TO rentcar_owner USING (true) WITH CHECK (true);
CREATE POLICY backup_read ON platform_audit FOR SELECT TO rentcar_backup USING (true);
CREATE POLICY system_read ON platform_audit FOR SELECT TO rentcar_app USING (app_scope() = 'system');
CREATE POLICY system_insert ON platform_audit FOR INSERT TO rentcar_app WITH CHECK (app_scope() = 'system');
GRANT SELECT, INSERT ON platform_audit TO rentcar_app;
GRANT SELECT ON platform_audit TO rentcar_backup;

-- slug_tombstone (5.21): a deleted tenant's slug stays reserved for 12 months.
CREATE TABLE slug_tombstone (
  slug               text        PRIMARY KEY CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  subject_tenant_id  uuid        NOT NULL,
  reserved_until     timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE slug_tombstone ENABLE ROW LEVEL SECURITY;
ALTER TABLE slug_tombstone FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON slug_tombstone TO rentcar_owner USING (true) WITH CHECK (true);
CREATE POLICY backup_read ON slug_tombstone FOR SELECT TO rentcar_backup USING (true);
CREATE POLICY system_manage ON slug_tombstone TO rentcar_app USING (app_scope() = 'system') WITH CHECK (app_scope() = 'system');
GRANT SELECT, INSERT, DELETE ON slug_tombstone TO rentcar_app;
GRANT SELECT ON slug_tombstone TO rentcar_backup;

-- deletion_ledger (5.22): ids and dates only; append-only.
CREATE TABLE deletion_ledger (
  id                       uuid        PRIMARY KEY,
  kind                     text        NOT NULL CHECK (kind IN ('customer_anonymised', 'tenant_hard_deleted')),
  subject_tenant_id        uuid        NOT NULL,
  subject_customer_id      uuid,
  occurred_at              timestamptz NOT NULL,
  CONSTRAINT deletion_ledger_customer_required CHECK (kind <> 'customer_anonymised' OR subject_customer_id IS NOT NULL)
);
CREATE TRIGGER deletion_ledger_no_update BEFORE UPDATE ON deletion_ledger FOR EACH ROW EXECUTE FUNCTION append_only_guard();
CREATE TRIGGER deletion_ledger_no_delete BEFORE DELETE ON deletion_ledger FOR EACH ROW EXECUTE FUNCTION append_only_guard();
CREATE TRIGGER deletion_ledger_no_truncate BEFORE TRUNCATE ON deletion_ledger FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();
ALTER TABLE deletion_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE deletion_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON deletion_ledger TO rentcar_owner USING (true) WITH CHECK (true);
CREATE POLICY backup_read ON deletion_ledger FOR SELECT TO rentcar_backup USING (true);
CREATE POLICY system_read ON deletion_ledger FOR SELECT TO rentcar_app USING (app_scope() = 'system');
CREATE POLICY tenant_insert ON deletion_ledger FOR INSERT TO rentcar_app
  WITH CHECK (subject_tenant_id = (SELECT app_tenant_id()) OR app_scope() = 'system');
GRANT SELECT, INSERT ON deletion_ledger TO rentcar_app;
GRANT SELECT ON deletion_ledger TO rentcar_backup;
