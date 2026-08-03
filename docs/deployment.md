# 部署 Runbook

1. 先在 staging 建立 D1、替換 `wrangler.jsonc` ID，設定四個 secrets，執行 migration。
2. 部署 staging，完成 Access 正負向測試、建立測試 Client、驗證 unchanged/update/rotate/disable。
3. 建立 production D1 與 Access application；以 production secrets 重複設定。
4. 記下 D1 Time Travel bookmark，先 migration、後 deploy。
5. 驗證兩個 custom domains、security headers、Admin 403、DDNS 401，再建立 production Client。
6. 若 Worker regression，回部署前 Git SHA；若 schema/data 問題，經變更核准後用 Time Travel bookmark 還原。

Production GitHub Environment 必須有 required reviewers；production deployment API token 只授予 Worker Scripts Edit、D1 Edit、必要 zone 的 Workers Routes Edit。
