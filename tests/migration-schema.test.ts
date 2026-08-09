import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('D1 migration schema', () => {
  it('indexes the rate-limit expiry column used by cleanup', async () => {
    const migration = await readFile(resolve('migrations/0001_initial.sql'), 'utf8');

    expect(migration).toMatch(/CREATE INDEX \w+ ON rate_limit_windows\(window_start\);/u);
  });

  it('indexes the global update log ordering used by the admin Logs page', async () => {
    const migration = await readFile(resolve('migrations/0003_global_update_log_index.sql'), 'utf8');

    expect(migration).toMatch(/CREATE INDEX \w+ ON update_logs\(created_at DESC\);/u);
  });
});
