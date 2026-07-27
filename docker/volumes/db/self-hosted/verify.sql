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
    WHERE version = '20260727_self_hosted_baseline_017'
  ) THEN
    RAISE EXCEPTION 'Readest self-hosted baseline record is missing';
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
