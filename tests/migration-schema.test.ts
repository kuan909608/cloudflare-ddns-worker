import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const clientId = '11111111-1111-4111-8111-111111111111';

describe('D1 migration chain', () => {
  it('applies every migration in order while preserving data and constraints', async () => {
    const names = (await readdir(resolve('migrations'))).filter((name) => name.endsWith('.sql')).sort();
    expect(names).toEqual([
      '0001_initial.sql',
      '0002_pending_dns_records.sql',
      '0003_global_update_log_index.sql',
      '0004_edge_rate_limit.sql',
    ]);

    const db = new DatabaseSync(':memory:');
    try {
      db.exec(await readFile(resolve('migrations', names[0]!), 'utf8'));
      const values = [clientId, 'Home', 'home-1', 'a'.repeat(32), 'example.com', 'b'.repeat(32), 'home.example.com', 'hash', '2026-01-01T00:00:00.000Z'];
      db.prepare(`INSERT INTO clients (
        id, display_name, slug, enabled, zone_id, zone_name, record_id, record_name, record_type,
        token_hash, token_created_at, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'A', ?, ?, ?, ?)`).run(...values, values[8]!, values[8]!);
      db.prepare(`INSERT INTO update_logs (id, client_id, source_ip, old_ip, new_ip, updated, status, error_code, created_at)
        VALUES ('log-1', ?, '8.8.8.8', '1.1.1.1', '8.8.8.8', 1, 'updated', NULL, '2026-01-01T00:01:00.000Z')`).run(clientId);
      db.prepare(`INSERT INTO admin_audit_logs (id, admin_email, action, target_client_id, result, created_at)
        VALUES ('audit-1', 'admin@example.com', 'client.update', ?, 'success', '2026-01-01T00:02:00.000Z')`).run(clientId);

      for (const name of names.slice(1)) db.exec(await readFile(resolve('migrations', name), 'utf8'));

      expect(db.prepare('SELECT id, record_id FROM clients').get()).toMatchObject({id:clientId, record_id:'b'.repeat(32)});
      expect(db.prepare('SELECT id, client_id FROM update_logs').get()).toMatchObject({id:'log-1', client_id:clientId});
      expect(db.prepare('SELECT id, target_client_id FROM admin_audit_logs').get()).toMatchObject({id:'audit-1', target_client_id:clientId});
      expect(db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='rate_limit_windows'").get()).toMatchObject({count:0});
      expect(db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='index' AND name IN ('ix_update_logs_created','ix_admin_audit_created')").get()).toMatchObject({count:2});
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(() => db.prepare(`INSERT INTO clients (id,display_name,slug,enabled,zone_id,zone_name,record_id,record_name,record_type,token_hash,token_created_at,created_at,updated_at)
        VALUES ('duplicate','Duplicate','home-1',1,'${'c'.repeat(32)}','example.com',NULL,'other.example.com','A','hash','now','now','now')`).run()).toThrow();
      expect(() => db.prepare("UPDATE clients SET enabled=2 WHERE id=?").run(clientId)).toThrow();
      expect(() => db.prepare("UPDATE clients SET record_type='TXT' WHERE id=?").run(clientId)).toThrow();
      expect(() => db.prepare(`INSERT INTO update_logs (id,client_id,source_ip,new_ip,updated,status,created_at)
        VALUES ('orphan','missing','8.8.8.8','8.8.8.8',1,'updated','now')`).run()).toThrow();
    } finally {
      db.close();
    }
  });
});
