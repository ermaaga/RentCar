#!/bin/sh
# Runs once on first container start (docker-entrypoint-initdb.d). Passwords come from the environment.
set -eu
: "${ROLE_MIGRATOR_PASSWORD:?ROLE_MIGRATOR_PASSWORD is required}"
: "${ROLE_APP_PASSWORD:?ROLE_APP_PASSWORD is required}"
: "${ROLE_BACKUP_PASSWORD:?ROLE_BACKUP_PASSWORD is required}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v migrator_pw="$ROLE_MIGRATOR_PASSWORD" \
  -v app_pw="$ROLE_APP_PASSWORD" \
  -v backup_pw="$ROLE_BACKUP_PASSWORD" \
  -f /rentcar/bootstrap.sql
