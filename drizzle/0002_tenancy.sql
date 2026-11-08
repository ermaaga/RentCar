-- 0002 (M1): tenancy base. Session helpers named as in docs/05-database.md 4.2, tenants table (5.1)
-- and its RLS. All GUCs are transaction-local (set_config(..., true)) because of the transaction pooler.

-- Helpers (docs/05-database.md 4.2). NULL when unset, so policies match nothing (fail closed).
CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_scope() RETURNS text
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.scope', true), '') $$;

-- Kept for 0001 callers: same meaning as app_tenant_id().
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT app_tenant_id() $$;

CREATE TABLE tenants (
  id                       uuid        PRIMARY KEY,
  slug                     text        NOT NULL CONSTRAINT tenants_slug_key UNIQUE
                                       CONSTRAINT tenants_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name                     text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  status                   text        NOT NULL DEFAULT 'active'
                                       CHECK (status IN ('active', 'suspended', 'terminated', 'deleted')),
  country_code             char(2)     NOT NULL DEFAULT 'IT' CHECK (country_code ~ '^[A-Z]{2}$'),
  time_zone                text        NOT NULL DEFAULT 'Europe/Rome',
  currency                 char(3)     NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  dpa_signed_at            timestamptz,
  terminated_at            timestamptz,
  deletion_due_at          timestamptz,
  export_delivered_at      timestamptz,
  export_storage_key       text,
  deletion_override_reason text        CHECK (char_length(deletion_override_reason) <= 500),
  deleted_at               timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenants_terminated_consistency
    CHECK ((status IN ('terminated', 'deleted')) = (terminated_at IS NOT NULL)),
  CONSTRAINT tenants_deleted_consistency
    CHECK ((status = 'deleted') = (deleted_at IS NOT NULL)),
  CONSTRAINT tenants_deletion_after_termination
    CHECK (deletion_due_at IS NULL OR terminated_at IS NULL OR deletion_due_at >= terminated_at)
);

CREATE INDEX tenants_deletion_due ON tenants (deletion_due_at) WHERE status = 'terminated';

-- RLS baseline (docs/05-database.md 4.3). The owner bypasses for migrations; the runtime role is
-- filtered. A tenant reads only its own row and can never write it (no UPDATE policy for tenants).
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_all ON tenants TO rentcar_owner USING (true) WITH CHECK (true);
CREATE POLICY backup_read ON tenants FOR SELECT TO rentcar_backup USING (true);
CREATE POLICY tenant_isolation ON tenants FOR SELECT TO rentcar_app
  USING (id = (SELECT app_tenant_id()));
CREATE POLICY system_manage ON tenants TO rentcar_app
  USING (app_scope() = 'system') WITH CHECK (app_scope() = 'system');

GRANT SELECT ON tenants TO rentcar_app;
GRANT INSERT, UPDATE ON tenants TO rentcar_app;
GRANT SELECT ON tenants TO rentcar_backup;
