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
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (declared > maxBytes) throw new AppError(413, 'Request body too large', 'BODY_TOO_LARGE');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new AppError(413, 'Request body too large', 'BODY_TOO_LARGE');
  try { return JSON.parse(text) as T; } catch { throw new AppError(400, 'Invalid JSON', 'INVALID_JSON'); }
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
