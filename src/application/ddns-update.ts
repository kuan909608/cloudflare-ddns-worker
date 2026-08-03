import { errors } from '../domain/errors';
import type { ClientRepository } from '../repositories/client-repository';
import type { CloudflareDnsService } from '../services/cloudflare-dns-service';
import { sourceIp } from '../services/ip-service';
import { verifyToken } from '../services/token-service';
import { bearerToken } from '../utils/http';

export class DdnsUpdateUseCase {
  constructor(private readonly clients: ClientRepository, private readonly dns: CloudflareDnsService, private readonly allowPrivate: boolean, private readonly rateLimit: (clientId: string) => Promise<void> = async () => undefined) {}
  async execute(slug: string, request: Request): Promise<{ updated: boolean; clientId: string }> {
    const token = bearerToken(request);
    if (!token) throw errors.unauthorized();
    return this.executeWithToken(slug, request, token);
  }
  async executeWithToken(slug: string, request: Request, token: string): Promise<{ updated: boolean; clientId: string; ip: string }> {
    const client = await this.clients.findBySlug(slug);
    if (!client) throw errors.unauthorized();
    if (!client.enabled) throw errors.disabled();
    if (!(await verifyToken(token, client.tokenHash))) throw errors.unauthorized();
    await this.rateLimit(client.id);
    const ip = sourceIp(request, client.recordType, this.allowPrivate);
    if (!ip) throw errors.badRequest('No valid public source IP');
    const now = new Date().toISOString();
    let oldIp: string | null = null;
    try {
      const record = await this.dns.getRecord(client.zoneId, client.recordId);
      if (record.name !== client.recordName || record.type !== client.recordType || record.zoneId !== client.zoneId) throw errors.dnsFailure();
      oldIp = record.content;
      const updated = oldIp !== ip;
      if (updated) await this.dns.update(record, ip);
      const status = updated ? 'updated' : 'unchanged';
      await this.clients.updateStatus(client.id, { ip, sourceIp: ip, status, updatedAt: now });
      await this.clients.addLog({ id: crypto.randomUUID(), clientId: client.id, sourceIp: ip, oldIp, newIp: ip, updated, status, errorCode: null, createdAt: now });
      return { updated, clientId: client.id, ip };
    } catch {
      await this.clients.updateStatus(client.id, { ip: client.lastIp ?? ip, sourceIp: ip, status: 'failed', updatedAt: now }).catch(() => undefined);
      await this.clients.addLog({ id: crypto.randomUUID(), clientId: client.id, sourceIp: ip, oldIp, newIp: ip, updated: false, status: 'failed', errorCode: 'DNS_UPDATE_FAILED', createdAt: now }).catch(() => undefined);
      throw errors.dnsFailure();
    }
  }
}
