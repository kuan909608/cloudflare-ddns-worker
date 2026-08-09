import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudflareDnsService } from '../src/services/cloudflare-dns-service';

afterEach(() => vi.unstubAllGlobals());

describe('Cloudflare DNS catalog', () => {
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
