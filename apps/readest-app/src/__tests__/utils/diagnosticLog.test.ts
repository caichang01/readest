// @vitest-environment node

import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  DIAGNOSTIC_LOG_LIMIT,
  appendDiagnosticLog,
  clearDiagnosticLog,
  exportDiagnosticLog,
  readDiagnosticLog,
} from '@/utils/diagnosticLog';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('diagnosticLog', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(),
      configurable: true,
    });
  });

  beforeEach(() => {
    localStorage.clear();
    clearDiagnosticLog();
  });

  test('persists structured entries and redacts credentials and signed URL queries', () => {
    appendDiagnosticLog('s3', 'download-start', {
      accessKeyId: 'AKID-SECRET',
      nested: { secretAccessKey: 'SUPER-SECRET' },
      url: 'https://storage.example/book.epub?X-Amz-Credential=AKID&X-Amz-Signature=sig',
      status: 206,
    });

    expect(readDiagnosticLog()).toEqual([
      expect.objectContaining({
        level: 'info',
        scope: 's3',
        event: 'download-start',
        data: {
          accessKeyId: '[REDACTED]',
          nested: { secretAccessKey: '[REDACTED]' },
          url: 'https://storage.example/book.epub?[REDACTED]',
          status: 206,
        },
      }),
    ]);
  });

  test('serializes errors without losing the message and redacts secrets in the stack', () => {
    const error = new Error('GET https://storage.example/book.epub?X-Amz-Signature=secret failed');

    appendDiagnosticLog('reader', 'open-failed', { error }, 'error');

    const entry = readDiagnosticLog()[0]!;
    expect(entry.level).toBe('error');
    expect(entry.data).toMatchObject({
      error: {
        name: 'Error',
        message: 'GET https://storage.example/book.epub?[REDACTED] failed',
      },
    });
    expect(JSON.stringify(entry)).not.toContain('X-Amz-Signature=secret');
  });

  test('keeps only the newest bounded number of entries', () => {
    for (let i = 0; i < DIAGNOSTIC_LOG_LIMIT + 5; i += 1) {
      appendDiagnosticLog('test', `event-${i}`);
    }

    const entries = readDiagnosticLog();
    expect(entries).toHaveLength(DIAGNOSTIC_LOG_LIMIT);
    expect(entries[0]?.event).toBe('event-5');
    expect(entries.at(-1)?.event).toBe(`event-${DIAGNOSTIC_LOG_LIMIT + 4}`);
  });

  test('exports a JSONL document with a format header and every saved entry', () => {
    appendDiagnosticLog('sync', 'started', { count: 2 });
    appendDiagnosticLog('sync', 'finished', { count: 2 });

    const lines = exportDiagnosticLog()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(lines[0]).toMatchObject({ format: 'readest-diagnostic-log-v1' });
    expect(lines.slice(1).map((line) => line['event'])).toEqual(['started', 'finished']);
  });
});
