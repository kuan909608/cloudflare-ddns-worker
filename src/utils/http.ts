import { AppError } from '../domain/errors';

export const json = (body: unknown, status = 200, extra: HeadersInit = {}): Response =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...extra } });

export function success(data: unknown, status = 200): Response {
  return json({ success: true, data }, status);
}

export function errorResponse(error: unknown, detailed = false): Response {
  if (error instanceof AppError) return json({ success: false, message: error.message }, error.status);
  return json({ success: false, message: detailed && error instanceof Error ? error.message : 'Internal server error' }, 500);
}

export async function strictJson<T>(request: Request, maxBytes = 16_384): Promise<T> {
  const contentType = request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new AppError(415, 'Content-Type must be application/json', 'UNSUPPORTED_MEDIA_TYPE');
  const lengthHeader = request.headers.get('Content-Length');
  const declared = lengthHeader === null ? null : Number(lengthHeader);
  if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0)) throw new AppError(400, 'Invalid Content-Length', 'INVALID_CONTENT_LENGTH');
  if (declared !== null && declared > maxBytes) throw new AppError(413, 'Request body too large', 'BODY_TOO_LARGE');
  if (!request.body) throw new AppError(400, 'Invalid JSON', 'INVALID_JSON');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new AppError(413, 'Request body too large', 'BODY_TOO_LARGE');
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  const text = chunks.join('');
  try { return JSON.parse(text) as T; } catch { throw new AppError(400, 'Invalid JSON', 'INVALID_JSON'); }
}

export function boundedInteger(value: string | null, defaultValue: number, minimum: number, maximum: number): number {
  if (value === null) return defaultValue;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new AppError(400, 'Invalid pagination parameters', 'INVALID_PAGINATION');
  }
  return parsed;
}

export async function strictEmptyJson(request: Request): Promise<void> {
  const value = await strictJson<unknown>(request);
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 0) {
    throw new AppError(400, 'Request body must be an empty JSON object', 'INVALID_JSON_BODY');
  }
}

export function enforceSameOrigin(request: Request, expectedHost: string): void {
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new AppError(403, 'Forbidden', 'FORBIDDEN');
  const origin = request.headers.get('Origin');
  if (!origin) return;
  try {
    const parsed = new URL(origin);
    const local = ['localhost', '127.0.0.1'].includes(expectedHost);
    if (parsed.hostname !== expectedHost || (!local && parsed.protocol !== 'https:')) throw new Error('origin mismatch');
  } catch {
    throw new AppError(403, 'Forbidden', 'FORBIDDEN');
  }
}

export function bearerToken(request: Request): string | null {
  const value = request.headers.get('Authorization');
  const match = value?.match(/^Bearer ([A-Za-z0-9_-]{20,})$/u);
  return match?.[1] ?? null;
}

export function basicCredentials(request: Request): { username: string; password: string } | null {
  const value = request.headers.get('Authorization');
  const encoded = value?.match(/^Basic ([A-Za-z0-9+/]+={0,2})$/u)?.[1];
  if (!encoded) return null;
  try {
    const decoded = atob(encoded);
    const separator = decoded.indexOf(':');
    if (separator < 1) return null;
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/u.test(username) || !/^ddns_[A-Za-z0-9_-]{20,}$/u.test(password)) return null;
    return { username, password };
  } catch { return null; }
}
