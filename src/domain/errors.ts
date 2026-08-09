export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

export const errors = {
  badRequest: (message = 'Bad request') => new AppError(400, message, 'BAD_REQUEST'),
  unauthorized: () => new AppError(401, 'Unauthorized', 'UNAUTHORIZED'),
  forbidden: () => new AppError(403, 'Forbidden', 'FORBIDDEN'),
  disabled: () => new AppError(403, 'Client disabled', 'CLIENT_DISABLED'),
  notFound: () => new AppError(404, 'Not found', 'NOT_FOUND'),
  conflict: (message = 'Conflict') => new AppError(409, message, 'CONFLICT'),
  tooLarge: () => new AppError(413, 'Request body too large', 'BODY_TOO_LARGE'),
  unsupportedMedia: () => new AppError(415, 'Content-Type must be application/json', 'UNSUPPORTED_MEDIA_TYPE'),
  rateLimited: () => new AppError(429, 'Too many requests', 'RATE_LIMITED'),
  databaseNotInitialized: () => new AppError(503, 'Database schema is not initialized', 'D1_SCHEMA_MISSING'),
  dnsFailure: () => new AppError(502, 'DNS update failed', 'DNS_UPDATE_FAILED'),
  dnsZoneNotConfigured: () => new AppError(500, 'DNS Zone is not configured', 'DNS_ZONE_NOT_CONFIGURED'),
};
