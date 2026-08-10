import { errors } from '../domain/errors';
import type { ClientRepository } from '../repositories/client-repository';
import type { DnsRecordGateway } from '../repositories/dns-record-gateway';
import { sourceIp } from '../services/ip-service';
import { verifyToken } from '../services/token-service';
import { bearerToken } from '../utils/http';

type DdnsFailureStage = 'record_claim' | 'record_lookup' | 'record_create' | 'record_validate' | 'record_bind' | 'record_get' | 'record_update';

function failureCategory(stage: DdnsFailureStage): string {
  if (stage === 'record_claim' || stage === 'record_bind') return 'D1_ERROR';
  if (stage === 'record_validate') return 'DNS_RESPONSE_INVALID';
  return 'DNS_PROVIDER_ERROR';
}

function failureCode(stage: DdnsFailureStage): string {
  return `DNS_${stage.toUpperCase()}_FAILED`;
}

export class DdnsUpdateUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly dns: DnsRecordGateway,
    private readonly allowPrivate: boolean,
    private readonly clientRateLimit: (clientId: string) => Promise<void> = async () => undefined,
  ) {}
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
    await this.clientRateLimit(client.id);
    const ip = sourceIp(request, client.recordType, this.allowPrivate);
    if (!ip) throw errors.badRequest('No valid public source IP');
    const now = new Date().toISOString();
    let oldIp: string | null = null;
    let updated = false;
    let failureStage: DdnsFailureStage = 'record_get';
    try {
      let activeClient = client;
      let provisioned = false;
      let created = false;
      let record;
      if (!activeClient.recordId) {
        failureStage = 'record_claim';
        const claimId = crypto.randomUUID();
        const staleBefore = new Date(Date.now() - 60_000).toISOString();
        const claimed = await this.clients.claimRecordProvisioning(activeClient.id, claimId, now, staleBefore);
        if (!claimed) {
          const refreshed = await this.clients.findById(activeClient.id);
          if (!refreshed?.recordId) throw errors.dnsFailure();
          activeClient = refreshed;
        } else {
          try {
            failureStage = 'record_lookup';
            const matches = await this.dns.findRecords(activeClient.zoneId, activeClient.zoneName, activeClient.recordName, activeClient.recordType);
            if (matches.length > 1) throw errors.dnsFailure();
            record = matches[0];
            if (!record) {
              failureStage = 'record_create';
              record = await this.dns.create(activeClient.zoneId, activeClient.zoneName, activeClient.recordName, activeClient.recordType, ip);
              created = true;
            }
            failureStage = 'record_validate';
            if (record.zoneId !== activeClient.zoneId || record.zoneName !== activeClient.zoneName || record.name !== activeClient.recordName || record.type !== activeClient.recordType) throw errors.dnsFailure();
            failureStage = 'record_bind';
            const bound = await this.clients.bindProvisionedRecord(activeClient.id, claimId, { id:record.id, zoneName:record.zoneName, name:record.name, type:record.type });
            if (!bound) throw errors.dnsFailure();
            activeClient = bound;
            provisioned = true;
          } catch (error) {
            await this.clients.releaseRecordProvisioning(activeClient.id, claimId).catch(() => undefined);
            throw error;
          }
        }
      }
      failureStage = 'record_get';
      record ??= await this.dns.getRecord(activeClient.zoneId, activeClient.zoneName, activeClient.recordId!);
      failureStage = 'record_validate';
      if (record.id !== activeClient.recordId || record.zoneId !== activeClient.zoneId || record.name !== activeClient.recordName || record.type !== activeClient.recordType) throw errors.dnsFailure();
      oldIp = created ? null : record.content;
      updated = provisioned || oldIp !== ip;
      if (!created && oldIp !== ip) {
        failureStage = 'record_update';
        await this.dns.update(record, ip);
      }
    } catch {
      console.error({ event:'ddns_update_failed', stage:failureStage, category:failureCategory(failureStage) });
      await Promise.allSettled([
        this.clients.updateStatus(client.id, { ip: client.lastIp ?? ip, sourceIp: ip, status: 'failed', updatedAt: now }),
        this.clients.addLog({ id: crypto.randomUUID(), clientId: client.id, sourceIp: ip, oldIp, newIp: ip, updated: false, status: 'failed', errorCode: failureCode(failureStage), createdAt: now }),
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
