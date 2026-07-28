import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../workflows/fork-release.yml', import.meta.url),
  'utf8',
);

test('fork builds receive the updater endpoint, public key, and private signing key', () => {
  assert.match(workflow, /NEXT_PUBLIC_UPDATER_BASE_URL:\s*\$\{\{ vars\./);
  assert.match(workflow, /NEXT_PUBLIC_UPDATER_PUBKEY:\s*\$\{\{ vars\./);
  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY:\s*\$\{\{ secrets\./);
  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD:\s*\$\{\{ secrets\./);
});

test('fork release signs Android packages and publishes a generated latest manifest', () => {
  assert.match(workflow, /tauri signer sign/);
  assert.match(workflow, /updater-manifest\.mjs/);
  assert.match(workflow, /latest\.json/);
});

test('desktop updater builds use the generated fork-only Tauri overlay', () => {
  assert.match(workflow, /fork-ci-tauri-config\.generated\.json/);
  assert.doesNotMatch(workflow, /--config src-tauri\/fork-ci-tauri-config\.json(?:\s|$)/);
});
