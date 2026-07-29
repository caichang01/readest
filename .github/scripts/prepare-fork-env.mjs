import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NATIVE_PUBLIC_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_API_BASE_URL',
  'NEXT_PUBLIC_UPDATER_BASE_URL',
  'NEXT_PUBLIC_UPDATER_PUBKEY',
];

function requireSingleLine(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is required`);
  }
  if (/[\r\n]/.test(value)) {
    throw new Error(`${label} must be a single line`);
  }
  if (value !== value.trim()) {
    throw new Error(`${label} must not start or end with whitespace`);
  }
  if (/^(?:YOUR_|PLACE_HOLDER|<)/i.test(value)) {
    throw new Error(`${label} still contains a placeholder value`);
  }
  return value;
}

function normalizePublicHttpsUrl(value, label) {
  const raw = requireSingleLine(value, label);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} must be a valid absolute URL`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must not contain credentials, query parameters, or fragments`);
  }
  return url.toString().replace(/\/+$/, '');
}

function validateAnonKey(value) {
  const key = requireSingleLine(value, 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (key.length < 20) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is unexpectedly short');
  }
  return key;
}

function validateUpdaterPubkey(value) {
  const key = requireSingleLine(value, 'NEXT_PUBLIC_UPDATER_PUBKEY');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(key) || key.length % 4 !== 0) {
    throw new Error(
      'NEXT_PUBLIC_UPDATER_PUBKEY must be a valid base64-encoded minisign public key',
    );
  }
  const decoded = Buffer.from(key, 'base64').toString('utf8');
  if (!decoded.startsWith('untrusted comment: minisign public key:')) {
    throw new Error(
      'NEXT_PUBLIC_UPDATER_PUBKEY must be a valid base64-encoded minisign public key',
    );
  }
  return key;
}

export function renderNativeEnv({
  baseEnv,
  supabaseUrl,
  supabaseAnonKey,
  apiBaseUrl,
  updaterBaseUrl,
  updaterPubkey,
}) {
  const values = {
    NEXT_PUBLIC_SUPABASE_URL: normalizePublicHttpsUrl(
      supabaseUrl,
      'NEXT_PUBLIC_SUPABASE_URL',
    ),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: validateAnonKey(supabaseAnonKey),
    NEXT_PUBLIC_API_BASE_URL: normalizePublicHttpsUrl(apiBaseUrl, 'NEXT_PUBLIC_API_BASE_URL'),
    NEXT_PUBLIC_UPDATER_BASE_URL: normalizePublicHttpsUrl(
      updaterBaseUrl,
      'NEXT_PUBLIC_UPDATER_BASE_URL',
    ),
    NEXT_PUBLIC_UPDATER_PUBKEY: validateUpdaterPubkey(updaterPubkey),
  };

  const publicKeyPattern = new RegExp(`^(?:${NATIVE_PUBLIC_KEYS.join('|')})=`);
  const retainedLines = baseEnv
    .split(/\r?\n/)
    .filter((line) => !publicKeyPattern.test(line))
    .join('\n')
    .replace(/\n+$/, '');

  return [
    retainedLines,
    '',
    ...NATIVE_PUBLIC_KEYS.map((key) => `${key}=${values[key]}`),
    '',
  ].join('\n');
}

export function renderTauriUpdaterConfig({ updaterBaseUrl, updaterPubkey }) {
  const baseUrl = normalizePublicHttpsUrl(updaterBaseUrl, 'NEXT_PUBLIC_UPDATER_BASE_URL');
  const pubkey = validateUpdaterPubkey(updaterPubkey);
  return {
    bundle: {
      createUpdaterArtifacts: true,
    },
    plugins: {
      updater: {
        pubkey,
        endpoints: [`${baseUrl}/latest.json`],
      },
    },
  };
}

function run() {
  const sourcePath = process.argv[2] ?? 'apps/readest-app/.env.tauri';
  const targetPath = process.argv[3] ?? 'apps/readest-app/.env.local';
  const tauriConfigPath = process.argv[4];
  const updaterConfig = {
    updaterBaseUrl: process.env.NEXT_PUBLIC_UPDATER_BASE_URL,
    updaterPubkey: process.env.NEXT_PUBLIC_UPDATER_PUBKEY,
  };
  const output = renderNativeEnv({
    baseEnv: readFileSync(sourcePath, 'utf8'),
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
    ...updaterConfig,
  });

  writeFileSync(targetPath, output, { encoding: 'utf8', mode: 0o600 });
  console.log(`Prepared native deployment environment at ${targetPath}`);
  if (tauriConfigPath) {
    writeFileSync(
      tauriConfigPath,
      `${JSON.stringify(renderTauriUpdaterConfig(updaterConfig), null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    console.log(`Prepared Tauri updater configuration at ${tauriConfigPath}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run();
}
