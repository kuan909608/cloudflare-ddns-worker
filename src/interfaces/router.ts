import { AdminClientsUseCase } from '../application/admin-clients';
import { runAudited } from '../application/admin-audit';
import { DdnsUpdateUseCase } from '../application/ddns-update';
import { AppError, errors } from '../domain/errors';
import { D1ClientRepository } from '../infrastructure/d1-client-repository';
import { enforceRateLimit } from '../middleware/rate-limit';
import { verifyAccess } from '../services/access-service';
import { CloudflareDnsService } from '../services/cloudflare-dns-service';
import { rateLimitSource } from '../services/ip-service';
import type { Env } from '../types';
import { basicCredentials, boundedInteger, enforceSameOrigin, errorResponse, json, strictEmptyJson, strictJson, success } from '../utils/http';
import { logRequestError } from '../utils/observability';
import { securityHeaders } from '../utils/security';

const idPattern = '[0-9a-fA-F-]{36}';
const isAdminPath = (pathname: string): boolean => pathname === '/admin' || pathname.startsWith('/admin/');

async function ddns(request: Request, env: Env, url: URL): Promise<Response> {
  const compatMatch = url.pathname.match(/^\/api\/ddns\/([a-z0-9][a-z0-9-]{1,62})\/unifi$/u);
  if (compatMatch) return unifiCompat(request, env, url, compatMatch[1]!);
  if (request.method !== 'POST' || url.search) throw errors.notFound();
  if (request.body !== null) throw errors.badRequest('Request body must be empty');
  const match = url.pathname.match(/^\/api\/ddns\/([a-z0-9][a-z0-9-]{1,62})$/u); if (!match) throw errors.notFound();
  const repository = new D1ClientRepository(env.DDNS_DB);
  const useCase = new DdnsUpdateUseCase(
    repository,
    new CloudflareDnsService(env.CLOUDFLARE_DNS_API_TOKEN),
    env.ALLOW_PRIVATE_IPS === 'true',
    (incoming) => enforceRateLimit(env.DDNS_DB, `ddns-preauth:${rateLimitSource(incoming)}`, 60),
    (clientId) => enforceRateLimit(env.DDNS_DB, `ddns-client:${clientId}`, 10),
  );
  const result = await useCase.execute(match[1]!, request);
  return json({ success: true, updated: result.updated });
}

