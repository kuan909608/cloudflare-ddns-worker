import { errors } from '../domain/errors';
import type { DnsRecord, DnsRecordGateway } from '../repositories/dns-record-gateway';

interface ApiEnvelope<T> {
  success: boolean;
  result: T;
  result_info?: { page?: number; total_pages?: number };
}

export interface CloudflareZoneOption { id: string; name: string; }
export interface CloudflareRecordOption { id: string; name: string; type: 'A' | 'AAAA'; content: string; }

export class CloudflareDnsService implements DnsRecordGateway {
  constructor(private readonly token: string) {}
  private async request<T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, signal: AbortSignal.timeout(8_000), headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', ...init.headers } });
    if (!response.ok) throw errors.dnsFailure();
    const body = await response.json<ApiEnvelope<T>>();
    if (!body.success) throw errors.dnsFailure();
    return body;
  }
  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    return (await this.request<T>(path, init)).result;
  }
  private async listAll<T>(path: string, perPage: number): Promise<T[]> {
    const values: T[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const separator = path.includes('?') ? '&' : '?';
      const response = await this.request<T[]>(`${path}${separator}page=${page}&per_page=${perPage}`);
      values.push(...response.result);
      if (page >= (response.result_info?.total_pages ?? 1)) return values;
    }
    throw errors.dnsFailure();
  }
  async listZones(): Promise<CloudflareZoneOption[]> {
    const zones = await this.listAll<{ id: string; name: string }>('/zones?status=active&order=name&direction=asc', 50);
    return zones.map(({ id, name }) => ({ id, name }));
  }
  async listRecords(zoneId: string): Promise<CloudflareRecordOption[]> {
    const records = await this.listAll<{ id: string; name: string; type: string; content: string }>(`/zones/${encodeURIComponent(zoneId)}/dns_records?order=name&direction=asc`, 1000);
    return records
      .filter((record): record is { id: string; name: string; type: 'A' | 'AAAA'; content: string } => record.type === 'A' || record.type === 'AAAA')
      .map(({ id, name, type, content }) => ({ id, name, type, content }));
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
