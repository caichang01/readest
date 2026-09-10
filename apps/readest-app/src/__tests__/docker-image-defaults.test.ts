import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const dockerfile = readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
const productionStage = dockerfile.slice(dockerfile.indexOf('AS production-stage'));

describe('Docker image runtime defaults', () => {
  test('does not require a deployment flag to bypass membership gates', () => {
    expect(productionStage).not.toMatch(/^ENV SELF_HOSTED=/m);
    const policy = readFileSync(
      path.join(repoRoot, 'apps/readest-app/src/utils/access.ts'),
      'utf8',
    );
    expect(policy).not.toMatch(/isSelfHosted|isCloudSyncAllowed|isNearbyPairingAllowed/);
  });
});
