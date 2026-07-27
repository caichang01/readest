#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

CAPTURE="$TMP_DIR/bootstrap.sql"
MOCK_PSQL="$TMP_DIR/mock-psql"

cat >"$MOCK_PSQL" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
cat >"$CAPTURE_SQL"
SH
chmod +x "$MOCK_PSQL"

CAPTURE_SQL="$CAPTURE" "$SCRIPT_DIR/bootstrap.sh" "$MOCK_PSQL"

assert_contains() {
  local pattern="$1"
  if ! grep -Fq -- "$pattern" "$CAPTURE"; then
    echo "Expected generated SQL to contain: $pattern" >&2
    exit 1
  fi
}

assert_not_contains() {
  local pattern="$1"
  if grep -Fq -- "$pattern" "$CAPTURE"; then
    echo "Expected generated SQL not to contain: $pattern" >&2
    exit 1
  fi
}

assert_contains '\set ON_ERROR_STOP on'
assert_contains 'BEGIN;'
assert_contains 'COMMIT;'
assert_contains 'CREATE TABLE public.books'
assert_contains "\\echo 'Applying 002_add_book_shares.sql...'"
assert_contains "\\echo 'Applying 014_add_reading_stats.sql...'"
assert_contains '20260727_self_hosted_baseline_018'
assert_contains 'CREATE SCHEMA IF NOT EXISTS readest_internal'
assert_contains 'GRANT SELECT ON TABLE public.send_inbox TO authenticated'
assert_contains 'CREATE OR REPLACE FUNCTION public.get_storage_by_book_hash(p_user_id uuid)'
assert_contains '"bookHash" text'
assert_contains '"fileCount" bigint'
assert_contains '"totalSize" bigint'
assert_contains 'REVOKE ALL ON FUNCTION public.get_storage_by_book_hash(uuid) FROM PUBLIC'
assert_contains 'GRANT SELECT ON public.files TO service_role'
assert_contains 'GRANT EXECUTE ON FUNCTION public.get_storage_by_book_hash(uuid) TO service_role'
assert_contains '018_add_storage_stats_rpc'
assert_contains "NOTIFY pgrst, 'reload schema'"
assert_contains 'Readest self-hosted baseline is already applied; no changes made.'
assert_contains 'Run self-hosted/upgrade.sh before retrying the baseline.'

assert_not_contains 'Migration 001:'
assert_not_contains 'Migration 013:'
assert_not_contains 'Migration 015:'
assert_not_contains 'Migration 016:'
assert_not_contains 'Migration 017:'
assert_not_contains "\\echo 'Applying 018_add_storage_stats_rpc.sql...'"
assert_not_contains 'CREATE INDEX CONCURRENTLY'
assert_not_contains 'CALL public.backfill_books_synced_at'

if LC_ALL=C grep -q $'\033' "$CAPTURE"; then
  echo "Generated SQL contains an unexpected ESC control character" >&2
  exit 1
fi

echo "self-hosted bootstrap generation test passed"
