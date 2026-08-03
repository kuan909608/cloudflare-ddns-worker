import { z } from 'zod';
import { errors } from '../domain/errors';
import type { Client, PublicClient } from '../domain/models';
import type { ClientRepository } from '../repositories/client-repository';
import type { CloudflareDnsService } from '../services/cloudflare-dns-service';
import { generateToken } from '../services/token-service';

export const clientInputSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,62}$/u),
  zoneId: z.string().trim().min(16).max(64),
  zoneName: z.string().trim().min(3).max(253),
  recordId: z.string().trim().min(16).max(64),
  recordName: z.string().trim().min(3).max(253),
  recordType: z.enum(['A', 'AAAA']),
}).strict();

const recordInputSchema = clientInputSchema.pick({ zoneId: true, zoneName: true, recordId: true, recordName: true, recordType: true });

export type ClientInput = z.infer<typeof clientInputSchema>;
const recordFields = (input: ClientInput) => ({ zoneId: input.zoneId, zoneName: input.zoneName, recordId: input.recordId, recordName: input.recordName, recordType: input.recordType });
export function publicClient(client: Client): PublicClient {
  const { tokenHash: _, ...safe } = client;
  return { ...safe, tokenConfigured: true };
}

export class AdminClientsUseCase {
  constructor(private readonly repository: ClientRepository, private readonly dns: CloudflareDnsService) {}
  async validate(raw: unknown) {
    const parsed = recordInputSchema.safeParse(raw); if (!parsed.success) throw errors.badRequest('Invalid record fields');
    const input = parsed.data;
    const record = await this.dns.getRecord(input.zoneId, input.recordId);
    if (record.zoneName !== input.zoneName || record.name !== input.recordName || record.type !== input.recordType) throw errors.badRequest('Cloudflare record does not match');
    return record;
  }
  async create(raw: unknown): Promise<{ client: PublicClient; token: string }> {
    const parsed = clientInputSchema.safeParse(raw); if (!parsed.success) throw errors.badRequest('Invalid client fields');
    await this.validate(recordFields(parsed.data));
    const credentials = await generateToken(); const now = new Date().toISOString();
    try {
      const client = await this.repository.create({ id: crypto.randomUUID(), ...parsed.data, enabled: true, tokenHash: credentials.hash, now });
      return { client: publicClient(client), token: credentials.token };
    } catch { throw errors.conflict('Slug or DNS record already exists'); }
  }
  async update(id: string, raw: unknown): Promise<PublicClient> {
    const parsed = clientInputSchema.safeParse(raw); if (!parsed.success) throw errors.badRequest('Invalid client fields');
    if (!(await this.repository.findById(id))) throw errors.notFound();
    await this.validate(recordFields(parsed.data));
    try { return publicClient((await this.repository.update(id, parsed.data))!); } catch { throw errors.conflict('Slug or DNS record already exists'); }
  }
  async rotate(id: string): Promise<{ client: PublicClient; token: string }> {
    if (!(await this.repository.findById(id))) throw errors.notFound();
    const credentials = await generateToken(); const client = await this.repository.rotateToken(id, credentials.hash, new Date().toISOString());
    return { client: publicClient(client!), token: credentials.token };
  }
}
