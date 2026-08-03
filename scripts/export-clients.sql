SELECT id, display_name, slug, enabled, zone_id, zone_name, record_id, record_name,
       record_type, token_hash, token_created_at, last_ip, last_source_ip,
       last_status, last_updated_at, created_at, updated_at
FROM clients ORDER BY created_at;
