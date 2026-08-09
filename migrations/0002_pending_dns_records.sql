PRAGMA foreign_keys = OFF;

CREATE TABLE clients_next (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  slug TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  zone_id TEXT NOT NULL,
  zone_name TEXT NOT NULL,
  record_id TEXT,
  record_name TEXT NOT NULL,
  record_type TEXT NOT NULL CHECK (record_type IN ('A', 'AAAA')),
  record_provisioning_token TEXT,
  record_provisioning_at TEXT,
  token_hash TEXT NOT NULL,
  token_created_at TEXT NOT NULL,
  last_ip TEXT,
  last_source_ip TEXT,
  last_status TEXT,
  last_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((record_provisioning_token IS NULL) = (record_provisioning_at IS NULL))
);

INSERT INTO clients_next (
  id, display_name, slug, enabled, zone_id, zone_name, record_id, record_name, record_type,
  token_hash, token_created_at, last_ip, last_source_ip, last_status, last_updated_at, created_at, updated_at
)
SELECT
  id, display_name, slug, enabled, zone_id, zone_name, record_id, record_name, record_type,
  token_hash, token_created_at, last_ip, last_source_ip, last_status, last_updated_at, created_at, updated_at
FROM clients;

DROP TABLE clients;
ALTER TABLE clients_next RENAME TO clients;

CREATE UNIQUE INDEX ux_clients_slug ON clients(slug);
CREATE UNIQUE INDEX ux_clients_record_id ON clients(record_id);
CREATE UNIQUE INDEX ux_clients_record_name ON clients(record_name);

PRAGMA foreign_keys = ON;
