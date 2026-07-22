import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { Book } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';

const mocks = vi.hoisted(() => ({
  provider: 's3' as 's3' | 'readest',
  download: vi.fn(),
  updateBook: vi.fn(),
}));

vi.mock('@/services/sync/cloudSyncProvider', () => ({
  getCloudSyncProvider: () => mocks.provider,
}));
vi.mock('@/services/sync/file/runLibrarySync', () => ({
  runActiveFileBookDownload: mocks.download,
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: {} }) },
}));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: { getState: () => ({ updateBook: mocks.updateBook }) },
}));
vi.mock('@/utils/diagnosticLog', () => ({ appendDiagnosticLog: vi.fn() }));

import { tryRecoverThirdPartyBook } from '@/services/sync/file/readerBookRecovery';

const envConfig = {} as EnvConfigType;
const book = {
  hash: 'h1',
  format: 'EPUB',
  title: 'Book',
  author: 'A',
  createdAt: 1,
  updatedAt: 1,
  uploadedAt: 10,
  downloadedAt: 10,
} as Book;

describe('tryRecoverThirdPartyBook', () => {
  beforeEach(() => {
    mocks.provider = 's3';
    mocks.download.mockReset().mockResolvedValue(true);
    mocks.updateBook.mockReset().mockResolvedValue(undefined);
  });

  test('re-downloads and persists a managed book after local load/parse failure', async () => {
    const recovered = await tryRecoverThirdPartyBook(envConfig, book, 'parse-book-document');

    expect(mocks.download).toHaveBeenCalledWith(envConfig, expect.objectContaining({ hash: 'h1' }));
    expect(mocks.updateBook).toHaveBeenCalledWith(
      envConfig,
      expect.objectContaining({ hash: 'h1', downloadedAt: expect.any(Number) }),
    );
    expect(recovered).toEqual(expect.objectContaining({ hash: 'h1' }));
    expect(recovered).not.toBe(book);
  });

  test('does not recover when Readest Cloud is active', async () => {
    mocks.provider = 'readest';

    expect(await tryRecoverThirdPartyBook(envConfig, book, 'parse-book-document')).toBeNull();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  test('does not recover unrelated reader failures or external books', async () => {
    expect(await tryRecoverThirdPartyBook(envConfig, book, 'load-book-config')).toBeNull();
    expect(
      await tryRecoverThirdPartyBook(
        envConfig,
        { ...book, filePath: '/external/book.epub' },
        'parse-book-document',
      ),
    ).toBeNull();
    expect(mocks.download).not.toHaveBeenCalled();
  });
});
