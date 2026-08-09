# Cloudflare DDNS Gateway

MIT 授權、可直接部署於 Cloudflare Workers 的集中式 DDNS Gateway。遠端設備只持有自己的高熵 Client Token；Cloudflare DNS API Token 永遠只存在 Worker Secret。管理頁使用 Vue 3，身分與 session 完全交給 Cloudflare Access。

## 架構與安全

```mermaid
flowchart LR
  Device[Router / Script] -->|POST + Bearer| Update[ddns.example.com]
  UniFi[UniFi / Inadyn] -->|GET + Basic, optional| Update
  Update --> Worker[Cloudflare Worker]
  Admin[Administrator] --> Access[Cloudflare Access]
  Access --> Console[ddns.example.com/admin/]
  Console --> Worker
  Worker --> D1[(Cloudflare D1)]
  Worker --> DNS[Cloudflare DNS API]
```

詳細設計見 [架構規格](docs/architecture.md)、[威脅模型](threat-model.md)、[資料模型](docs/data-model.md)、[API 規格](docs/api.md) 與 [OpenAPI 3.1](docs/openapi.yaml)。

## 前置需求

- Cloudflare 帳戶、受管理的 DNS zone、Workers 與 D1 權限
- Node.js 24（只作建置工具；production 沒有 Node server runtime）與 npm
- Wrangler 4.51+
- 一個位於 Cloudflare DNS zone 的 hostname，例如 `ddns.example.com`

## 安裝與本機開發

```bash
npm ci
cp .env.example .dev.vars
npm run build:frontend
npm run db:migrate:local
npm run dev
```

本機 `.dev.vars` 只能放測試用 runtime 值且已被 gitignore；可由 `.env.example` 複製後填入，不得使用 production secret。第一次尚無 Access JWT 時，建議測試純 service/unit tests；完整 Admin flow 請在正式 Access application 驗證。本機 D1 由 Wrangler 模擬，不會在 Cloudflare 帳戶建立額外資料庫。

## 部署步驟

以下流程適用於全新的 production Worker。安全原則是：先完成 D1 migration、Access 與 runtime secrets，最後才把公開 Custom Domain 指向 Worker。若同名 Worker 已經有公開路由，先移除路由或安排維護時段再操作。

### 1. 安裝並完成本機驗證

```bash
npm ci
npm run lint
npm run typecheck
npm run test:coverage
npm run build
npm audit --audit-level=high
npm run db:migrate:local
```

所有命令必須通過。正式 secret 不得放進 `.dev.vars`、GitHub、build variables 或任何已追蹤檔案。

### 2. 設定 runtime variables 並登入 Cloudflare

先在 Worker → Settings → Variables & Secrets 設定下列非敏感 runtime variables；`wrangler.jsonc` 刻意不宣告 `vars` 且設有 `keep_vars:true`，後續 Git 自動部署會沿用 Dashboard 現值，不會以 repository 預設值覆蓋：

- `ENVIRONMENT=production`
- `APP_HOST`：正式 hostname，例如 `ddns.example.com`
- `ALLOW_PRIVATE_IPS=false`
- `ENABLE_UNIFI_COMPAT=true`（不需要 UniFi 時設為 `false`）
- `DETAILED_ERRORS=false`

接著確認 Wrangler 使用正確帳戶：

```bash
npx wrangler login
npx wrangler whoami
```

專案刻意設定 `workers_dev:false` 且不在 `wrangler.jsonc` 宣告 `routes`；Custom Domain 會在最後由 Dashboard 手動關聯，避免 deploy 覆蓋控制平面設定。

### 3. 首次部署並建立 D1

```bash
npm run deploy
```

`DDNS_DB` 是沒有 resource ID 的 draft binding。Wrangler 4.45+ 會在首次 deploy 自動建立並綁定唯一 D1；這是部署階段的資源建立，不是 Worker runtime 呼叫帳戶 API。此時尚未綁 Custom Domain，不應有公開流量。

### 4. 在公開服務前套用 migration

```bash
npm run db:migrate
npx wrangler d1 migrations list DDNS_DB --remote
```

確認沒有待套用 migration，再到 D1 Dashboard 記下資料庫名稱與 Time Travel bookmark。Migration 不會隨 D1 自動建立而套用；禁止在空 schema 狀態下綁定公開網域。

### 5. 建立 Cloudflare Access application

Zero Trust → Settings → Authentication 啟用 **Cloudflare** identity provider，並啟用 restrict to account members。建立 Self-hosted application：

