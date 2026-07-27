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

- `001`, `013`, `015`, and `017` are already represented in `schema.sql`;
- `016` is a live-table backfill using `CREATE INDEX CONCURRENTLY` and
  transaction-controlling procedures, while its final column, index, and
  trigger are already represented in `schema.sql`.

The assembled baseline runs in one transaction. It records
`20260727_self_hosted_baseline_017` in
`readest_internal.schema_migrations`. A repeated run exits successfully
without changing the database. If Readest tables exist without that record,
the script stops instead of guessing whether the database is partially
initialized.

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

Before applying to a non-empty deployment, take a PostgreSQL backup and inspect
the existing schema. Do not use this fresh-install baseline to upgrade an
older Readest database; add and apply a forward migration instead.

## Local generation test

The lightweight test verifies the assembled SQL includes the intended
migrations and excludes the live-data or already-folded migrations:

```bash
docker/volumes/db/self-hosted/test-bootstrap.sh
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