async function unifiCompat(request: Request, env: Env, url: URL, slug: string): Promise<Response> {
  if (env.ENABLE_UNIFI_COMPAT !== 'true') throw errors.notFound();
  if (request.method !== 'GET' || request.body !== null) throw errors.notFound();
  const forbiddenQueryKeys = new Set(['token', 'password', 'passwd', 'key', 'apikey', 'api_key', 'auth', 'authorization', 'secret', 'address', 'target', 'record', 'recordid', 'recordname', 'domain', 'zone', 'zoneid', 'zonename']);
  if ([...url.searchParams.keys()].some((key) => forbiddenQueryKeys.has(key.toLowerCase()))) throw errors.badRequest('Credential and record query parameters are not accepted');
  const credentials = basicCredentials(request);
  if (!credentials || credentials.username !== slug) throw errors.unauthorized();
  const repository = new D1ClientRepository(env.DDNS_DB);
  const useCase = new DdnsUpdateUseCase(
    repository,
    new CloudflareDnsService(env.CLOUDFLARE_DNS_API_TOKEN),
    env.ALLOW_PRIVATE_IPS === 'true',
    (incoming) => enforceRateLimit(env.DDNS_DB, `ddns-preauth:${rateLimitSource(incoming)}`, 60),
    (clientId) => enforceRateLimit(env.DDNS_DB, `ddns-client:${clientId}`, 10),
  );
  const result = await useCase.executeWithToken(slug, request, credentials.password);
  return new Response(`${result.updated ? 'good' : 'nochg'} ${result.ip}\n`, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function admin(request: Request, env: Env, url: URL): Promise<Response> {
  const identity = await verifyAccess(request, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD, env.ADMIN_ALLOWED_EMAILS);
  if (!url.pathname.startsWith('/admin/api/')) {
    if (!['GET', 'HEAD'].includes(request.method)) throw errors.notFound();
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404 || url.pathname.split('/').at(-1)?.includes('.')) return assetResponse;
    const fallbackUrl = new URL(request.url); fallbackUrl.pathname = '/admin/index.html';
    return env.ASSETS.fetch(new Request(fallbackUrl, request));
  }
  await enforceRateLimit(env.DDNS_DB, `admin:${identity.email}`, 60);
  if (['POST', 'PUT', 'DELETE'].includes(request.method)) enforceSameOrigin(request, url.hostname);
  const repository = new D1ClientRepository(env.DDNS_DB); const useCase = new AdminClientsUseCase(repository, new CloudflareDnsService(env.CLOUDFLARE_DNS_API_TOKEN));
  const listPath = url.pathname === '/admin/api/clients';
  const clientMatch = url.pathname.match(new RegExp(`^/admin/api/clients/(${idPattern})$`, 'u'));
  const actionMatch = url.pathname.match(new RegExp(`^/admin/api/clients/(${idPattern})/(enable|disable|rotate-token|logs)$`, 'u'));
  let response: Response;
  if (url.pathname === '/admin/api/config' && request.method === 'GET') response = success({ ddnsOrigin: ['localhost', '127.0.0.1'].includes(url.hostname) ? url.origin : `https://${env.APP_HOST}`, unifiCompatibilityEnabled: env.ENABLE_UNIFI_COMPAT === 'true' });
  else if (url.pathname === '/admin/api/dashboard' && request.method === 'GET') response = success(await repository.dashboard());
  else if (listPath && request.method === 'GET') response = success(await useCase.list());
  else if (listPath && request.method === 'POST') { const result = await runAudited(repository, identity.email, 'client.create', async () => useCase.create(await strictJson(request)), (value) => value.client.id); response = success(result, 201); }
  else if (clientMatch && request.method === 'GET') response = success(await useCase.get(clientMatch[1]!));
  else if (clientMatch && request.method === 'PUT') { const id = clientMatch[1]!; const result = await runAudited(repository, identity.email, 'client.update', async () => useCase.update(id, await strictJson(request)), () => id, id); response = success(result); }
  else if (clientMatch && request.method === 'DELETE') { const id = clientMatch[1]!; const result = await runAudited(repository, identity.email, 'client.delete', async () => { await strictEmptyJson(request); if (!(await repository.remove(id))) throw errors.notFound(); return { deleted: true }; }, () => id, id); response = success(result); }
  else if (actionMatch && actionMatch[2] === 'logs' && request.method === 'GET') { const limit = boundedInteger(url.searchParams.get('limit'), 50, 1, 100); const offset = boundedInteger(url.searchParams.get('offset'), 0, 0, 1_000_000); response = success(await repository.logs(actionMatch[1]!, limit, offset)); }
  else if (actionMatch && request.method === 'POST') {
    const [id, action] = [actionMatch[1]!, actionMatch[2]!];
    if (action === 'rotate-token') { const result = await runAudited(repository, identity.email, 'client.rotate-token', async () => { await strictEmptyJson(request); return useCase.rotate(id); }, () => id, id); response = success(result); }
    else { const result = await runAudited(repository, identity.email, `client.${action}`, async () => { await strictEmptyJson(request); const changed = await repository.setEnabled(id, action === 'enable'); if (!changed) throw errors.notFound(); return useCase.get(id); }, () => id, id); response = success(result); }
  } else if (url.pathname === '/admin/api/cloudflare/validate-record' && request.method === 'POST') { const record = await runAudited(repository, identity.email, 'cloudflare.validate-record', async () => useCase.validate(await strictJson(request)), () => null); response = success(record); }
  else throw errors.notFound();
  return response;
}

export async function route(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url); let response: Response;
    const localDevelopment = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !localDevelopment) throw errors.badRequest('HTTPS required');
    const appHost = env.APP_HOST.trim().toLowerCase();
    if (url.hostname !== appHost && !localDevelopment) throw errors.notFound();
    if (url.pathname === '/admin' && ['GET', 'HEAD'].includes(request.method)) response = Response.redirect(new URL('/admin/', url), 308);
    else if (url.pathname.startsWith('/api/ddns/')) response = await ddns(request, env, url);
    else if (isAdminPath(url.pathname)) response = await admin(request, env, url);
    else throw errors.notFound();
    return securityHeaders(response);
  } catch (error) {
    const pathname = new URL(request.url).pathname;
    const forced = error instanceof AppError && isAdminPath(pathname) && [401, 403].includes(error.status) ? new AppError(403, 'Forbidden', 'FORBIDDEN') : error;
    const response = errorResponse(forced, env.DETAILED_ERRORS === 'true' && env.ENVIRONMENT !== 'production');
    if (response.status >= 500) logRequestError(request, pathname, forced, response.status);
    return securityHeaders(response);
  }
}
