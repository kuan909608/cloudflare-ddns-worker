import { AppError } from '../domain/errors';

function errorCategory(error: unknown): string {
  if (error instanceof AppError) return error.code;
  const detail = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : '';
  if (detail.includes('no such table')) return 'D1_SCHEMA_MISSING';
  if (detail.includes('undefined') && detail.includes('prepare')) return 'D1_BINDING_MISSING';
  if (detail.includes('d1_error') || detail.includes('sqlite')) return 'D1_ERROR';
  return 'UNEXPECTED_ERROR';
}

export function logRequestError(request: Request, pathname: string, error: unknown, status: number): void {
  console.error({
    event: 'request_error',
    method: request.method,
    pathname,
    status,
    category: errorCategory(error),
  });
}
