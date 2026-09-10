\set ON_ERROR_STOP on

DO $$
DECLARE
  missing_tables text[];
  rls_disabled text[];
  replica_constraint text;
  rpc text;
  archive_table text;
BEGIN
  IF to_regclass('readest_internal.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'Readest migration ledger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM readest_internal.schema_migrations
    WHERE version IN (
      '20260727_self_hosted_baseline_017',
      '20260727_self_hosted_baseline_018',
      '20260813_self_hosted_baseline_019',
      '20260902_self_hosted_baseline_024'
    )
  ) THEN
    RAISE EXCEPTION 'Readest self-hosted baseline record is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM readest_internal.schema_migrations
    WHERE version = '018_add_storage_stats_rpc'
  ) THEN
    RAISE EXCEPTION 'Readest storage statistics migration record is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM readest_internal.schema_migrations
    WHERE version = '019_add_metadata_updated_at'
  ) THEN
    RAISE EXCEPTION 'Readest metadata timestamp migration record is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'books'
      AND column_name = 'metadata_updated_at'
  ) THEN
    RAISE EXCEPTION 'Readest books table is missing metadata_updated_at';
  END IF;

  IF to_regprocedure('public.get_storage_by_book_hash(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Readest storage statistics RPC is missing';
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

  IF NOT has_table_privilege('service_role', 'public.files', 'SELECT') THEN
    RAISE EXCEPTION 'Readest files table is not readable by service_role';
  END IF;

  IF EXISTS (
    SELECT required.version FROM (VALUES
      ('020_stat_pages_upsert_rpc'), ('021_stat_archives'),
      ('022_stat_archive_row_cap'), ('023_add_group_updated_at'),
      ('024_replica_abs_server')
    ) AS required(version)
    WHERE NOT EXISTS (
      SELECT 1 FROM readest_internal.schema_migrations applied
      WHERE applied.version = required.version
    )
  ) THEN
    RAISE EXCEPTION 'Readest migrations 020 through 024 are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'books'
      AND column_name = 'group_updated_at'
  ) THEN
    RAISE EXCEPTION 'Readest books table is missing group_updated_at';
  END IF;

  IF to_regprocedure('public.upsert_stat_pages(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Readest statistics upsert RPC is missing';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.upsert_stat_pages(jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.upsert_stat_pages(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Readest statistics upsert RPC privileges are incorrect';
  END IF;

  FOREACH rpc IN ARRAY ARRAY[
    'public.stat_archive_claim_users(integer)',
    'public.stat_archive_candidate(uuid,interval)',
    'public.stat_archive_rows(uuid,timestamp with time zone,interval,integer,text,integer,bigint)',
    'public.stat_archive_commit(uuid,text,timestamp with time zone,timestamp with time zone,integer,integer)',
    'public.upsert_stat_pages_as(uuid,jsonb)'
  ] LOOP
    IF to_regprocedure(rpc) IS NULL THEN
      RAISE EXCEPTION 'Readest archive RPC is missing: %', rpc;
    END IF;
    IF NOT has_function_privilege('service_role', rpc, 'EXECUTE')
      OR has_function_privilege('anon', rpc, 'EXECUTE')
      OR has_function_privilege('authenticated', rpc, 'EXECUTE') THEN
      RAISE EXCEPTION 'Readest archive RPC privileges are incorrect: %', rpc;
    END IF;
  END LOOP;

  FOREACH archive_table IN ARRAY ARRAY[
    'public.stat_archives', 'public.stat_archive_state', 'public.stat_archive_orphans'
  ] LOOP
    IF NOT (
      has_table_privilege('service_role', archive_table, 'SELECT')
      AND has_table_privilege('service_role', archive_table, 'INSERT')
      AND has_table_privilege('service_role', archive_table, 'UPDATE')
      AND has_table_privilege('service_role', archive_table, 'DELETE')
    )
      OR has_table_privilege('anon', archive_table, 'SELECT,INSERT,UPDATE,DELETE')
      OR has_table_privilege('authenticated', archive_table, 'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'Readest archive table privileges are incorrect: %', archive_table;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated', 'public.stat_archives', 'SELECT')
    OR has_table_privilege('authenticated', 'public.stat_archive_state', 'SELECT')
    OR has_table_privilege('authenticated', 'public.stat_archive_orphans', 'SELECT') THEN
    RAISE EXCEPTION 'Readest archive manifest visibility is incorrect';
  END IF;

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
      ('stat_pages'),
      ('stat_archives'),
      ('stat_archive_state'),
      ('stat_archive_orphans')
  ) AS expected(name)
  WHERE to_regclass(format('public.%I', expected.name)) IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'Missing Readest tables: %', missing_tables;
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
      'stat_pages',
      'stat_archives',
      'stat_archive_state',
      'stat_archive_orphans'
    )
    AND NOT c.relrowsecurity;

  IF rls_disabled IS NOT NULL THEN
    RAISE EXCEPTION 'RLS is disabled for Readest tables: %', rls_disabled;
  END IF;

  SELECT pg_get_constraintdef(oid)
  INTO replica_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.replicas'::regclass
    AND conname = 'replicas_kind_allowlist';

  IF replica_constraint IS NULL
    OR replica_constraint NOT LIKE '%dictionary%'
    OR replica_constraint NOT LIKE '%font%'
    OR replica_constraint NOT LIKE '%texture%'
    OR replica_constraint NOT LIKE '%opds_catalog%'
    OR replica_constraint NOT LIKE '%settings%'
    OR replica_constraint NOT LIKE '%abs_server%'
  THEN
    RAISE EXCEPTION 'Replica kind allowlist is incomplete: %', replica_constraint;
  END IF;
END;
$$;

SELECT
  (SELECT count(*) FROM auth.users) AS auth_users,
  (SELECT count(*)
   FROM pg_tables
   WHERE schemaname = 'public'
     AND tablename IN (
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
       'stat_pages',
      'stat_archives',
      'stat_archive_state',
      'stat_archive_orphans'
     )) AS readest_tables,
  (SELECT count(*)
   FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN (
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
       'stat_pages',
      'stat_archives',
      'stat_archive_state',
      'stat_archive_orphans'
     )) AS rls_policies;

SELECT version, description, applied_at
FROM readest_internal.schema_migrations
ORDER BY applied_at;
