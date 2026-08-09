import { createRemoteJWKSet, jwtVerify } from 'jose';
import { errors } from '../domain/errors';
import type { AccessIdentity } from '../domain/models';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function verifyAccess(request: Request, teamDomain: string, audience: string): Promise<AccessIdentity> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw errors.forbidden();
  const host = teamDomain.replace(/^https?:\/\//u, '').replace(/\/$/u, '');
  const issuer = `https://${host}`;
  let jwks = jwksCache.get(host);
  if (!jwks) { jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)); jwksCache.set(host, jwks); }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience, algorithms: ['RS256'] });
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    if (!email || payload.type !== 'app' || typeof payload.exp !== 'number' || typeof payload.sub !== 'string' || !payload.sub) throw errors.forbidden();
    return { email, subject: payload.sub };
  } catch { throw errors.forbidden(); }
}
