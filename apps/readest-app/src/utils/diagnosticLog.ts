export type DiagnosticLogLevel = 'info' | 'warning' | 'error';

export interface DiagnosticLogEntry {
  timestamp: string;
  level: DiagnosticLogLevel;
  scope: string;
  event: string;
  data?: unknown;
}

export const DIAGNOSTIC_LOG_LIMIT = 500;

const STORAGE_KEY = 'readest_diagnostic_log_v1';
const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;
const MAX_STRING_LENGTH = 8_000;
const SENSITIVE_KEY =
  /access.?key|secret|authorization|password|token|credential|signature|cookie/i;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;

const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

const sanitizeUrl = (raw: string): string => {
  try {
    const url = new URL(raw);
    if (!url.search) return raw;
    return `${url.origin}${url.pathname}?[REDACTED]`;
  } catch {
    return raw;
  }
};

const sanitizeString = (value: string): string => {
  const redacted = value.replace(URL_PATTERN, (url) => sanitizeUrl(url));
  return redacted.length > MAX_STRING_LENGTH
    ? `${redacted.slice(0, MAX_STRING_LENGTH)}…[TRUNCATED]`
    : redacted;
};

const sanitizeValue = (value: unknown, seen: WeakSet<object>, depth: number): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);
  if (depth >= MAX_DEPTH) return '[MAX_DEPTH]';

  if (value instanceof Error) {
    return {
      name: sanitizeString(value.name),
      message: sanitizeString(value.message),
      ...(value.stack ? { stack: sanitizeString(value.stack) } : {}),
      ...(value.cause !== undefined ? { cause: sanitizeValue(value.cause, seen, depth + 1) } : {}),
    };
  }

  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitizeValue(nested, seen, depth + 1);
  }
  return out;
};

const sanitize = (value: unknown): unknown => sanitizeValue(value, new WeakSet(), 0);

export const readDiagnosticLog = (): DiagnosticLogEntry[] => {
  const target = storage();
  if (!target) return [];
  try {
    const parsed = JSON.parse(target.getItem(STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as DiagnosticLogEntry[]) : [];
  } catch {
    return [];
  }
};

export const appendDiagnosticLog = (
  scope: string,
  event: string,
  data?: unknown,
  level: DiagnosticLogLevel = 'info',
): void => {
  const target = storage();
  if (!target) return;
  const entry: DiagnosticLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    scope: sanitizeString(scope),
    event: sanitizeString(event),
    ...(data === undefined ? {} : { data: sanitize(data) }),
  };
  const entries = [...readDiagnosticLog(), entry].slice(-DIAGNOSTIC_LOG_LIMIT);
  try {
    target.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // A diagnostic recorder must never interfere with the operation it observes.
  }
};

export const clearDiagnosticLog = (): void => {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort cleanup only.
  }
};

export const exportDiagnosticLog = (): string => {
  const header = {
    format: 'readest-diagnostic-log-v1',
    exportedAt: new Date().toISOString(),
    userAgent: typeof navigator === 'undefined' ? null : sanitizeString(navigator.userAgent),
  };
  return [header, ...readDiagnosticLog()].map((entry) => JSON.stringify(entry)).join('\n') + '\n';
};