- Domain/path：`ddns.example.com/admin/*`，實際部署時替換成 `APP_HOST`
- Session duration：8 小時以下，依風險縮短
- Allow policy：Include 指定 Email；Require **Cloudflare Account Member** 並指定 account
- 不建立 Bypass 或 Everyone policy

不要保護整個 hostname，否則 `/api/ddns/*` 會被互動式登入攔截。記下 Application AUD tag，稍後存為 `ACCESS_AUD`。正式管理入口是 `https://APP_HOST/admin/`；裸 `/admin` 會先重新導向 `/admin/`。

### 6. 建立 DNS API Token 並設定 runtime secrets

Cloudflare Dashboard → My Profile → API Tokens → Create Custom Token：

- Permission：Zone / DNS / Edit
- Zone Resources：Include / Specific zone / 只選實際使用 zone
- 視需求加 client IP filter 與期限

不要使用 Global API Key。依序設定四個 Worker secrets：

```bash
npx wrangler secret put CLOUDFLARE_DNS_API_TOKEN
npx wrangler secret put ACCESS_TEAM_DOMAIN
npx wrangler secret put ACCESS_AUD
npx wrangler secret put ADMIN_ALLOWED_EMAILS
npx wrangler secret list
```

`ACCESS_TEAM_DOMAIN` 填 `your-team.cloudflareaccess.com`；`ADMIN_ALLOWED_EMAILS` 使用逗號分隔的完整 email，不接受網域 wildcard。`wrangler.jsonc` 的 `secrets.required` 只預留這四個必要名稱，不包含或覆蓋 secret 值；缺少任一項時 Wrangler 會阻止後續部署並列出缺少名稱。`wrangler secret put` 會建立並立即部署新的 Worker version；四個 secret 全部設定完成後才可繼續。Secret 值不會顯示在 `secret list`。

### 7. 綁定 Custom Domain 與 TLS

Workers & Pages → 選擇 `cloudflare-ddns-gateway` → Settings → Domains & Routes，將 `APP_HOST` 關聯為唯一 Custom Domain。接著確認：

- SSL/TLS mode：**Full (strict)**
- Edge Certificates：**Always Use HTTPS** 已啟用
- Access application path 仍只有 `APP_HOST/admin/*`
- 沒有 Bypass policy

Worker Static Assets 使用 `run_worker_first:true`，Vue 資產也必須先通過 Worker 與 Access JWT gate。限流使用同一個 D1 的固定窗口表：來源 IP 60/min、驗證後每 Client 10/min、每管理者 60/min。

### 8. 執行上線 smoke test

1. `https://APP_HOST/` 回傳 404。
2. `https://APP_HOST/admin` 回傳 308 並導向 `/admin/`。
3. `/admin/` 會觸發 Access 登入；非 member 或非 allowlist email 必須被拒絕。
4. 登入後建立測試 Client，保存只顯示一次的 Client Token。
5. 呼叫 `/api/ddns/{slug}`，確認回傳 `success:true`；首次可能是 `updated:true` 或 `updated:false`，相同 IP 再呼叫必須是 `updated:false`。
6. 輪替 token，確認舊 token 回傳 401；停用 Client，確認有效 token 回傳 403。
7. 若使用 UniFi，驗證 `/api/ddns/{slug}/unifi?hostname=` 回傳 `good <IP>` 或 `nochg <IP>`。
8. 檢查 security headers，並確認 log 沒有 Authorization、JWT、cookie、token/hash 或 Cloudflare 原始錯誤。

### 9. 連接 Cloudflare Git Build

完成手動上線驗證後，到 Worker → Settings → Builds → Connect：

1. 授權 Cloudflare Workers & Pages GitHub App 只存取此 repository。
2. Production branch：`main`。
3. Build command：`npm run build:frontend`。
4. Deploy command：`npx wrangler deploy`。
5. Root directory：`/`。
6. 不需要 preview 時關閉 non-production branch builds。

Workers Build 會使用 `package.json` 鎖定的 Wrangler。Build variables/secrets 只存在建置環境，不是 Worker runtime variables；五個非敏感 runtime variables 與四個 runtime secrets 必須保留在 Worker → Settings → Variables & Secrets。`keep_vars:true` 會在部署時沿用這些 Dashboard bindings。之後 push 到 `main` 會自動建置及部署，但 D1 migration 仍需由管理者手動執行。

### 10. 後續部署與回復

