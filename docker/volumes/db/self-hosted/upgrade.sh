#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DB_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
MIGRATIONS_DIR="$DB_DIR/migrations"
MIGRATION_FILE="$MIGRATIONS_DIR/018_add_storage_stats_rpc.sql"
MIGRATION_VERSION="018_add_storage_stats_rpc"
PREVIOUS_BASELINE_VERSION="20260727_self_hosted_baseline_017"
CURRENT_BASELINE_VERSION="20260727_self_hosted_baseline_018"

if [[ ! -f "$MIGRATION_FILE" ]]; then
  echo "Missing migration: $MIGRATION_FILE" >&2
  exit 2
fi

if [[ "$#" -eq 0 ]]; then
  PSQL_COMMAND=(psql -X -d "${PGDATABASE:-postgres}")
else
  PSQL_COMMAND=("$@")
fi

emit_sql() {
  cat <<SQL
\set ON_ERROR_STOP on
\set migration_version '$MIGRATION_VERSION'

SELECT to_regclass('readest_internal.schema_migrations') IS NOT NULL
  AS ledger_exists
\gset

\if :ledger_exists
\else
\echo 'Readest migration ledger is missing; run self-hosted/bootstrap.sh for a fresh database.'
\quit 4
\endif

SELECT EXISTS (
  SELECT 1
  FROM readest_internal.schema_migrations
  WHERE version IN (
    '$PREVIOUS_BASELINE_VERSION',
    '$CURRENT_BASELINE_VERSION'
  )
) AS supported_baseline
\gset

\if :supported_baseline
\else
\echo 'No supported Readest self-hosted baseline record was found.'
\quit 3
\endif

SELECT EXISTS (
  SELECT 1
  FROM readest_internal.schema_migrations
  WHERE version = :'migration_version'
) AS migration_applied
\gset

\if :migration_applied
\echo 'Readest self-hosted migrations are already current; no changes made.'
\quit 0
\endif

BEGIN;
SQL

  printf '\n%s\n' "\\echo 'Applying 018_add_storage_stats_rpc.sql...'"
  cat "$MIGRATION_FILE"

  cat <<'SQL'

INSERT INTO readest_internal.schema_migrations (version, description)
VALUES (
  :'migration_version',
  'Add service-role storage statistics aggregation RPC'
);

NOTIFY pgrst, 'reload schema';

COMMIT;

\echo 'Readest self-hosted migrations applied successfully.'
SELECT version, description, applied_at
FROM readest_internal.schema_migrations
ORDER BY applied_at;
SQL
}

emit_sql | "${PSQL_COMMAND[@]}"
