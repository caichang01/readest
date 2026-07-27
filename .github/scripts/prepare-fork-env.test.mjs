import assert from 'node:assert/strict';
import test from 'node:test';

import { renderNativeEnv } from './prepare-fork-env.mjs';

const validConfig = {
  supabaseUrl: 'https://supabase.example.com/',
  supabaseAnonKey: 'a-client-safe-anon-key-with-sufficient-length',
  apiBaseUrl: 'https://readest.example.com/',
};

test('renders the self-hosted endpoints into the native build environment', () => {
  const result = renderNativeEnv({
    baseEnv: [
      'NEXT_PUBLIC_APP_PLATFORM=tauri',
      'NEXT_PUBLIC_SUPABASE_URL=https://upstream.example.com',
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
      '',
    ].join('\n'),
  );
  assert.equal(result.match(/^NEXT_PUBLIC_SUPABASE_URL=/gm)?.length, 1);
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
