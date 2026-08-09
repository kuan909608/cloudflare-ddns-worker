# Threat Model

| 威脅 | 風險與影響 | 緩解措施 | 剩餘風險 |
|---|---|---|---|
| Client Token 外洩 | 攻擊者可替指定 record 更新至其來源 IP | 獨立 256-bit token、SHA-256 at rest、限流、立即輪替、固定 record | 輪替前仍可濫用；來源 IP 會留 audit |
| DNS API Token 外洩 | 指定 zone DNS 可被全面修改 | Worker secret、Specific Zone + DNS Edit、redaction、定期輪替 | Cloudflare 帳戶/Worker 管理權遭入侵時仍可能取得能力 |
| Access 帳號遭入侵 | 可管理所有 clients | Account Member + email 雙重 allowlist、IdP MFA、Access session 限制、audit | 有效 session 期間仍具管理權 |
| 管理頁 XSS | 可代管理者呼叫 API 或讀取一次性 token | 嚴格 CSP、Vue escaping、無 unsafe-inline/eval、無 token persistence、供應鏈掃描 | 同源依賴被植入仍可能執行 |
| 管理 API 權限繞過 | 未授權管理 DNS 綁定 | Access policy 管理 Email allowlist；Worker 驗 JWT signature/iss/aud/exp/type/email identity、403 fail closed | Access/JWKS 平台失陷 |
| D1 資料外洩 | Client metadata、IP、token hashes 外洩 | 無明文 secret、最小管理權、備份加密、retention | IP/metadata 與 hash 仍屬敏感；弱 token 不適用（本系統為高熵） |
| 重放攻擊 | 竊得的 Bearer request 可重送 | Worker 拒絕明文 HTTP、Cloudflare Always Use HTTPS、rate limit、來源 IP 只能更新成 edge observed IP、token rotation | Bearer token 本質不具 nonce；同一 NAT 攻擊仍可能重放 |
| 暴力破解 | 猜測 client token、隨機 slug 消耗 D1，或錯誤 Token 排擠合法更新 | 256-bit entropy、constant-time hash compare、來源 IP pre-auth 60/min、驗證後 per-client 10/min、統一 401 | 分散式低速掃描仍可能消耗 Worker 資源 |
| DNS Record 越權更新 | client 操作其他 record | record/待建立 FQDN 綁定在 D1、設備 API 不收 record/IP、DB unique constraint、更新前核對 type/name；首次建立以 conditional claim 防重複 | 管理者誤綁定或命名仍可能造成錯誤 |
| Worker Secret 洩漏 | DNS token/Access config 暴露 | Wrangler secrets、禁止 log/response、最小 Cloudflare RBAC | Cloudflare 管理平面被接管 |
| 原始碼或部署環境洩漏 | 原始碼、build 設定或 runtime credential 被 exfiltrate | Repository 不含自動化 workflow、Cloudflare Git App 只授權指定 repository、runtime secrets 只設於 Worker environment、無 client token、branch protection | GitHub 或 Cloudflare 管理帳號遭入侵時仍可能觸發惡意部署 |
| Supply Chain Attack | npm dependency或 Cloudflare build 被植入 | lockfile、本機 npm audit、最少 production deps、人工審查升級、限制 Cloudflare Git App repository scope | Registry、maintainer、GitHub 或 Cloudflare build chain compromise 無法完全排除 |
| 偽造來源 IP | DNS 被更新為任意 IP | 不讀 body/query；CF-Connecting-IP 存在但 family 不符時 fail closed；僅在它缺漏/格式無效時依規格檢查 XFF；嚴格 global-unicast validation，private mode 只放行 RFC1918/ULA | Worker 被非預期路徑呼叫時轉送 header 風險仍需由 custom domain、host gate 與 Cloudflare edge 維持 |
| DoS / 資源耗盡 | D1/API 成本與延遲上升 | D1 固定窗口三層限流、過期窗口索引清理、body/route/method 限制、Cloudflare WAF 可加強 | 全球分散攻擊仍可能觸及 Worker，且 limiter 與業務資料共用 D1 額度 |

## 資產與安全目標

最高敏感資產是 DNS API token、Access identity、Client token。核心目標是：任何 Client 最多只能把自己綁定的 A/AAAA record 更新為 Cloudflare edge 確認的來源 IP；任何管理動作必須可歸因到經 Access policy 授權且由 Worker 驗證 JWT identity 的 email。
