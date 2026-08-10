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
- `DNS_ZONE_ID`：此 Worker 唯一可管理的 Cloudflare Zone ID（Zone Overview 右側可查）
- `ALLOW_PRIVATE_IPS=false`
- `ENABLE_UNIFI_COMPAT=true`（只有明確設為 `true` 才啟用；未設定或其他值都 fail closed 為停用）
- `DETAILED_ERRORS=false`
- `LOG_RETENTION_DAYS=90`（可省略；update logs 與 admin audit 共用此保存期，預設 90 天）

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
- 可設定期限；一般 Worker 沒有專屬固定出口 IP，因此不要把 Cloudflare 共用 IP ranges 當作 client IP 白名單。必須使用來源 IP 限制時，需先配置 Zero Trust Enterprise Dedicated Egress IP，再只允許該專屬 IP

不要使用 Global API Key。依序設定三個 Worker secrets：

```bash
npx wrangler secret put CLOUDFLARE_DNS_API_TOKEN
npx wrangler secret put ACCESS_TEAM_DOMAIN
npx wrangler secret put ACCESS_AUD
npx wrangler secret list
```

`ACCESS_TEAM_DOMAIN` 填 `your-team.cloudflareaccess.com`。管理者 Email allowlist 只由 Cloudflare Access policy 維護，Worker 不保留第二份名單；Worker 仍驗證 JWT 的 signature、issuer、audience、expiration、type 與 email identity。`wrangler.jsonc` 的 `secrets.required` 只提供 Wrangler 型別／開發提示，不會驗證遠端 secret，也不會阻止 deploy；部署者必須以 `wrangler secret list` 人工確認三個名稱都存在。`wrangler secret put` 會建立並立即部署新的 Worker version；三個 secret 全部設定完成後才可繼續。Secret 值不會顯示在 `secret list`。

### 7. 綁定 Custom Domain 與 TLS

Workers & Pages → 選擇 `cloudflare-ddns-worker` → Settings → Domains & Routes，將 `APP_HOST` 關聯為唯一 Custom Domain。接著確認：

- SSL/TLS mode：**Full (strict)**
- Edge Certificates：**Always Use HTTPS** 已啟用
- Access application path 仍只有 `APP_HOST/admin/*`
- 沒有 Bypass policy

Worker Static Assets 使用 `run_worker_first:true`，Vue 資產也必須先通過 Worker 與 Access JWT gate。三層限流使用 Cloudflare Workers Rate Limiting bindings，在任何公開 DDNS D1 lookup 前先套用來源 IP 60/min，驗證後每 Client 10/min，管理 API 每管理者 60/min；D1 不再保存或清理限流 counter。

### 8. 執行上線 smoke test

1. `https://APP_HOST/` 回傳 404。
2. `https://APP_HOST/admin` 回傳 308 並導向 `/admin/`。
3. `/admin/` 會觸發 Access 登入；Access policy 必須拒絕非 member 或非 allowlist email。
4. 登入後建立測試 Client，保存只顯示一次的 Client Token。
5. 若選擇「建立新主機名」，先確認 Cloudflare 尚無該 Record；呼叫 `/api/ddns/{slug}` 後應回傳 `success:true, updated:true`，並以來源 IP 建立 Record。相同 IP 再呼叫必須是 `updated:false`。
6. 輪替 token，確認舊 token 回傳 401；停用 Client，確認有效 token 回傳 403。
7. 若使用 UniFi，驗證 `/api/ddns/{slug}/unifi?hostname=` 回傳 `good <IP>` 或 `nochg <IP>`。
8. 檢查 security headers，並確認 redacted custom log 沒有 query、Authorization、JWT、cookie、token/hash 或 Cloudflare 原始錯誤。
9. 在 Triggers 確認每日 `17 3 * * *` UTC cron；以測試資料驗證超過 `LOG_RETENTION_DAYS` 的兩類 logs 會分批清除。

### 9. 連接 Cloudflare Git Build

完成手動上線驗證後，到 Worker → Settings → Builds → Connect：

