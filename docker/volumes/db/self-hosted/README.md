# Readest on an existing self-hosted Supabase

This directory contains the database bootstrap used when Supabase already
exists and PostgreSQL is managed outside Readest, such as a Pigsty deployment.
It does not start another PostgreSQL, Auth, Kong, Storage, or Studio stack.

## What the baseline contains

`bootstrap.sh` assembles the current fresh-install schema from:

- `../init/schema.sql`;
- migrations `002` through `012`, excluding no files within that range;
- migration `014`.

The following historical migrations are intentionally not replayed:

- `001`, `013`, `015`, `017`, and `018` are already represented in `schema.sql`;
- `016` is a live-table backfill using `CREATE INDEX CONCURRENTLY` and
  transaction-controlling procedures, while its final column, index, and
  trigger are already represented in `schema.sql`.

The assembled baseline runs in one transaction. It records
`20260813_self_hosted_baseline_019` and the folded
`018_add_storage_stats_rpc` and `019_add_metadata_updated_at` migrations in
`readest_internal.schema_migrations`. A repeated run exits successfully
without changing the database. If Readest tables exist without that record,
the script stops instead of guessing whether the database is partially
initialized.

Migration 018 adds `public.get_storage_by_book_hash(uuid)`, the storage-manager
aggregation RPC used by the Readest API. It returns camelCase PostgREST fields,
excludes soft-deleted files, runs as `SECURITY INVOKER`, and is executable only
by `service_role`.

Migration 019 adds the nullable `public.books.metadata_updated_at` column used
to resolve metadata edits independently from reading-progress updates. The
upstream file originally used number 018; this fork renumbers it to 019 because
018 is already part of the deployed self-hosted migration ledger.

## Prerequisites

- A self-hosted Supabase project with `auth.users`, `auth.uid()`, and
  `auth.role()`.
- PostgreSQL roles `authenticated` and `service_role`.
- An empty target set of Readest tables in the `public` schema.
- `psql` access as a database administrator.

## Apply to a Pigsty Supabase node

Run from a checkout of this repository on the server:

```bash
docker/volumes/db/self-hosted/bootstrap.sh \
  sudo -iu postgres psql -d postgres -X
```

The SQL is streamed over standard input, so the `postgres` operating-system
user does not need filesystem access to the checkout.

Run the independent verification afterward:

```bash
sudo -iu postgres psql -d postgres -X -v ON_ERROR_STOP=1 \
  < docker/volumes/db/self-hosted/verify.sql
```

## Upgrade an existing baseline 017 or 018 deployment

Take a PostgreSQL backup first. Do not rerun `bootstrap.sh` against the existing
Readest tables.

For the verified Pigsty deployment, PostgreSQL is already protected by
pgBackRest with an S3 repository and PITR. Run the Pigsty-managed backup command
before each Readest database migration:

```bash
sudo -iu postgres pig pb backup
```

Confirm that the command completes successfully before continuing. This is the
preferred migration backup path for that environment; an additional ad-hoc
`pg_dump` is not required unless a separate logical backup is explicitly
requested.

After the managed backup succeeds, apply the forward migration with:

```bash
docker/volumes/db/self-hosted/upgrade.sh \
  sudo -iu postgres psql -d postgres -X
```

The upgrade runner accepts baseline 017, 018, or 019, checks the migration ledger,
applies only unapplied forward migrations in one transaction, records
`018_add_storage_stats_rpc` and `019_add_metadata_updated_at` as needed, and
notifies PostgREST to reload its schema cache.
A repeated run exits successfully without changing the database.

Run `verify.sql` afterward. It checks both migration records, the metadata
column, the RPC signature, absence of `PUBLIC` execute permission, and the
`service_role` function and table grants in addition to the existing table,
RLS, and replica checks.

### Upload and upgrade from a workstation

When the repository is on a local workstation rather than the Pigsty server,
run the supplied SSH/SCP helper from the repository root after the managed
backup has completed successfully:

```bash
docker/volumes/db/self-hosted/deploy-remote-upgrade.sh \
  --host rockyadmin@database-server \
  --backup-completed
```

Replace `rockyadmin@database-server` with an SSH config alias or the actual
`USER@HOST`. Use `--port PORT` for a non-default SSH port. By default the helper
creates a timestamped `readest-db-019-*` directory below the remote user's home
directory; `--remote-dir /absolute/path` can select another safe staging path.

The helper:

1. refuses to proceed without the explicit `--backup-completed` acknowledgement;
2. uploads only migrations 018/019, `upgrade.sh`, and `verify.sql`;
3. runs the forward upgrade as the PostgreSQL operating-system user;
4. runs the independent verification with `ON_ERROR_STOP=1`;
5. retains the remote staging directory for audit or repeat verification.

It deliberately does not execute the backup command and never invokes
`bootstrap.sh`. SSH may prompt for the remote login key/password, and `sudo` may
prompt according to the server policy.

Before applying to any non-empty deployment, take a PostgreSQL backup and
inspect the existing schema. Do not use the fresh-install baseline as an
upgrade mechanism.

## Local generation test

The lightweight tests verify the assembled baseline and forward-upgrade SQL,
including the storage RPC signature and permission boundary. They also exclude
live-data or already-folded migrations from the baseline:

```bash
docker/volumes/db/self-hosted/test-bootstrap.sh
docker/volumes/db/self-hosted/test-upgrade.sh
docker/volumes/db/self-hosted/test-deploy-remote-upgrade.sh
```

The same test is available from the repository root:

```bash
pnpm test:self-hosted-db
```

## Verified environment

The baseline, verification SQL, rollback behavior, and repeated-run guard were
validated on 2026-07-27 against a Pigsty-managed PostgreSQL 18.4 Supabase
deployment. The first test run exposed an escaped `\echo` generation bug; the
transaction rolled back cleanly, the generator was fixed, and a regression
check now rejects ESC control characters in generated SQL.
