import { errors } from '../domain/errors';

export async function enforceRateLimit(db: D1Database, key: string, limit: number): Promise<void> {
  const windowStart = Math.floor(Date.now() / 60_000) * 60_000;
  await db.prepare(`INSERT INTO rate_limit_windows (bucket_key, window_start, request_count) VALUES (?, ?, 1)
    ON CONFLICT(bucket_key, window_start) DO UPDATE SET request_count=request_count+1`).bind(key, windowStart).run();
  await db.prepare('DELETE FROM rate_limit_windows WHERE window_start < ?').bind(windowStart - 120_000).run().catch(() => undefined);
  const row = await db.prepare('SELECT request_count FROM rate_limit_windows WHERE bucket_key=? AND window_start=?').bind(key, windowStart).first<{ request_count: number }>();
  if ((row?.request_count ?? limit + 1) > limit) throw errors.rateLimited();
}
