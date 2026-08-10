import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('production deployment configuration', () => {
  it('uses the deployed Worker name and migrates before deployment', async () => {
    const wrangler = JSON.parse(await readFile('wrangler.jsonc', 'utf8')) as {
      name: string;
      ratelimits: Array<{name:string;namespace_id:string;simple:{limit:number;period:number}}>;
      triggers:{crons:string[]};
      observability:{logs:{invocation_logs:boolean;enabled:boolean}};
    };
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { scripts: Record<string, string> };

    expect(wrangler.name).toBe('cloudflare-ddns-worker');
    expect(wrangler.ratelimits).toEqual([
      {name:'DDNS_PREAUTH_RATE_LIMITER',namespace_id:'90960801',simple:{limit:60,period:60}},
      {name:'DDNS_CLIENT_RATE_LIMITER',namespace_id:'90960802',simple:{limit:10,period:60}},
      {name:'ADMIN_RATE_LIMITER',namespace_id:'90960803',simple:{limit:60,period:60}},
    ]);
    expect(new Set(wrangler.ratelimits.map((binding)=>binding.namespace_id)).size).toBe(3);
    expect(wrangler.triggers.crons).toEqual(['17 3 * * *']);
    expect(wrangler.observability.logs).toMatchObject({enabled:true,invocation_logs:false});
    expect(packageJson.scripts['deploy:production']).toBe('npm run db:migrate && wrangler deploy');
  });
});
