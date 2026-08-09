import { afterEach, describe, expect, it, vi } from 'vitest';
import { route } from '../src/interfaces/router';
import { hashToken } from '../src/services/token-service';
import type { Env } from '../src/types';

const baseEnv = {
  ENVIRONMENT:'production', APP_HOST:'ddns.example.com', ALLOW_PRIVATE_IPS:'false', DETAILED_ERRORS:'false',
} as Env;

afterEach(() => vi.unstubAllGlobals());

function database(client: Record<string, unknown>): D1Database {
  const prepare = vi.fn((sql:string) => ({
    bind:vi.fn(() => ({
      first:vi.fn(async () => sql.startsWith('SELECT * FROM clients') ? client : sql.startsWith('SELECT request_count') ? { request_count:1 } : null),
      run:vi.fn(async () => ({ meta:{ changes:1 } })),
    })),
  }));
  return { prepare } as unknown as D1Database;
}

function client(tokenHash:string) {
  return {
    id:'client-id', display_name:'Home', slug:'linhome', enabled:1, zone_id:'zone-id', zone_name:'kthome.net',
    record_id:'record-id', record_name:'linhome-to.kthome.net', record_type:'A', token_hash:tokenHash,
    token_created_at:'now', last_ip:null, last_source_ip:null, last_status:null, last_updated_at:null,
    created_at:'now', updated_at:'now',
  };
}

function mockCloudflare(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (_input:RequestInfo | URL, init?:RequestInit) => Response.json({
    success:true,
    result:init?.method === 'PATCH' ? {} : {
      id:'record-id', zone_id:'zone-id', zone_name:'kthome.net', name:'linhome-to.kthome.net', type:'A', content:'1.1.1.1', ttl:1,
    },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('UniFi compatibility route security', () => {
  it('is indistinguishable from a missing route when disabled', async () => {
    const response = await route(new Request('https://ddns.example.com/api/ddns/linhome/unifi'), { ...baseEnv, ENABLE_UNIFI_COMPAT:'false' });
    expect(response.status).toBe(404);
  });

  it('rejects missing Basic credentials before accessing persistence', async () => {
    const response = await route(new Request('https://ddns.example.com/api/ddns/linhome/unifi'), { ...baseEnv, ENABLE_UNIFI_COMPAT:'true' });
    expect(response.status).toBe(401);
  });

  it('rejects credentials or record selectors in query strings', async () => {
    const password = `ddns_${'a'.repeat(32)}`;
    const response = await route(new Request('https://ddns.example.com/api/ddns/linhome/unifi?TOKEN=leak', {
      headers:{ Authorization:`Basic ${btoa(`linhome:${password}`)}` },
    }), { ...baseEnv, ENABLE_UNIFI_COMPAT:'true' });
    expect(response.status).toBe(400);
  });

  it('requires Basic username to equal path slug', async () => {
    const password = `ddns_${'a'.repeat(32)}`;
    const response = await route(new Request('https://ddns.example.com/api/ddns/linhome/unifi', {
      headers:{ Authorization:`Basic ${btoa(`other:${password}`)}` },
    }), { ...baseEnv, ENABLE_UNIFI_COMPAT:'true' });
    expect(response.status).toBe(401);
  });

  it('updates through the shared use case and returns an Inadyn response', async () => {
    const password = `ddns_${'a'.repeat(32)}`;
    const db = database(client(await hashToken(password)));
    const fetchMock = mockCloudflare();
    const auth = `Basic ${btoa(`linhome:${password}`)}`;
    const request = new Request('https://ddns.example.com/api/ddns/linhome/unifi?hostname=linhome-to.kthome.net&myip=192.168.1.1', {
      headers:{ Authorization:auth, 'CF-Connecting-IP':'8.8.8.8' },
    });
    const response = await route(request, { ...baseEnv, ENABLE_UNIFI_COMPAT:'true', DDNS_DB:db });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('good 8.8.8.8\n');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE clients SET last_ip='));
  });
});

describe('primary DDNS route', () => {
  it('rejects plaintext HTTP before reading any credential', async () => {
    const response = await route(new Request('http://ddns.example.com/api/ddns/linhome', {
      method:'POST', headers:{ Authorization:`Bearer ddns_${'x'.repeat(32)}` },
    }), baseEnv);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success:false, message:'HTTPS required' });
  });

  it('updates a bound record with a Bearer token', async () => {
    const password = `ddns_${'b'.repeat(32)}`;
    const db = database(client(await hashToken(password)));
    mockCloudflare();
    const response = await route(new Request('https://ddns.example.com/api/ddns/linhome', {
      method:'POST', headers:{ Authorization:`Bearer ${password}`, 'CF-Connecting-IP':'8.8.8.8' },
    }), { ...baseEnv, DDNS_DB:db });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success:true, updated:true });
  });

  it('rejects query strings, request bodies and unknown hosts', async () => {
    expect((await route(new Request('https://ddns.example.com/api/ddns/linhome?ip=8.8.8.8', { method:'POST' }), baseEnv)).status).toBe(404);
    expect((await route(new Request('https://ddns.example.com/api/ddns/linhome', { method:'POST', body:'{}' }), baseEnv)).status).toBe(400);
    expect((await route(new Request('https://unknown.example/api/ddns/linhome', { method:'POST' }), baseEnv)).status).toBe(404);
  });
});
