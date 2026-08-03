# 部署 Runbook

1. 先在 staging 建立 D1、替換 `wrangler.jsonc` ID，設定四個 secrets，執行 migration。
2. 手動部署一次 staging，完成 Access 正負向測試、建立測試 Client、驗證 unchanged/update/rotate/disable。
3. 建立 production D1 與 Access application；以 production secrets 重複設定。
4. 記下 D1 Time Travel bookmark，先 migration、後首次 deploy。
5. 在 Cloudflare Worker 的 Settings → Builds 手動連結 GitHub repository，production branch 選 `main`，Build command 使用 `npm run build:frontend`，Deploy command 使用 `npx wrangler deploy --env production`。
6. 視需求關閉 non-production branch builds；GitHub repository 不放 Actions 或 Dependabot 設定。
7. SSL/TLS mode 設為 Full (strict)，開啟 Always Use HTTPS；驗證 HTTP credential request 被 Worker 拒絕，再驗證兩個 custom domains、security headers、Admin 403、DDNS 401。
8. Access application 必須只啟用 Cloudflare IdP，IdP 開啟 Restrict to account members；Allow policy 同時 Require Cloudflare Account Member 並 Include 指定 Email。用 Policy Tester 做 member/non-member 正負向驗證後才建立 production Client。
9. 若 Worker regression，從 Cloudflare Deployments 回復先前版本；若 schema/data 問題，經變更核准後用 Time Travel bookmark 還原。

專案不提供 repository 內的 CI/CD。Git association 由獲授權管理者在 Cloudflare Dashboard 手動建立，建置與部署由 Cloudflare Workers Builds 管理。D1 migration 仍由管理者手動執行並保留變更核准紀錄。
