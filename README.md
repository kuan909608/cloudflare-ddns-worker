# Cloudflare DDNS Gateway

MIT 授權、可直接部署於 Cloudflare Workers 的集中式 DDNS Gateway。遠端設備只持有自己的高熵 Client Token；Cloudflare DNS API Token 永遠只存在 Worker Secret。管理頁使用 Vue 3，身分與 session 完全交給 Cloudflare Access。

## 架構與安全

```mermaid
flowchart LR
  Device[Router / Script] -->|POST + Bearer| Update[ddns.example.com]
  UniFi[UniFi / Inadyn] -->|GET + Basic, optional| Update
  Update --> Worker[Cloudflare Worker]
  Admin[Administrator] --> Access[Cloudflare Access]
  Access --> Console[ddns-admin.example.com]
  Console --> Worker
  Worker --> D1[(Cloudflare D1)]
  Worker --> DNS[Cloudflare DNS API]
```

詳細設計見 [架構規格](docs/architecture.md)、[威脅模型](threat-model.md)、[資料模型](docs/data-model.md)、[API 規格](docs/api.md) 與 [OpenAPI 3.1](docs/openapi.yaml)。

## 前置需求

- Cloudflare 帳戶、受管理的 DNS zone、Workers 與 D1 權限
- Node.js 24（只作建置工具；production 沒有 Node server runtime）與 npm
- Wrangler 4.51+
- 兩個可用 hostname，例如 `ddns.example.com` 與 `ddns-admin.example.com`

## 安裝與本機開發

```bash
npm ci
cp .env.example .dev.vars
npm run build:frontend
npm run db:migrate:local
npm run dev
```

本機 `.dev.vars` 只能放測試 secret 且已被 gitignore。第一次尚無 Access JWT 時，建議測試純 service/unit tests；完整 Admin flow 請在 development Access application 驗證。

## Cloudflare 建置

### 1. 建立 D1

每個環境獨立建立，並將輸出的 UUID 填入 `wrangler.jsonc` 對應環境：

```bash
npx wrangler d1 create cloudflare-ddns-development
npx wrangler d1 create cloudflare-ddns-staging
npx wrangler d1 create cloudflare-ddns-production
npm run db:migrate:staging
npm run db:migrate:production
```

Migration 只可向前新增；production 前先在 staging 演練並取得 Time Travel bookmark。

### 2. 建立最小權限 DNS API Token

Cloudflare Dashboard → My Profile → API Tokens → Create Custom Token：

- Permission：Zone / DNS / Edit
- Zone Resources：Include / Specific zone / 只選實際使用 zone
- 可加 client IP filter 與期限；不同環境用不同 token

不要使用 Global API Key。不要把 token 寫入 Git、D1 或前端；以 Wrangler secret 設定：

```bash
npx wrangler secret put CLOUDFLARE_DNS_API_TOKEN --env staging
npx wrangler secret put ACCESS_TEAM_DOMAIN --env staging
npx wrangler secret put ACCESS_AUD --env staging
npx wrangler secret put ADMIN_ALLOWED_EMAILS --env staging
```

對 production 重複一次。`ADMIN_ALLOWED_EMAILS` 是逗號分隔完整 email；不要用網域 wildcard。即使 team domain 本身通常不是 secret，本專案仍依安全基線以 secret 管理。

### 3. Cloudflare Access

Zero Trust → Settings → Authentication 啟用 **Cloudflare** identity provider，並啟用 restrict to account members。建立 Self-hosted application：

- Domain：`ddns-admin.example.com`
- Session duration：依風險選短時效（建議 8 小時以下）
- Allow policy：Include 指定 Email；Require **Cloudflare Account Member** 並指定 account
- 不建立 Bypass/Everyone policy

將 Application AUD tag 存成 `ACCESS_AUD`。Worker 會再次驗證 `Cf-Access-Jwt-Assertion` 的 RS256 signature、issuer、audience、expiration 與 email allowlist。Account Member 是該 AUD 所屬 Access application 的 Require policy；Worker 以簽章與 AUD 綁定確保 assertion 來自該 application，不能只靠可偽造 header。管理驗證失敗統一 403。

`ddns.example.com` 不建立互動式 Access application；它只接受 Client Bearer token。兩個 hostname 都由 Worker host allowlist 再隔離。

### 4. Custom Domains 與環境

替換 `wrangler.jsonc` 的 example hostname、D1 UUID 與 Rate Limiting namespace。staging/production 各有獨立 Worker、D1、domains、AUD、allowed emails 與 DNS token。部署：

```bash
npm run deploy:staging
npm run deploy:production
```