每次 push 前重跑步驟 1 的品質命令。若有 schema 變更，先備份並取得 Time Travel bookmark，在維護時段套用 migration，再部署相依程式碼。Worker regression 從 Cloudflare Deployments 回復上一版；資料問題依 bookmark 執行 Time Travel restore。

此架構以 Workers Free、D1 Free 與 Zero Trust Free 額度為目標；網域費不包含在內，免費額度不可視為 SLA。完整回復注意事項見 [部署 Runbook](docs/deployment.md)。

## Client 操作

登入管理頁後新增 Client，輸入 Cloudflare zone/record 的 ID、名稱與 A/AAAA type。後端會向 Cloudflare API 完整核對 record ID、zone ID、名稱與 type，且 D1 unique index 防止重複綁定。Client 清單與詳情的 `currentDnsIp` 來自 Cloudflare 即時查詢；`lastIp` 只代表最後一次 Gateway 更新。建立成功的 token 只顯示一次，不進 localStorage、sessionStorage、IndexedDB、cookie 或持久化 Pinia。

輪替 Token 會用單一 D1 update 立即取代 hash，舊 token 隨即失效。刪除、停用與輪替都有確認步驟。每個管理 mutation 會先持久化 `started` audit；起始 audit 失敗時操作 fail closed，完成後再寫入 success/failure，避免操作完全無法歸因。

### curl

```bash
curl --fail-with-body -X POST \
  'https://ddns.example.com/api/ddns/linhome' \
  -H 'Authorization: Bearer ddns_REPLACE_WITH_ONE_TIME_TOKEN'
```

不得加 `ip`、`hostname`、`record` 或 `zone` query/body；伺服器只採 Cloudflare edge 觀察到的 public IP。正常回應為 `{"success":true,"updated":true}` 或 `updated:false`。

## UniFi Custom DDNS

UniFi Network 的 Custom DDNS 由 Inadyn 驅動，會用 GET 與 HTTP Basic Auth 呼叫自訂 server。專案預設提供隔離的相容端點，且不改變主要 Bearer POST 安全模式；不需要 UniFi 時可將 `ENABLE_UNIFI_COMPAT` 設為 `false` 關閉。

管理頁建立 Client 後，使用一次性 Client Token 設定 UniFi：

```text
服務：自訂
主機名稱：linhome-to.kthome.net
使用者名稱：linhome
密碼：ddns_REPLACE_WITH_ONE_TIME_TOKEN
伺服器：ddns.example.com/api/ddns/linhome/unifi?hostname=
```

部分 UniFi 版本要求 Server 不含 `https://`；僅可在已確認該韌體的 Inadyn 固定使用 HTTPS、且 Cloudflare 已啟用 Always Use HTTPS 時採此格式。若該版本接受完整 scheme，必須優先填 `https://ddns.example.com/api/ddns/linhome/unifi?hostname=`。`?hostname=` 是給 Inadyn 附加 hostname 的相容位置；Worker 會完全忽略它。若封包測試顯示設備送出 HTTP，請勿使用相容模式，改用支援 HTTPS POST 的排程腳本。

相容請求的語意為：

```http
GET /api/ddns/linhome/unifi?hostname=linhome-to.kthome.net
Authorization: Basic base64(linhome:ddns_CLIENT_TOKEN)
```

安全限制：

- Basic username 必須等於 URL client slug。
- Password 是 Client Token，不是 Cloudflare DNS API Token。
- Token 仍只以 SHA-256 hash 存在 D1，且可從管理頁立即輪替。
- Worker 忽略 hostname、IP 與其他非敏感 query；來源 IP 只取可信 Cloudflare header。
- Query/path token 與 record/zone selector 一律拒絕。
- 成功回傳 Inadyn/DynDNS 相容的 `good <IP>` 或 `nochg <IP>`。
- HTTPS 是必要條件；不得改成明文 HTTP。

若 UniFi 韌體能直接送 POST 與自訂 Bearer header，仍優先使用主要 `/api/ddns/{slug}` 端點。

UniFi 的「主機名稱」欄位請填該 Client 已綁定的 record name，供 Inadyn 組合請求；Worker 不採用此 query 值決定目標，永遠只以 slug 查 D1 固定綁定。

## FortiGate

FortiOS 內建 `config system ddns` 面向列舉的第三方 provider，使用 username/password 或 TSIG，沒有通用的 Bearer-header + POST 模板。因此不能把 token 填進 `ddns-password` 假設可相容本 API。

