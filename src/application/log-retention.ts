import type { LogRetentionRepository } from '../repositories/log-retention-repository';

export const DEFAULT_LOG_RETENTION_DAYS = 90;
export const LOG_RETENTION_BATCH_SIZE = 500;
const MAX_BATCHES_PER_RUN = 20;

export function logRetentionDays(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_LOG_RETENTION_DAYS;
  if (!/^\d+$/u.test(value)) throw new Error('LOG_RETENTION_DAYS must be an integer from 1 to 3650');
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) throw new Error('LOG_RETENTION_DAYS must be an integer from 1 to 3650');
  return days;
}

export async function pruneLogBatches(
  repository: LogRetentionRepository,
  cutoff: string,
): Promise<{ updateLogs: number; adminAuditLogs: number }> {
  const deleted = { updateLogs: 0, adminAuditLogs: 0 };
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
    const result = await repository.pruneLogsBefore(cutoff, LOG_RETENTION_BATCH_SIZE);
    deleted.updateLogs += result.updateLogs;
    deleted.adminAuditLogs += result.adminAuditLogs;
    if (result.updateLogs < LOG_RETENTION_BATCH_SIZE && result.adminAuditLogs < LOG_RETENTION_BATCH_SIZE) break;
  }
  return deleted;
}

export async function runLogRetention(
  repository: LogRetentionRepository,
  configuredDays: string | undefined,
  now = new Date(),
): Promise<{ updateLogs: number; adminAuditLogs: number }> {
  const days = logRetentionDays(configuredDays);
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  const deleted = await pruneLogBatches(repository, cutoff);
  console.info({ event:'log_retention_completed', retentionDays:days, ...deleted });
  return deleted;
}