Worker Static Assets 以 `run_worker_first` 保證 Vue 資產也先經 host/Access gate。Cloudflare SSL/TLS mode 必須使用 **Full (strict)**，Edge Certificates 必須啟用 **Always Use HTTPS**；Worker 仍會在讀取 Authorization 前拒絕 custom domain 的明文 HTTP。若帳戶方案不提供 Rate Limiting binding，移除該環境的 `ratelimits` 設定；程式會使用 D1 固定窗口 fallback。三個 limiter 分別是來源 IP pre-auth 60/min、驗證成功後每 Client 10/min、每管理者 60/min。原生 binding 是 eventually consistent abuse control，不作精準計費。

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
伺服器：ddns.example.com/api/compat/unifi/linhome?hostname=
```

部分 UniFi 版本要求 Server 不含 `https://`；僅可在已確認該韌體的 Inadyn 固定使用 HTTPS、且 Cloudflare 已啟用 Always Use HTTPS 時採此格式。若該版本接受完整 scheme，必須優先填 `https://ddns.example.com/api/compat/unifi/linhome?hostname=`。`?hostname=` 是給 Inadyn 附加 hostname 的相容位置；Worker 會完全忽略它。若封包測試顯示設備送出 HTTP，請勿使用相容模式，改用支援 HTTPS POST 的排程腳本。

相容請求的語意為：

```http
GET /api/compat/unifi/linhome?hostname=linhome-to.kthome.net
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

可行方式是在受管理的外部/內建 automation 能安全執行 HTTPS POST 的 FortiOS 版本，建立定時觸發動作呼叫主端點；能力與語法依 FortiOS 型號/版本而異，正式設定前以 Fortinet 文件及 staging endpoint 驗證。若設備只支援原生 provider，維持本 Gateway 的安全基線時應使用同站 Linux/PowerShell 排程；不要降級成 query/path token。FortiGate 的 WAN 出口必須直接經 Cloudflare，才能讓 `CF-Connecting-IP` 代表正確 public IP。

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

## 本機驗證與 Cloudflare Git 部署

Repository 不包含 GitHub Actions、Dependabot 或其他 GitHub 自動化。每次變更先在本機依序執行：

```bash
npm ci
npm run lint
npm run typecheck
npm run test:coverage
npm run build
npm audit --audit-level=high
```

確認全部通過後，將 repository 從 Cloudflare Dashboard 手動關聯到 Worker：

1. Workers & Pages → 選擇 Worker → Settings → Builds → Connect。
2. 授權 Cloudflare Workers & Pages GitHub App 只存取此 repository。
3. Production branch 選 `main`；不需要 preview 時關閉 non-production branch builds。
4. Build command 設為 `npm run build:frontend`。
5. Deploy command 設為 `npx wrangler deploy --env production`。
6. Root directory 保持 `/`。
7. D1 migration 在首次部署及每次 schema 變更前，由管理者在本機手動執行 `npm run db:migrate:production`。

關聯後，Cloudflare Workers Builds 會在 `main` push 時建置及部署；這是 Cloudflare 管理的 Git integration，不需要 repository 內的 CI workflow。Client Token 與 Cloudflare DNS API Token 不得放進 GitHub repository、build variables 或部署輸出；Worker runtime secrets 必須在 Cloudflare Worker environment 設定。

## 備份、匯出與還原

D1 production storage 自動提供 Time Travel。先查 bookmark：

```bash
npx wrangler d1 time-travel info cloudflare-ddns-production
npx wrangler d1 export cloudflare-ddns-production --remote --output backups/ddns.sql
```

Clients/Logs 可用 `scripts/export-clients.sql`、`scripts/export-logs.sql` 搭配 `wrangler d1 execute --remote --file` 查詢/匯出。Clients export 含 token hash，仍是敏感資料：加密、最小存取、設定 retention；永遠沒有明文 token。

還原會覆寫資料，先記錄目前 bookmark、取得變更核准並停止管理變更，再執行：

```bash
npx wrangler d1 time-travel restore cloudflare-ddns-production --bookmark REPLACE_BOOKMARK
```

還原到 token 輪替前會使舊 hash 恢復；還原後必須輪替所有受影響 Client token。

## 故障排除

- `401 Unauthorized`：token 缺漏/錯誤/已輪替；不要把 Authorization 貼進 log。
- UniFi 相容端點 `404`：確認該環境沒有把 `ENABLE_UNIFI_COMPAT` 改為 `false`，且使用的是正確 DDNS hostname。
- `403 Client disabled`：由 Access 管理頁啟用；Admin 的 403 則檢查 Access AUD、team domain 與 email allowlist。
- `400 No valid public source IP`：record family 不符、CGNAT/private/link-local，或不是經 Cloudflare custom domain 呼叫。`ALLOW_PRIVATE_IPS` 預設 false；開啟時只額外允許 RFC1918/IPv6 ULA，loopback、unspecified、link-local、multicast 等仍永久拒絕，不建議 production 開啟。
- `409`：slug、record ID 或 record name 已綁定。
- `502`：DNS token scope、zone/record 綁定或 Cloudflare API 問題；Client response 刻意不含上游細節。
- Vue 404/Access bypass：確認 assets `run_worker_first:true`，管理 hostname 已納入 Access application，且沒有 Bypass policy。

Worker log 禁止輸出 Authorization、JWT、cookie、token/hash、secret 或 Cloudflare 原始錯誤。Production 不得啟用 `DETAILED_ERRORS`。建議設定 update/admin audit retention、Cloudflare WAF 與異常 401/429/502 告警。

完整上線順序與回復點見 [部署 Runbook](docs/deployment.md)。
