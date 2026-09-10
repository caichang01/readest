import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const policy = vi.hoisted(() => vi.fn());
const range = vi.hoisted(() => vi.fn());
const presign = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
const single = vi.hoisted(() => vi.fn());

vi.mock('@/utils/cors', () => ({ corsAllMethods: {}, runMiddleware: vi.fn() }));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: vi.fn(async () => ({ user: { id: 'user-1' }, token: 'tok' })),
  getStoragePolicyData: policy,
  isStorageLimitExceeded: (usage: number, bytes: number, limit: number | null) =>
    limit !== null && usage + bytes > limit,
}));
vi.mock('@/utils/supabase', () => ({ createSupabaseAdminClient: () => ({ from }) }));
vi.mock('@/utils/object', () => ({
  isSafeObjectKeyName: () => true,
  getUploadSignedUrl: presign,
  getDownloadSignedUrl: vi.fn(async () => 'https://storage.test/book'),
}));

import handler from '@/pages/api/storage/upload';

const request = async (fileSize = 10) => {
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer tok' },
    body: { fileName: 'book.epub', fileSize },
  } as unknown as NextApiRequest;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  await handler(req, res as unknown as NextApiResponse);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  policy.mockReturnValue({ usage: 0, limit: 100 });
  range.mockReset().mockResolvedValue({ data: [{ file_size: 20 }], error: null });
  single
    .mockReset()
    .mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } })
    .mockResolvedValueOnce({ data: { file_size: 10 }, error: null });
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    range,
    single,
  };
  from.mockReturnValue(builder);
  presign.mockResolvedValue('https://storage.test/upload');
});

describe('upload deployment limit uses live file usage without membership tables', () => {
  it('rejects an upload over the configured limit despite a stale JWT', async () => {
    range.mockResolvedValue({ data: [{ file_size: 100 }], error: null });
    const res = await request();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(presign).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalledWith('plans');
  });

  it('allows a fitting upload and reports the live usage', async () => {
    const res = await request();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ usage: 30 }));
  });

  it('pages past the PostgREST row cap', async () => {
    policy.mockReturnValue({ usage: 0, limit: 1005 });
    range
      .mockResolvedValueOnce({
        data: Array.from({ length: 1000 }, () => ({ file_size: 1 })),
        error: null,
      })
      .mockResolvedValueOnce({ data: [{ file_size: 5 }], error: null });
    const res = await request(1);
    expect(range).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('does not impose a user quota or scan usage when no deployment limit is configured', async () => {
    policy.mockReturnValue({ usage: 1000000, limit: null });
    const res = await request();
    expect(range).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does not authorize against stale usage when a configured-limit query fails', async () => {
    range.mockResolvedValue({ data: null, error: { message: 'database unavailable' } });
    const res = await request();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(presign).not.toHaveBeenCalled();
  });
});
