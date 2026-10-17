# 管理後台基礎審查證據

狀態：管理後台基礎程式、正式前台 schema 整合、靜態檢查與無資料庫測試已完成一輪。PostgreSQL、網站服務與瀏覽器尚未啟動。

## 程式基準與隔離

| 項目 | 使用值 |
| --- | --- |
| worktree | `/Users/jean/Documents/Codex/2026-10-16/task/lerniqa-admin` |
| 分支 | `codex/lerniqa-admin-20261016` |
| 建立 worktree 的基準 | `6ef62eb139d35693e31ed78ee966f2d1f37a61f9` |
| 前台正式來源 commit | `b21b9d4d74678f79a4146e850f9f75d22380dd50` |
| 本分支前台整合 commit | `a52ee0b17be13c538e1ac5d62144026c3f85baa1` |
| 管理後台 web | `127.0.0.1:3617` |
| 開發／preview 目錄 | `.next-admin` |
| production build 目錄 | `.next-admin-build` |
| PostgreSQL port | `55439` |
| database | `lerniqa_admin_e2e` |
| PostgreSQL data | `local-data/admin-e2e/postgres` |
| PostgreSQL socket | `local-data/admin-e2e/socket` |

`3500`、`8443`、`5432`、`55432`、`local-data/postgres`、原始 checkout 的程序及真實資料庫不在使用範圍。這輪沒有啟動 `3617` 或 `55439`，也沒有停止或變更保留服務。

## 已整合的正式契約

前台的 `0008` 至 `0011` 已從單一正式 commit 帶入，沒有複製前台未提交檔案：

- `0008_auth_and_import_integrity` 固定有效 session、學習者與帳號鎖定順序，並只修正指定 confirmed Hanlin 批次的原生文件分類。
- `0009_automatic_answer_completeness` 要求已發布或已取代版本的自動判分小題有可用答案。
- `0010_account_role_and_self_learner` 加入 `users.account_role`、self learner、名稱與設定權限限制。帳號與學習者的唯一正式關聯表是 `learner_access`。
- `0011_score_session_aggregates` 加入五個 score aggregate、answer-free `practice_score_receipts` 與 `asset_object_cleanup_jobs`。後台報表不回讀已清除的 score 作答內容。

`0012_admin_catalog_and_question_enrichment` 仍在封版與靜態審查。SQL 檔案已存在不等於 migration 已通過；它要等專用 PostgreSQL 可安全啟動後，才能執行 up/down/up 與 E2E。

## 管理員與資料讀取邊界

- session token 只從 HttpOnly cookie 取得，伺服器雜湊後查詢。瀏覽器提交的 `activeRole` 或管理員旗標不是授權依據。
- 管理頁與 GET API 在同一個 `READ ONLY REPEATABLE READ` transaction 中重新確認有效 session、帳號狀態與未撤銷的 `system_admin` 授權，再解析受保護參數及查詢資料。
- 未登入與沒有管理權限分別使用 `401` 與 `403`。查詢錯誤不回傳 SQL、連線資訊、stack 或未整理的例外訊息。
- 帳號、題目、方案與稽核清單使用參數化篩選、排序白名單、固定 tie-breaker 與伺服器分頁。資料不是先下載到瀏覽器再篩選。
- 管理回應使用 `Cache-Control: private, no-store`。管理頁另禁止外站 iframe 嵌入，並使用 `Referrer-Policy: no-referrer`。
- 帳號 API 不回傳 password hash、session token、token hash、MFA 或 provider credential。題目資產另檢查正式引用、掃描狀態、路徑、symlink、大小、checksum 與 MIME allowlist。

## 管理寫入邊界

題目版本與訂閱目錄的寫入路由共用同一套管理操作管線。路由先驗證管理員，再檢查精確 Origin、`Sec-Fetch-Site`、CSRF header、UUID 冪等鍵與最多 64 KiB 的受限 JSON。交易開始後取得 auth lock，並用原 session 再次確認操作者仍有權限。

`admin_mutation_receipts`、業務資料與 `admin_audit_logs` 共用同一個 transaction runner。相同 actor、operation、冪等鍵與內容可以回放；相同鍵搭配不同內容會衝突；業務或稽核失敗時不能留下已完成收據。這是原始碼與單元契約的結論，尚未以真實 PostgreSQL 併發驗證。

帳號管理維持唯讀。帳號停權、關閉、角色授予、角色撤銷、人工驗證與學習者關係異動沒有 route，也沒有在 unit fixture 以外執行。

## KEEL 與 ERP 邊界

Lerniqa 使用 lockfile 中的 `@keel-design/ui@0.4.0-test.25` 及相同套件族。唯讀核對的 KEEL source 位於 `/Users/jean/Documents/GitHub/keel-design`，source HEAD 為 `f53704350e7756492ea0a8399877c457570dc3ca`；UI 發布 commit 為 `bd03988eafc4d5fa7be9b6f35a435f7b7dfd7173`。

管理後台直接使用 KEEL 的 AppShell、表格、分頁、表單、Button、Badge、Card、Alert、Drawer 與 Dialog，沒有以 Lerniqa 元件冒充同名 KEEL 元件。ERP repository 只用來核對資訊密度與頁面組合；沒有搬入客戶資料、Secret、`.env`、憑證、權限值或 ERP 專用狀態。

## 已執行驗證

| 驗證 | 結果 |
| --- | --- |
| 管理後台單元與 source contract | `npm run test:admin`，161/161 通過 |
| runtime 隔離 guardrails | `npm run test:runtime-guardrails`，31/31 通過 |
| 既有 auth、mail、verification、answer disclosure、backup 與題目 fixture | 各自的 npm script 通過 |
| TypeScript | `npm run lint` 通過 |
| production build | 使用 `.next-admin-build` 的隔離 `next build` 通過 |
| diff 格式 | `git diff --check` 通過 |

Build 仍會列出 KEEL 文件預覽器的選用套件 warning。管理後台沒有使用該功能，warning 沒有阻斷產物；這不代表文件預覽器已驗證。

## 尚未驗收

最近一次唯讀盤點仍有 32 個 macOS System V shared-memory segments，`55439` 沒有 listener，因此本分支不能安全啟動資料庫，也不得改用 `55432`。主線整合任務之後會在它獲准使用的 `55432` 建立 disposable test database；它的結果可以作為整合依賴證據，但不能記成本分支執行。在相應證據交付前，下列項目保持未完成：

- `0012` 的 PostgreSQL migration、constraint、trigger、down 與 schema parity。
- 管理 API 的資料庫整合、鎖定、撤權、併發、rollback 與 durable receipt E2E。
- 合成資料的帳號、題目、方案、報表和稽核流程，以及第四課 279 題不變量。
- `3617` 預覽、390／768／1024／1440 px、鍵盤、焦點、錯誤恢復、截圖與 VoiceOver。

沒有資料庫或瀏覽器證據的項目不能因 unit test、SQL test source、fixture 或 CSS 已存在而改列為通過。
