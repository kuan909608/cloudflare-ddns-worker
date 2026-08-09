import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('production deployment configuration', () => {
  it('uses the deployed Worker name and migrates before deployment', async () => {
    const wrangler = JSON.parse(await readFile('wrangler.jsonc', 'utf8')) as { name: string };
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { scripts: Record<string, string> };

    expect(wrangler.name).toBe('cloudflare-ddns-worker');
    expect(packageJson.scripts['deploy:production']).toBe('npm run db:migrate && wrangler deploy');
  });
});
