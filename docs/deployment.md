# 部署 Runbook

1. 本機先驗證 migration；在 Worker Dashboard 設定正式 `APP_HOST`、固定且唯一的 `DNS_ZONE_ID` 等 runtime variables，再執行首次 deploy。`wrangler.jsonc` 不宣告 production `vars` 且使用 `keep_vars:true`，避免後續 Git 部署覆蓋 Dashboard 現值。Wrangler 會從 draft `DDNS_DB` binding 自動建立並綁定唯一 D1。此時不要關聯公開網域。
2. 在尚未關聯公開網域時立即執行 `npm run db:migrate`，確認遠端 schema 完整後記下 Time Travel bookmark。
3. 建立只涵蓋 `ddns.example.com/admin/*` 的 Access application，取得 AUD；建立最小權限 DNS API Token 並設定三個 Worker runtime secrets。
4. 在 Dashboard 手動建立唯一的 Custom Domain；不要保護整個 hostname，並確認 Full (strict) 與 Always Use HTTPS。Worker 本身對 HTTP 回 400，不負責 redirect；只有 Edge 的 Always Use HTTPS 會回 301/308。
5. 完成 Access member/non-member 正負向測試、建立測試 Client、驗證 unchanged/update/rotate/disable。
6. 在 Cloudflare Worker 的 Settings → Builds 手動連結 GitHub repository，production branch 選 `main`，Build command 使用 `npm run build:frontend`，Deploy command 使用 `npm run deploy:production`；此指令會先套用遠端 D1 migration，成功後才執行 `wrangler deploy`。
7. 視需求關閉 non-production branch builds；GitHub repository 不放 Actions 或 Dependabot 設定。
8. Access application 必須只啟用 Cloudflare IdP，IdP 開啟 Restrict to account members；Allow policy 同時 Require Cloudflare Account Member 並 Include 指定 Email。用 Policy Tester 做 member/non-member 正負向驗證後才建立 production Client。
9. 若 Worker regression，從 Cloudflare Deployments 回復先前版本；若 schema/data 問題，經變更核准後用 Time Travel bookmark 還原。

專案不提供 repository 內的 GitHub Actions。Git association 由獲授權管理者在 Cloudflare Dashboard 手動建立，建置與部署由 Cloudflare Workers Builds 管理。首次 D1 初始化依步驟 1、2 人工執行；後續 migration 由 production deploy command 自動套用，失敗時不得繼續部署 Worker。

## Cloudflare 控制台人工驗證清單

- Access：Application 只能涵蓋 `APP_HOST/admin/*`；Allow 同時限制 account member 與指定 email；Policy Tester 的允許／拒絕案例都通過；沒有 Bypass、Everyone 或 Service Auth 規則繞過管理頁。公開 `/api/ddns/*` 不可被 Access login redirect。
- DNS API Token：權限只有 `Zone / DNS / Edit`，Resource 是實際 Specific zone；不是 Global API Key。以 `wrangler secret list` 只核對 secret 名稱存在，不讀取值；`secrets.required` 不可當作 deploy gate。
- D1：執行 `npx wrangler d1 migrations list DDNS_DB --remote`，確認 0001–0004 全部 applied、無 pending；在套用前保存 Time Travel bookmark，禁止由本 runbook 自動修改 production 資料。
- Rate limiting：Cloudflare 目前不在 Dashboard 顯示 Workers Rate Limiting bindings；以 `npm run build` 的 binding summary 與部署紀錄確認 `DDNS_PREAUTH_RATE_LIMITER` 60/60、`DDNS_CLIENT_RATE_LIMITER` 10/60、`ADMIN_RATE_LIMITER` 60/60，並盤點帳戶內其他 Worker 設定，確保三個 namespace ID 未共用。用測試 Client 驗證 429 custom logs。另在 Security → WAF 人工確認所需的 edge Rate Limiting rule；需要更強的全球／路徑防護時新增 WAF rule，但不可移除 Worker binding。
- Retention：Triggers 顯示 `17 3 * * *` UTC；Variables 若未設 `LOG_RETENTION_DAYS` 應採 90 天，若有設定則為 1–3650 整數；Workers Logs retention 符合組織政策。用非 production 測試資料驗證 cron 分批清除，不在公開 request 執行 DELETE。
- Observability：Workers Logs 已啟用、invocation logs 已停用；`request_completed` 事件只含 method/pathname/status，沒有 query、Authorization、cookie 或 body。WAF/Workers 告警涵蓋異常 401、429、502、`severity:high` 與 scheduled retention failure。
- TLS：Edge Certificates 的 Always Use HTTPS 已啟用。`curl -sS -o /dev/null -D - http://APP_HOST/` 應回 301/308 且 `Location` 為 HTTPS；`curl -sS -o /dev/null -D - https://APP_HOST/` 應回 Worker 404。
- Secret rotation：建立新 DNS API Token → `wrangler secret put CLOUDFLARE_DNS_API_TOKEN` → 驗證測試 Client → 撤銷舊 Token。Client Token 從管理頁輪替並確認舊值回 401。若 credential 曾出現在 URL，立即輪替並限制、檢查 Workers Logs 存取，不傳播完整 URL。
