# 資料模型

`clients` 保存固定 DNS 綁定、SHA-256 token hash 與最後狀態。`record_id` 在選擇既有 Record 或首次自動建立完成後保存；待建立狀態為 `NULL`。`record_provisioning_token` 與 `record_provisioning_at` 是首次建立的短期 conditional claim，兩欄必須同時有值或同時為 `NULL`。`slug`、非 NULL 的 `record_id`、`record_name` 唯一，避免路由或 DNS Record 重複綁定。A/AAAA 由 CHECK 約束。

`update_logs` 是更新稽核；`admin_audit_logs` 是管理操作稽核。兩者都不含 credential。刪除 Client 使用 foreign key cascade 清除其 update logs，但管理稽核保留 target id 字串。`update_logs(created_at DESC)` 與 `admin_audit_logs(created_at DESC)` 支援依 cutoff 的 retention 與最近事件查詢；`update_logs(client_id, created_at DESC)` 支援單一 Client 歷程。每日 scheduled Worker 以 `LOG_RETENTION_DAYS`（預設 90）為共同保存期，每批每表最多 500 筆、每次最多 20 批。Rate limit counter 由 Cloudflare edge binding 保存，D1 沒有限流表，也不在公開 request path 清理資料。

時間一律存 ISO-8601 UTC。ID 使用 Web Crypto UUID。Token hash 雖不可直接使用，仍視為敏感資料，匯出與備份需加密及限制存取。
