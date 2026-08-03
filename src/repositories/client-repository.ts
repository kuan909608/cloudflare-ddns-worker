import type { Client, UpdateLog } from '../domain/models';

export interface CreateClientRecord {
  id: string; displayName: string; slug: string; enabled: boolean;
  zoneId: string; zoneName: string; recordId: string; recordName: string;
  recordType: 'A' | 'AAAA'; tokenHash: string; now: string;
}

export interface ClientRepository {
  list(): Promise<Client[]>;
  findById(id: string): Promise<Client | null>;
  findBySlug(slug: string): Promise<Client | null>;
  create(input: CreateClientRecord): Promise<Client>;
  update(id: string, input: Partial<Pick<Client, 'displayName' | 'slug' | 'zoneId' | 'zoneName' | 'recordId' | 'recordName' | 'recordType'>>): Promise<Client | null>;
  setEnabled(id: string, enabled: boolean): Promise<Client | null>;
  rotateToken(id: string, hash: string, now: string): Promise<Client | null>;
  updateStatus(id: string, values: { ip: string; sourceIp: string; status: string; updatedAt: string }): Promise<void>;
  remove(id: string): Promise<boolean>;
  addLog(log: UpdateLog): Promise<void>;
  logs(id: string, limit: number, offset: number): Promise<UpdateLog[]>;
  audit(email: string, action: string, targetId: string | null, result: string): Promise<void>;
  dashboard(): Promise<Record<string, number>>;
}
