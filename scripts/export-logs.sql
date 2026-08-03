SELECT id, client_id, source_ip, old_ip, new_ip, updated, status, error_code, created_at
FROM update_logs ORDER BY created_at;
