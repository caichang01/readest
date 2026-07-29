import assert from 'node:assert/strict';
import test from 'node:test';

import { renderNativeEnv, renderTauriUpdaterConfig } from './prepare-fork-env.mjs';

const validConfig = {
  supabaseUrl: 'https://supabase.example.com/',
  supabaseAnonKey: 'a-client-safe-anon-key-with-sufficient-length',
  apiBaseUrl: 'https://readest.example.com/',
  updaterBaseUrl: 'https://updates.example.com/releases/',
  updaterPubkey:
    'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDAwMDAwMDAwMDAwMDAwMDAKUldRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBCg==',
};

test('renders the self-hosted endpoints and updater trust into the native build environment', () => {
  const result = renderNativeEnv({
    baseEnv: [
      'NEXT_PUBLIC_APP_PLATFORM=tauri',
      'NEXT_PUBLIC_SUPABASE_URL=https://upstream.example.com',
      'NEXT_PUBLIC_UPDATER_BASE_URL=https://download.readest.com/releases',
      '',
    ].join('\n'),
    ...validConfig,
  });

  assert.equal(
    result,
    [
      'NEXT_PUBLIC_APP_PLATFORM=tauri',
      '',
      'NEXT_PUBLIC_SUPABASE_URL=https://supabase.example.com',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY=a-client-safe-anon-key-with-sufficient-length',
      'NEXT_PUBLIC_API_BASE_URL=https://readest.example.com',
      'NEXT_PUBLIC_UPDATER_BASE_URL=https://updates.example.com/releases',
      `NEXT_PUBLIC_UPDATER_PUBKEY=${validConfig.updaterPubkey}`,
      '',
    ].join('\n'),
  );
  assert.equal(result.match(/^NEXT_PUBLIC_SUPABASE_URL=/gm)?.length, 1);
  assert.equal(result.match(/^NEXT_PUBLIC_UPDATER_BASE_URL=/gm)?.length, 1);
});

test('rejects missing or placeholder deployment values', () => {
  assert.throws(
    () => renderNativeEnv({ baseEnv: '', ...validConfig, supabaseAnonKey: '' }),
    /NEXT_PUBLIC_SUPABASE_ANON_KEY is required/,
  );
  assert.throws(
    () =>
      renderNativeEnv({
        baseEnv: '',
        ...validConfig,
        supabaseAnonKey: 'YOUR_SUPABASE_ANON_KEY',
      }),
    /placeholder/,
  );
  assert.throws(
    () => renderNativeEnv({ baseEnv: '', ...validConfig, updaterPubkey: '' }),
    /NEXT_PUBLIC_UPDATER_PUBKEY is required/,
  );
  assert.throws(
    () => renderNativeEnv({ baseEnv: '', ...validConfig, updaterPubkey: 'not-base64' }),
    /valid base64-encoded minisign public key/,
  );
});

test('requires public HTTPS origins without credentials or query strings', () => {
  assert.throws(
    () =>
      renderNativeEnv({
        baseEnv: '',
        ...validConfig,
        supabaseUrl: 'http://supabase.example.com',
      }),
    /must use HTTPS/,
  );
  assert.throws(
    () =>
      renderNativeEnv({
        baseEnv: '',
        ...validConfig,
        apiBaseUrl: 'https://user:pass@readest.example.com?token=secret',
      }),
    /must not contain credentials, query parameters, or fragments/,
  );
  assert.throws(
    () =>
      renderNativeEnv({
        baseEnv: '',
        ...validConfig,
        updaterBaseUrl: 'http://updates.example.com/releases',
      }),
    /NEXT_PUBLIC_UPDATER_BASE_URL must use HTTPS/,
  );
});

test('rejects multiline values so generated dotenv files cannot be injected', () => {
  assert.throws(
    () =>
      renderNativeEnv({
        baseEnv: '',
        ...validConfig,
        supabaseAnonKey: `${validConfig.supabaseAnonKey}\nNEXT_PUBLIC_API_BASE_URL=https://evil.test`,
      }),
    /single line/,
  );
});

test('renders a Tauri updater overlay that trusts only the fork endpoint', () => {
  assert.deepEqual(
    renderTauriUpdaterConfig({
      updaterBaseUrl: validConfig.updaterBaseUrl,
      updaterPubkey: validConfig.updaterPubkey,
    }),
    {
      bundle: {
        createUpdaterArtifacts: true,
      },
      plugins: {
        updater: {
          pubkey: validConfig.updaterPubkey,
          endpoints: ['https://updates.example.com/releases/latest.json'],
        },
      },
    },
  );
});
