-- 0015 (M2): vehicles, vehicle photos, customers and bookings (docs/05-database.md 5.8, 5.9, 5.11,
-- 5.12 and 6). Tenant data only: RLS tenant_isolation, no system policy at all (SY-02, ABU-M1-28:
-- the system scope reads zero rows). Double booking is impossible by the exclusion constraint on
-- (vehicle_id, blocked_during); blocked_during is set only by trigger (ADR-0004).

CREATE TABLE vehicles (
  id                 uuid        PRIMARY KEY,
  tenant_id          uuid        NOT NULL REFERENCES tenants (id),
  name               text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  plate              text        NOT NULL CHECK (char_length(plate) BETWEEN 1 AND 20),
  plate_normalized   text        GENERATED ALWAYS AS (upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g'))) STORED,
  make               text        NOT NULL CHECK (char_length(make) BETWEEN 1 AND 80),
  model              text        NOT NULL CHECK (char_length(model) BETWEEN 1 AND 80),
  category           text        NOT NULL CHECK (category IN ('city', 'compact', 'sedan', 'suv', 'van', 'convertible', 'luxury', 'other')),
  fuel_type          text        NOT NULL CHECK (fuel_type IN ('petrol', 'diesel', 'hybrid', 'plug_in_hybrid', 'electric', 'lpg_cng')),
  seats              smallint    NOT NULL CHECK (seats BETWEEN 1 AND 20),
  daily_price_minor  bigint      NOT NULL CHECK (daily_price_minor >= 0),
  status             text        NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'maintenance')),
  archived_at        timestamptz,
  notes              text        CHECK (char_length(notes) <= 2000),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicles_tenant_key UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX vehicles_tenant_plate ON vehicles (tenant_id, plate_normalized);
CREATE INDEX vehicles_tenant_name ON vehicles (tenant_id, lower(name));
CREATE INDEX vehicles_tenant_live ON vehicles (tenant_id) WHERE archived_at IS NULL;

