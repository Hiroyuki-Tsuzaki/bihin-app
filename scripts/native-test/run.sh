#!/usr/bin/env bash
# Docker なしの簡易テスト: 素の PostgreSQL(+pgTAP, pg_cron) にスタブ→マイグレーション→pgTAPテストを流す
#   前提: PGHOST/PGPORT/PGUSER でスーパーユーザー接続できること。pg_cron を shared_preload_libraries に設定済み
#   使い方: PGPORT=55432 scripts/native-test/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${TEST_DB:-bihin_test}
export PGUSER=${PGUSER:-postgres} PGHOST=${PGHOST:-localhost}
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "alter database $DB set search_path = public, extensions"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f scripts/native-test/supabase-shim.sql
# pg_cron は cron.database_name のDBにしか入らないため、テストDBでは cron スキーマをスタブ
psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, jobname text, schedule text, command text);
create or replace function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint
language sql as $$ insert into cron.job(jobname, schedule, command) values (p_name, p_schedule, p_command) returning jobid $$;
create or replace function cron.unschedule(p_jobid bigint) returns boolean
language sql as $$ delete from cron.job where jobid = p_jobid returning true $$;
SQL
for f in supabase/migrations/*.sql; do
  # pg_cron の create extension はスタブ済みなので除外
  sed 's/^create extension if not exists pg_cron;/-- (native-test) pg_cron skipped/' "$f" | psql -q -v ON_ERROR_STOP=1 -d "$DB" -f -
done
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/seed.sql
pg_prove -d "$DB" supabase/tests/database/*.test.sql
