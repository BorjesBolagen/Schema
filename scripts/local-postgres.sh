#!/usr/bin/env bash
# Startar en lokal PostgreSQL för att prova den väg produktionen tar.
#
# PGlite räcker för utveckling, men drivrutinen är en annan än i drift.
# Det här skriptet gör det billigt att testa mot riktig Postgres.
#
#   ./scripts/local-postgres.sh start
#   DATABASE_URL='postgresql://postgres@127.0.0.1:55432/schema?sslmode=disable' npm run seed
#   ./scripts/local-postgres.sh stop
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGROOT="${PGROOT:-/tmp/schema-pg}"
PGDATA="$PGROOT/data"
PORT="${PGPORT:-55432}"

case "${1:-start}" in
  start)
    if [ ! -d "$PGDATA" ]; then
      id postgres >/dev/null 2>&1 || useradd -m postgres
      mkdir -p "$PGROOT" && chown -R postgres "$PGROOT"
      su postgres -c "$PGBIN/initdb -D $PGDATA -A trust -U postgres --encoding=UTF8 --locale=C" >/dev/null
    fi
    su postgres -c "$PGBIN/pg_ctl -D $PGDATA -o '-p $PORT -k $PGROOT' -l $PGROOT/pg.log start"
    sleep 1
    psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='schema'" \
      | grep -q 1 || psql -h 127.0.0.1 -p "$PORT" -U postgres -c "CREATE DATABASE schema" >/dev/null
    echo "DATABASE_URL='postgresql://postgres@127.0.0.1:$PORT/schema?sslmode=disable'"
    ;;
  stop)
    su postgres -c "$PGBIN/pg_ctl -D $PGDATA stop" || true
    ;;
  reset)
    "$0" stop || true
    rm -rf "$PGROOT"
    "$0" start
    ;;
  *)
    echo "Användning: $0 [start|stop|reset]" >&2
    exit 1
    ;;
esac
