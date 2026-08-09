import { AppError, errors } from '../domain/errors';
import type { DnsRecord, DnsRecordGateway } from '../repositories/dns-record-gateway';
import type { RecordType } from '../domain/models';

interface ApiEnvelope<T> {
  success: boolean;
  result: T;
  errors?: Array<{ code?: number | string }>;
  result_info?: { page?: number; total_pages?: number };
}

interface RecordResponse {
  id: string;
  name: string;
  type: string;
  content: string;
  ttl: number;
  proxied?: boolean;
}

type CloudflareOperation = 'zone_get' | 'record_list' | 'record_get' | 'record_create' | 'record_update';

const MAX_ATTEMPTS = 3;
const MAX_INLINE_RETRY_DELAY_MS = 2_000;
const BASE_RETRY_DELAY_MS = 100;

export interface CloudflareRecordOption { id: string; name: string; type: 'A' | 'AAAA'; content: string; }

class CloudflareApiError extends AppError {
  constructor(
    public readonly operation: CloudflareOperation,
    public readonly providerStatus: number | null,
    public readonly providerCode: number | string | null,
    public readonly requestId: string | null,
    public readonly retryable: boolean,
    public readonly retryAfterMs: number | null,
  ) {
    super(502, 'DNS update failed', 'DNS_UPDATE_FAILED');
  }
}

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get('Retry-After')?.trim();
  if (!value) return null;
  if (/^\d+$/u.test(value)) return Number(value) * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class CloudflareDnsService implements DnsRecordGateway {
  constructor(private readonly token: string) {}

  private retryDelay(error: CloudflareApiError, attempt: number): number | null {
    if (error.retryAfterMs !== null) return error.retryAfterMs <= MAX_INLINE_RETRY_DELAY_MS ? error.retryAfterMs : null;
    const ceiling = Math.min(BASE_RETRY_DELAY_MS * (2 ** attempt), MAX_INLINE_RETRY_DELAY_MS);
    return Math.floor(Math.random() * (ceiling + 1));
  }

  private logAttempt(error: CloudflareApiError, attempt: number, willRetryInline: boolean): void {
    console.error({
      event: 'cloudflare_api_attempt_failed',
      operation: error.operation,
      status: error.providerStatus,
      providerCode: error.providerCode,
      requestId: error.requestId,
      retryable: error.retryable,
      attempt,
      willRetryInline,
    });
  }

  private async request<T>(operation: CloudflareOperation, path: string, init: RequestInit = {}, maxAttempts = MAX_ATTEMPTS): Promise<ApiEnvelope<T>> {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let failure: CloudflareApiError;
      try {
        const headers = new Headers(init.headers);
        headers.set('Authorization', `Bearer ${this.token}`);
        headers.set('Content-Type', 'application/json');
        const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers, signal: AbortSignal.timeout(8_000) });
        const body = await response.json<ApiEnvelope<T>>().catch(() => null);
        if (response.ok && body?.success) return body;
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        failure = new CloudflareApiError(
          operation,
          response.status,
          body?.errors?.[0]?.code ?? (body ? null : 'INVALID_RESPONSE'),
          response.headers.get('CF-Ray') ?? response.headers.get('X-Request-ID'),
          retryable,
          retryAfterMs(response),
        );
      } catch (error) {
        if (error instanceof CloudflareApiError) throw error;
        failure = new CloudflareApiError(operation, null, 'NETWORK_ERROR', null, true, null);
      }

      const delay = failure.retryable && attempt < maxAttempts ? this.retryDelay(failure, attempt) : null;
      this.logAttempt(failure, attempt, delay !== null);
      if (delay === null) throw failure;
      await sleep(delay);
    }
    throw errors.dnsFailure();
  }

  private async call<T>(operation: CloudflareOperation, path: string, init: RequestInit = {}, maxAttempts = MAX_ATTEMPTS): Promise<T> {
    return (await this.request<T>(operation, path, init, maxAttempts)).result;
  }

  private async listAll<T>(operation: CloudflareOperation, path: string, perPage: number): Promise<T[]> {
    const values: T[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const separator = path.includes('?') ? '&' : '?';
      const response = await this.request<T[]>(operation, `${path}${separator}page=${page}&per_page=${perPage}`);
      values.push(...response.result);
      if (page >= (response.result_info?.total_pages ?? 1)) return values;
    }
    throw errors.dnsFailure();
  }

  private record(response: RecordResponse, zoneId: string, zoneName: string, expectedType?: RecordType): DnsRecord {
    if ((response.type !== 'A' && response.type !== 'AAAA') || (expectedType && response.type !== expectedType)) throw errors.dnsFailure();
    return {
      id: response.id,
      zoneId,
      zoneName,
      name: response.name,
      type: response.type,
      content: response.content,
      ttl: response.ttl,
      ...(response.proxied === undefined ? {} : { proxied: response.proxied }),
    };
  }

  async getZone(zoneId: string): Promise<{ id:string; name:string }> {
    const zone = await this.call<{ id:string; name:string }>('zone_get', `/zones/${encodeURIComponent(zoneId)}`);
    const name = zone.name?.toLowerCase().replace(/\.$/u, '');
    if (zone.id !== zoneId || !name || name.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(name)) throw errors.dnsFailure();
    return { id:zone.id, name };
  }

  async listRecords(zoneId: string): Promise<CloudflareRecordOption[]> {
    const records = await this.listAll<RecordResponse>('record_list', `/zones/${encodeURIComponent(zoneId)}/dns_records?order=name&direction=asc`, 1000);
    return records
      .filter((record): record is RecordResponse & { type: 'A' | 'AAAA' } => record.type === 'A' || record.type === 'AAAA')
      .map(({ id, name, type, content }) => ({ id, name, type, content }));
  }

  async getRecord(zoneId: string, zoneName: string, recordId: string): Promise<DnsRecord> {
    const response = await this.call<RecordResponse>('record_get', `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`);
    if (response.id !== recordId) throw errors.dnsFailure();
    return this.record(response, zoneId, zoneName);
  }

  async findRecords(zoneId: string, zoneName: string, name: string, type: RecordType): Promise<DnsRecord[]> {
    const query = new URLSearchParams({ name, type, match:'all' });
    const records = await this.listAll<RecordResponse>('record_list', `/zones/${encodeURIComponent(zoneId)}/dns_records?${query}`, 100);
    return records
      .filter((record): record is RecordResponse & { type: RecordType } => record.type === type && record.name === name)
      .map((record) => this.record(record, zoneId, zoneName, type));
  }

  private async createOnce(zoneId: string, zoneName: string, name: string, type: RecordType, content: string): Promise<DnsRecord> {
    const response = await this.call<RecordResponse>('record_create', `/zones/${encodeURIComponent(zoneId)}/dns_records`, {
      method:'POST', body:JSON.stringify({ name, type, content, ttl:1, proxied:false }),
    }, 1);
    if (response.name !== name) throw errors.dnsFailure();
    return this.record(response, zoneId, zoneName, type);
  }

  async create(zoneId: string, zoneName: string, name: string, type: RecordType, content: string): Promise<DnsRecord> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        return await this.createOnce(zoneId, zoneName, name, type, content);
      } catch (error) {
        if (!(error instanceof CloudflareApiError) || !error.retryable) throw error;
        const delay = this.retryDelay(error, attempt);
        if (delay === null) throw error;
        console.error({ event:'cloudflare_record_create_recovery', attempt, action:'requery_before_retry' });
        await sleep(delay);
        const matches = await this.findRecords(zoneId, zoneName, name, type);
        if (matches.length > 1) throw errors.dnsFailure();
        if (matches[0]) {
          if (matches[0].content !== content) await this.update(matches[0], content);
          return { ...matches[0], content };
        }
        if (attempt === 2) throw error;
      }
    }
    throw errors.dnsFailure();
  }

  async update(record: DnsRecord, content: string): Promise<void> {
    await this.call('record_update', `/zones/${encodeURIComponent(record.zoneId)}/dns_records/${encodeURIComponent(record.id)}`, {
      method:'PATCH',
      body:JSON.stringify({ type:record.type, name:record.name, content, ttl:record.ttl, ...(record.proxied === undefined ? {} : { proxied:record.proxied }) }),
    });
  }
}
