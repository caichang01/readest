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

test('Android SDK setup only requests supported bootstrap packages', () => {
  const setupStep = workflow.match(
    /- name: Set up Android SDK\n(?<step>[\s\S]*?)(?=\n      - name:)/,
  )?.groups?.step;
  assert.ok(setupStep);
  assert.match(setupStep, /^\s*packages:[ \t]*platform-tools[ \t]*$/m);

  const sdkPackagesStep = workflow.match(
    /- name: Install Android SDK packages\n(?<step>[\s\S]*?)(?=\n      - name:)/,
  )?.groups?.step;
  assert.ok(sdkPackagesStep);
  assert.match(sdkPackagesStep, /"platforms;android-36"/);
  assert.match(sdkPackagesStep, /"build-tools;35\.0\.0"/);
  assert.match(sdkPackagesStep, /"ndk;\$\{NDK_VERSION\}"/);
});

test('desktop updater builds use the generated fork-only Tauri overlay', () => {
  assert.match(workflow, /fork-ci-tauri-config\.generated\.json/);
  assert.doesNotMatch(workflow, /--config src-tauri\/fork-ci-tauri-config\.json(?:\s|$)/);
  assert.match(workflow, /tauri_args: --target universal-apple-darwin(?:\r?\n)/);
  assert.doesNotMatch(workflow, /universal-apple-darwin --bundles dmg/);
});

test('Linux AppImage builds use pinned and verified bundler inputs', () => {
  assert.match(
    workflow,
    /TAURI_CEF_REV:\s*[0-9a-f]{40}/,
  );
  assert.match(workflow, /QUICK_SHARUN_REV:\s*[0-9a-f]{40}/);
  assert.match(workflow, /QUICK_SHARUN_SHA256:\s*[0-9a-f]{64}/);
  assert.doesNotMatch(workflow, /--branch feat\/truly-portable-appimage/);
  assert.match(workflow, /git -C .* apply .*tauri-cef-appimage\.patch/s);
  assert.match(workflow, /TAURI_CEF_CARGO: "1"/);
  assert.match(workflow, /curl .*--connect-timeout .*--max-time/s);
  assert.match(
    workflow,
    /api\.github\.com\/repos\/pkgforge-dev\/Anylinux-AppImages\/contents\/useful-tools\/quick-sharun\.sh\?ref=\$\{QUICK_SHARUN_REV\}/,
  );
  assert.doesNotMatch(workflow, /raw\.githubusercontent\.com/);
  assert.match(workflow, /sha256sum --check/);
  assert.match(workflow, /timeout --signal=TERM --kill-after=30s 50m pnpm tauri build/);
  assert.match(workflow, /--locked/);
  assert.match(workflow, /libxkbcommon-x11\.so\.0/);
  assert.match(workflow, /libcef\.so/);

  const bundlerPatch = readFileSync(
    new URL('../patches/tauri-cef-appimage.patch', import.meta.url),
    'utf8',
  );
  assert.match(bundlerPatch, /quick-sharun\.sh was not preloaded/);
  const patchAdditions = bundlerPatch
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .join('\n');
  assert.doesNotMatch(patchAdditions, /refs\/heads\/main/);
});
