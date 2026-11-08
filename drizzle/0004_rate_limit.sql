-- 0004 (M1): shared rate-limit counters (docs/05-database.md 5.17). No RLS: the key is an HMAC
-- computed before the tenant is known (4.3 documented exception). Rows are purged after expires_at.
CREATE TABLE rate_limit_buckets (
  key          text        NOT NULL CHECK (char_length(key) = 64 AND key ~ '^[0-9a-f]{64}$'),
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0 CHECK (count >= 0),
  expires_at   timestamptz NOT NULL,
  PRIMARY KEY (key, window_start)
);

CREATE INDEX rate_limit_buckets_expires ON rate_limit_buckets (expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limit_buckets TO rentcar_app;
