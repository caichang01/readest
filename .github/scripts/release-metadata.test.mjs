import assert from 'node:assert/strict';
import test from 'node:test';

import { determineRelease } from './release-metadata.mjs';

test('publishes a push only when the application version changes', () => {
  assert.deepEqual(
    determineRelease({
      eventName: 'push',
      forceRelease: false,
      currentVersion: '0.11.19',
      previousVersion: '0.11.18',
    }),
    { isPrerelease: false, shouldRelease: true, tag: 'v0.11.19' },
  );

  assert.deepEqual(
    determineRelease({
      eventName: 'push',
      forceRelease: false,
      currentVersion: '0.11.19',
      previousVersion: '0.11.19',
    }),
    { isPrerelease: false, shouldRelease: false, tag: 'v0.11.19' },
  );
});

test('publishes a manual run only when explicitly requested', () => {
  assert.deepEqual(
    determineRelease({
      eventName: 'workflow_dispatch',
      forceRelease: true,
      currentVersion: '0.11.19',
    }),
    { isPrerelease: false, shouldRelease: true, tag: 'v0.11.19' },
  );

  assert.deepEqual(
    determineRelease({
      eventName: 'workflow_dispatch',
      forceRelease: false,
      currentVersion: '0.11.19',
    }),
    { isPrerelease: false, shouldRelease: false, tag: 'v0.11.19' },
  );
});

test('marks semantic pre-release versions correctly', () => {
  assert.deepEqual(
    determineRelease({
      eventName: 'workflow_dispatch',
      forceRelease: true,
      currentVersion: '0.12.0-beta.1',
    }),
    { isPrerelease: true, shouldRelease: true, tag: 'v0.12.0-beta.1' },
  );
});

test('rejects invalid or incomplete release metadata', () => {
  assert.throws(
    () =>
      determineRelease({
        eventName: 'push',
        forceRelease: false,
        currentVersion: 'next',
        previousVersion: '0.11.18',
      }),
    /valid semantic version/,
  );

  assert.throws(
    () =>
      determineRelease({
        eventName: 'push',
        forceRelease: false,
        currentVersion: '0.11.19',
      }),
    /previous version/,
  );
});
