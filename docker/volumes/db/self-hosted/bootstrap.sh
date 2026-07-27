#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DB_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
INIT_SCHEMA="$DB_DIR/init/schema.sql"
MIGRATIONS_DIR="$DB_DIR/migrations"
BASELINE_VERSION="20260727_self_hosted_baseline_018"
PREVIOUS_BASELINE_VERSION="20260727_self_hosted_baseline_017"
STORAGE_STATS_MIGRATION_VERSION="018_add_storage_stats_rpc"

if [[ ! -f "$INIT_SCHEMA" ]]; then
  echo "Missing base schema: $INIT_SCHEMA" >&2
  exit 2
fi

MIGRATIONS=(
  "002_add_book_shares.sql"
  "003_add_replicas.sql"
  "004_crdt_merge_replica_fn.sql"
  "005_replica_manifest_cursor_updated_at.sql"
  "006_replica_more_kinds.sql"
  "007_files_replica_grouping.sql"
  "008_replica_keys_rpcs.sql"
  "009_replica_opds_catalog.sql"
  "010_replica_keys_forget.sql"
  "011_replica_settings.sql"
  "012_send_to_readest.sql"
  "014_add_reading_stats.sql"
)

for migration in "${MIGRATIONS[@]}"; do
  if [[ ! -f "$MIGRATIONS_DIR/$migration" ]]; then
    echo "Missing migration: $MIGRATIONS_DIR/$migration" >&2
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
\set baseline_version '$BASELINE_VERSION'
\set storage_stats_migration_version '$STORAGE_STATS_MIGRATION_VERSION'

SELECT to_regclass('readest_internal.schema_migrations') IS NOT NULL
  AS ledger_exists
\gset

\if :ledger_exists
SELECT EXISTS (
  SELECT 1
  FROM readest_internal.schema_migrations
  WHERE version = :'baseline_version'
) AS baseline_applied
\gset
\else
\set baseline_applied false
\endif

\if :baseline_applied
\echo 'Readest self-hosted baseline is already applied; no changes made.'
\quit
\endif

\if :ledger_exists
SELECT EXISTS (
  SELECT 1
  FROM readest_internal.schema_migrations
  WHERE version = '$PREVIOUS_BASELINE_VERSION'
) AS previous_baseline_applied
\gset
\else
\set previous_baseline_applied false
\endif

\if :previous_baseline_applied
DO \$psql\$
BEGIN
  RAISE EXCEPTION 'The previous Readest self-hosted baseline is installed; run self-hosted/upgrade.sh before retrying the baseline.';
END
\$psql\$;
\endif

SELECT
  to_regclass('auth.users') IS NOT NULL
  AND to_regprocedure('auth.uid()') IS NOT NULL
  AND to_regprocedure('auth.role()') IS NOT NULL
  AS supabase_ready
\gset

\if :supabase_ready
\else
DO \$psql\$
BEGIN
  RAISE EXCEPTION 'This database is missing the Supabase Auth schema or helper functions.';
END
\$psql\$;
\endif

SELECT NOT EXISTS (
  SELECT 1
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND c.relname IN (
      'books',
      'book_configs',
      'book_notes',
      'files',
      'book_shares',
      'replica_keys',
      'replicas',
      'send_addresses',
      'send_allowed_senders',
      'send_inbox',
      'stat_books',
      'stat_pages'
    )
) AS target_is_clean
\gset

\if :target_is_clean
\else
DO \$psql\$
BEGIN
  RAISE EXCEPTION 'Readest tables already exist without the expected baseline record; refusing to guess whether this is a partial or older installation.';
END
\$psql\$;
\endif

BEGIN;

\echo 'Applying Readest base schema...'
SQL

  cat "$INIT_SCHEMA"

  for migration in "${MIGRATIONS[@]}"; do
    printf '\n%s\n' "\\echo 'Applying $migration...'"
    cat "$MIGRATIONS_DIR/$migration"
  done

  cat <<'SQL'

-- Do not rely on installation-specific default privileges. These grants
-- mirror the API access expected by Readest while preserving send_inbox as
-- read-only for authenticated clients (its writes go through RPCs).
GRANT USAGE ON SCHEMA public TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.books,
  public.book_configs,
  public.book_notes,
  public.files,
  public.book_shares,
  public.replica_keys,
  public.replicas,
  public.send_addresses,
  public.send_allowed_senders,
  public.stat_books,
  public.stat_pages
