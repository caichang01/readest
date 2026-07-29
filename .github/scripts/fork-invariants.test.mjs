import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const pathFromRoot = (path) => `${repositoryRoot}${path}`;
const readFromRoot = (path) => readFileSync(pathFromRoot(path), 'utf8');

test('only reviewed fork workflows are active', () => {
  const activeWorkflows = readdirSync(pathFromRoot('.github/workflows'))
    .filter((name) => /\.ya?ml$/.test(name))
    .sort();

  assert.deepEqual(activeWorkflows, ['fork-release.yml', 'fork-web-image.yml']);
});

test('membership, quota, payment, and IAP implementations stay removed', () => {
  const removedPaths = [
    'apps/readest-app/src/app/api/apple/iap-verify',
    'apps/readest-app/src/app/api/google/iap-verify',
    'apps/readest-app/src/app/api/stripe',
    'apps/readest-app/src/app/user/utils/plan.ts',
    'apps/readest-app/src/components/Quota.tsx',
    'apps/readest-app/src/libs/payment',
    'apps/readest-app/workers/iap-reconcile',
  ];

  for (const path of removedPaths) {
    assert.equal(existsSync(pathFromRoot(path)), false, `${path} must remain removed`);
  }

  const accessPolicy = readFromRoot('apps/readest-app/src/utils/access.ts');
  assert.doesNotMatch(accessPolicy, /\b(?:membership|premium|subscription|planType)\b/i);
});

test('self-hosted deployment, S3 recovery, and updater trust assets remain present', () => {
  const requiredPaths = [
    '.github/scripts/prepare-fork-env.mjs',
    '.github/scripts/updater-manifest.mjs',
    '.github/workflows/fork-release.yml',
    '.github/workflows/fork-web-image.yml',
    'apps/readest-app/src/services/sync/file/readerBookRecovery.ts',
    'apps/readest-app/src/services/sync/providers/s3/S3Provider.ts',
    'apps/readest-app/src/services/sync/replicaSettingsSync.ts',
    'apps/readest-app/src/utils/diagnosticLog.ts',
    'docker/compose.external-supabase.yaml',
    'docker/volumes/db/migrations/018_add_storage_stats_rpc.sql',
    'docker/volumes/db/self-hosted/verify.sql',
  ];

  for (const path of requiredPaths) {
    assert.equal(existsSync(pathFromRoot(path)), true, `${path} must remain present`);
  }

  const releaseWorkflow = readFromRoot('.github/workflows/fork-release.yml');
  assert.match(releaseWorkflow, /NEXT_PUBLIC_UPDATER_BASE_URL:\s*\$\{\{ vars\./);
  assert.match(releaseWorkflow, /NEXT_PUBLIC_UPDATER_PUBKEY:\s*\$\{\{ vars\./);
  assert.doesNotMatch(releaseWorkflow, /download\.readest\.com|readest\/readest\/releases/);
});
