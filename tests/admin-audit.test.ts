import { describe, expect, it, vi } from 'vitest';
import { runAudited } from '../src/application/admin-audit';

describe('admin operation audit', () => {
  it('fails closed before mutation when the audit intent cannot be stored', async () => {
    const audit = vi.fn(async () => { throw new Error('D1 unavailable'); });
    const operation = vi.fn(async () => ({ id:'client', token:'one-time' }));
    await expect(runAudited({ audit }, 'admin@example.com', 'client.rotate-token', operation, (value) => value.id, 'client')).rejects.toThrow('D1 unavailable');
    expect(operation).not.toHaveBeenCalled();
  });

  it('returns a successful one-time result when only audit completion is unavailable', async () => {
    const audit = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('D1 unavailable'));
    const result = await runAudited({ audit }, 'admin@example.com', 'client.rotate-token', async () => ({ id:'client', token:'one-time' }), (value) => value.id, 'client');
    expect(result.token).toBe('one-time');
    expect(audit).toHaveBeenNthCalledWith(1, 'admin@example.com', 'client.rotate-token', 'client', 'started');
    expect(audit).toHaveBeenCalledWith('admin@example.com', 'client.rotate-token', 'client', 'success');
  });

  it('records a failed operation and preserves the original error', async () => {
    const audit = vi.fn(async () => undefined);
    const failure = new Error('conflict');
    await expect(runAudited({ audit }, 'admin@example.com', 'client.update', async () => { throw failure; }, () => 'client', 'client')).rejects.toBe(failure);
    expect(audit).toHaveBeenCalledWith('admin@example.com', 'client.update', 'client', 'started');
    expect(audit).toHaveBeenCalledWith('admin@example.com', 'client.update', 'client', 'failure');
  });
});
