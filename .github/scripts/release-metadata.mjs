import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PACKAGE_PATH = 'apps/readest-app/package.json';
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function validateVersion(version, label) {
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
    throw new Error(`${label} must be a valid semantic version; received ${JSON.stringify(version)}`);
  }
}

export function determineRelease({ eventName, forceRelease, currentVersion, previousVersion }) {
  validateVersion(currentVersion, 'Current version');

  if (eventName === 'push') {
    if (previousVersion === undefined) {
      throw new Error('A push event must provide the previous version');
    }
    validateVersion(previousVersion, 'Previous version');
  }

  return {
    isPrerelease: currentVersion.includes('-'),
    shouldRelease:
      (eventName === 'push' && previousVersion !== currentVersion) ||
      (eventName === 'workflow_dispatch' && forceRelease),
    tag: `v${currentVersion}`,
  };
}

function readVersion(contents) {
  return JSON.parse(contents).version;
}

function run() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const currentVersion = readVersion(readFileSync(PACKAGE_PATH, 'utf8'));
  let previousVersion;

  if (eventName === 'push') {
    const previousSha = process.env.PREVIOUS_SHA;
    if (!/^[0-9a-f]{40}$/i.test(previousSha ?? '') || /^0{40}$/.test(previousSha)) {
      throw new Error(`PREVIOUS_SHA must be a non-zero 40-character commit SHA; received ${JSON.stringify(previousSha)}`);
    }

    previousVersion = readVersion(
      execFileSync('git', ['show', `${previousSha}:${PACKAGE_PATH}`], { encoding: 'utf8' }),
    );
  }

  const result = determineRelease({
    eventName,
    forceRelease: process.env.FORCE_RELEASE === 'true',
    currentVersion,
    previousVersion,
  });

  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    throw new Error('GITHUB_OUTPUT is required');
  }

  appendFileSync(
    outputFile,
    [
      `version=${currentVersion}`,
      `tag=${result.tag}`,
      `is_prerelease=${result.isPrerelease}`,
      `should_release=${result.shouldRelease}`,
    ].join('\n') +
      '\n',
  );

  console.log(
    JSON.stringify({
      eventName,
      currentVersion,
      previousVersion: previousVersion ?? null,
      ...result,
    }),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run();
}