TO authenticated;

GRANT SELECT ON TABLE public.send_inbox TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.books,
  public.book_configs,
  public.book_notes,
  public.files,
  public.book_shares,
  public.replica_keys,
  public.replicas,
  public.send_addresses,
  public.send_allowed_senders,
  public.send_inbox,
  public.stat_books,
  public.stat_pages
TO service_role;

GRANT EXECUTE ON FUNCTION
  public.increment_book_share_download(text, timestamp with time zone),
  public.hlc_max(text, text),
  public.crdt_merge_fields(jsonb, jsonb),
  public.crdt_compute_updated_at(jsonb, text),
  public.crdt_merge_replica(uuid, text, text, jsonb, jsonb, text, text, text, integer),
  public.replica_keys_create(text),
  public.replica_keys_list(),
  public.replica_keys_forget(),
  public.claim_inbox_item(text),
  public.renew_inbox_claim(uuid, text),
  public.complete_inbox_item(uuid, text),
  public.fail_inbox_item(uuid, text, text)
TO service_role;

GRANT EXECUTE ON FUNCTION
  public.get_storage_by_book_hash(uuid)
TO service_role;

-- Fail inside the transaction if the assembled baseline is incomplete.
DO $$
DECLARE
  missing_tables text[];
  rls_disabled text[];
BEGIN
  SELECT array_agg(expected.name ORDER BY expected.name)
  INTO missing_tables
  FROM (
    VALUES
      ('books'),
      ('book_configs'),
      ('book_notes'),
      ('files'),
      ('book_shares'),
      ('replica_keys'),
      ('replicas'),
      ('send_addresses'),
      ('send_allowed_senders'),
      ('send_inbox'),
      ('stat_books'),
      ('stat_pages')
  ) AS expected(name)
  WHERE to_regclass(format('public.%I', expected.name)) IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'Readest baseline is missing tables: %', missing_tables;
  END IF;

  SELECT array_agg(c.relname ORDER BY c.relname)
  INTO rls_disabled
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN (
      'books',
      'book_configs',
      'book_notes',
      'files',
      'book_shares',
      'replica_keys',
      'replicas',
      'send_addresses',
      'send_allowed_senders',
      'send_inbox',
      'stat_books',
      'stat_pages'
    )
    AND NOT c.relrowsecurity;

  IF rls_disabled IS NOT NULL THEN
    RAISE EXCEPTION 'Readest baseline has tables without RLS: %', rls_disabled;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'books'
      AND column_name IN (
        'synced_at',
        'reading_status_updated_at',
        'cover_hash',
        'cover_updated_at'
      )
    GROUP BY table_schema, table_name
    HAVING count(*) = 4
  ) THEN
    RAISE EXCEPTION 'Readest books table is missing current sync columns';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'files'
      AND column_name IN ('replica_kind', 'replica_id')
    GROUP BY table_schema, table_name
    HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'Readest files table is missing replica grouping columns';
  END IF;

  IF to_regprocedure('public.get_storage_by_book_hash(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Readest baseline is missing the storage statistics RPC';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(
      COALESCE(p.proacl, acldefault('f', p.proowner))
    ) acl
    WHERE p.oid = 'public.get_storage_by_book_hash(uuid)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Readest storage statistics RPC is executable by PUBLIC';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.get_storage_by_book_hash(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Readest storage statistics RPC is not executable by service_role';
  END IF;
END;
$$;

CREATE SCHEMA IF NOT EXISTS readest_internal;
REVOKE ALL ON SCHEMA readest_internal FROM PUBLIC;

CREATE TABLE IF NOT EXISTS readest_internal.schema_migrations (
  version text PRIMARY KEY,
  description text NOT NULL,
  applied_at timestamp with time zone NOT NULL DEFAULT now()
);

INSERT INTO readest_internal.schema_migrations (version, description)
VALUES (
  :'baseline_version',
  'Readest self-hosted Supabase baseline through migration 018'
);

INSERT INTO readest_internal.schema_migrations (version, description)
VALUES (
  :'storage_stats_migration_version',
  'Add service-role storage statistics aggregation RPC'
);

NOTIFY pgrst, 'reload schema';

COMMIT;

\echo 'Readest self-hosted baseline applied successfully.'
SELECT version, description, applied_at
FROM readest_internal.schema_migrations
ORDER BY applied_at;
SQL
}

emit_sql | "${PSQL_COMMAND[@]}"
