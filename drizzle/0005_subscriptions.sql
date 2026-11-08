-- 0005 (M1): subscriptions (docs/05-database.md 5.4). One active subscription per tenant at a time:
-- date ranges may not overlap (EXCLUDE, A-6). `expired` is derived from dates, not stored.
CREATE TABLE subscriptions (
  id             uuid        PRIMARY KEY,
  tenant_id      uuid        NOT NULL REFERENCES tenants (id),
  max_vehicles   integer     NOT NULL CHECK (max_vehicles >= 0),
  max_operators  integer     NOT NULL CHECK (max_operators >= 0),
  start_date     date        NOT NULL,
  end_date       date        NOT NULL,
  price_minor    bigint      NOT NULL CHECK (price_minor >= 0),
  price_currency char(3)     NOT NULL CHECK (price_currency ~ '^[A-Z]{3}$'),
  status         text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_dates CHECK (end_date >= start_date),
  CONSTRAINT subscriptions_cancel_consistency CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CONSTRAINT subscriptions_no_overlap EXCLUDE USING gist (
    tenant_id WITH =, daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (status <> 'cancelled')
);

CREATE INDEX subscriptions_tenant_end ON subscriptions (tenant_id, end_date DESC);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON subscriptions TO rentcar_owner USING (true) WITH CHECK (true);
CREATE POLICY backup_read ON subscriptions FOR SELECT TO rentcar_backup USING (true);
CREATE POLICY tenant_isolation ON subscriptions FOR SELECT TO rentcar_app
  USING (tenant_id = (SELECT app_tenant_id()));
CREATE POLICY system_manage ON subscriptions TO rentcar_app
  USING (app_scope() = 'system') WITH CHECK (app_scope() = 'system');

GRANT SELECT ON subscriptions TO rentcar_app;
GRANT INSERT, UPDATE ON subscriptions TO rentcar_app;
GRANT SELECT ON subscriptions TO rentcar_backup;
