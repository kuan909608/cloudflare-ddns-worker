import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAudited } from '../src/application/admin-audit';

describe('admin operation audit', () => {
  afterEach(() => vi.restoreAllMocks());
  it('fails closed before mutation when the audit intent cannot be stored', async () => {
    const audit = vi.fn(async () => { throw new Error('D1 unavailable'); });
    const operation = vi.fn(async () => ({ id:'client', token:'one-time' }));
    await expect(runAudited({ audit }, 'admin@example.com', 'client.rotate-token', operation, (value) => value.id, 'client')).rejects.toThrow('D1 unavailable');
    expect(operation).not.toHaveBeenCalled();
  });

  it('returns a successful one-time result when only audit completion is unavailable', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const audit = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('D1 unavailable'));
    const result = await runAudited({ audit }, 'admin@example.com', 'client.rotate-token', async () => ({ id:'client', token:'one-time' }), (value) => value.id, 'client');
    expect(result.token).toBe('one-time');
    expect(audit).toHaveBeenNthCalledWith(1, 'admin@example.com', 'client.rotate-token', 'client', 'started');
    expect(audit).toHaveBeenCalledWith('admin@example.com', 'client.rotate-token', 'client', 'success');
    expect(errorLog).toHaveBeenCalledWith({event:'admin_audit_completion_failed',severity:'high',action:'client.rotate-token',result:'success'});
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('admin@example.com');
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('one-time');
  });

  it('records a failed operation and preserves the original error', async () => {
    const audit = vi.fn(async () => undefined);
    const failure = new Error('conflict');
    await expect(runAudited({ audit }, 'admin@example.com', 'client.update', async () => { throw failure; }, () => 'client', 'client')).rejects.toBe(failure);
    expect(audit).toHaveBeenCalledWith('admin@example.com', 'client.update', 'client', 'started');
    expect(audit).toHaveBeenCalledWith('admin@example.com', 'client.update', 'client', 'failure');
  });

  it('logs a sanitized high-priority event when failure completion cannot be stored', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const audit = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('secret database detail'));
    await expect(runAudited({ audit }, 'admin@example.com', 'client.update', async () => { throw new Error('original'); }, () => 'client', 'client')).rejects.toThrow('original');
    expect(errorLog).toHaveBeenCalledWith({event:'admin_audit_completion_failed',severity:'high',action:'client.update',result:'failure'});
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('secret database detail');
  });
});
