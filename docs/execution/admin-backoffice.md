# 管理後台整合與付費能力交接

更新日期：2026-10-17

## Repository 狀態

- Repository：`/Users/jean/Documents/GitHub/lerniqa`
- Branch：`main`
- 最後已推送 commit：`98915e23c3e32cae870b2bac43c9b6144f01ee55`
- 本階段尚未 commit，也未部署。
- 後台來源工作樹：`/Users/jean/Documents/Codex/2026-10-16/task/lerniqa-admin`
- 後台來源 branch：`codex/lerniqa-admin-20261016`
- 後台來源 commit：`a52ee0b17be13c538e1ac5d62144026c3f85baa1`

## 已完成

- 將既有的管理路由、管理 API、管理元件、repository 與 20 個管理測試檔移植到最新主系統。
- 保留主分支後來加入的帳號復原、教育階段、手寫辨識、題目推薦與 migration 0013／0014；沒有整批合併舊後台分支。
- 管理後台已改用主系統 PostgreSQL 連線。讀取授權與聚合資料會共用同一個 read-only repeatable-read snapshot（唯讀、可重複讀取快照）。
- 修正同一個 transaction client（交易連線）透過 `Promise.all` 並行查詢造成的 pg 棄用警告。
- `/account?returnTo=/admin` 登入成功後會回到後台。只允許 `/admin` 與子路徑，外部網址、其他站內路徑、protocol-relative URL（省略協定的網址）及反斜線形式會被拒絕。
- 管理頁加入禁止 iframe 嵌入及 referrer 洩漏的 HTTP header。
- `http://127.0.0.1:3500/admin` 與 `https://linmacbook-pro.tailc132cc.ts.net:8443/admin` 已從 404 改為 307，正確導向 `/account?returnTo=/admin`。
- 使用者確認後，既有 `Jean lin` 帳號已由 `bootstrap_admin` 授予 `system_admin`。角色授權與 `admin_role_granted` 稽核紀錄在同一交易完成；沒有修改密碼或其他帳號資料。

## 驗證與證據

- `npm run test:admin`：exit code 0，161 項通過、0 項失敗。
- `node --no-warnings --experimental-strip-types --test tests/admin-return-path.test.ts tests/admin-read-snapshot.test.ts`：exit code 0，6 項通過、0 項失敗。
- `npm run lint`：exit code 0。
- `npm run build`：exit code 0；30 項 runtime guardrail（執行環境防護）測試通過，管理頁與管理 API 全部出現在 production route manifest（正式路由清單）。build 仍有 KEEL 文件預覽缺少四個選用套件的既知警告，列在施工計畫 R11，不影響本次編譯成功。
- `npm run db:local:status`：主資料庫執行中，socket 為 `local-data/postgres-socket`，port 55432，database 為 `lerniqa_local`。
- URL 檢查：本機與 8443 的 `/admin` 都回傳 307 並導向正確登入網址。
- 正式資料庫仍是 14 個帳號、279 題、13 個學習者；本階段未執行 seed、reset 或測試 cleanup。

## 未提交檔案與責任範圍

本任務新增或修改：

- `app/admin/`
- `app/api/v1/admin/`
- `app/components/admin/`
- `app/lib/admin/`
- `app/lib/admin-return-path.ts`
- `app/lib/postgres-read-transaction.ts`
- `app/lib/local-postgres.ts`
- `app/account/page.tsx`
- `next.config.ts`
- `package.json`
- `tests/admin-*.test.ts`
- `tests/postgres-read-transaction.test.ts`
- `docs/review.md`
- `docs/review-plan.md`
- `docs/reviews/admin-backoffice-integration-interface-quality-review.md`
- `docs/execution/admin-backoffice.md`

工作樹另有正在進行的前端、手寫辨識、教材、題目關聯與文件修改。這些不是管理後台整合產生，不得回退或覆寫。特別包含 `AGENTS.md`、`README.md`、`app/globals.css`、`app/page.tsx`、多份既有 `docs/`、手寫測試，以及 migration 0014。

## 目前阻擋

- 瀏覽器原本登入的是沒有管理員權限的合成介面驗收帳號，後台正確拒絕存取。該帳號已登出，分頁停在 `Jean lin` 的登入步驟；需要使用者自行輸入既有密碼，才能完成真實登入與正式資料瀏覽器驗證。
- 預設系統管理員、MFA、Secret Manager、登入速率限制與 production RLS／GRANT 仍等待部署環境決策，不能以本機帳號授權代替。
- AI 點數的每位學習者額度、三種 AI 功能扣點數值、免費群組取得的方案與金流供應商尚未確認。這些項目阻擋訂閱資料模型與金流施工，不阻擋管理後台讀取功能。

## 下一個可直接執行的動作

1. 使用者在已開啟的 8443 帳號頁輸入 `Jean lin` 的既有密碼。
2. 登入後核對自動返回 `/admin`、14 個帳號、279 題，以及桌面與手機的管理流程。
3. 完成 R2、R3 的階段審查後，再進入 R5–R9；尚未確認的 AI 點數數值必須保留為設定，不得寫成 magic value（散落在程式中的固定值）。

## 不得回退或覆寫

- 主資料庫既有帳號、角色、學習者、279 題、題目版本、作答與稽核紀錄。
- migration 0013、0014 及其對應的主分支功能。
- 主工作樹內其他任務的未提交修改。
- 原後台工作樹的未提交內容；在本階段完成 commit 前，它仍是移植來源與回復證據。
