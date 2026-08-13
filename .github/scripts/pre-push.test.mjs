import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const prePush = readFileSync(`${repositoryRoot}.husky/pre-push`, 'utf8');

test('pre-push requires a supported Node runtime', () => {
  assert.match(prePush, /node_major/);
  assert.match(prePush, /Node\.js 20 or newer is required/);
});

test('pre-push remains valid POSIX shell', () => {
  execFileSync('sh', ['-n', `${repositoryRoot}.husky/pre-push`]);
});

test('pre-push runs the complete Vitest suite with bounded concurrency', () => {
  assert.match(prePush, /vitest run --maxWorkers=1/);
  assert.match(prePush, /dotenv -e \.env -e \.env\.test\.local/);
});
