export interface LogRetentionRepository {
  pruneLogsBefore(cutoff: string, batchSize: number): Promise<{ updateLogs: number; adminAuditLogs: number }>;
}
