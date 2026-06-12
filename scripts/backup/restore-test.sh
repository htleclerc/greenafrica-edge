#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# restore-test.sh — monthly backup/restore drill against the hosted Supabase DB
#
# READ-ONLY against the source database. Proves three things:
#   1. We can reach production Postgres with the credentials we keep.
#   2. pg_dump produces a structurally valid dump (schema + migration history).
#   3. The fiscal tables are present and populated (row-count smoke).
#
# Usage:
#   SUPABASE_DB_URL="postgresql://..." ./scripts/backup/restore-test.sh
#
#   SUPABASE_DB_URL  (required)  Postgres connection string. Use the pooler URL
#                    (aws-1-eu-north-1.pooler.supabase.com:5432) if direct
#                    db.<ref>.supabase.co DNS is blocked on your network.
#                    See docs/runbooks/2026-backup-dr.md §3.3 for where the
#                    credentials live. NEVER hardcode it here.
#   BACKUP_DIR       (optional)  Output directory. Default: <repo>/backups
#                    (gitignored — dumps must NEVER be committed).
#   SCHEMAS          (optional)  Space-separated schemas to dump.
#                    Default: "public supabase_migrations".
#
# Exit code: 0 = PASS, 1 = FAIL (any check failed).
# ─────────────────────────────────────────────────────────────────────────────
set -u -o pipefail

# ── Preconditions ────────────────────────────────────────────────────────────
if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "FATAL: SUPABASE_DB_URL is not set. Refusing to run." >&2
  echo "  export SUPABASE_DB_URL=\"postgresql://postgres:<password>@.../postgres\"" >&2
  echo "  (credentials: see docs/runbooks/2026-backup-dr.md §3.3)" >&2
  exit 1
fi

for tool in pg_dump psql; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "FATAL: $tool not found on PATH." >&2
    echo "  On this dev machine: scoop install postgresql" >&2
    echo "  (binaries land in ~/scoop/apps/postgresql/current/bin)" >&2
    exit 1
  fi
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
SCHEMAS="${SCHEMAS:-public supabase_migrations}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="$BACKUP_DIR/restore-test-schema-$TS.sql"

mkdir -p "$BACKUP_DIR"

PASS=true
fail() { PASS=false; echo "  [FAIL] $1"; }
ok()   { echo "  [ OK ] $1"; }

echo "── Backup/restore drill — $TS ──────────────────────────────────────"
echo "   target : (redacted — \$SUPABASE_DB_URL)"
echo "   output : $DUMP_FILE"
echo

# ── 1. Schema-only dump ──────────────────────────────────────────────────────
echo "[1/3] pg_dump --schema-only (${SCHEMAS})"
SCHEMA_FLAGS=()
for s in $SCHEMAS; do SCHEMA_FLAGS+=(--schema="$s"); done

if pg_dump "$SUPABASE_DB_URL" \
    --schema-only --no-owner --no-privileges \
    "${SCHEMA_FLAGS[@]}" \
    --file "$DUMP_FILE" 2>&1; then
  SIZE=$(wc -c <"$DUMP_FILE" | tr -d ' ')
  if [ "$SIZE" -gt 10000 ]; then
    ok "dump written ($SIZE bytes)"
  else
    fail "dump suspiciously small ($SIZE bytes)"
  fi
else
  fail "pg_dump exited non-zero"
fi

# ── 2. Fiscal row-count smoke (read-only) ────────────────────────────────────
echo
echo "[2/3] Row-count smoke (psql, read-only)"

run_count() { # run_count <label> <sql> [min_expected]
  local label="$1" sql="$2" min="${3:-0}" n
  n=$(psql "$SUPABASE_DB_URL" -X -A -t -v ON_ERROR_STOP=1 -c "$sql" 2>&1)
  if [[ "$n" =~ ^[0-9]+$ ]]; then
    if [ "$n" -ge "$min" ]; then
      ok "$label = $n"
    else
      fail "$label = $n (expected >= $min)"
    fi
  else
    fail "$label query failed: $(echo "$n" | head -1)"
  fi
}

run_count "transactions             " "SELECT COUNT(*) FROM public.transactions;" 1
run_count "payments                 " "SELECT COUNT(*) FROM public.payments;" 0
run_count "wallets                  " "SELECT COUNT(*) FROM public.wallets;" 0
run_count "tariffs                  " "SELECT COUNT(*) FROM public.tariffs;" 1
run_count "v_revenue_split_settlement" "SELECT COUNT(*) FROM public.v_revenue_split_settlement;" 0
run_count "auth.users               " "SELECT COUNT(*) FROM auth.users;" 1

MIG_TIP=$(psql "$SUPABASE_DB_URL" -X -A -t -v ON_ERROR_STOP=1 \
  -c "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 1;" 2>&1)
if [[ "$MIG_TIP" =~ ^[0-9]+$ ]]; then
  ok "schema_migrations tip = $MIG_TIP"
else
  fail "schema_migrations tip query failed: $(echo "$MIG_TIP" | head -1)"
fi

# ── 3. Validate the dump is restorable-shaped ───────────────────────────────
echo
echo "[3/3] Dump validation (CREATE TABLE markers present)"
for tbl in transactions payments tariffs wallets wallet_ledger audit_logs; do
  if grep -q "CREATE TABLE public\.$tbl " "$DUMP_FILE" 2>/dev/null ||
     grep -q "CREATE TABLE IF NOT EXISTS public\.$tbl " "$DUMP_FILE" 2>/dev/null; then
    ok "CREATE TABLE public.$tbl"
  else
    fail "CREATE TABLE public.$tbl NOT found in dump"
  fi
done

# ── Summary ──────────────────────────────────────────────────────────────────
echo
if $PASS; then
  echo "RESULT: PASS — dump at $DUMP_FILE (local only, gitignored)"
  exit 0
else
  echo "RESULT: FAIL — investigate before relying on this backup path"
  exit 1
fi
