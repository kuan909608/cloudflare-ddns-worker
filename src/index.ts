import { runLogRetention } from './application/log-retention';
import { D1ClientRepository } from './infrastructure/d1-client-repository';
import { route } from './interfaces/router';
import type { Env } from './types';

export default {
  fetch(request: Request, env: Env): Promise<Response> { return route(request, env); },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    try {
      await runLogRetention(new D1ClientRepository(env.DDNS_DB), env.LOG_RETENTION_DAYS);
    } catch {
      console.error({ event:'log_retention_failed', severity:'high' });
      throw new Error('Log retention failed');
    }
  },
} satisfies ExportedHandler<Env>;
