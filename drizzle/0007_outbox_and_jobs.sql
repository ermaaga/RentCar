-- 0007 (M1): email outbox (docs/05-database.md 5.15) and job runs (5.16).

CREATE TABLE email_log (
  id                    uuid        PRIMARY KEY,
  tenant_id             uuid        REFERENCES tenants (id),
  channel               text        NOT NULL CHECK (channel IN ('tenant_smtp', 'system_smtp')),
  category              text        NOT NULL CHECK (category IN ('transactional', 'credential')),
  template              text        NOT NULL,
  related_type          text        NOT NULL,
  related_id            uuid        NOT NULL,
  recipient             text        CHECK (char_length(recipient) <= 254),
  recipient_scrubbed_at timestamptz,
  status                text        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'abandoned')),
  attempts              smallint    NOT NULL DEFAULT 0,
  max_attempts          smallint    NOT NULL DEFAULT 5,
  next_attempt_at       timestamptz,
  locked_until          timestamptz,
  last_attempt_at       timestamptz,
  sent_at               timestamptz,
  last_error            text        CHECK (char_length(last_error) <= 500),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_log_no_retry_for_credentials CHECK (category <> 'credential' OR max_attempts = 1)
);

CREATE INDEX email_log_due ON email_log (next_attempt_at)
  WHERE status IN ('pending', 'failed') AND category = 'transactional';
CREATE INDEX email_log_related ON email_log (tenant_id, related_type, related_id);
CREATE INDEX email_log_created ON email_log (created_at);

ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_log FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON email_log TO rentcar_owner USING (true) WITH CHECK (true);
CREATE POLICY backup_read ON email_log FOR SELECT TO rentcar_backup USING (true);
CREATE POLICY tenant_isolation ON email_log TO rentcar_app
  USING (tenant_id IS NOT NULL AND tenant_id = (SELECT app_tenant_id()))
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = (SELECT app_tenant_id()));
CREATE POLICY system_manage ON email_log TO rentcar_app
  USING (app_scope() = 'system') WITH CHECK (app_scope() = 'system');

GRANT SELECT, INSERT, UPDATE ON email_log TO rentcar_app;
GRANT SELECT ON email_log TO rentcar_backup;

CREATE TABLE job_runs (
  id           uuid        PRIMARY KEY,
  job          text        NOT NULL,
  tenant_id    uuid        REFERENCES tenants (id),
  period_key   text        NOT NULL,
  status       text        NOT NULL CHECK (status IN ('succeeded', 'failed', 'skipped')),
  attempt      integer     NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  started_at   timestamptz NOT NULL,
  finished_at  timestamptz NOT NULL,
  counts       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  error        text        CHECK (char_length(error) <= 500)
);

-- One run per (job, tenant, period), including platform jobs (tenant NULL).
CREATE UNIQUE INDEX job_runs_idempotency ON job_runs (job, tenant_id, period_key) NULLS NOT DISTINCT;
CREATE INDEX job_runs_started ON job_runs (started_at DESC);

ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON job_runs TO rentcar_owner USING (true) WITH CHECK (true);
CREATE POLICY backup_read ON job_runs FOR SELECT TO rentcar_backup USING (true);
CREATE POLICY tenant_isolation ON job_runs TO rentcar_app
  USING (tenant_id IS NOT NULL AND tenant_id = (SELECT app_tenant_id()))
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = (SELECT app_tenant_id()));
CREATE POLICY system_manage ON job_runs TO rentcar_app
  USING (app_scope() = 'system') WITH CHECK (app_scope() = 'system');

GRANT SELECT, INSERT, UPDATE ON job_runs TO rentcar_app;
GRANT SELECT ON job_runs TO rentcar_backup;
