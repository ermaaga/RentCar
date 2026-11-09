-- 0012 (M1): termination export download link (docs/05-database.md 5.23, SR-GDPR-06).
-- Owned by the tenant, not a credential: only the SHA-256 of the token is stored, one live link per
-- tenant, and a bounded download counter consumed atomically by the download route.
CREATE TABLE export_download_tokens (
  id                  uuid        PRIMARY KEY,
  tenant_id           uuid        NOT NULL REFERENCES tenants (id),
  token_hash          bytea       NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  storage_key         text        NOT NULL CHECK (char_length(storage_key) BETWEEN 1 AND 512),
  expires_at          timestamptz NOT NULL,
  download_count      smallint    NOT NULL DEFAULT 0 CHECK (download_count >= 0),
  max_downloads       smallint    NOT NULL DEFAULT 3 CHECK (max_downloads BETWEEN 1 AND 3),
  superseded_at       timestamptz,
  created_by_user_id  uuid        REFERENCES users (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT export_download_tokens_expiry CHECK (expires_at > created_at),
  CONSTRAINT export_download_tokens_counter CHECK (download_count <= max_downloads),
  CONSTRAINT export_download_tokens_key_scope CHECK (
    storage_key LIKE 'private/' || tenant_id::text || '/exports/%.zip')
);

CREATE UNIQUE INDEX export_download_tokens_one_live ON export_download_tokens (tenant_id)
  WHERE superseded_at IS NULL;
CREATE INDEX export_download_tokens_created ON export_download_tokens (created_at);

-- Tenant isolation only: the systemadmin issues the link inside a transaction scoped to the target tenant.
ALTER TABLE export_download_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_download_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON export_download_tokens TO rentcar_owner USING (true) WITH CHECK (true);
CREATE POLICY backup_read ON export_download_tokens FOR SELECT TO rentcar_backup USING (true);
CREATE POLICY tenant_isolation ON export_download_tokens TO rentcar_app
  USING (tenant_id = (SELECT app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT app_tenant_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON export_download_tokens TO rentcar_app;
GRANT SELECT ON export_download_tokens TO rentcar_backup;
