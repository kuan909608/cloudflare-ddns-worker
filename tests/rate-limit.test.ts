import { describe, expect, it, vi } from 'vitest';
import { enforceRateLimit } from '../src/middleware/rate-limit';

describe('rate limiting', () => {
  it('rejects a key when the edge binding exhausts its configured allowance', async () => {
    const limit=vi.fn(async()=>({success:false}));
    await expect(enforceRateLimit({limit} as RateLimit,'admin:admin@example.com')).rejects.toMatchObject({status:429});
    expect(limit).toHaveBeenCalledWith({key:'admin:admin@example.com'});
  });

  it('allows a key without touching D1 when the edge binding accepts it', async () => {
    const limit=vi.fn(async()=>({success:true}));
    await expect(enforceRateLimit({limit} as RateLimit,'ddns-preauth:8.8.8.8')).resolves.toBeUndefined();
    expect(limit).toHaveBeenCalledTimes(1);
  });
});
