import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_LOG_RETENTION_DAYS, LOG_RETENTION_BATCH_SIZE, logRetentionDays, pruneLogBatches } from '../src/application/log-retention';
import { D1ClientRepository } from '../src/infrastructure/d1-client-repository';
import worker from '../src/index';
import type { Env } from '../src/types';

describe('log retention', () => {
  it('uses one bounded retention setting with a documented default', () => {
    expect(logRetentionDays(undefined)).toBe(DEFAULT_LOG_RETENTION_DAYS);
    expect(logRetentionDays('30')).toBe(30);
    expect(() => logRetentionDays('0')).toThrow('LOG_RETENTION_DAYS');
    expect(() => logRetentionDays('forever')).toThrow('LOG_RETENTION_DAYS');
  });

  it('runs bounded batches until both log tables are below the batch size', async () => {
    const pruneLogsBefore = vi.fn()
      .mockResolvedValueOnce({updateLogs:LOG_RETENTION_BATCH_SIZE,adminAuditLogs:4})
      .mockResolvedValueOnce({updateLogs:12,adminAuditLogs:0});
    await expect(pruneLogBatches({pruneLogsBefore}, '2026-01-01T00:00:00.000Z')).resolves.toEqual({
      updateLogs:LOG_RETENTION_BATCH_SIZE + 12,
      adminAuditLogs:4,
    });
    expect(pruneLogsBefore).toHaveBeenCalledTimes(2);
    expect(pruneLogsBefore).toHaveBeenCalledWith('2026-01-01T00:00:00.000Z', LOG_RETENTION_BATCH_SIZE);
  });

  it('deletes both tables by indexed cutoff in one D1 batch', async () => {
    const statements:{sql:string;args:unknown[]}[]=[];
    const prepare=vi.fn((sql:string)=>({bind:vi.fn((...args:unknown[])=>{const statement={sql,args};statements.push(statement);return statement;})}));
    const batch=vi.fn(async()=>[{meta:{changes:3}},{meta:{changes:2}}]);
    const repository = new D1ClientRepository({prepare,batch} as unknown as D1Database);
    await expect(repository.pruneLogsBefore('2026-01-01T00:00:00.000Z', 500)).resolves.toEqual({updateLogs:3,adminAuditLogs:2});
    expect(batch).toHaveBeenCalledTimes(1);
    expect(statements).toHaveLength(2);
    expect(statements.every((statement)=>statement.sql.includes('created_at < ?') && statement.sql.includes('LIMIT ?'))).toBe(true);
    expect(statements.every((statement)=>statement.args[1] === 500)).toBe(true);
  });

  it('wires scheduled retention and reports failures as high priority', async () => {
    const prepare=vi.fn((sql:string)=>({bind:vi.fn((...args:unknown[])=>({sql,args}))}));
    const batch=vi.fn(async()=>[{meta:{changes:0}},{meta:{changes:0}}]);
    const info=vi.spyOn(console,'info').mockImplementation(()=>undefined);
    const error=vi.spyOn(console,'error').mockImplementation(()=>undefined);
    const env={DDNS_DB:{prepare,batch},LOG_RETENTION_DAYS:'30'} as unknown as Env;
    await expect(worker.scheduled({} as ScheduledController,env)).resolves.toBeUndefined();
    expect(info).toHaveBeenCalledWith(expect.objectContaining({event:'log_retention_completed',retentionDays:30}));

    batch.mockRejectedValueOnce(new Error('D1 unavailable'));
    await expect(worker.scheduled({} as ScheduledController,env)).rejects.toThrow('Log retention failed');
    expect(error).toHaveBeenCalledWith({event:'log_retention_failed',severity:'high'});
  });
});