1. 授權 Cloudflare Workers & Pages GitHub App 只存取此 repository。
2. Production branch：`main`。
3. Build command：`npm run build:frontend`。
4. Deploy command：`npm run deploy:production`。此指令會先套用遠端 D1 migration，成功後才部署 Worker。
5. Root directory：`/`。
6. 不需要 preview 時關閉 non-production branch builds。

Workers Build 會使用 `package.json` 鎖定的 Wrangler。Build variables/secrets 只存在建置環境，不是 Worker runtime variables；上述 runtime variables 與三個 runtime secrets 必須保留在 Worker → Settings → Variables & Secrets。`keep_vars:true` 會在部署時沿用這些 Dashboard bindings。之後 push 到 `main` 時，production deploy 會先執行 `npm run db:migrate`；migration 失敗便中止，不會部署相依 Worker。首次 deploy 仍須依步驟 3、4 先建立 draft D1，再人工初始化 schema，因為 migration 執行前必須已有遠端 D1。

### 10. 後續部署與回復

每次 push 前重跑步驟 1 的品質命令。後續 schema 變更會由 `deploy:production` 在 Worker 部署前自動套用；Wrangler 會在每次 migration 建立備份。破壞性 schema 變更仍須先取得 Time Travel bookmark 並安排維護時段。Worker regression 從 Cloudflare Deployments 回復上一版；資料問題依 bookmark 執行 Time Travel restore。

此架構以 Workers Free、D1 Free 與 Zero Trust Free 額度為目標；網域費不包含在內，免費額度不可視為 SLA。完整回復注意事項見 [部署 Runbook](docs/deployment.md)。

## Client 操作

每個 Worker 只管理 `DNS_ZONE_ID` 固定的一個 Zone；Zone Name 由 Worker 使用同一個 DNS API Token 呼叫 Cloudflare Zone Details API 取得。新增 Client 可選擇既有 A/AAAA Record，或只填主機標籤建立待首次更新的主機名；完整 FQDN 由後端組合，browser request 無法指定或切換 Zone。待建立 Client 第一次通過 Token 驗證後，Worker 以 Cloudflare edge 觀察到的來源 IP 建立 DNS Record，並將 Cloudflare 回傳的 Record ID 永久綁定。D1 provisioning claim 與同名 Record 查找可避免並行請求或中斷重試造成重複建立。API Token 只需 `Zone / DNS / Edit`。Client 清單與詳情的 `currentDnsIp` 來自 Cloudflare 即時查詢；`lastIp` 只代表最後一次 Gateway 更新。建立成功的 token 只顯示一次，不進 localStorage、sessionStorage、IndexedDB、cookie 或持久化 Pinia。

輪替 Token 會用單一 D1 update 立即取代 hash，舊 token 隨即失效。刪除、停用與輪替都有確認步驟。每個管理 mutation 會先持久化 `started` audit；起始 audit 失敗時操作 fail closed。完成 audit 無法寫入時不會回滾已完成的 D1/DNS 行為，但一定輸出不含 email、token 或 provider detail 的 `severity:high` 結構化事件；外部 DNS 操作不宣稱具備跨系統 transaction。

### curl

```bash
curl --fail-with-body -X POST \
  'https://ddns.example.com/api/ddns/linhome' \
  -H 'Authorization: Bearer ddns_REPLACE_WITH_ONE_TIME_TOKEN'
```

此 POST 必須是真正的 0-byte body；curl 產生的零長度 body stream 會被接受，任何有內容的 body 都回 400。不得加 `token`、`password`、`ip`、`hostname`、`record` 或 `zone` query/body；伺服器只接受合法 `CF-Connecting-IP`，缺失或格式錯誤直接拒絕且永不採用 `X-Forwarded-For`。正常回應為 `{"success":true,"updated":true}` 或 `updated:false`。

## UniFi Custom DDNS

UniFi Network 的 Custom DDNS 由 Inadyn 驅動，會用 GET 與 HTTP Basic Auth 呼叫自訂 server。相容端點不改變主要 Bearer POST 安全模式，但採 fail-closed：只有 `ENABLE_UNIFI_COMPAT=true` 才會啟用並在管理頁顯示 UniFi 操作，未設定、`false` 或其他值一律回 404。

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

