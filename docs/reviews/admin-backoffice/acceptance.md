# 管理後台驗收紀錄

狀態：原始碼、不需資料庫的驗證與主線 disposable database 的 migration 驗證已完成；後台合成資料 E2E、網站服務、瀏覽器、截圖與獨立預覽尚未驗收。

這份紀錄只把實際執行並取得結果的項目列為通過。SQL 檔案、unit fixture、React 程式與 CSS breakpoint 都不是 PostgreSQL 或瀏覽器驗收證據。

## 交付範圍

管理後台位於同一個 Lerniqa 專案的 `/admin`，沿用既有帳號、學習者、題庫、題目版本、作答、統計與稽核模型。已完成的原始碼範圍包括：

- 帳號清單與詳情的唯讀查詢、篩選、排序、分頁，以及登入身份、角色與學習者關係狀態。
- 全題庫查詢、題目詳情、版本歷史、系統題目草稿、不同管理員審核與發布，以及待審佇列。帳號題目維持唯讀。
- 未連接支付的方案、價格、功能定義與功能限制目錄。程式不包含訂閱者、付款、發票、退款或收入。
- 註冊、帳號狀態、角色、年級、活動、練習完成、作答結果與題庫品質報表。缺值、真實零、零分母、未蒐集與小樣本抑制分開呈現。
- 管理員伺服器授權、唯讀 snapshot、Origin／CSRF、受限 JSON、耐久冪等收據、交易內重新授權、稽核欄位 allowlist、資產讀取限制與管理頁防嵌入 header。
- KEEL `AppShell`、`DataTable`、`Pagination`、表單、Button、Badge、Card、Alert、Drawer 與 Dialog 的共用介面。ERP 只作唯讀版面參考。

帳號停權、關閉、角色授予、角色撤銷與人工驗證沒有開放。沒有建立任何真實方案、付費用戶、收入或子女資料，也沒有變更真實帳號或第四課 279 題。

## 已取得的驗證結果

| 驗證 | 結果 | 能證明的範圍 |
| --- | --- | --- |
| `npm run test:admin` | 161/161 通過 | 管理輸入、授權、唯讀 snapshot、repository、報表、題目版本寫入、方案目錄、冪等與介面純函式；不含 PostgreSQL 與瀏覽器 |
| `npm run test:runtime-guardrails` | 31/31 通過 | 本機 PostgreSQL、匯入 runner 與管理後台隔離 guardrail；沒有啟動服務 |
| `npm run test:auth` | 通過 | 登入與 session 核心單元契約 |
| `npm run test:mail` | 通過 | 郵件服務單元契約 |
| `npm run test:email-verification` | 通過 | 信箱驗證單元契約 |
| `npm run test:answer-disclosure` | 通過 | 練習答案揭露限制 |
| `npm run test:local-backup` | 通過 | 本機資料備份 guardrail |
| `npm test` | 通過 | repository 既有題目 fixture 完整性檢查；fixture 不是資料庫實況 |
| `npm run lint` | 通過 | TypeScript 靜態型別 |
| 隔離 production build | 通過，有既有 warning | Next.js production 編譯與頁面產物；沒有啟動 PostgreSQL 或網站 |
| `git diff --check` | 通過 | 目前 diff 沒有 whitespace error |
| 主線 `0012` migration 驗證 | 12 組前進、限制測試、逐層回滾、再次前進與 schema parity 通過 | 使用 `55432` 的隨機 disposable database；沒有套用到 `lerniqa_local`，清理後未留下 `lerniqa_schema_test_*` database |
| enrichment／handwriting／recommendation 契約測試 | 58/58 通過 | worker 與 migration 的欄位、狀態及保存契約；不含管理後台瀏覽器操作 |

Production build 使用 `.next-admin-build`、專用 socket 路徑、port `55439` 與 database 名稱執行直接的 `next build`。建置成功，但 KEEL 未使用的文件預覽功能仍會報告選用套件缺少的 warning，包括 `exceljs`、`docx-preview`、`@aiden0z/pptx-renderer` 與 `markdown-it`。這些 warning 沒有阻斷產物；它們也不能視為文件預覽功能已驗證。

## 尚未取得的證據

最近一次在臺北時間 02:07 完成的唯讀盤點仍有 32 個 macOS System V shared-memory segments，`55439` 沒有 listener。前台服務與 ERP preview 使用中的 13 個 attached segments 不可停止；19 個沒有 attachment 的 stale segments 也沒有獲得清理批准。因此本輪沒有啟動後台專用 PostgreSQL `55439`，也沒有啟動 Next.js `3617`。

主線已完成 `0012` migration 驗證。這個阻擋仍使下列項目無法驗收：

- 以合成資料驗證 `401`、`403`、撤權、資料範圍、分頁、報表手算、重複提交、交易回滾及題目版本歷史。
- 第四課 279 題與 337 parts 在套用 `0012` 後仍完整且不被覆寫。
- 方案目錄、題目版本與 durable receipt 的真實 PostgreSQL 併發測試。
- 390、768、1024、1440 px 的操作，鍵盤與焦點，Drawer／Dialog，長文字、錯誤恢復、200% zoom 與 VoiceOver。
- desktop、tablet、mobile 與焦點狀態截圖，以及 `http://127.0.0.1:3617` 獨立預覽。

瀏覽器尚未開啟，不能把 source CSS 或 unit fixture 寫成響應式畫面已驗收。

主線整合任務已在獲准使用的 `55432` 上，以 disposable database 驗證 `0012`。本分支仍不得連接 `55432`；其餘 E2E 必須在專用環境執行。

## Schema 與整合狀態

前台正式 commit `b21b9d4d74678f79a4146e850f9f75d22380dd50` 已整合成本分支 commit `a52ee0b17be13c538e1ac5d62144026c3f85baa1`。本分支因此沿用正式的 `0008` 至 `0011`，包括 `learner_access`、`users.account_role`、自動答案完整性、score aggregates、answer-free `practice_score_receipts` 與資產清理工作。

`0012_admin_catalog_and_question_enrichment` 同時承載管理方案目錄、管理寫入收據、題型優先推薦的追溯資料、題目版本 enrichment、手寫分析工作與嘗試紀錄、帳號復原 identity 綁定，以及練習推薦請求的耐久識別。主線 disposable database 已驗證 migration；管理後台 runtime 仍待專用環境驗收。

## 交付限制

本輪沒有使用或停止 `3500`、`8443`、`5432`、`55432`，沒有執行 `ipcrm`，也沒有連接真實資料庫。沒有推送、合併、公開部署、建立憑證、串接支付或執行任何真實安全變更。

待 `0012` 封版後，資料庫證據可由主線獲准的 disposable database 驗收提供；本分支只有在使用者另行明確通知安全維護時段後，才可重新盤點 shared-memory slots 並啟動 `55439`。網站預覽、瀏覽器驗收與截圖仍需 `3617` 實際執行。若這些證據未提供，交付狀態必須維持「原始碼完成、runtime 驗收未完成」。
