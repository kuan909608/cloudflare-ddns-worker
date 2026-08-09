# 部署 Runbook

1. 本機先驗證 migration；在 Worker Dashboard 設定正式 `APP_HOST`、固定且唯一的 `DNS_ZONE_ID` 等 runtime variables，再執行首次 deploy。`wrangler.jsonc` 不宣告 production `vars` 且使用 `keep_vars:true`，避免後續 Git 部署覆蓋 Dashboard 現值。Wrangler 會從 draft `DDNS_DB` binding 自動建立並綁定唯一 D1。此時不要關聯公開網域。
2. 在尚未關聯公開網域時立即執行 `npm run db:migrate`，確認遠端 schema 完整後記下 Time Travel bookmark。
3. 建立只涵蓋 `ddns.example.com/admin/*` 的 Access application，取得 AUD；建立最小權限 DNS API Token 並設定三個 Worker runtime secrets。
4. 在 Dashboard 手動建立唯一的 Custom Domain；不要保護整個 hostname，並確認 Full (strict) 與 Always Use HTTPS。
5. 完成 Access member/non-member 正負向測試、建立測試 Client、驗證 unchanged/update/rotate/disable。
6. 在 Cloudflare Worker 的 Settings → Builds 手動連結 GitHub repository，production branch 選 `main`，Build command 使用 `npm run build:frontend`，Deploy command 使用 `npx wrangler deploy`。
7. 視需求關閉 non-production branch builds；GitHub repository 不放 Actions 或 Dependabot 設定。
8. Access application 必須只啟用 Cloudflare IdP，IdP 開啟 Restrict to account members；Allow policy 同時 Require Cloudflare Account Member 並 Include 指定 Email。用 Policy Tester 做 member/non-member 正負向驗證後才建立 production Client。
9. 若 Worker regression，從 Cloudflare Deployments 回復先前版本；若 schema/data 問題，經變更核准後用 Time Travel bookmark 還原。

專案不提供 repository 內的 CI/CD。Git association 由獲授權管理者在 Cloudflare Dashboard 手動建立，建置與部署由 Cloudflare Workers Builds 管理。D1 migration 仍由管理者手動執行並保留變更核准紀錄。
