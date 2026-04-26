#!/usr/bin/env bash
# Runs a migration test file against the local Supabase DB.
# Usage: ./supabase/tests/run.sh migrations/023_arrival_alerts.test.sql
set -euo pipefail
TEST_FILE="${1:?usage: run.sh <path-relative-to-supabase/tests/>}"
DB_URL="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
exec psql "$DB_URL" -v ON_ERROR_STOP=1 -f "supabase/tests/${TEST_FILE}"
