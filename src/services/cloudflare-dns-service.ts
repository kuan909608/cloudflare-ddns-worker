import { errors } from '../domain/errors';
import type { RecordType } from '../domain/models';

interface ApiEnvelope<T> { success: boolean; result: T; }
export interface DnsRecord { id: string; zoneId: string; zoneName: string; name: string; type: RecordType; content: string; ttl: number; proxied?: boolean; }

export class CloudflareDnsService {
  constructor(private readonly token: string) {}
  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, signal: AbortSignal.timeout(8_000), headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', ...init.headers } });
    if (!response.ok) throw errors.dnsFailure();
    const body = await response.json<ApiEnvelope<T>>();
    if (!body.success) throw errors.dnsFailure();
    return body.result;
  }
  async getRecord(zoneId: string, recordId: string): Promise<DnsRecord> {
    const record = await this.call<{ id: string; zone_id: string; zone_name: string; name: string; type: string; content: string; ttl: number; proxied?: boolean }>(`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`);
    if (record.type !== 'A' && record.type !== 'AAAA') throw errors.badRequest('Record must be A or AAAA');
    return { id: record.id, zoneId: record.zone_id, zoneName: record.zone_name, name: record.name, type: record.type, content: record.content, ttl: record.ttl, ...(record.proxied === undefined ? {} : { proxied: record.proxied }) };
  }
  async update(record: DnsRecord, content: string): Promise<void> {
    await this.call(`/zones/${encodeURIComponent(record.zoneId)}/dns_records/${encodeURIComponent(record.id)}`, { method: 'PATCH', body: JSON.stringify({ type: record.type, name: record.name, content, ttl: record.ttl, ...(record.proxied === undefined ? {} : { proxied: record.proxied }) }) });
  }
}
