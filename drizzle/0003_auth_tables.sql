-- 0003 (M1): users and sessions (docs/05-database.md 5.5, 5.6), with RLS per 4.3.
-- users.tenant_id NULL = systemadmin (never visible to a tenant). Sessions store only the SHA-256 of the token.

CREATE TABLE users (
  id                   uuid        PRIMARY KEY,
  tenant_id            uuid        REFERENCES tenants (id),
  role                 text        NOT NULL CHECK (role IN ('systemadmin', 'admin', 'operator')),
  username             text        NOT NULL CHECK (username = lower(username) AND username ~ '^[a-z0-9._-]{3,64}$'),
  display_name         text        NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  email                text        NOT NULL CHECK (char_length(email) <= 254),
  password_hash        text,
  status               text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'deactivated')),
  must_change_password boolean     NOT NULL DEFAULT false,
  password_changed_at  timestamptz,
  last_login_at        timestamptz,
  deactivated_at       timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_role_scope CHECK ((role = 'systemadmin') = (tenant_id IS NULL)),
  CONSTRAINT users_active_has_password CHECK (status <> 'active' OR password_hash IS NOT NULL),
  CONSTRAINT users_tenant_key UNIQUE (tenant_id, id)
);

-- Usernames are unique per tenant (history stays under the same username), and globally for systemadmins.
CREATE UNIQUE INDEX users_username_per_tenant ON users (tenant_id, username) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX users_username_system ON users (username) WHERE tenant_id IS NULL;
-- At most one admin per tenant that is pending or active.
CREATE UNIQUE INDEX users_one_admin_per_tenant ON users (tenant_id)
  WHERE role = 'admin' AND status IN ('pending', 'active');
CREATE INDEX users_tenant_role_status ON users (tenant_id, role, status);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON users TO rentcar_owner USING (true) WITH CHECK (true);
CREATE POLICY backup_read ON users FOR SELECT TO rentcar_backup USING (true);
CREATE POLICY tenant_isolation ON users TO rentcar_app
  USING (tenant_id IS NOT NULL AND tenant_id = (SELECT app_tenant_id()))
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = (SELECT app_tenant_id()));
CREATE POLICY system_manage ON users TO rentcar_app
  USING (app_scope() = 'system') WITH CHECK (app_scope() = 'system');

CREATE TABLE sessions (
  id                   uuid        PRIMARY KEY,
  tenant_id            uuid        REFERENCES tenants (id),
  realm                text        NOT NULL CHECK (realm IN ('tenant', 'system')),
  user_id              uuid        NOT NULL,
  token_hash           bytea       NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  assurance_level      smallint    NOT NULL DEFAULT 1 CHECK (assurance_level IN (1, 2)),
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  idle_expires_at      timestamptz NOT NULL,
  absolute_expires_at  timestamptz NOT NULL,
  user_agent_summary   text        CHECK (char_length(user_agent_summary) <= 80),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_realm_scope CHECK ((realm = 'system') = (tenant_id IS NULL)),
  CONSTRAINT sessions_user_fk FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id)
);

CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_absolute_expiry ON sessions (absolute_expires_at);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON sessions TO rentcar_owner USING (true) WITH CHECK (true);
CREATE POLICY backup_read ON sessions FOR SELECT TO rentcar_backup USING (true);
CREATE POLICY tenant_isolation ON sessions TO rentcar_app
  USING (tenant_id IS NOT NULL AND tenant_id = (SELECT app_tenant_id()))
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = (SELECT app_tenant_id()));
CREATE POLICY system_manage ON sessions TO rentcar_app
  USING (app_scope() = 'system') WITH CHECK (app_scope() = 'system');

GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions TO rentcar_app;
GRANT SELECT ON users, sessions TO rentcar_backup;
