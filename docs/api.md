# API 規格

所有 response 為 JSON，錯誤格式為 `{ "success": false, "message": "..." }`。Admin 成功格式為 `{ "success": true, "data": ... }`。完整 schema 見 `docs/openapi.yaml`。

## DDNS

`POST /api/ddns/{clientSlug}`，只接受 `Authorization: Bearer <token>`，body 必須為空。成功回傳 `updated` boolean。認證失敗 401、停用 403、限流 429、上游更新失敗 502。任何 query string 直接拒絕，避免 credential/record injection。

預設啟用的 `GET /api/ddns/{clientSlug}/unifi` 接受 `Authorization: Basic base64(slug:clientToken)`，回傳 DynDNS/Inadyn 的 `good <IP>` 或 `nochg <IP>`。它不接受 query/path token，且忽略 Inadyn 附加的 hostname；可用 `ENABLE_UNIFI_COMPAT=false` 關閉，停用時回傳 404。

## Admin

Admin API 只接受 Access 驗證後的使用者。所有 POST/PUT/DELETE 僅接受 `application/json`，最大 16 KiB；無參數 mutation 也必須傳送 `{}`，並拒絕 cross-site browser request。路由：

- `GET/POST /admin/api/clients`
- `GET/PUT/DELETE /admin/api/clients/{id}`
- `POST /admin/api/clients/{id}/enable|disable|rotate-token`
- `GET /admin/api/clients/{id}/logs`
- `GET /admin/api/cloudflare/records`
- `GET /admin/api/dashboard`
- `GET /admin/api/config`

`GET /admin/api/config` 只回傳非敏感 runtime 設定，管理頁用同源 origin 產生 DDNS、curl 與 UniFi URL。Client list/detail 的 `currentDnsIp` 由 Cloudflare DNS API 即時取得；`lastIp` 仍代表最後一次 Gateway 更新狀態。Dashboard 的 recent success/failure 是最近 24 小時 `update_logs` 事件數。

Cloudflare catalog route 只列出 Worker runtime variables `DNS_ZONE_ID`、`DNS_ZONE_NAME` 所固定 Zone 內的 A/AAAA records。Create/Update payload 不接受 Zone 欄位，後端會注入並驗證固定 Zone；API Token 只需 `Zone / DNS / Edit`。

非 localhost 的 HTTP request 會在解析 Authorization 前以 400 拒絕。DDNS 先按可信 `CF-Connecting-IP` 套用 60/min pre-auth limiter，再於 Token 成功後套用每 Client 10/min limiter；未知 slug 與錯誤 Token 不會消耗合法 Client bucket。

Create/rotate response 是唯一包含明文 token 的 response。Browser 只能把它留在未持久化記憶體。
