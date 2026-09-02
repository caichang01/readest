#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DB_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
MIGRATIONS_DIR="$DB_DIR/migrations"
STORAGE_STATS_MIGRATION_FILE="$MIGRATIONS_DIR/018_add_storage_stats_rpc.sql"
STORAGE_STATS_MIGRATION_VERSION="018_add_storage_stats_rpc"
METADATA_MIGRATION_FILE="$MIGRATIONS_DIR/019_add_metadata_updated_at.sql"
METADATA_MIGRATION_VERSION="019_add_metadata_updated_at"
PREVIOUS_BASELINE_VERSION="20260727_self_hosted_baseline_017"
CURRENT_BASELINE_VERSION="20260727_self_hosted_baseline_018"
NEXT_BASELINE_VERSION="20260813_self_hosted_baseline_019"
LATEST_BASELINE_VERSION="20260902_self_hosted_baseline_024"
ADDITIONAL_MIGRATIONS=(
  020_stat_pages_upsert_rpc
  021_stat_archives
  022_stat_archive_row_cap
  023_add_group_updated_at
  024_replica_abs_server
)

for migration in "${ADDITIONAL_MIGRATIONS[@]}"; do
  if [[ ! -f "$MIGRATIONS_DIR/$migration.sql" ]]; then
    echo "Missing migration: $MIGRATIONS_DIR/$migration.sql" >&2
    exit 2
  fi
done

for migration_file in "$STORAGE_STATS_MIGRATION_FILE" "$METADATA_MIGRATION_FILE"; do
  if [[ ! -f "$migration_file" ]]; then
    echo "Missing migration: $migration_file" >&2
    exit 2
  fi
done

if [[ "$#" -eq 0 ]]; then
  PSQL_COMMAND=(psql -X -d "${PGDATABASE:-postgres}")
else
  PSQL_COMMAND=("$@")
fi

emit_sql() {
  cat <<SQL
\set ON_ERROR_STOP on
\set storage_stats_migration_version '$STORAGE_STATS_MIGRATION_VERSION'
\set metadata_migration_version '$METADATA_MIGRATION_VERSION'

SELECT to_regclass('readest_internal.schema_migrations') IS NOT NULL
  AS ledger_exists
\gset

\if :ledger_exists
\else
DO \$psql\$
BEGIN
  RAISE EXCEPTION 'Readest migration ledger is missing; run self-hosted/bootstrap.sh for a fresh database.';
END
\$psql\$;
\endif

SELECT EXISTS (
  SELECT 1
  FROM readest_internal.schema_migrations
  WHERE version IN (
    '$PREVIOUS_BASELINE_VERSION',
    '$CURRENT_BASELINE_VERSION',
    '$NEXT_BASELINE_VERSION',
    '$LATEST_BASELINE_VERSION'
  )
) AS supported_baseline
\gset

\if :supported_baseline
\else
DO \$psql\$
BEGIN
  RAISE EXCEPTION 'No supported Readest self-hosted baseline record was found.';
END
\$psql\$;
\endif

BEGIN;
-- Serialize concurrent upgrades before inspecting individual ledger entries.
SELECT pg_advisory_xact_lock(hashtext('readest_self_hosted_upgrade'));

SELECT NOT EXISTS (
  SELECT required.version
  FROM (VALUES
    (:'storage_stats_migration_version'),
    (:'metadata_migration_version'),
    ('020_stat_pages_upsert_rpc'),
    ('021_stat_archives'),
    ('022_stat_archive_row_cap'),
    ('023_add_group_updated_at'),
    ('024_replica_abs_server')
  ) AS required(version)
  WHERE NOT EXISTS (
    SELECT 1
    FROM readest_internal.schema_migrations applied
    WHERE applied.version = required.version
  )
) AS migrations_current
\gset

\if :migrations_current
\echo 'Readest self-hosted migrations are already current; no changes made.'
COMMIT;
\quit
\endif

SELECT EXISTS (
  SELECT 1
  FROM readest_internal.schema_migrations
  WHERE version = :'storage_stats_migration_version'
) AS storage_stats_migration_applied
\gset

SELECT EXISTS (
  SELECT 1
  FROM readest_internal.schema_migrations
  WHERE version = :'metadata_migration_version'
) AS metadata_migration_applied
\gset

SQL

  printf '\n%s\n' '\if :storage_stats_migration_applied'
  printf '%s\n' '\else'
  printf '%s\n' "\\echo 'Applying 018_add_storage_stats_rpc.sql...'"
  cat "$STORAGE_STATS_MIGRATION_FILE"

  cat <<'SQL'

INSERT INTO readest_internal.schema_migrations (version, description)
VALUES (
  :'storage_stats_migration_version',
  'Add service-role storage statistics aggregation RPC'
);
\endif
SQL

  printf '\n%s\n' '\if :metadata_migration_applied'
  printf '%s\n' '\else'
  printf '%s\n' "\\echo 'Applying 019_add_metadata_updated_at.sql...'"
  cat "$METADATA_MIGRATION_FILE"

  cat <<'SQL'

INSERT INTO readest_internal.schema_migrations (version, description)
VALUES (
  :'metadata_migration_version',
  'Add metadata conflict-resolution timestamp to books'
);
\endif
SQL

  for migration in "${ADDITIONAL_MIGRATIONS[@]}"; do
    printf "\nSELECT EXISTS (SELECT 1 FROM readest_internal.schema_migrations WHERE version = '%s') AS migration_applied\n" "$migration"
    printf '%s\n' '\gset' '\if :migration_applied' '\else'
    printf '%s\n' "\\echo 'Applying $migration.sql...'"
    cat "$MIGRATIONS_DIR/$migration.sql"
    printf "\nINSERT INTO readest_internal.schema_migrations (version, description) VALUES ('%s', 'Readest forward migration %s');\n" "$migration" "$migration"
    printf '%s\n' '\endif'
  done

  cat <<'SQL'

NOTIFY pgrst, 'reload schema';

COMMIT;

\echo 'Readest self-hosted migrations applied successfully.'
SELECT version, description, applied_at
FROM readest_internal.schema_migrations
ORDER BY applied_at;
SQL
}

emit_sql | "${PSQL_COMMAND[@]}"
