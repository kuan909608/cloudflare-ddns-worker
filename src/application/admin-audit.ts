export interface AuditWriter {
  audit(email: string, action: string, targetId: string | null, result: string): Promise<void>;
}

function logCompletionFailure(action: string, result: 'success' | 'failure'): void {
  console.error({
    event: 'admin_audit_completion_failed',
    severity: 'high',
    action,
    result,
  });
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
    await writer.audit(email, action, successTarget(result), 'success').catch(() => logCompletionFailure(action, 'success'));
    return result;
  } catch (error) {
    await writer.audit(email, action, failureTarget, 'failure').catch(() => logCompletionFailure(action, 'failure'));
    throw error;
  }
}
