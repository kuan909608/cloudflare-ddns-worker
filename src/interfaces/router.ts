import { AdminClientsUseCase, publicClient } from '../application/admin-clients';
import { DdnsUpdateUseCase } from '../application/ddns-update';
import { AppError, errors } from '../domain/errors';
import { D1ClientRepository } from '../infrastructure/d1-client-repository';
import { enforceRateLimit } from '../middleware/rate-limit';
import { verifyAccess } from '../services/access-service';
import { CloudflareDnsService } from '../services/cloudflare-dns-service';
import type { Env } from '../types';
import { basicCredentials, errorResponse, json, strictJson, success } from '../utils/http';
import { securityHeaders } from '../utils/security';

const idPattern = '[0-9a-fA-F-]{36}';

async function ddns(request: Request, env: Env, url: URL): Promise<Response> {
  const compatMatch = url.pathname.match(/^\/api\/compat\/unifi\/([a-z0-9][a-z0-9-]{1,62})$/u);
  if (compatMatch) return unifiCompat(request, env, url, compatMatch[1]!);
  if (request.method !== 'POST' || url.search) throw errors.notFound();
  if (request.body !== null) throw errors.badRequest('Request body must be empty');
  const match = url.pathname.match(/^\/api\/ddns\/([a-z0-9][a-z0-9-]{1,62})$/u); if (!match) throw errors.notFound();
  const repository = new D1ClientRepository(env.DDNS_DB);
  const useCase = new DdnsUpdateUseCase(repository, new CloudflareDnsService(env.CLOUDFLARE_DNS_API_TOKEN), env.ALLOW_PRIVATE_IPS === 'true', (clientId) => enforceRateLimit(env.DDNS_DB, env.DDNS_RATE_LIMITER, clientId, 10));
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
  const useCase = new DdnsUpdateUseCase(repository, new CloudflareDnsService(env.CLOUDFLARE_DNS_API_TOKEN), env.ALLOW_PRIVATE_IPS === 'true', (clientId) => enforceRateLimit(env.DDNS_DB, env.DDNS_RATE_LIMITER, clientId, 10));
  const result = await useCase.executeWithToken(slug, request, credentials.password);
  return new Response(`${result.updated ? 'good' : 'nochg'} ${result.ip}\n`, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function admin(request: Request, env: Env, url: URL): Promise<Response> {
  const identity = await verifyAccess(request, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD, env.ADMIN_ALLOWED_EMAILS);
  await enforceRateLimit(env.DDNS_DB, env.ADMIN_RATE_LIMITER, identity.email, 60);
  if (!url.pathname.startsWith('/api/admin/')) return env.ASSETS.fetch(request);
  const repository = new D1ClientRepository(env.DDNS_DB); const useCase = new AdminClientsUseCase(repository, new CloudflareDnsService(env.CLOUDFLARE_DNS_API_TOKEN));
  const listPath = url.pathname === '/api/admin/clients';
  const clientMatch = url.pathname.match(new RegExp(`^/api/admin/clients/(${idPattern})$`, 'u'));
  const actionMatch = url.pathname.match(new RegExp(`^/api/admin/clients/(${idPattern})/(enable|disable|rotate-token|logs)$`, 'u'));
  let response: Response;
  let audit: { action: string; target: string | null } | null = null;
  if (url.pathname === '/api/admin/dashboard' && request.method === 'GET') response = success(await repository.dashboard());
  else if (listPath && request.method === 'GET') response = success((await repository.list()).map(publicClient));
  else if (listPath && request.method === 'POST') { const result = await useCase.create(await strictJson(request)); audit = { action: 'client.create', target: result.client.id }; response = success(result, 201); }
  else if (clientMatch && request.method === 'GET') { const found = await repository.findById(clientMatch[1]!); if (!found) throw errors.notFound(); response = success(publicClient(found)); }
  else if (clientMatch && request.method === 'PUT') { const result = await useCase.update(clientMatch[1]!, await strictJson(request)); audit = { action: 'client.update', target: result.id }; response = success(result); }
  else if (clientMatch && request.method === 'DELETE') { const removed = await repository.remove(clientMatch[1]!); if (!removed) throw errors.notFound(); audit = { action: 'client.delete', target: clientMatch[1]! }; response = success({ deleted: true }); }
  else if (actionMatch && actionMatch[2] === 'logs' && request.method === 'GET') { const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50))); const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0)); response = success(await repository.logs(actionMatch[1]!, limit, offset)); }
  else if (actionMatch && request.method === 'POST') {
    const [id, action] = [actionMatch[1]!, actionMatch[2]!];
    if (action === 'rotate-token') { const result = await useCase.rotate(id); audit = { action: 'client.rotate-token', target: id }; response = success(result); }
    else { const result = await repository.setEnabled(id, action === 'enable'); if (!result) throw errors.notFound(); audit = { action: `client.${action}`, target: id }; response = success(publicClient(result)); }
  } else if (url.pathname === '/api/admin/cloudflare/validate-record' && request.method === 'POST') { response = success(await useCase.validate(await strictJson(request))); }
  else throw errors.notFound();
  if (audit) await repository.audit(identity.email, audit.action, audit.target, 'success');
  return response;
}

export async function route(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url); let response: Response;
    if (url.hostname === env.DDNS_HOST) response = await ddns(request, env, url);
    else if (url.hostname === env.ADMIN_HOST) response = await admin(request, env, url);
    else if (env.ENVIRONMENT !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname)) response = url.pathname.startsWith('/api/ddns/') ? await ddns(request, env, url) : await admin(request, env, url);
    else throw errors.notFound();
    return securityHeaders(response);
  } catch (error) {
    const forced = error instanceof AppError && new URL(request.url).pathname.startsWith('/api/admin/') && [401, 403].includes(error.status) ? new AppError(403, 'Forbidden', 'FORBIDDEN') : error;
    return securityHeaders(errorResponse(forced, env.DETAILED_ERRORS === 'true' && env.ENVIRONMENT !== 'production'));
  }
}
