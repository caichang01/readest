import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('jwt-decode', () => ({
  jwtDecode: vi.fn(() => ({ storage_usage_bytes: 128 })),
}));

import {
  getStoragePolicyData,
  getTranslationDailyLimit,
  isStorageLimitExceeded,
} from '@/utils/access';

const originalStorageLimit = process.env['STORAGE_LIMIT_BYTES'];
const originalLegacyStorageLimit = process.env['STORAGE_FIXED_QUOTA'];
const originalTranslationLimit = process.env['TRANSLATION_DAILY_LIMIT'];
const originalLegacyTranslationLimit = process.env['TRANSLATION_FIXED_QUOTA'];

afterEach(() => {
  if (originalStorageLimit === undefined) delete process.env['STORAGE_LIMIT_BYTES'];
  else process.env['STORAGE_LIMIT_BYTES'] = originalStorageLimit;
  if (originalLegacyStorageLimit === undefined) delete process.env['STORAGE_FIXED_QUOTA'];
  else process.env['STORAGE_FIXED_QUOTA'] = originalLegacyStorageLimit;
  if (originalTranslationLimit === undefined) delete process.env['TRANSLATION_DAILY_LIMIT'];
  else process.env['TRANSLATION_DAILY_LIMIT'] = originalTranslationLimit;
  if (originalLegacyTranslationLimit === undefined) delete process.env['TRANSLATION_FIXED_QUOTA'];
  else process.env['TRANSLATION_FIXED_QUOTA'] = originalLegacyTranslationLimit;
});

describe('deployment storage policy', () => {
  it('is unlimited by default and does not derive a limit from a membership plan', () => {
    delete process.env['STORAGE_LIMIT_BYTES'];
    delete process.env['STORAGE_FIXED_QUOTA'];

    expect(getStoragePolicyData('token')).toEqual({ usage: 128, limit: null });
    expect(isStorageLimitExceeded(128, Number.MAX_SAFE_INTEGER, null)).toBe(false);
  });

  it('enforces a deployment-wide limit when configured', () => {
    process.env['STORAGE_LIMIT_BYTES'] = '1024';

    expect(getStoragePolicyData('token')).toEqual({ usage: 128, limit: 1024 });
    expect(isStorageLimitExceeded(900, 124, 1024)).toBe(false);
    expect(isStorageLimitExceeded(900, 125, 1024)).toBe(true);
  });

  it('accepts the legacy fixed-quota variable as a migration fallback', () => {
    delete process.env['STORAGE_LIMIT_BYTES'];
    process.env['STORAGE_FIXED_QUOTA'] = '2048';

    expect(getStoragePolicyData('token').limit).toBe(2048);
  });
});

describe('deployment translation policy', () => {
  it('is unlimited by default', () => {
    delete process.env['TRANSLATION_DAILY_LIMIT'];
    delete process.env['TRANSLATION_FIXED_QUOTA'];
    expect(getTranslationDailyLimit()).toBeNull();
  });

  it('uses one deployment-wide daily limit', () => {
    process.env['TRANSLATION_DAILY_LIMIT'] = '50000';
    expect(getTranslationDailyLimit()).toBe(50000);
  });
});
