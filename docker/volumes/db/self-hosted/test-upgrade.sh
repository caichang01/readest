#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

CAPTURE="$TMP_DIR/upgrade.sql"
MOCK_PSQL="$TMP_DIR/mock-psql"
VERIFY_SQL="$SCRIPT_DIR/verify.sql"

cat >"$MOCK_PSQL" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
cat >"$CAPTURE_SQL"
SH
chmod +x "$MOCK_PSQL"

CAPTURE_SQL="$CAPTURE" "$SCRIPT_DIR/upgrade.sh" "$MOCK_PSQL"

assert_contains() {
  local pattern="$1"
  if ! grep -Fq -- "$pattern" "$CAPTURE"; then
    echo "Expected generated upgrade SQL to contain: $pattern" >&2
    exit 1
  fi
}

assert_not_contains() {
  local pattern="$1"
  if grep -Fq -- "$pattern" "$CAPTURE"; then
    echo "Expected generated upgrade SQL not to contain: $pattern" >&2
    exit 1
  fi
}

assert_contains '\set ON_ERROR_STOP on'
assert_contains '20260727_self_hosted_baseline_017'
assert_contains '20260727_self_hosted_baseline_018'
assert_contains '018_add_storage_stats_rpc'
assert_contains "\\echo 'Applying 018_add_storage_stats_rpc.sql...'"
assert_contains 'CREATE OR REPLACE FUNCTION public.get_storage_by_book_hash(p_user_id uuid)'
assert_contains 'REVOKE ALL ON FUNCTION public.get_storage_by_book_hash(uuid) FROM PUBLIC'
assert_contains 'GRANT SELECT ON public.files TO service_role'
assert_contains 'GRANT EXECUTE ON FUNCTION public.get_storage_by_book_hash(uuid) TO service_role'
assert_contains "NOTIFY pgrst, 'reload schema'"
assert_contains 'Readest self-hosted migrations are already current; no changes made.'
assert_contains "RAISE EXCEPTION 'Readest migration ledger is missing"
assert_contains "RAISE EXCEPTION 'No supported Readest self-hosted baseline record was found"
assert_not_contains '\quit 0'
assert_not_contains '\quit 3'
assert_not_contains '\quit 4'

assert_verify_contains() {
  local pattern="$1"
  if ! grep -Fq -- "$pattern" "$VERIFY_SQL"; then
    echo "Expected verification SQL to contain: $pattern" >&2
    exit 1
  fi
}

assert_verify_contains "to_regprocedure('public.get_storage_by_book_hash(uuid)')"
assert_verify_contains "'018_add_storage_stats_rpc'"
assert_verify_contains "'service_role'"
assert_verify_contains "acl.privilege_type = 'EXECUTE'"
assert_verify_contains "has_table_privilege('service_role', 'public.files', 'SELECT')"

if LC_ALL=C grep -q $'\033' "$CAPTURE"; then
  echo "Generated upgrade SQL contains an unexpected ESC control character" >&2
  exit 1
fi

echo "self-hosted upgrade generation test passed"
