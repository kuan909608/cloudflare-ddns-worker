import { z } from 'zod';
import { errors } from '../domain/errors';
import type { Client, PublicClient } from '../domain/models';
import type { ClientRepository } from '../repositories/client-repository';
import type { DnsRecord, DnsRecordGateway } from '../repositories/dns-record-gateway';
import { generateToken } from '../services/token-service';

const baseClientInputSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,62}$/u),
});

const recordIdSchema = z.string().trim().min(16).max(64);
const hostnameSchema = z.string().trim().toLowerCase().max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u);

export const clientInputSchema = z.discriminatedUnion('bindingMode', [
  baseClientInputSchema.extend({ bindingMode:z.literal('existing'), recordId:recordIdSchema }).strict(),
  baseClientInputSchema.extend({ bindingMode:z.literal('new'), hostname:hostnameSchema, recordType:z.enum(['A', 'AAAA']) }).strict(),
]);

export type ClientInput = z.infer<typeof clientInputSchema>;
export interface FixedDnsZone { id: string; }
const isUniqueConflict = (error: unknown): boolean => error instanceof Error && /unique constraint/iu.test(error.message);

function pendingRecordName(hostname: string, zoneName: string): string {
  const value = `${hostname}.${zoneName}`;
  if (value.length > 253) throw errors.badRequest('Hostname is too long for the fixed DNS Zone');
  return value;
}

export function publicClient(client: Client, currentDnsIp: string | null = client.lastIp): PublicClient {
  const { tokenHash: _, ...safe } = client;
  return { ...safe, currentDnsIp, recordPending:client.recordId === null, tokenConfigured:true };
}

export class AdminClientsUseCase {
  constructor(private readonly repository: ClientRepository, private readonly dns: DnsRecordGateway, private readonly zone: FixedDnsZone) {}

  private matches(record: DnsRecord, client: Client): boolean {
    return record.id === client.recordId && record.zoneId === client.zoneId && record.name === client.recordName && record.type === client.recordType;
  }

  private async existingRecord(recordId: string): Promise<DnsRecord> {
    const record = await this.dns.getRecord(this.zone.id, recordId);
    if (record.id !== recordId || record.zoneId !== this.zone.id) {
      throw errors.badRequest('Cloudflare record does not match fixed DNS Zone');
    }
    return record;
  }

  async list(): Promise<PublicClient[]> {
    const clients = await this.repository.list();
    return Promise.all(clients.map(async (client) => {
      if (!client.recordId) return publicClient(client, null);
      try {
        const record = await this.dns.getRecord(client.zoneId, client.recordId);
        return publicClient(client, this.matches(record, client) ? record.content : null);
      } catch {
        return publicClient(client, null);
      }
    }));
  }

  async get(id: string): Promise<PublicClient> {
    const client = await this.repository.findById(id);
    if (!client) throw errors.notFound();
    if (!client.recordId) return publicClient(client, null);
    const record = await this.dns.getRecord(client.zoneId, client.recordId);
    if (!this.matches(record, client)) throw errors.dnsFailure();
    return publicClient(client, record.content);
  }

  async create(raw: unknown): Promise<{ client: PublicClient; token: string }> {
    const parsed = clientInputSchema.safeParse(raw);
    if (!parsed.success) throw errors.badRequest('Invalid client fields');
    const input = parsed.data;
    const record = input.bindingMode === 'existing' ? await this.existingRecord(input.recordId) : null;
    const zoneName = record?.zoneName ?? (await this.dns.getZone(this.zone.id)).name;
    const binding = input.bindingMode === 'existing'
      ? { recordId:record!.id, recordName:record!.name, recordType:record!.type }
      : { recordId:null, recordName:pendingRecordName(input.hostname, zoneName), recordType:input.recordType };
    const credentials = await generateToken();
    const now = new Date().toISOString();
    try {
      const client = await this.repository.create({
        id:crypto.randomUUID(), displayName:input.displayName, slug:input.slug, enabled:true,
        zoneId:this.zone.id, zoneName,
        ...binding,
        tokenHash:credentials.hash, now,
      });
      return { client:publicClient(client, record?.content ?? null), token:credentials.token };
    } catch (error) {
      if (isUniqueConflict(error)) throw errors.conflict('Slug or DNS record already exists');
      throw error;
    }
  }

  async update(id: string, raw: unknown): Promise<PublicClient> {
    const parsed = clientInputSchema.safeParse(raw);
    if (!parsed.success) throw errors.badRequest('Invalid client fields');
    const current = await this.repository.findById(id);
    if (!current) throw errors.notFound();
    const input = parsed.data;
    const isPending = current.recordId === null;
    if ((isPending && input.bindingMode !== 'new') || (!isPending && input.bindingMode !== 'existing')) {
      throw errors.badRequest('DNS binding mode cannot be changed after Client creation');
    }
    const record = input.bindingMode === 'existing' ? await this.existingRecord(input.recordId) : null;
    const binding = input.bindingMode === 'existing'
      ? { zoneId:record!.zoneId, zoneName:record!.zoneName, recordId:record!.id, recordName:record!.name, recordType:record!.type }
      : { recordName:pendingRecordName(input.hostname, current.zoneName), recordType:input.recordType };
    try {
      const changed = await this.repository.update(id, {
        displayName:input.displayName, slug:input.slug,
        ...binding,
      });
      return publicClient(changed!, record?.content ?? null);
    } catch (error) {
      if (isUniqueConflict(error)) throw errors.conflict('Slug or DNS record already exists');
      throw error;
    }
  }

  async rotate(id: string): Promise<{ client: PublicClient; token: string }> {
    const current = await this.get(id);
    const credentials = await generateToken();
    const client = await this.repository.rotateToken(id, credentials.hash, new Date().toISOString());
    if (!client) throw errors.notFound();
    return { client:publicClient(client, current.currentDnsIp), token:credentials.token };
  }
}