Vitest 覆蓋 Worker/Admin HTTP routes、真實零 byte POST stream、token/hash/constant-time、Access JWT 偽造/audience/expiration、Cloudflare API mock、D1 repository、edge rate limiting、來源 IP fail-closed、串流 body/content type/size、scheduled retention、完整 migration chain、security headers、redaction、SQL/path/query injection、前端狀態與 runtime URL。Coverage 對整個後端核心計算並強制 lines/functions/statements 90%、branches 85%；production 禁止以真實 token 當 fixture。

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

Wrangler 保留 100% Workers Logs，但關閉會自動包含完整 URL 的 invocation logs，改由 Worker 對每次請求輸出 `request_completed` custom event；內容只有 method、pathname、status，刻意不包含 query、headers 或 body。錯誤另有安全 category/stage。這保留可診斷性，同時避免設備誤把 token 放進 query 時由自動 invocation message 保存完整 URL。設定變更需重新部署才會生效。即時追蹤 production Worker：

```bash
npx wrangler tail cloudflare-ddns-worker --format pretty
```

先啟動 tail，再重現一次問題。歷史記錄可在 Cloudflare Dashboard → Workers & Pages → `cloudflare-ddns-worker` → Observability → Logs 查詢，並以 `event=request_completed`、`pathname` 與 `status=500` 篩選。

- `401 Unauthorized`：token 缺漏/錯誤/已輪替；不要把 Authorization 貼進 log。
- UniFi 相容端點 `404`：確認該環境沒有把 `ENABLE_UNIFI_COMPAT` 改為 `false`，且使用的是正確 DDNS hostname。
- `403 Client disabled`：由 Access 管理頁啟用；Admin 的 403 則檢查 Access JWT 與由 Access policy 管理的 Email allowlist。
- `400 No valid public source IP`：record family 不符、CGNAT/private/link-local，或不是經 Cloudflare custom domain 呼叫。`ALLOW_PRIVATE_IPS` 預設 false；開啟時只額外允許 RFC1918/IPv6 ULA，loopback、unspecified、link-local、multicast 等仍永久拒絕，不建議 production 開啟。
- `409`：slug、record ID 或 record name 已綁定。
- `502`：DNS token scope、zone/record 綁定或 Cloudflare API 問題；Client response 刻意不含上游細節。
- Vue 404/Access bypass：確認 assets 已啟用 `run_worker_first:true` 與 `not_found_handling:single-page-application`、建置產物引用 `/admin/assets/*`、Access application path 是 `ddns.example.com/admin/*`，且沒有 Bypass policy。

Worker log 禁止輸出 query、Authorization、JWT、cookie、token/hash、secret 或 Cloudflare 原始錯誤；DDNS API 也明確禁止任何 query token。若 token 曾誤放在 URL：立即停用該設備設定；在管理頁輪替受影響 Client Token；若誤放的是 DNS API Token，建立新的 Specific-zone Token、以 `wrangler secret put CLOUDFLARE_DNS_API_TOKEN` 切換後撤銷舊 Token；檢查 Workers Logs 的存取與 retention，依事件程序保存必要證據並限制閱覽。不得把完整疑似 URL貼進 issue/chat。Production 不得啟用 `DETAILED_ERRORS`。

每日 cron 會以 `LOG_RETENTION_DAYS`（預設 90 天）為單一保存期，分批刪除 `update_logs` 與 `admin_audit_logs`；每批每表最多 500 筆、單次排程最多 20 批，不在公開 request path 執行 DELETE。Cloudflare Workers Logs 的平台 retention、WAF 與 401/429/502 告警仍須在 Dashboard 人工設定與驗證。

HTTP 預期分兩層：Worker 本身對非 localhost 明文 HTTP 一律 fail closed 回 400，不自行 redirect；若需要 301/308，必須在 Cloudflare Edge 開啟 Always Use HTTPS。驗證：

```bash
curl -sS -o /dev/null -D - 'http://ddns.example.com/'
curl -sS -o /dev/null -D - 'https://ddns.example.com/'
```

第一個命令在 Edge 已啟用 redirect 時必須先看到 301/308 與 HTTPS `Location`；否則會到 Worker 並回 400。第二個命令應回 404，證明 HTTPS Worker route fail closed。

完整上線順序與回復點見 [部署 Runbook](docs/deployment.md)。
