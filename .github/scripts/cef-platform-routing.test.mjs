import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(
  new URL('../../apps/readest-app/scripts/tauri.mjs', import.meta.url),
  'utf8',
);

test('CEF routes only Linux desktop commands, not other platforms or Android builds', () => {
  const expression = source.match(/^const useCef = (.+);$/m)?.[1];
  assert.ok(expression, 'platform guard must remain explicit');
  for (const platform of ['linux', 'darwin', 'win32']) {
    for (const command of ['dev', 'build', 'bundle', 'android', 'ios', 'signer']) {
      const result = runInNewContext(expression, { process: { platform }, command });
      assert.equal(
        result,
        platform === 'linux' && ['dev', 'build', 'bundle'].includes(command),
        `${platform}: ${command}`,
      );
    }
  }
});

test('CEF builds use their own lockfile and restore the shared platform lockfile', () => {
  assert.match(source, /Cargo\.cef\.lock/);
  assert.match(source, /flag: 'wx'/);
  assert.match(source, /fs\.renameSync\(savedLockPath, lockPath\)/);
  assert.match(source, /'--no-default-features'/);
  assert.match(source, /run\('cargo', \['tauri', \.\.\.args\], restoreLock\)/);
});
