import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '../src/domain/models';
import { AppError } from '../src/domain/errors';
import type { Env } from '../src/types';

const mocks = vi.hoisted(() => ({
  verifyAccess: vi.fn(async () => ({ email:'admin@example.com', subject:'member' })),
  enforceRateLimit: vi.fn(async () => undefined),
  repository: {
    list:vi.fn(), findById:vi.fn(), findBySlug:vi.fn(), create:vi.fn(), update:vi.fn(), setEnabled:vi.fn(),
    rotateToken:vi.fn(), updateStatus:vi.fn(), remove:vi.fn(), addLog:vi.fn(), logs:vi.fn(), audit:vi.fn(), dashboard:vi.fn(),
  },
  getRecord: vi.fn(), listZones:vi.fn(), listRecords:vi.fn(),
  updateRecord: vi.fn(),
}));

vi.mock('../src/services/access-service', () => ({ verifyAccess:mocks.verifyAccess }));
vi.mock('../src/middleware/rate-limit', () => ({ enforceRateLimit:mocks.enforceRateLimit }));
vi.mock('../src/infrastructure/d1-client-repository', () => ({ D1ClientRepository:class { constructor() { return mocks.repository; } } }));
vi.mock('../src/services/cloudflare-dns-service', () => ({ CloudflareDnsService:class { getRecord=mocks.getRecord; listZones=mocks.listZones; listRecords=mocks.listRecords; update=mocks.updateRecord; } }));

import { route } from '../src/interfaces/router';

const id = '11111111-1111-4111-8111-111111111111';
const client: Client = {
  id, displayName:'Home', slug:'home-1', enabled:true, zoneId:'1'.repeat(32), zoneName:'example.com',
  recordId:'2'.repeat(32), recordName:'home.example.com', recordType:'A', tokenHash:'hash', tokenCreatedAt:'now',
  lastIp:'1.1.1.1', lastSourceIp:null, lastStatus:null, lastUpdatedAt:null, createdAt:'now', updatedAt:'now',
};
const record = { id:client.recordId, zoneId:client.zoneId, zoneName:client.zoneName, name:client.recordName, type:'A' as const, content:'8.8.8.8', ttl:1 };
const env = {
  ENVIRONMENT:'production', APP_HOST:'ddns.kthome.net', ENABLE_UNIFI_COMPAT:'true',
  ACCESS_TEAM_DOMAIN:'team.cloudflareaccess.com', ACCESS_AUD:'aud',
  CLOUDFLARE_DNS_API_TOKEN:'secret', DDNS_DB:{} as D1Database,
  ASSETS:{ fetch:vi.fn(async () => new Response('asset')) },
} as unknown as Env;

