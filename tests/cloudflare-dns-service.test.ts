import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudflareDnsService } from '../src/services/cloudflare-dns-service';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
      result:[{id:'record',name:'home.example.com',type:'A',content:'192.0.2.10',ttl:1,proxied:false}],
      result_info:{page:1,total_pages:1},
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new CloudflareDnsService('token').findRecords('zone','example.com','home.example.com','A')).resolves.toEqual([
      {id:'record',zoneId:'zone',zoneName:'example.com',name:'home.example.com',type:'A',content:'192.0.2.10',ttl:1,proxied:false},
    ]);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe('/client/v4/zones/zone/dns_records');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({name:'home.example.com',type:'A',match:'all',page:'1'});
  });

  it('creates an unproxied automatic-TTL Record with the first source IP', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({success:true,result:{id:'record',name:'home.example.com',type:'A',content:'203.0.113.10',ttl:1,proxied:false}}));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new CloudflareDnsService('token').create('zone','example.com','home.example.com','A','203.0.113.10')).resolves.toMatchObject({id:'record',zoneId:'zone',zoneName:'example.com',content:'203.0.113.10'});
    expect(fetchMock).toHaveBeenCalledWith('https://api.cloudflare.com/client/v4/zones/zone/dns_records', expect.objectContaining({method:'POST'}));
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({name:'home.example.com',type:'A',content:'203.0.113.10',ttl:1,proxied:false});
  });

  it('retries a transient read failure and preserves safe provider diagnostics', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({success:false,result:null,errors:[{code:1000,message:'temporary provider detail'}]}, {status:503,headers:{'Retry-After':'0','CF-Ray':'provider-ray'}}))
      .mockResolvedValueOnce(Response.json({success:true,result:{id:'zone',name:'example.com'}}));
    const errorSpy = vi.spyOn(console,'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', fetchMock);

    await expect(new CloudflareDnsService('secret-token').getZone('zone')).resolves.toEqual({id:'zone',name:'example.com'});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({event:'cloudflare_api_attempt_failed',operation:'zone_get',status:503,providerCode:1000,requestId:'provider-ray',retryable:true}));
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret-token');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('temporary provider detail');
  });

  it('does not retry a permanent provider rejection', async () => {
    const fetchMock = vi.fn(async () => Response.json({success:false,result:null,errors:[{code:9109,message:'invalid token'}]}, {status:403}));
    const errorSpy = vi.spyOn(console,'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', fetchMock);

    await expect(new CloudflareDnsService('secret-token').getZone('zone')).rejects.toMatchObject({status:502,code:'DNS_UPDATE_FAILED'});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({event:'cloudflare_api_attempt_failed',operation:'zone_get',status:403,providerCode:9109,retryable:false}));
  });

  it('re-queries after an ambiguous create failure instead of creating a duplicate', async () => {
    const existing = {id:'record',name:'home.example.com',type:'A',content:'203.0.113.10',ttl:1,proxied:false};
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('network reset after request upload'))
      .mockResolvedValueOnce(Response.json({success:true,result:[existing],result_info:{page:1,total_pages:1}}));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new CloudflareDnsService('token').create('zone','example.com','home.example.com','A','203.0.113.10')).resolves.toMatchObject({id:'record',zoneId:'zone',zoneName:'example.com'});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.filter(([,init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('retries Record creation only after an exact-name re-query confirms it is absent', async () => {
    const created = {id:'record',name:'home.example.com',type:'A',content:'203.0.113.10',ttl:1,proxied:false};
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({success:false,result:null,errors:[{code:1000}]}, {status:503,headers:{'Retry-After':'0'}}))
      .mockResolvedValueOnce(Response.json({success:true,result:[],result_info:{page:1,total_pages:1}}))
      .mockResolvedValueOnce(Response.json({success:true,result:created}));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new CloudflareDnsService('token').create('zone','example.com','home.example.com','A','203.0.113.10')).resolves.toMatchObject({id:'record'});
    expect(fetchMock.mock.calls.map(([,init]) => init?.method ?? 'GET')).toEqual(['POST','GET','POST']);
  });
});
