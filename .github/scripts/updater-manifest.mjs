const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/;
const TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const PLATFORM_RULES = [
  { keys: ['android-universal'], pattern: /_universal\.apk$/ },
  { keys: ['android-arm64'], pattern: /_arm64\.apk$/ },
  { keys: ['windows-x86_64'], pattern: /_x64-setup\.exe$/ },
  { keys: ['windows-aarch64'], pattern: /_arm64-setup\.exe$/ },
  { keys: ['darwin-aarch64', 'darwin-x86_64'], pattern: /\.app\.tar\.gz$/ },
  { keys: ['linux-x86_64-appimage'], pattern: /_(?:amd64|x86_64)\.AppImage$/ },
  { keys: ['linux-aarch64-appimage'], pattern: /_aarch64\.AppImage$/ },
];

const REQUIRED_PLATFORM_KEYS = PLATFORM_RULES.flatMap((rule) => rule.keys);

function requireReleaseMetadata({ version, tag, repository, pubDate }) {
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
    throw new Error(`version must be a valid semantic version; received ${JSON.stringify(version)}`);
  }
  if (typeof tag !== 'string' || !TAG_PATTERN.test(tag)) {
    throw new Error(`tag must be a safe release tag; received ${JSON.stringify(tag)}`);
  }
  const repositoryName = typeof repository === 'string' ? repository.split('/')[1] : '';
  if (
    typeof repository !== 'string' ||
    !REPOSITORY_PATTERN.test(repository) ||
    repositoryName === '.' ||
    repositoryName === '..'
  ) {
    throw new Error(
      `repository must use the owner/name format; received ${JSON.stringify(repository)}`,
    );
  }
  if (typeof pubDate !== 'string' || Number.isNaN(Date.parse(pubDate))) {
    throw new Error(`pubDate must be an ISO timestamp; received ${JSON.stringify(pubDate)}`);
  }
}

export function buildUpdaterManifest({
  version,
  tag,
  repository,
  pubDate,
  notes = '',
  assets,
}) {
  requireReleaseMetadata({ version, tag, repository, pubDate });
  if (!Array.isArray(assets)) {
    throw new Error('assets must be an array');
  }

  const platforms = {};
  for (const asset of assets) {
    const rule = PLATFORM_RULES.find(({ pattern }) => pattern.test(asset?.name ?? ''));
    if (!rule) continue;
    const signature = typeof asset.signature === 'string' ? asset.signature.trim() : '';
    if (!signature) {
      throw new Error(`${rule.keys[0]} asset is missing its updater signature`);
    }
    const url = `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(asset.name)}`;
    for (const key of rule.keys) {
      if (platforms[key]) {
        throw new Error(`multiple updater assets matched ${key}`);
      }
      platforms[key] = { signature, url };
    }
  }

  for (const key of REQUIRED_PLATFORM_KEYS) {
    if (!platforms[key]) {
      throw new Error(`missing updater asset for ${key}`);
    }
  }

  return {
    version,
    pub_date: new Date(pubDate).toISOString(),
    notes,
    platforms,
  };
}
