import type { AdminUpdateLog, Client, UpdateLog } from '../domain/models';
import type { ClientRepository, CreateClientRecord } from '../repositories/client-repository';

type Row = Record<string, unknown>;
const text = (row: Row, key: string): string => String(row[key]);
const nullable = (row: Row, key: string): string | null => row[key] == null ? null : String(row[key]);

function mapClient(row: Row): Client {
  return {
    id: text(row, 'id'), displayName: text(row, 'display_name'), slug: text(row, 'slug'), enabled: Boolean(row.enabled),
    zoneId: text(row, 'zone_id'), zoneName: text(row, 'zone_name'), recordId: nullable(row, 'record_id'),
    recordName: text(row, 'record_name'), recordType: text(row, 'record_type') as 'A' | 'AAAA', tokenHash: text(row, 'token_hash'),
    tokenCreatedAt: text(row, 'token_created_at'), lastIp: nullable(row, 'last_ip'), lastSourceIp: nullable(row, 'last_source_ip'),
    lastStatus: nullable(row, 'last_status'), lastUpdatedAt: nullable(row, 'last_updated_at'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
  };
}

function mapLog(row: Row): UpdateLog {
  return { id: text(row, 'id'), clientId: text(row, 'client_id'), sourceIp: text(row, 'source_ip'), oldIp: nullable(row, 'old_ip'),
    newIp: text(row, 'new_ip'), updated: Boolean(row.updated), status: text(row, 'status'), errorCode: nullable(row, 'error_code'), createdAt: text(row, 'created_at') };
}

function mapAdminLog(row: Row): AdminUpdateLog {
  return { ...mapLog(row), clientDisplayName:text(row, 'client_display_name'), clientSlug:text(row, 'client_slug') };
}

export class D1ClientRepository implements ClientRepository {
  constructor(private readonly db: D1Database) {}

  async list(): Promise<Client[]> {
    const result = await this.db.prepare('SELECT * FROM clients ORDER BY display_name').all<Row>();
    return result.results.map(mapClient);
  }
  async findById(id: string): Promise<Client | null> { const row = await this.db.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first<Row>(); return row ? mapClient(row) : null; }
  async findBySlug(slug: string): Promise<Client | null> { const row = await this.db.prepare('SELECT * FROM clients WHERE slug = ?').bind(slug).first<Row>(); return row ? mapClient(row) : null; }
  async create(i: CreateClientRecord): Promise<Client> {
    await this.db.prepare(`INSERT INTO clients (id, display_name, slug, enabled, zone_id, zone_name, record_id, record_name, record_type, token_hash, token_created_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(i.id, i.displayName, i.slug, i.enabled ? 1 : 0, i.zoneId, i.zoneName, i.recordId, i.recordName, i.recordType, i.tokenHash, i.now, i.now, i.now).run();
    return (await this.findById(i.id))!;
  }
  async update(id: string, i: Partial<Pick<Client, 'displayName' | 'slug' | 'zoneId' | 'zoneName' | 'recordId' | 'recordName' | 'recordType'>>): Promise<Client | null> {
    const current = await this.findById(id); if (!current) return null;
    const next = { ...current, ...i }; const now = new Date().toISOString();
    await this.db.prepare(`UPDATE clients SET display_name=?, slug=?, zone_id=?, zone_name=?, record_id=?, record_name=?, record_type=?, updated_at=? WHERE id=?`)
      .bind(next.displayName, next.slug, next.zoneId, next.zoneName, next.recordId, next.recordName, next.recordType, now, id).run();
    return this.findById(id);
  }
  async claimRecordProvisioning(id: string, claimId: string, claimedAt: string, staleBefore: string): Promise<boolean> {
    const result = await this.db.prepare(`UPDATE clients SET record_provisioning_token=?, record_provisioning_at=?, updated_at=?
      WHERE id=? AND record_id IS NULL AND (record_provisioning_token IS NULL OR record_provisioning_at < ?)`)
      .bind(claimId, claimedAt, claimedAt, id, staleBefore).run();
    return (result.meta.changes ?? 0) > 0;
  }
  async bindProvisionedRecord(id: string, claimId: string, record: { id: string; zoneName: string; name: string; type: 'A' | 'AAAA' }): Promise<Client | null> {
    const now = new Date().toISOString();
    const result = await this.db.prepare(`UPDATE clients SET zone_name=?, record_id=?, record_name=?, record_type=?, record_provisioning_token=NULL, record_provisioning_at=NULL, updated_at=?
      WHERE id=? AND record_id IS NULL AND record_provisioning_token=?`)
      .bind(record.zoneName, record.id, record.name, record.type, now, id, claimId).run();
    return (result.meta.changes ?? 0) > 0 ? this.findById(id) : null;
  }
  async releaseRecordProvisioning(id: string, claimId: string): Promise<void> {
    await this.db.prepare('UPDATE clients SET record_provisioning_token=NULL, record_provisioning_at=NULL WHERE id=? AND record_provisioning_token=?')
      .bind(id, claimId).run();
  }
  async setEnabled(id: string, enabled: boolean): Promise<Client | null> { await this.db.prepare('UPDATE clients SET enabled=?, updated_at=? WHERE id=?').bind(enabled ? 1 : 0, new Date().toISOString(), id).run(); return this.findById(id); }
  async rotateToken(id: string, hash: string, now: string): Promise<Client | null> { await this.db.prepare('UPDATE clients SET token_hash=?, token_created_at=?, updated_at=? WHERE id=?').bind(hash, now, now, id).run(); return this.findById(id); }
  async updateStatus(id: string, values: { ip: string; sourceIp: string; status: string; updatedAt: string }): Promise<void> { await this.db.prepare('UPDATE clients SET last_ip=?, last_source_ip=?, last_status=?, last_updated_at=?, updated_at=? WHERE id=?').bind(values.ip, values.sourceIp, values.status, values.updatedAt, values.updatedAt, id).run(); }
  async remove(id: string): Promise<boolean> { const result = await this.db.prepare('DELETE FROM clients WHERE id=?').bind(id).run(); return (result.meta.changes ?? 0) > 0; }
  async addLog(l: UpdateLog): Promise<void> { await this.db.prepare('INSERT INTO update_logs (id, client_id, source_ip, old_ip, new_ip, updated, status, error_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(l.id, l.clientId, l.sourceIp, l.oldIp, l.newIp, l.updated ? 1 : 0, l.status, l.errorCode, l.createdAt).run(); }
  async logs(id: string, limit: number, offset: number): Promise<UpdateLog[]> { const result = await this.db.prepare('SELECT * FROM update_logs WHERE client_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?').bind(id, limit, offset).all<Row>(); return result.results.map(mapLog); }
  async allLogs(limit: number, offset: number): Promise<AdminUpdateLog[]> {
    const result = await this.db.prepare(`SELECT logs.*, clients.display_name AS client_display_name, clients.slug AS client_slug
      FROM update_logs logs JOIN clients ON clients.id=logs.client_id
      ORDER BY logs.created_at DESC LIMIT ? OFFSET ?`).bind(limit, offset).all<Row>();
    return result.results.map(mapAdminLog);
  }
  async audit(email: string, action: string, targetId: string | null, result: string): Promise<void> { await this.db.prepare('INSERT INTO admin_audit_logs (id, admin_email, action, target_client_id, result, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), email, action, targetId, result, new Date().toISOString()).run(); }
  async dashboard(): Promise<Record<string, number>> {
    const row = await this.db.prepare(`SELECT
      (SELECT COUNT(*) FROM clients) total,
      (SELECT COUNT(*) FROM clients WHERE enabled=1) enabled,
      (SELECT COUNT(*) FROM clients WHERE enabled=0) disabled,
      (SELECT COUNT(*) FROM update_logs WHERE unixepoch(created_at) >= unixepoch('now', '-24 hours') AND status IN ('updated','unchanged')) recentSuccess,
      (SELECT COUNT(*) FROM update_logs WHERE unixepoch(created_at) >= unixepoch('now', '-24 hours') AND status='failed') recentFailure`).first<Row>();
    return Object.fromEntries(Object.entries(row ?? {}).map(([key, value]) => [key, Number(value ?? 0)]));
  }
}
