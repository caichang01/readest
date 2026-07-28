import assert from 'node:assert/strict';
import test from 'node:test';

import { buildUpdaterManifest } from './updater-manifest.mjs';

const assets = [
  { name: 'Readest_1.2.3_deadbeef_universal.apk', signature: 'android-universal-signature' },
  { name: 'Readest_1.2.3_deadbeef_arm64.apk', signature: 'android-arm64-signature' },
  { name: 'Readest_1.2.3_x64-setup.exe', signature: 'windows-x64-signature' },
  { name: 'Readest_1.2.3_arm64-setup.exe', signature: 'windows-arm64-signature' },
  { name: 'Readest.app.tar.gz', signature: 'macos-universal-signature' },
  { name: 'Readest_1.2.3_amd64.AppImage', signature: 'linux-x64-signature' },
  { name: 'Readest_1.2.3_aarch64.AppImage', signature: 'linux-arm64-signature' },
];

test('builds one signed manifest for every supported updater platform', () => {
  const manifest = buildUpdaterManifest({
    version: '1.2.3',
    tag: 'v1.2.3',
    repository: 'owner/readest',
    pubDate: '2026-07-28T00:00:00.000Z',
    notes: 'Fork release',
    assets,
  });

  assert.equal(manifest.version, '1.2.3');
  assert.equal(manifest.pub_date, '2026-07-28T00:00:00.000Z');
  assert.equal(manifest.notes, 'Fork release');
  assert.deepEqual(Object.keys(manifest.platforms).sort(), [
    'android-arm64',
    'android-universal',
    'darwin-aarch64',
    'darwin-x86_64',
    'linux-aarch64-appimage',
    'linux-x86_64-appimage',
    'windows-aarch64',
    'windows-x86_64',
  ]);
  assert.deepEqual(manifest.platforms['darwin-aarch64'], manifest.platforms['darwin-x86_64']);
  assert.deepEqual(manifest.platforms['android-arm64'], {
    signature: 'android-arm64-signature',
    url: 'https://github.com/owner/readest/releases/download/v1.2.3/Readest_1.2.3_deadbeef_arm64.apk',
  });
});

test('rejects incomplete or unsigned updater assets', () => {
  assert.throws(
    () =>
      buildUpdaterManifest({
        version: '1.2.3',
        tag: 'v1.2.3',
        repository: 'owner/readest',
        pubDate: '2026-07-28T00:00:00.000Z',
        assets: assets.filter((asset) => !asset.name.endsWith('_aarch64.AppImage')),
      }),
    /linux-aarch64-appimage/,
  );

  assert.throws(
    () =>
      buildUpdaterManifest({
        version: '1.2.3',
        tag: 'v1.2.3',
        repository: 'owner/readest',
        pubDate: '2026-07-28T00:00:00.000Z',
        assets: assets.map((asset) =>
          asset.name.endsWith('_arm64.apk') ? { ...asset, signature: '' } : asset,
        ),
      }),
    /android-arm64.*signature/,
  );
});

test('rejects unsafe repository, version, tag, and timestamp values', () => {
  const base = {
    version: '1.2.3',
    tag: 'v1.2.3',
    repository: 'owner/readest',
    pubDate: '2026-07-28T00:00:00.000Z',
    assets,
  };

  assert.throws(() => buildUpdaterManifest({ ...base, repository: '../readest' }), /repository/);
  assert.throws(() => buildUpdaterManifest({ ...base, version: 'latest' }), /version/);
  assert.throws(() => buildUpdaterManifest({ ...base, tag: 'release/latest' }), /tag/);
  assert.throws(() => buildUpdaterManifest({ ...base, pubDate: 'today' }), /pubDate/);
});
