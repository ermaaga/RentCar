-- 0000 baseline (M0): no tables yet. Creates the migration ledger owned by the owner role.
-- The runner (scripts/migrate.mjs) records every file with its checksum; applied files are never edited.
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          text        PRIMARY KEY,
  checksum    text        NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now()
);
