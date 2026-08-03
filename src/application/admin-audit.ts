export interface AuditWriter {
  audit(email: string, action: string, targetId: string | null, result: string): Promise<void>;
}

export async function runAudited<T>(
  writer: AuditWriter,
  email: string,
  action: string,
  operation: () => Promise<T>,
  successTarget: (result: T) => string | null,
  failureTarget: string | null = null,
): Promise<T> {
  await writer.audit(email, action, failureTarget, 'started');
  try {
    const result = await operation();
    await writer.audit(email, action, successTarget(result), 'success').catch(() => undefined);
    return result;
  } catch (error) {
    await writer.audit(email, action, failureTarget, 'failure').catch(() => undefined);
    throw error;
  }
}
