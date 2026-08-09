import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { build } from 'vite';

describe('frontend production build', () => {
  it('emits every referenced admin asset at its public URL path', async () => {
    await build({ configFile:resolve('frontend/vite.config.ts'), logLevel:'silent' });
    const html = await readFile(resolve('dist/admin/index.html'), 'utf8');
    const assetUrls = [...html.matchAll(/(?:src|href)="(\/admin\/[^"]+)"/gu)].map((match) => match[1]!);

    expect(assetUrls.length).toBeGreaterThan(0);
    for (const assetUrl of assetUrls) {
      await expect(access(resolve('dist', assetUrl.slice(1)))).resolves.toBeUndefined();
    }
  });
});
