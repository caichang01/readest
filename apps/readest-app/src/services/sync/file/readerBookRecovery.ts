import type { Book } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';
import { getActiveFileSyncBackends } from '@/services/sync/cloudSyncProvider';
import { runFileBookDownload } from '@/services/sync/file/runLibrarySync';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { appendDiagnosticLog } from '@/utils/diagnosticLog';

const RECOVERABLE_READER_STAGES = new Set(['load-local-book-file', 'parse-book-document']);

/**
 * Replace a missing/corrupt app-managed book with a selected third-party
 * provider's copy. The multi-provider runner tries every enabled backend in
 * stable order. The caller owns the one-shot retry guard; this helper only
 * decides eligibility, downloads, and persists the repaired device-local row.
 */
export const tryRecoverThirdPartyBook = async (
  envConfig: EnvConfigType,
  book: Book,
  failedStage: string,
): Promise<Book | null> => {
  if (
    !RECOVERABLE_READER_STAGES.has(failedStage) ||
    !book.uploadedAt ||
    book.filePath ||
    book.url ||
    getActiveFileSyncBackends(useSettingsStore.getState().settings).length === 0
  ) {
    return null;
  }

  const recovered = { ...book };
  appendDiagnosticLog('reader', 'book-recovery-start', {
    bookHash: book.hash,
    failedStage,
  });
  const downloaded = await runFileBookDownload(envConfig, recovered);
  if (!downloaded) {
    appendDiagnosticLog(
      'reader',
      'book-recovery-download-failed',
      { bookHash: book.hash, failedStage },
      'error',
    );
    return null;
  }

  await useLibraryStore.getState().updateBook(envConfig, recovered);
  appendDiagnosticLog('reader', 'book-recovery-complete', {
    bookHash: book.hash,
    failedStage,
    downloadedAt: recovered.downloadedAt,
  });
  return recovered;
};
