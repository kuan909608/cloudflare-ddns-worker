import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('deployment and API documentation consistency', () => {
  it('documents the real zero-byte curl contract without a request body flag', async () => {
    const readme = await readFile('README.md', 'utf8');
    const openapi = await readFile('docs/openapi.yaml', 'utf8');
    const curl = readme.match(/curl --fail-with-body -X POST[\s\S]*?```/u)?.[0] ?? '';
    expect(curl).toContain("-H 'Authorization: Bearer");
    expect(curl).not.toMatch(/(?:--data|-d\s)/u);
    expect(openapi).toContain('Requires a true zero-byte request body');
  });

  it('does not claim secrets.required blocks deployment and documents fail-closed UniFi', async () => {
    const readme = await readFile('README.md', 'utf8');
    expect(readme).toContain('`secrets.required` 只提供 Wrangler 型別／開發提示，不會驗證遠端 secret，也不會阻止 deploy');
    expect(readme).toContain('只有 `ENABLE_UNIFI_COMPAT=true` 才會啟用');
  });
});
