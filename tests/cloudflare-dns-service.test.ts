import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudflareDnsService } from '../src/services/cloudflare-dns-service';

afterEach(() => vi.unstubAllGlobals());

describe('Cloudflare DNS catalog', () => {
  it('lists every active zone page in name order', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get('page'));
      return Response.json({
        success:true,
        result:page === 1 ? [{id:'zone-1',name:'example.com'}] : [{id:'zone-2',name:'kthome.net'}],
        result_info:{page,total_pages:2},
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(new CloudflareDnsService('token').listZones()).resolves.toEqual([
      {id:'zone-1',name:'example.com'}, {id:'zone-2',name:'kthome.net'},
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/zones?status=active&order=name&direction=asc&page=1&per_page=50');
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
});