function request(path:string, method='GET', body?:unknown, headers:HeadersInit={}) {
  return new Request(`https://ddns.kthome.net${path}`, {
    method,
    headers:{ ...(body === undefined ? {} : {'Content-Type':'application/json'}), ...headers },
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAccess.mockResolvedValue({ email:'admin@example.com', subject:'member' });
  mocks.repository.findById.mockResolvedValue(client);
  mocks.repository.list.mockResolvedValue([client]);
  mocks.repository.dashboard.mockResolvedValue({total:1});
  mocks.repository.logs.mockResolvedValue([]);
  mocks.repository.update.mockResolvedValue(client);
  mocks.repository.setEnabled.mockResolvedValue(client);
  mocks.repository.rotateToken.mockResolvedValue(client);
  mocks.repository.remove.mockResolvedValue(true);
  mocks.repository.create.mockResolvedValue(client);
  mocks.repository.audit.mockResolvedValue(undefined);
  mocks.getRecord.mockResolvedValue(record);
  mocks.listZones.mockResolvedValue([{id:client.zoneId,name:client.zoneName}]);
  mocks.listRecords.mockResolvedValue([{id:client.recordId,name:client.recordName,type:client.recordType,content:record.content}]);
});

describe('admin HTTP API', () => {
  it('redirects the bare admin path to the Access-protected trailing-slash path', async () => {
    const response = await route(request('/admin'), env);

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('https://ddns.kthome.net/admin/');
    expect(mocks.verifyAccess).not.toHaveBeenCalled();
  });

  it('keeps root public routing closed and requires Access before serving admin assets', async () => {
    expect((await route(request('/'), env)).status).toBe(404);
    expect(mocks.verifyAccess).not.toHaveBeenCalled();
    mocks.verifyAccess.mockRejectedValueOnce(new AppError(401, 'Unauthorized', 'UNAUTHORIZED'));
    expect((await route(request('/admin/'), env)).status).toBe(403);
  });

  it('serves Access-protected assets without consuming API rate limit', async () => {
    expect(await (await route(request('/admin/'), env)).text()).toBe('asset');
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
  });

  it('logs a sanitized category when an unexpected D1 failure becomes a 500', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.enforceRateLimit.mockRejectedValueOnce(new Error('D1_ERROR: no such table: rate_limit_windows'));
    try {
      const response = await route(request('/admin/api/config'), env);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ success:false, message:'Internal server error' });
      expect(log).toHaveBeenCalledWith({
        event:'request_error', method:'GET', pathname:'/admin/api/config', status:500, category:'D1_SCHEMA_MISSING',
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain('rate_limit_windows');
    } finally {
      log.mockRestore();
    }
  });

  it('delegates protected SPA navigation and asset misses to the configured assets binding', async () => {
    const assets = { fetch:vi.fn(async (input:Request) => new Response(new URL(input.url).pathname === '/admin/clients' ? 'spa' : 'missing', { status:new URL(input.url).pathname === '/admin/clients' ? 200 : 404 })) };
    const fallbackEnv = { ...env, ASSETS:assets } as unknown as Env;
    expect(await (await route(request('/admin/clients'), fallbackEnv)).text()).toBe('spa');
    expect((await route(request('/admin/missing.js'), fallbackEnv)).status).toBe(404);
    expect(assets.fetch).toHaveBeenCalledTimes(2);
  });

  it('returns runtime config, dashboard, list, live detail and logs', async () => {
    expect(await (await route(request('/admin/api/config'), env)).json()).toMatchObject({data:{ddnsOrigin:'https://ddns.kthome.net'}});
    expect((await route(request('/admin/api/dashboard'), env)).status).toBe(200);
    expect((await route(request('/admin/api/clients'), env)).status).toBe(200);
    expect(await (await route(request(`/admin/api/clients/${id}`), env)).json()).toMatchObject({data:{currentDnsIp:'8.8.8.8'}});
    expect((await route(request(`/admin/api/clients/${id}/logs?limit=25&offset=0`), env)).status).toBe(200);
    expect(mocks.repository.logs).toHaveBeenCalledWith(id,25,0);
  });

  it('lists Cloudflare zones and A/AAAA records for the guided client form', async () => {
    expect(await (await route(request('/admin/api/cloudflare/zones'), env)).json()).toMatchObject({data:[{name:'example.com'}]});
    const zoneId = 'a'.repeat(32);
    expect(await (await route(request(`/admin/api/cloudflare/zones/${zoneId}/records`), env)).json()).toMatchObject({data:[{type:'A'}]});
    expect(mocks.listRecords).toHaveBeenCalledWith(zoneId);
  });

  it('creates, updates, deletes, enables, disables and rotates with JSON mutation policy', async () => {
    const input = {displayName:'Home',slug:'home-1',zoneId:client.zoneId,zoneName:client.zoneName,recordId:client.recordId,recordName:client.recordName,recordType:'A'};
    expect((await route(request('/admin/api/clients','POST',input),env)).status).toBe(201);
    expect((await route(request(`/admin/api/clients/${id}`,'PUT',input),env)).status).toBe(200);
    expect((await route(request(`/admin/api/clients/${id}`,'DELETE',{}),env)).status).toBe(200);
    expect(await (await route(request(`/admin/api/clients/${id}/enable`,'POST',{}),env)).json()).toMatchObject({data:{currentDnsIp:'8.8.8.8'}});
    expect((await route(request(`/admin/api/clients/${id}/disable`,'POST',{}),env)).status).toBe(200);
    expect(await (await route(request(`/admin/api/clients/${id}/rotate-token`,'POST',{}),env)).json()).toMatchObject({data:{client:{currentDnsIp:'8.8.8.8'}}});
    expect(mocks.repository.audit).toHaveBeenCalledWith('admin@example.com','client.rotate-token',id,'success');
  });

  it('validates records and rejects invalid pagination, media type, origin and routes', async () => {
    const recordInput = {zoneId:client.zoneId,zoneName:client.zoneName,recordId:client.recordId,recordName:client.recordName,recordType:'A'};
    expect((await route(request('/admin/api/cloudflare/validate-record','POST',recordInput),env)).status).toBe(200);
    expect((await route(request(`/admin/api/clients/${id}/logs?limit=NaN`),env)).status).toBe(400);
    expect((await route(request(`/admin/api/clients/${id}/enable`,'POST'),env)).status).toBe(415);
    expect((await route(request(`/admin/api/clients/${id}/enable`,'POST',{}, {Origin:'https://evil.example','Sec-Fetch-Site':'cross-site'}),env)).status).toBe(403);
    expect((await route(request('/admin/api/missing'),env)).status).toBe(404);
  });
});
