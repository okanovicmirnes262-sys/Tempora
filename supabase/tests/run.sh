#!/usr/bin/env bash
# Pokreće migracije + seed + RLS testove na lokalnom (praznom) Postgresu.
# Koristi standardne PG varijable: PGHOST, PGPORT, PGUSER (npr. PGHOST=localhost PGUSER=postgres).
set -euo pipefail
cd "$(dirname "$0")/.."
psql -d postgres -v ON_ERROR_STOP=1 -q -c 'drop database if exists smjene_test' -c 'create database smjene_test'
run() { psql -d smjene_test -v ON_ERROR_STOP=1 -q -f "$1"; }
run tests/00_supabase_stub.sql
for f in migrations/*.sql; do run "$f"; done
run seed.sql
run tests/10_rls.sql
echo "OK: baza i RLS testovi prošli"
