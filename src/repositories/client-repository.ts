import type { Client, UpdateLog } from '../domain/models';

export interface CreateClientRecord {
  id: string; displayName: string; slug: string; enabled: boolean;
  zoneId: string; zoneName: string; recordId: string | null; recordName: string;
  recordType: 'A' | 'AAAA'; tokenHash: string; now: string;
}

export interface ClientRepository {
  list(): Promise<Client[]>;
  findById(id: string): Promise<Client | null>;
  findBySlug(slug: string): Promise<Client | null>;
  create(input: CreateClientRecord): Promise<Client>;
  update(id: string, input: Partial<Pick<Client, 'displayName' | 'slug' | 'zoneId' | 'zoneName' | 'recordId' | 'recordName' | 'recordType'>>): Promise<Client | null>;
  claimRecordProvisioning(id: string, claimId: string, claimedAt: string, staleBefore: string): Promise<boolean>;
  bindProvisionedRecord(id: string, claimId: string, record: { id: string; zoneName: string; name: string; type: 'A' | 'AAAA' }): Promise<Client | null>;
  releaseRecordProvisioning(id: string, claimId: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<Client | null>;
  rotateToken(id: string, hash: string, now: string): Promise<Client | null>;
  updateStatus(id: string, values: { ip: string; sourceIp: string; status: string; updatedAt: string }): Promise<void>;
  remove(id: string): Promise<boolean>;
  addLog(log: UpdateLog): Promise<void>;
  logs(id: string, limit: number, offset: number): Promise<UpdateLog[]>;
  audit(email: string, action: string, targetId: string | null, result: string): Promise<void>;
  dashboard(): Promise<Record<string, number>>;
}
