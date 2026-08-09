PRAGMA foreign_keys = ON;

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  slug TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  zone_id TEXT NOT NULL,
  zone_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  record_name TEXT NOT NULL,
  record_type TEXT NOT NULL CHECK (record_type IN ('A', 'AAAA')),
  token_hash TEXT NOT NULL,
  token_created_at TEXT NOT NULL,
  last_ip TEXT,
  last_source_ip TEXT,
  last_status TEXT,
  last_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX ux_clients_slug ON clients(slug);
CREATE UNIQUE INDEX ux_clients_record_id ON clients(record_id);
CREATE UNIQUE INDEX ux_clients_record_name ON clients(record_name);

CREATE TABLE update_logs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source_ip TEXT NOT NULL,
  old_ip TEXT,
  new_ip TEXT NOT NULL,
  updated INTEGER NOT NULL CHECK (updated IN (0, 1)),
  status TEXT NOT NULL,
  error_code TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_update_logs_client_created ON update_logs(client_id, created_at DESC);

CREATE TABLE admin_audit_logs (
  id TEXT PRIMARY KEY,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_client_id TEXT,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_admin_audit_created ON admin_audit_logs(created_at DESC);

CREATE TABLE rate_limit_windows (
  bucket_key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  PRIMARY KEY (bucket_key, window_start)
);
CREATE INDEX ix_rate_limit_windows_start ON rate_limit_windows(window_start);