可行方式是在受管理的外部/內建 automation 能安全執行 HTTPS POST 的 FortiOS 版本，建立定時觸發動作呼叫主端點；能力與語法依 FortiOS 型號/版本而異，正式設定前以 Fortinet 文件及測試 Client 驗證。若設備只支援原生 provider，維持本 Gateway 的安全基線時應使用同站 Linux/PowerShell 排程；不要降級成 query/path token。FortiGate 的 WAN 出口必須直接經 Cloudflare，才能讓 `CF-Connecting-IP` 代表正確 public IP。

## 其他設備腳本

Linux 使用上述 curl。PowerShell：

```powershell
Invoke-RestMethod -Method Post -Uri 'https://ddns.example.com/api/ddns/linhome' `
  -Headers @{ Authorization = 'Bearer ddns_REPLACE_WITH_ONE_TIME_TOKEN' }
```

MikroTik、OPNsense、pfSense、Synology 若其自訂 DDNS client 支援 POST header 即直接使用；否則採設備排程腳本，避免弱 credential transport。

## 測試與品質

```bash
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

Vitest 覆蓋 Worker/Admin HTTP routes、token/hash/constant-time、Access JWT 偽造/audience/expiration、Cloudflare API mock、D1 repository、rate limit、IP family 與禁止範圍、header precedence、串流 body/content type/size、security headers、redaction、SQL/path/query injection、前端 Client payload 與 runtime URL。Coverage 對整個後端核心計算並強制 lines/functions/statements 90%、branches 85%；production 禁止以真實 token 當 fixture。

## 備份、匯出與還原

D1 提供 Time Travel。先查 bookmark：

```bash
npx wrangler d1 time-travel info REPLACE_AUTO_PROVISIONED_D1_NAME
npx wrangler d1 export REPLACE_AUTO_PROVISIONED_D1_NAME --remote --output backups/ddns.sql
```

Clients/Logs 可用 `scripts/export-clients.sql`、`scripts/export-logs.sql` 搭配 `wrangler d1 execute --remote --file` 查詢/匯出。Clients export 含 token hash，仍是敏感資料：加密、最小存取、設定 retention；永遠沒有明文 token。

還原會覆寫資料，先記錄目前 bookmark、取得變更核准並停止管理變更，再執行：

```bash
npx wrangler d1 time-travel restore REPLACE_AUTO_PROVISIONED_D1_NAME --bookmark REPLACE_BOOKMARK
```

還原到 token 輪替前會使舊 hash 恢復；還原後必須輪替所有受影響 Client token。

## 故障排除

Wrangler 已啟用 100% invocation logs 並持久化到 Cloudflare Workers Logs；設定變更需重新部署才會生效。即時追蹤 production Worker：

```bash
npx wrangler tail cloudflare-ddns-gateway --format pretty
```

先啟動 tail，再重現一次問題。歷史記錄可在 Cloudflare Dashboard → Workers & Pages → `cloudflare-ddns-gateway` → Observability → Logs 查詢，並以 request path 與 HTTP status `500` 篩選。

- `401 Unauthorized`：token 缺漏/錯誤/已輪替；不要把 Authorization 貼進 log。
- UniFi 相容端點 `404`：確認該環境沒有把 `ENABLE_UNIFI_COMPAT` 改為 `false`，且使用的是正確 DDNS hostname。
- `403 Client disabled`：由 Access 管理頁啟用；Admin 的 403 則檢查 Access AUD、team domain 與 email allowlist。
- `400 No valid public source IP`：record family 不符、CGNAT/private/link-local，或不是經 Cloudflare custom domain 呼叫。`ALLOW_PRIVATE_IPS` 預設 false；開啟時只額外允許 RFC1918/IPv6 ULA，loopback、unspecified、link-local、multicast 等仍永久拒絕，不建議 production 開啟。
- `409`：slug、record ID 或 record name 已綁定。
- `502`：DNS token scope、zone/record 綁定或 Cloudflare API 問題；Client response 刻意不含上游細節。
- Vue 404/Access bypass：確認 assets `run_worker_first:true`、Vite base 為 `/admin/`、Access application path 是 `ddns.example.com/admin/*`，且沒有 Bypass policy。

Worker log 禁止輸出 Authorization、JWT、cookie、token/hash、secret 或 Cloudflare 原始錯誤。Production 不得啟用 `DETAILED_ERRORS`。建議設定 update/admin audit retention、Cloudflare WAF 與異常 401/429/502 告警。

完整上線順序與回復點見 [部署 Runbook](docs/deployment.md)。
