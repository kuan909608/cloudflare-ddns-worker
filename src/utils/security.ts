const SENSITIVE_KEYS = /authorization|token|secret|jwt|assertion|cookie/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redact(entry)]));
  }
  return value;
}

export function securityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  const headers = secured.headers;
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  headers.set('X-Frame-Options', 'DENY');
  return secured;
}
