# 資料模型

`clients` 保存固定 DNS 綁定、SHA-256 token hash 與最後狀態。`slug`、`record_id`、`record_name` 唯一，避免路由或 DNS record 越權重複綁定。A/AAAA 由 CHECK 約束。

`update_logs` 是不可變更新稽核；`admin_audit_logs` 是管理操作稽核。兩者都不含 credential。刪除 Client 使用 foreign key cascade 清除其 update logs，但管理稽核保留 target id 字串。`rate_limit_windows` 是三層限流共用的固定窗口儲存；`window_start` 索引讓每次請求清除過期窗口時不必掃描整張表。

時間一律存 ISO-8601 UTC。ID 使用 Web Crypto UUID。Token hash 雖不可直接使用，仍視為敏感資料，匯出與備份需加密及限制存取。
