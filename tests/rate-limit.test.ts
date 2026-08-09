import { describe, expect, it, vi } from 'vitest';
import { enforceRateLimit } from '../src/middleware/rate-limit';

describe('rate limiting', () => {
  it('uses parameterized D1 windows and prunes expired entries', async () => {
    const run=vi.fn(async()=>({}));
    const first=vi.fn(async()=>({request_count:11}));
    const bind=vi.fn((..._args:unknown[])=>({run,first}));
    const prepare=vi.fn((_sql:string)=>({bind}));
    await expect(enforceRateLimit({prepare}as unknown as D1Database,'admin@example.com',10)).rejects.toMatchObject({status:429});
    expect(bind).toHaveBeenCalledWith('admin@example.com',expect.any(Number));
    expect(prepare).toHaveBeenCalledWith('DELETE FROM rate_limit_windows WHERE window_start < ?');
  });

  it('reports an uninitialized remote D1 without exposing table names', async () => {
    const run=vi.fn(async()=>{throw new Error('D1_ERROR: no such table: rate_limit_windows');});
    const bind=vi.fn(()=>({run}));
    const prepare=vi.fn(()=>({bind}));

    await expect(enforceRateLimit({prepare}as unknown as D1Database,'admin@example.com',10)).rejects.toMatchObject({
      status:503,
      message:'Database schema is not initialized',
      code:'D1_SCHEMA_MISSING',
    });
  });
});
