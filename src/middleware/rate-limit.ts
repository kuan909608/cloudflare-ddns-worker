import { errors } from '../domain/errors';

export async function enforceRateLimit(limiter: RateLimit, key: string): Promise<void> {
  const result = await limiter.limit({ key });
  if (!result.success) throw errors.rateLimited();
}
