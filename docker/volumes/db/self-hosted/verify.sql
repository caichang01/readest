\set ON_ERROR_STOP on

DO $$
DECLARE
  missing_tables text[];
  rls_disabled text[];
  replica_constraint text;
BEGIN
  IF to_regclass('readest_internal.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'Readest migration ledger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM readest_internal.schema_migrations
    WHERE version IN (
      '20260727_self_hosted_baseline_017',
      '20260727_self_hosted_baseline_018'
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
      'stat_pages'
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
       'stat_pages'
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
       'stat_pages'
     )) AS rls_policies;

SELECT version, description, applied_at
FROM readest_internal.schema_migrations
ORDER BY applied_at;
