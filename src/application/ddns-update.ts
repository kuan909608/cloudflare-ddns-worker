import { errors } from '../domain/errors';
import type { ClientRepository } from '../repositories/client-repository';
import type { DnsRecordGateway } from '../repositories/dns-record-gateway';
import { sourceIp } from '../services/ip-service';
import { verifyToken } from '../services/token-service';
import { bearerToken } from '../utils/http';

export class DdnsUpdateUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly dns: DnsRecordGateway,
    private readonly allowPrivate: boolean,
    private readonly preAuthRateLimit: (request: Request, slug: string) => Promise<void> = async () => undefined,
    private readonly clientRateLimit: (clientId: string) => Promise<void> = async () => undefined,
  ) {}
  async execute(slug: string, request: Request): Promise<{ updated: boolean; clientId: string }> {
    const token = bearerToken(request);
    if (!token) throw errors.unauthorized();
    return this.executeWithToken(slug, request, token);
  }
  async executeWithToken(slug: string, request: Request, token: string): Promise<{ updated: boolean; clientId: string; ip: string }> {
    await this.preAuthRateLimit(request, slug);
    const client = await this.clients.findBySlug(slug);
    if (!client) throw errors.unauthorized();
    if (!client.enabled) throw errors.disabled();
    if (!(await verifyToken(token, client.tokenHash))) throw errors.unauthorized();
    await this.clientRateLimit(client.id);
    const ip = sourceIp(request, client.recordType, this.allowPrivate);
    if (!ip) throw errors.badRequest('No valid public source IP');
    const now = new Date().toISOString();
    let oldIp: string | null = null;
    let updated = false;
    try {
      const record = await this.dns.getRecord(client.zoneId, client.recordId);
      if (record.id !== client.recordId || record.zoneId !== client.zoneId || record.name !== client.recordName || record.type !== client.recordType) throw errors.dnsFailure();
      oldIp = record.content;
      updated = oldIp !== ip;
      if (updated) await this.dns.update(record, ip);
    } catch {
      await Promise.allSettled([
        this.clients.updateStatus(client.id, { ip: client.lastIp ?? ip, sourceIp: ip, status: 'failed', updatedAt: now }),
        this.clients.addLog({ id: crypto.randomUUID(), clientId: client.id, sourceIp: ip, oldIp, newIp: ip, updated: false, status: 'failed', errorCode: 'DNS_UPDATE_FAILED', createdAt: now }),
      ]);
      throw errors.dnsFailure();
    }
    const status = updated ? 'updated' : 'unchanged';
    const persistence = await Promise.allSettled([
      this.clients.updateStatus(client.id, { ip, sourceIp: ip, status, updatedAt: now }),
      this.clients.addLog({ id: crypto.randomUUID(), clientId: client.id, sourceIp: ip, oldIp, newIp: ip, updated, status, errorCode: null, createdAt: now }),
    ]);
    if (persistence.some((result) => result.status === 'rejected')) console.error('DDNS_STATE_PERSISTENCE_FAILED');
    return { updated, clientId: client.id, ip };
  }
}
