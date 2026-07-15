import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const validateUserMock = vi.fn();
vi.mock('@/utils/access', async () => {
  const actual = await vi.importActual<typeof import('@/utils/access')>('@/utils/access');
  return {
    ...actual,
    validateUserAndToken: (...args: unknown[]) => validateUserMock(...args),
  };
});

vi.mock('@/utils/cors', () => ({
  corsAllMethods: vi.fn(),
  runMiddleware: vi.fn(async () => undefined),
}));

const supabaseTouched = vi.fn();
const chainProxy = (): unknown => {
  const empty = { data: null, error: null };
  const handler: ProxyHandler<{ then?: unknown }> = {
    get(_target, prop) {
      if (prop === 'then') return undefined;
      return (..._args: unknown[]) => {
        if (prop === 'maybeSingle' || prop === 'single') return Promise.resolve(empty);
        return chainProxy();
      };
    },
  };
  return new Proxy({}, handler);
};

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => {
    supabaseTouched();
    return { from: () => chainProxy() };
  },
}));

const { default: addressHandler } = await import('@/pages/api/send/address');
const { default: sendersHandler } = await import('@/pages/api/send/senders');

interface MockRes {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  statusCode: number;
}

const makeRes = (): MockRes => {
  const res: MockRes = { status: vi.fn(), json: vi.fn(), statusCode: 0 };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res as unknown as NextApiResponse;
  });
  res.json.mockImplementation(() => res as unknown as NextApiResponse);
  return res;
};

const makeReq = (): NextApiRequest =>
  ({
    method: 'GET',
    headers: { authorization: 'Bearer testtoken' },
    body: {},
    query: {},
  }) as unknown as NextApiRequest;

beforeEach(() => {
  validateUserMock.mockReset().mockResolvedValue({
    user: { id: 'user-1', email: 'u@example.com' },
    token: 'testtoken',
  });
  supabaseTouched.mockReset();
});

describe('Send to Readest authenticated access', () => {
  const cases = [
    ['address', addressHandler],
    ['senders', sendersHandler],
  ] as const;

  test.each(
    cases,
  )('allows an authenticated user to access %s without a subscription', async (_name, handler) => {
    const res = makeRes();
    await handler(makeReq(), res as unknown as NextApiResponse);

    expect(supabaseTouched).toHaveBeenCalled();
    expect(res.statusCode).not.toBe(403);
  });
});
