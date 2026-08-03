# API 規格

所有 response 為 JSON，錯誤格式為 `{ "success": false, "message": "..." }`。Admin 成功格式為 `{ "success": true, "data": ... }`。完整 schema 見 `docs/openapi.yaml`。

## DDNS

`POST /api/ddns/{clientSlug}`，只接受 `Authorization: Bearer <token>`，body 必須為空。成功回傳 `updated` boolean。認證失敗 401、停用 403、限流 429、上游更新失敗 502。任何 query string 直接拒絕，避免 credential/record injection。

預設啟用的 `GET /api/compat/unifi/{clientSlug}` 接受 `Authorization: Basic base64(slug:clientToken)`，回傳 DynDNS/Inadyn 的 `good <IP>` 或 `nochg <IP>`。它不接受 query/path token，且忽略 Inadyn 附加的 hostname；可用 `ENABLE_UNIFI_COMPAT=false` 關閉，停用時回傳 404。

## Admin

Admin API 只接受 Access 驗證後的使用者。POST/PUT 僅接受 `application/json`，最大 16 KiB。路由：

- `GET/POST /api/admin/clients`
- `GET/PUT/DELETE /api/admin/clients/{id}`
- `POST /api/admin/clients/{id}/enable|disable|rotate-token`
- `GET /api/admin/clients/{id}/logs`
- `POST /api/admin/cloudflare/validate-record`
- `GET /api/admin/dashboard`

Create/rotate response 是唯一包含明文 token 的 response。Browser 只能把它留在未持久化記憶體。
