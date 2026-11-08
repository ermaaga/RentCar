-- 0006 (M1): credential tokens for set-password and reset links (docs/05-database.md 5.7).
-- Only the SHA-256 of the token is stored. One live token per user and purpose; re-issuing supersedes.
CREATE TABLE credential_tokens (
  id                 uuid        PRIMARY KEY,
  tenant_id          uuid        REFERENCES tenants (id),
  user_id            uuid        NOT NULL,
  purpose            text        NOT NULL CHECK (purpose IN ('activation', 'password_reset')),
  token_hash         bytea       NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at         timestamptz NOT NULL,
  used_at            timestamptz,
  superseded_at      timestamptz,
  created_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credential_tokens_user_fk FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id),
  CONSTRAINT credential_tokens_creator_fk FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users (tenant_id, id)
);

CREATE UNIQUE INDEX credential_tokens_one_live ON credential_tokens (user_id, purpose)
  WHERE used_at IS NULL AND superseded_at IS NULL;

ALTER TABLE credential_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE credential_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON credential_tokens TO rentcar_owner USING (true) WITH CHECK (true);
CREATE POLICY backup_read ON credential_tokens FOR SELECT TO rentcar_backup USING (true);
CREATE POLICY tenant_isolation ON credential_tokens TO rentcar_app
  USING (tenant_id IS NOT NULL AND tenant_id = (SELECT app_tenant_id()))
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = (SELECT app_tenant_id()));
CREATE POLICY system_manage ON credential_tokens TO rentcar_app
  USING (app_scope() = 'system') WITH CHECK (app_scope() = 'system');

GRANT SELECT, INSERT, UPDATE ON credential_tokens TO rentcar_app;
GRANT SELECT ON credential_tokens TO rentcar_backup;
