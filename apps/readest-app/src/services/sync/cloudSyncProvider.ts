import type { SystemSettings } from '@/types/settings';
import type { FileSyncBackendKind } from '@/services/sync/file/providerRegistry';

/**
 * The user's selected cloud sync provider for library data (book files,
 * book rows, progress, notes). 'readest' is the native Readest Cloud;
 * the others are the third-party file-sync backends. Account-level data
 * (settings replicas, reading stats, dictionaries/fonts, translations)
 * always syncs via Readest Cloud regardless of this selection.
 *
 * The selection is DERIVED from the existing per-device enabled flags —
 * there is no separate persisted field, so it inherits the device-local
 * semantics of each provider's `enabled` flag and needs no
 * migration. `withActiveCloudProvider` keeps the flags mutually
 * exclusive; if both are ever enabled (hand-edited or restored
 * settings), WebDAV wins deterministically.
 */
export type CloudSyncProviderKind = 'readest' | FileSyncBackendKind;

/** Settings slice key for a third-party backend kind. */
export const settingsKeyForBackend = (
  kind: FileSyncBackendKind,
): 'webdav' | 'googleDrive' | 's3' | 'onedrive' => (kind === 'gdrive' ? 'googleDrive' : kind);

/** Human-readable provider name (product names — deliberately untranslated). */
export const cloudProviderDisplayName = (kind: CloudSyncProviderKind): string =>
  kind === 'gdrive'
    ? 'Google Drive'
    : kind === 'webdav'
      ? 'WebDAV'
      : kind === 's3'
        ? 'S3'
        : kind === 'onedrive'
          ? 'OneDrive'
          : 'Readest Cloud';

export const getCloudSyncProvider = (
  settings: SystemSettings | null | undefined,
): CloudSyncProviderKind =>
  settings?.webdav?.enabled
    ? 'webdav'
    : settings?.googleDrive?.enabled
      ? 'gdrive'
      : settings?.s3?.enabled
        ? 's3'
        : settings?.onedrive?.enabled
          ? 'onedrive'
          : 'readest';

/**
 * One-time upgrade migration helper (appService migrate20260706): users
 * who already had a third-party backend enabled before provider selection shipped
 * become "third-party selected" on upgrade, which gates native Readest
 * Cloud uploads off — with syncBooks at its old `false` default their
 * books would back up nowhere. Flip syncBooks on for the SELECTED
 * provider only. Mutates `settings` in place (the migration runner saves
 * the same snapshot afterwards) and returns whether anything changed.
 */
export const applySyncBooksAutoEnable = (settings: SystemSettings): boolean => {
  const provider = getCloudSyncProvider(settings);
  if (provider === 'webdav' && settings.webdav && !settings.webdav.syncBooks) {
    settings.webdav = { ...settings.webdav, syncBooks: true };
    return true;
  }
  if (provider === 'gdrive' && settings.googleDrive && !settings.googleDrive.syncBooks) {
    settings.googleDrive = { ...settings.googleDrive, syncBooks: true };
    return true;
  }
  if (provider === 's3' && settings.s3 && !settings.s3.syncBooks) {
    settings.s3 = { ...settings.s3, syncBooks: true };
    return true;
  }
  if (provider === 'onedrive' && settings.onedrive && !settings.onedrive.syncBooks) {
    settings.onedrive = { ...settings.onedrive, syncBooks: true };
    return true;
  }
  return false;
};

/**
 * Whether Readest Cloud storage may be written to (book file uploads).
 * Strictly: only when Readest Cloud is the selected provider. A selected
 * third-party provider — active or paused — means no Readest Cloud
 * uploads.
 */
export const isReadestCloudStorageActive = (settings: SystemSettings | null | undefined): boolean =>
  getCloudSyncProvider(settings) === 'readest';
