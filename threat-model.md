# Threat Model

| 威脅 | 風險與影響 | 緩解措施 | 剩餘風險 |
|---|---|---|---|
| Client Token 外洩 | 攻擊者可替指定 record 更新至其來源 IP | 獨立 256-bit token、SHA-256 at rest、限流、立即輪替、固定 record | 輪替前仍可濫用；來源 IP 會留 audit |
| DNS API Token 外洩 | 指定 zone DNS 可被全面修改 | Worker secret、Specific Zone + DNS Edit、redaction、定期輪替 | Cloudflare 帳戶/Worker 管理權遭入侵時仍可能取得能力 |
| Access 帳號遭入侵 | 可管理所有 clients | Account Member + email 雙重 allowlist、IdP MFA、Access session 限制、audit | 有效 session 期間仍具管理權 |
| 管理頁 XSS | 可代管理者呼叫 API 或讀取一次性 token | 嚴格 CSP、Vue escaping、無 unsafe-inline/eval、無 token persistence、供應鏈掃描 | 同源依賴被植入仍可能執行 |
| 管理 API 權限繞過 | 未授權管理 DNS 綁定 | Edge Access + Worker 驗 JWT signature/iss/aud/exp/email、403 fail closed | Access/JWKS 平台失陷 |
| D1 資料外洩 | Client metadata、IP、token hashes 外洩 | 無明文 secret、最小管理權、備份加密、retention | IP/metadata 與 hash 仍屬敏感；弱 token 不適用（本系統為高熵） |
| 重放攻擊 | 竊得的 Bearer request 可重送 | TLS、rate limit、來源 IP 只能更新成 edge observed IP、token rotation | Bearer token 本質不具 nonce；同一 NAT 攻擊仍可能重放 |
| 暴力破解 | 猜測 client token | 256-bit entropy、constant-time hash compare、per-client 限流、統一 401 | 分散式低速掃描仍消耗 Worker 資源 |
| DNS Record 越權更新 | client 操作其他 record | record 綁定在 D1、API 不收 record/IP、DB unique constraint、更新前核對 type/name | 管理者誤綁定仍可能造成錯誤 |
| Worker Secret 洩漏 | DNS token/Access config 暴露 | Wrangler secrets、禁止 log/response、分環境、最小 Cloudflare RBAC | Cloudflare 管理平面被接管 |
| GitHub Actions 洩漏 | deploy credential 被 exfiltrate | GitHub Environment approval、短範圍 API token、secret masking、無 client token | 惡意 workflow 在核准後可能讀取 secret，需 branch protection |
| Supply Chain Attack | npm dependency/build 被植入 | lockfile、Dependabot/npm audit、最少 production deps、pin CI action SHA/major、review upgrades | Registry 或 maintainer compromise 無法完全排除 |
| 偽造來源 IP | DNS 被更新為任意 IP | 不讀 body/query；只信 Cloudflare edge headers；嚴格 global unicast validation | Worker 被非 Cloudflare 路徑直接呼叫時 XFF 可偽造，因此 custom domain 與 host gate 必須維持 |
| DoS / 資源耗盡 | D1/API 成本與延遲上升 | 原生 rate limiter、body/route/method 限制、Cloudflare WAF 可加強 | 全球分散攻擊仍可能觸及 Worker |

## 資產與安全目標

最高敏感資產是 DNS API token、Access identity、Client token。核心目標是：任何 Client 最多只能把自己綁定的 A/AAAA record 更新為 Cloudflare edge 確認的來源 IP；任何管理動作必須可歸因到驗證過且在 allowlist 的 email。
