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

export interface DnsZone {
  id: string;
  name: string;
}

export interface DnsRecordGateway {
  getZone(zoneId: string): Promise<DnsZone>;
  getRecord(zoneId: string, recordId: string): Promise<DnsRecord>;
  findRecords(zoneId: string, name: string, type: RecordType): Promise<DnsRecord[]>;
  create(zoneId: string, name: string, type: RecordType, content: string): Promise<DnsRecord>;
  update(record: DnsRecord, content: string): Promise<void>;
}
