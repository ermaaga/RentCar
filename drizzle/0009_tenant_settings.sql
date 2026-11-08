-- 0009 (M1): tenant settings, one row per tenant (docs/05-database.md 5.2). NULL colours mean the
-- platform default, so no duplicated tokens are stored. Address is all-or-nothing (DB-A3).
CREATE TABLE tenant_settings (
  tenant_id                 uuid        PRIMARY KEY REFERENCES tenants (id),
  title                     text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 45),
  short_description         text        CHECK (char_length(short_description) <= 160),
  contact_email             text        NOT NULL CHECK (char_length(contact_email) <= 254),
  contact_phone             text        NOT NULL CHECK (char_length(contact_phone) <= 32),
  address_street            text,
  address_postal_code       text,
  address_city              text,
  address_country_code      char(2)     CHECK (address_country_code ~ '^[A-Z]{2}$'),
  logo_storage_key          text,
  logo_alt                  text        CHECK (logo_storage_key IS NULL OR char_length(logo_alt) > 0),
  og_image_key              text        CHECK (og_image_key IS NULL OR logo_storage_key IS NOT NULL),
  color_primary             char(7)    CHECK (color_primary ~ '^#[0-9a-fA-F]{6}$'),
  color_secondary           char(7)    CHECK (color_secondary ~ '^#[0-9a-fA-F]{6}$'),
  color_accent              char(7)    CHECK (color_accent ~ '^#[0-9a-fA-F]{6}$'),
  color_background          char(7)    CHECK (color_background ~ '^#[0-9a-fA-F]{6}$'),
  color_text                char(7)    CHECK (color_text ~ '^#[0-9a-fA-F]{6}$'),
  font_key                  text        NOT NULL DEFAULT 'inter' CHECK (font_key IN ('inter', 'manrope', 'plus_jakarta_sans')),
  theme_mode                text        NOT NULL DEFAULT 'auto' CHECK (theme_mode IN ('auto', 'light', 'dark')),
  theme_version             integer     NOT NULL DEFAULT 1,
  min_rental_days           smallint    NOT NULL DEFAULT 1 CHECK (min_rental_days >= 1),
  max_rental_days           smallint    NOT NULL DEFAULT 30,
  lead_time_minutes         integer     NOT NULL DEFAULT 0 CHECK (lead_time_minutes BETWEEN 0 AND 43200),
  buffer_minutes            integer     NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 1440),
  privacy_notice_url        text        CHECK (privacy_notice_url ~ '^https://' AND char_length(privacy_notice_url) <= 2048),
  rental_terms_url          text        CHECK (rental_terms_url ~ '^https://' AND char_length(rental_terms_url) <= 2048),
  privacy_notice_text       text        CHECK (char_length(privacy_notice_text) <= 20000),
  rental_terms_text         text        CHECK (char_length(rental_terms_text) <= 20000),
  notify_new_booking        boolean     NOT NULL DEFAULT true,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_settings_rental_days CHECK (max_rental_days >= min_rental_days),
  CONSTRAINT tenant_settings_address_all_or_none CHECK (
    (address_street IS NULL AND address_postal_code IS NULL AND address_city IS NULL AND address_country_code IS NULL)
    OR (address_street IS NOT NULL AND address_postal_code IS NOT NULL AND address_city IS NOT NULL AND address_country_code IS NOT NULL)
  )
);

ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON tenant_settings TO rentcar_owner USING (true) WITH CHECK (true);
CREATE POLICY backup_read ON tenant_settings FOR SELECT TO rentcar_backup USING (true);
CREATE POLICY tenant_isolation ON tenant_settings TO rentcar_app
  USING (tenant_id = (SELECT app_tenant_id())) WITH CHECK (tenant_id = (SELECT app_tenant_id()));
CREATE POLICY system_manage ON tenant_settings TO rentcar_app
  USING (app_scope() = 'system') WITH CHECK (app_scope() = 'system');

GRANT SELECT, INSERT, UPDATE ON tenant_settings TO rentcar_app;
GRANT SELECT ON tenant_settings TO rentcar_backup;
