/**
 * Registry that maps a backend kind to a concrete {@link FileSyncProvider}, so
 * the reader hook and the Sync-now form stay backend-agnostic: they ask which
 * backends are enabled and build each one by kind, never naming WebDAV or Drive
 * directly.
 *
 * The settings view is intentionally narrow: connection fields for credentialed
 * providers and enabled flags for OAuth providers. Drive providers assemble
 * their tokens from secure storage, so they need no credential fields here.
 */
import type { FileSyncProvider } from './provider';
import type { S3Settings, WebDAVSettings } from '@/types/settings';
import { createWebDAVProvider } from '@/services/sync/providers/webdav/WebDAVProvider';
import { buildGoogleDriveProvider } from '@/services/sync/providers/gdrive/buildGoogleDriveProvider';
import { buildOneDriveProvider } from '@/services/sync/providers/onedrive/buildOneDriveProvider';
import { createS3Provider } from '@/services/sync/providers/s3/S3Provider';

export type FileSyncBackendKind = 'webdav' | 'gdrive' | 's3' | 'onedrive';

/** Minimal settings the registry reads to pick + build backends. */
export interface FileSyncBackendsSettings {
  webdav?: WebDAVSettings;
  googleDrive?: { enabled?: boolean };
  s3?: S3Settings;
  onedrive?: { enabled?: boolean };
}

/** The backends the user has switched on, in a stable order. */
export const getEnabledFileSyncBackends = (
  settings: FileSyncBackendsSettings,
): FileSyncBackendKind[] => {
  const enabled: FileSyncBackendKind[] = [];
  if (settings.webdav?.enabled) enabled.push('webdav');
  if (settings.googleDrive?.enabled) enabled.push('gdrive');
  if (settings.s3?.enabled) enabled.push('s3');
  if (settings.onedrive?.enabled) enabled.push('onedrive');
  return enabled;
};

/** Whether a backend has enough local configuration to start syncing. */
export const isFileSyncBackendConfigured = (
  kind: FileSyncBackendKind,
  settings: FileSyncBackendsSettings,
): boolean => {
  if (kind === 'webdav') {
    const config = settings.webdav;
    return !!(config?.enabled && config.serverUrl && config.username);
  }
  if (kind === 's3') {
    const config = settings.s3;
    return !!(
      config?.enabled &&
      config.endpoint &&
      config.bucket &&
      config.accessKeyId &&
      config.secretAccessKey
    );
  }
  if (kind === 'onedrive') return !!settings.onedrive?.enabled;
  return !!settings.googleDrive?.enabled;
};

/**
 * One provider is memoised per connection key and shared by every surface
 * (the reader's per-book sync, the library auto-sync, Sync now / pull to
 * refresh). What makes reuse worth it is the provider's path->id cache
 * (Drive): a cold provider re-resolves /Readest, books/ and library.json by
 * name query on every engine build, so one engine per book open/close/sync
 * turned each user action into a burst of redundant remote requests. The key
 * mirrors the connection-relevant settings, so a config edit rebuilds; stale
 * cached ids self-heal through the provider's 404 eviction. Drive connect /
 * disconnect must call {@link resetFileSyncProviderCache} — its token source
 * changes identity without any key input changing.
 */
let cachedProvider: { key: string; provider: FileSyncProvider } | null = null;

export const fileSyncProviderConfigKey = (
  kind: FileSyncBackendKind,
  settings: FileSyncBackendsSettings,
): string => {
  if (kind === 'webdav') {
    const w = settings.webdav;
    return `webdav:${w?.enabled}:${w?.serverUrl}:${w?.username}:${w?.password}:${w?.rootPath}`;
  }
  if (kind === 's3') {
    const c = settings.s3;
    return `s3:${c?.enabled}:${c?.endpoint}:${c?.region}:${c?.bucket}:${c?.accessKeyId}:${c?.secretAccessKey}`;
  }
  if (kind === 'onedrive') return 'onedrive';
  return 'gdrive';
};

export const resetFileSyncProviderCache = (): void => {
  cachedProvider = null;
};

/**
 * Build the provider for one backend, or `null` when it cannot run here (WebDAV
 * without config, Drive without a baked client id / secure storage). Async
 * because Drive probes the keychain to assemble its token store.
 */
export const createFileSyncProvider = async (
  kind: FileSyncBackendKind,
  settings: FileSyncBackendsSettings,
): Promise<FileSyncProvider | null> => {
  const key = fileSyncProviderConfigKey(kind, settings);
  if (cachedProvider?.key === key) return cachedProvider.provider;
  const provider =
    kind === 'webdav'
      ? settings.webdav
        ? createWebDAVProvider(settings.webdav)
        : null
      : kind === 's3'
        ? settings.s3
          ? createS3Provider(settings.s3)
          : null
        : kind === 'onedrive'
          ? await buildOneDriveProvider()
          : await buildGoogleDriveProvider();
  if (provider) cachedProvider = { key, provider };
  return provider;
};