CREATE TABLE vehicle_photos (
  id           uuid     PRIMARY KEY,
  tenant_id    uuid     NOT NULL,
  vehicle_id   uuid     NOT NULL,
  storage_key  text     NOT NULL UNIQUE CHECK (char_length(storage_key) <= 300),
  byte_size    integer  NOT NULL CHECK (byte_size > 0),
  width        integer  NOT NULL CHECK (width > 0),
  height       integer  NOT NULL CHECK (height > 0),
  position     smallint NOT NULL CHECK (position BETWEEN 0 AND 9),
  is_cover     boolean  NOT NULL DEFAULT false,
  CONSTRAINT vehicle_photos_vehicle_fk FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES vehicles (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT vehicle_photos_position_key UNIQUE (vehicle_id, position) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX vehicle_photos_one_cover ON vehicle_photos (vehicle_id) WHERE is_cover;

CREATE TABLE customers (
  id             uuid        PRIMARY KEY,
  tenant_id      uuid        NOT NULL REFERENCES tenants (id),
  first_name     text        NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 80),
  last_name      text        NOT NULL CHECK (char_length(last_name) BETWEEN 1 AND 80),
  phone          text        NOT NULL,
  email          text        CHECK (char_length(email) <= 254),
  anonymized_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_tenant_key UNIQUE (tenant_id, id),
  CONSTRAINT customers_phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{6,14}$' OR anonymized_at IS NOT NULL)
);
CREATE UNIQUE INDEX customers_tenant_phone ON customers (tenant_id, phone);
CREATE INDEX customers_tenant_created ON customers (tenant_id, created_at DESC);

CREATE TABLE bookings (
  id                   uuid        PRIMARY KEY,
  tenant_id            uuid        NOT NULL REFERENCES tenants (id),
  code                 text        NOT NULL CHECK (code ~ '^[0-9A-HJKMNP-TV-Z]{10}$'),
  vehicle_id           uuid        NOT NULL,
  customer_id          uuid        NOT NULL,
  customer_first_name  text        NOT NULL CHECK (char_length(customer_first_name) BETWEEN 1 AND 80),
  customer_last_name   text        NOT NULL CHECK (char_length(customer_last_name) BETWEEN 1 AND 80),
  customer_email       text        CHECK (char_length(customer_email) <= 254),
  start_at             timestamptz NOT NULL,
  end_at               timestamptz NOT NULL,
  buffer_minutes       integer     NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 1440),
  blocked_during       tstzrange   NOT NULL DEFAULT 'empty' CHECK (NOT isempty(blocked_during)),
  status               text        NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'active', 'completed', 'cancelled')),
  status_changed_at    timestamptz NOT NULL DEFAULT now(),
  daily_price_minor    bigint      NOT NULL CHECK (daily_price_minor >= 0),
  billed_days          smallint    NOT NULL CHECK (billed_days >= 1),
  total_minor          bigint      NOT NULL CHECK (total_minor >= 0),
  payment_method       text        CHECK (payment_method IN ('card', 'cash')),
  is_paid              boolean     NOT NULL DEFAULT false,
  paid_amount_minor    bigint      NOT NULL DEFAULT 0 CHECK (paid_amount_minor >= 0),
  paid_at              timestamptz,
  source               text        NOT NULL CHECK (source IN ('public', 'admin')),
  notes                text        CHECK (char_length(notes) <= 2000),
  cancelled_at         timestamptz,
  cancel_reason        text        CHECK (char_length(cancel_reason) <= 500),
  created_by_user_id   uuid        REFERENCES users (id),
  idempotency_key      text        CHECK (char_length(idempotency_key) <= 64),
  version              integer     NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bookings_tenant_key UNIQUE (tenant_id, id),
  CONSTRAINT bookings_tenant_code_key UNIQUE (tenant_id, code),
  CONSTRAINT bookings_vehicle_fk FOREIGN KEY (tenant_id, vehicle_id) REFERENCES vehicles (tenant_id, id),
  CONSTRAINT bookings_customer_fk FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id),
  CONSTRAINT bookings_dates CHECK (end_at > start_at),
  CONSTRAINT bookings_paid_method CHECK (NOT is_paid OR payment_method IS NOT NULL),
  CONSTRAINT bookings_paid_amount CHECK (is_paid OR paid_amount_minor = 0),
  CONSTRAINT bookings_cancel_consistency CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CONSTRAINT bookings_vehicle_id_blocked_during_excl
    EXCLUDE USING gist (vehicle_id WITH =, blocked_during WITH &&) WHERE (status <> 'cancelled')
);
CREATE UNIQUE INDEX bookings_tenant_idempotency_key ON bookings (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX bookings_tenant_start ON bookings (tenant_id, start_at DESC);
CREATE INDEX bookings_tenant_end ON bookings (tenant_id, end_at);
CREATE INDEX bookings_tenant_vehicle_start ON bookings (tenant_id, vehicle_id, start_at DESC);
CREATE INDEX bookings_tenant_customer_start ON bookings (tenant_id, customer_id, start_at DESC);
CREATE INDEX bookings_open_idx ON bookings (tenant_id, start_at) WHERE status IN ('confirmed', 'active');

CREATE FUNCTION bookings_set_blocked_during() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.blocked_during := tstzrange(NEW.start_at, NEW.end_at + make_interval(mins => NEW.buffer_minutes), '[)');
  RETURN NEW;
END $$;
CREATE TRIGGER bookings_blocked_during BEFORE INSERT OR UPDATE OF start_at, end_at, buffer_minutes, blocked_during
  ON bookings FOR EACH ROW EXECUTE FUNCTION bookings_set_blocked_during();

-- RLS: tenant isolation only (no system_manage policy: the console never reads fleet or bookings).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vehicles', 'vehicle_photos', 'customers', 'bookings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY owner_all ON %I TO rentcar_owner USING (true) WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY backup_read ON %I FOR SELECT TO rentcar_backup USING (true)', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO rentcar_app USING (tenant_id = (SELECT app_tenant_id())) WITH CHECK (tenant_id = (SELECT app_tenant_id()))',
      t);
    EXECUTE format('GRANT SELECT ON %I TO rentcar_backup', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON vehicles, customers, bookings TO rentcar_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON vehicle_photos TO rentcar_app;
