-- Idempotent bootstrap of roles and the database, run once per container init and on every
-- managed-database setup (docs/11-devops-deploy.md 2.1 and 9.2). Run as the bootstrap superuser.
-- Expects psql variables: migrator_pw, app_pw, backup_pw.
\set ON_ERROR_STOP on

-- Roles (created once, passwords refreshed on every run)
SELECT format('CREATE ROLE rentcar_owner NOLOGIN')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rentcar_owner') \gexec

SELECT format('CREATE ROLE rentcar_migrator LOGIN')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rentcar_migrator') \gexec
ALTER ROLE rentcar_migrator LOGIN PASSWORD :'migrator_pw';
GRANT rentcar_owner TO rentcar_migrator;

SELECT format('CREATE ROLE rentcar_app LOGIN')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rentcar_app') \gexec
ALTER ROLE rentcar_app LOGIN PASSWORD :'app_pw' NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;

SELECT format('CREATE ROLE rentcar_backup LOGIN')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rentcar_backup') \gexec
ALTER ROLE rentcar_backup LOGIN PASSWORD :'backup_pw' NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- Role-level timeouts (05-database 4.1)
ALTER ROLE rentcar_app SET statement_timeout = '15s';
ALTER ROLE rentcar_app SET lock_timeout = '3s';
ALTER ROLE rentcar_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE rentcar_migrator SET statement_timeout = '5min';
ALTER ROLE rentcar_migrator SET lock_timeout = '10s';

-- Database owned by the owner role; schema owned by the owner role; public schema locked down
ALTER DATABASE rentcar OWNER TO rentcar_owner;
REVOKE ALL ON DATABASE rentcar FROM PUBLIC;
GRANT CONNECT ON DATABASE rentcar TO rentcar_migrator, rentcar_app, rentcar_backup;
\connect rentcar
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO rentcar_owner;
CREATE EXTENSION IF NOT EXISTS btree_gist;
GRANT USAGE ON SCHEMA public TO rentcar_app, rentcar_backup;
