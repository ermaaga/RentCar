-- 0010 (M1): per-tenant SMTP configuration (docs/05-database.md 5.3). The password is stored only as
-- ciphertext (v1 format, checked here). A separate table keeps the secret out of tenant_settings reads.
CREATE TABLE tenant_smtp_configs (
  tenant_id           uuid        PRIMARY KEY REFERENCES tenants (id),
  host                text        NOT NULL CHECK (char_length(host) BETWEEN 1 AND 255),
  port                integer     NOT NULL CHECK (port IN (25, 465, 587, 2525)),
  security            text        NOT NULL CHECK (security IN ('tls', 'starttls')),
  username            text        NOT NULL,
  password_enc        text        NOT NULL CHECK (password_enc ~ '^v1\.[0-9a-f]{8}\.'),
  from_address        text        NOT NULL,
  from_name           text,
  last_test_at        timestamptz,
  last_test_ok        boolean,
  last_test_error     text        CHECK (char_length(last_test_error) <= 500),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenant_smtp_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_smtp_configs FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON tenant_smtp_configs TO rentcar_owner USING (true) WITH CHECK (true);
CREATE POLICY backup_read ON tenant_smtp_configs FOR SELECT TO rentcar_backup USING (true);
CREATE POLICY tenant_isolation ON tenant_smtp_configs TO rentcar_app
  USING (tenant_id = (SELECT app_tenant_id())) WITH CHECK (tenant_id = (SELECT app_tenant_id()));
CREATE POLICY system_manage ON tenant_smtp_configs TO rentcar_app
  USING (app_scope() = 'system') WITH CHECK (app_scope() = 'system');

GRANT SELECT, INSERT, UPDATE ON tenant_smtp_configs TO rentcar_app;
GRANT SELECT ON tenant_smtp_configs TO rentcar_backup;
