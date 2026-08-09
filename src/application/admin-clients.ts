import { z } from 'zod';
import { errors } from '../domain/errors';
import type { Client, PublicClient } from '../domain/models';
import type { ClientRepository } from '../repositories/client-repository';
import type { DnsRecordGateway } from '../repositories/dns-record-gateway';
import { generateToken } from '../services/token-service';

export const clientInputSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,62}$/u),
  recordId: z.string().trim().min(16).max(64),
  recordName: z.string().trim().min(3).max(253),
  recordType: z.enum(['A', 'AAAA']),
}).strict();

const recordInputSchema = clientInputSchema.pick({ recordId: true, recordName: true, recordType: true });

export type ClientInput = z.infer<typeof clientInputSchema>;
export interface FixedDnsZone { id: string; name: string; }
const recordFields = (input: ClientInput) => ({ recordId: input.recordId, recordName: input.recordName, recordType: input.recordType });
const isUniqueConflict = (error: unknown): boolean => error instanceof Error && /unique constraint/iu.test(error.message);
export function publicClient(client: Client, currentDnsIp: string | null = client.lastIp): PublicClient {
  const { tokenHash: _, ...safe } = client;
  return { ...safe, currentDnsIp, tokenConfigured: true };
}

export class AdminClientsUseCase {
  constructor(private readonly repository: ClientRepository, private readonly dns: DnsRecordGateway, private readonly zone: FixedDnsZone) {}
  async list(): Promise<PublicClient[]> {
    const clients = await this.repository.list();
    return Promise.all(clients.map(async (client) => {
      try {
        const record = await this.dns.getRecord(client.zoneId, client.recordId);
        if (record.id !== client.recordId || record.zoneId !== client.zoneId || record.name !== client.recordName || record.type !== client.recordType) return publicClient(client, null);
        return publicClient(client, record.content);
      } catch {
        return publicClient(client, null);
      }
    }));
  }
  async get(id: string): Promise<PublicClient> {
    const client = await this.repository.findById(id);
    if (!client) throw errors.notFound();
    const record = await this.dns.getRecord(client.zoneId, client.recordId);
    if (record.id !== client.recordId || record.zoneId !== client.zoneId || record.name !== client.recordName || record.type !== client.recordType) throw errors.dnsFailure();
    return publicClient(client, record.content);
  }
  async validate(raw: unknown) {
    const parsed = recordInputSchema.safeParse(raw); if (!parsed.success) throw errors.badRequest('Invalid record fields');
    const input = parsed.data;
    const record = await this.dns.getRecord(this.zone.id, input.recordId);
    if (record.id !== input.recordId || record.zoneId !== this.zone.id || record.zoneName !== this.zone.name || record.name !== input.recordName || record.type !== input.recordType) throw errors.badRequest('Cloudflare record does not match fixed DNS Zone');
    return record;
  }
  async create(raw: unknown): Promise<{ client: PublicClient; token: string }> {
    const parsed = clientInputSchema.safeParse(raw); if (!parsed.success) throw errors.badRequest('Invalid client fields');
    const record = await this.validate(recordFields(parsed.data));
    const credentials = await generateToken(); const now = new Date().toISOString();
    try {
      const client = await this.repository.create({ id: crypto.randomUUID(), ...parsed.data, zoneId: this.zone.id, zoneName: this.zone.name, enabled: true, tokenHash: credentials.hash, now });
      return { client: publicClient(client, record.content), token: credentials.token };
    } catch (error) { if (isUniqueConflict(error)) throw errors.conflict('Slug or DNS record already exists'); throw error; }
  }
  async update(id: string, raw: unknown): Promise<PublicClient> {
    const parsed = clientInputSchema.safeParse(raw); if (!parsed.success) throw errors.badRequest('Invalid client fields');
    if (!(await this.repository.findById(id))) throw errors.notFound();
    const record = await this.validate(recordFields(parsed.data));
    try { return publicClient((await this.repository.update(id, { ...parsed.data, zoneId: this.zone.id, zoneName: this.zone.name }))!, record.content); } catch (error) { if (isUniqueConflict(error)) throw errors.conflict('Slug or DNS record already exists'); throw error; }
  }
  async rotate(id: string): Promise<{ client: PublicClient; token: string }> {
    const current = await this.get(id);
    const credentials = await generateToken(); const client = await this.repository.rotateToken(id, credentials.hash, new Date().toISOString());
    if (!client) throw errors.notFound();
    return { client: publicClient(client, current.currentDnsIp), token: credentials.token };
  }
}
