import type { RecordType } from '../domain/models';

export interface DnsRecord {
  id: string;
  zoneId: string;
  zoneName: string;
  name: string;
  type: RecordType;
  content: string;
  ttl: number;
  proxied?: boolean;
}

export interface DnsRecordGateway {
  getRecord(zoneId: string, recordId: string): Promise<DnsRecord>;
  update(record: DnsRecord, content: string): Promise<void>;
}
