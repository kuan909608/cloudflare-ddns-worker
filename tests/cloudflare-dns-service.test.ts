import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudflareDnsService } from '../src/services/cloudflare-dns-service';

afterEach(() => vi.unstubAllGlobals());

describe('Cloudflare DNS catalog', () => {
  it('resolves the authoritative Zone Name from the fixed Zone ID', async () => {
    const fetchMock = vi.fn(async () => Response.json({success:true,result:{id:'zone-id',name:'Example.COM.'}}));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new CloudflareDnsService('token').getZone('zone-id')).resolves.toEqual({id:'zone-id',name:'example.com'});
    expect(fetchMock).toHaveBeenCalledWith('https://api.cloudflare.com/client/v4/zones/zone-id', expect.any(Object));
  });

  it('returns only A and AAAA records as safe form options', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      success:true,
      result:[
        {id:'a-record',name:'home.example.com',type:'A',content:'192.0.2.10'},
        {id:'aaaa-record',name:'v6.example.com',type:'AAAA',content:'2001:db8::10'},
        {id:'txt-record',name:'example.com',type:'TXT',content:'verification'},
      ],
      result_info:{page:1,total_pages:1},
    })));

    await expect(new CloudflareDnsService('token').listRecords('zone/id')).resolves.toEqual([
      {id:'a-record',name:'home.example.com',type:'A',content:'192.0.2.10'},
      {id:'aaaa-record',name:'v6.example.com',type:'AAAA',content:'2001:db8::10'},
    ]);
  });

  it('looks up only the persisted fixed name and type for interrupted provisioning recovery', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      success:true,
      result:[{id:'record',zone_id:'zone',zone_name:'example.com',name:'home.example.com',type:'A',content:'192.0.2.10',ttl:1,proxied:false}],
      result_info:{page:1,total_pages:1},
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new CloudflareDnsService('token').findRecords('zone','home.example.com','A')).resolves.toEqual([
      {id:'record',zoneId:'zone',zoneName:'example.com',name:'home.example.com',type:'A',content:'192.0.2.10',ttl:1,proxied:false},
    ]);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe('/client/v4/zones/zone/dns_records');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({name:'home.example.com',type:'A',match:'all',page:'1'});
  });

  it('creates an unproxied automatic-TTL Record with the first source IP', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({success:true,result:{id:'record',zone_id:'zone',zone_name:'example.com',name:'home.example.com',type:'A',content:'203.0.113.10',ttl:1,proxied:false}}));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new CloudflareDnsService('token').create('zone','home.example.com','A','203.0.113.10')).resolves.toMatchObject({id:'record',content:'203.0.113.10'});
    expect(fetchMock).toHaveBeenCalledWith('https://api.cloudflare.com/client/v4/zones/zone/dns_records', expect.objectContaining({method:'POST'}));
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({name:'home.example.com',type:'A',content:'203.0.113.10',ttl:1,proxied:false});
  });
});
