#!/usr/bin/env bash
# PgBouncer in transaction mode in front of the test Postgres, for the GUC-bleed test (spike S1 local,
# ABU-M0-04/05). Two server connections only, so transactions of different tenants share them.
# Usage: start.sh <app role password> [postgres host] [postgres port]. Listens on 127.0.0.1:6432.
set -euo pipefail
password="${1:?app role password}"
host="${2:-127.0.0.1}"
port="${3:-5432}"
dir="$(mktemp -d)"
cat > "$dir/pgbouncer.ini" <<INI
[databases]
rentcar = host=$host port=$port dbname=rentcar
[pgbouncer]
listen_addr = 127.0.0.1
listen_port = 6432
unix_socket_dir =
auth_type = scram-sha-256
auth_file = $dir/userlist.txt
pool_mode = transaction
default_pool_size = 2
max_client_conn = 500
ignore_startup_parameters = extra_float_digits
logfile = $dir/pgbouncer.log
pidfile = $dir/pgbouncer.pid
INI
printf '"rentcar_app" "%s"\n' "$password" > "$dir/userlist.txt"
chmod 600 "$dir/userlist.txt"
pgbouncer -d "$dir/pgbouncer.ini"
for _ in $(seq 1 20); do
  pg_isready -h 127.0.0.1 -p 6432 -q && exit 0
  sleep 0.5
done
cat "$dir/pgbouncer.log" >&2
exit 1
