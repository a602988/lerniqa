# Lerniqa 管理後台架構

狀態：管理後台原始碼與正式 `0008` 至 `0011` schema 已整合；`0012` 正在封版。資料庫與瀏覽器尚未驗收，不能把這份架構文件當成已部署證明。

管理後台位於同一個 Lerniqa 專案及網站的 `/admin`。它沿用既有帳號、學習者、題庫、題目版本、作答、統計與稽核資料，不建立另一套會員、題庫或報表來源。管理後台也不是普通使用者的學習者設定頁；導覽、資料範圍與敏感操作由伺服器端管理員授權保護。

## 基準與隔離環境

| 項目 | 固定值 |
| --- | --- |
| 原始 repository | `/Users/jean/Documents/GitHub/lerniqa`，施工期間保持唯讀 |
| 獨立 worktree | `/Users/jean/Documents/Codex/2026-10-16/task/lerniqa-admin` |
| 專用分支 | `codex/lerniqa-admin-20261016` |
| 建立 worktree 的基準 | `6ef62eb139d35693e31ed78ee966f2d1f37a61f9` |
| 前台正式來源 commit | `b21b9d4d74678f79a4146e850f9f75d22380dd50` |
| 本分支前台整合 commit | `a52ee0b17be13c538e1ac5d62144026c3f85baa1` |
| 管理後台 web | `http://127.0.0.1:3617` |
| Next.js dev／preview 目錄 | `.next-admin` |
| Next.js production build 目錄 | `.next-admin-build` |
| PostgreSQL port | `55439` |
| PostgreSQL database | `lerniqa_admin_e2e` |
| PostgreSQL data | `local-data/admin-e2e/postgres` |
| PostgreSQL socket | `local-data/admin-e2e/socket` |

管理後台 worktree 不得使用或停止 `3500`、HTTPS `8443`、PostgreSQL `5432`／`55432` 或 `local-data/postgres`。任何資料庫指令都要明確傳入專用 host、port、database 與 user，不讀取未核准的共用 `DATABASE_URL`。主線整合任務日後若在它獲准的 `55432` 建立 disposable test database，結果屬外部整合證據，不能記成本 worktree 使用過 `55432`。

## Schema 整合

前台正式 commit 已把下列 migration 帶入本分支：

- `0008_auth_and_import_integrity`
- `0009_automatic_answer_completeness`
- `0010_account_role_and_self_learner`
- `0011_score_session_aggregates`

正式帳號與學習者關聯表是 `learner_access`。`accountRole` 與 `activeRole` 是應用程式契約名稱，不是第二份角色資料；一般帳號身份讀取 `users.account_role`，管理權限讀取有效 `user_roles`，session 的 active role 不能代替授權。

Score session 使用 `practice_sessions` 的五個 aggregate 欄位與 answer-free `practice_score_receipts`。報表不得回讀、推導或重新建立 `0011` 已清除的 score 答案明細。只有 score 專屬的私有資產會經 `asset_object_cleanup_jobs` 走受控清理；migration 不直接刪除外部物件。

`0012_admin_catalog_and_question_enrichment` 是唯一下一個 migration，仍在封版與靜態審查。它的契約範圍是：

- 管理方案目錄與管理寫入的耐久收據。
- 同題型優先推薦的來源追溯與 session／queue 一致性。
- 固定題目版本的模型建議與人工審核 sidecar。
- 手寫分析的 durable queue、每次嘗試紀錄與人工採用鏈結。
- 復原 challenge 與建立當下登入 identity 的綁定。
- 練習推薦開始請求的耐久識別與來源陣列。

Migration 只保存並驗證上述資料，不會自行啟動 selector、AI worker、Ollama、付款或通知服務。精確表名、欄位、trigger 與 down 行為要等 SQL 封版後寫入 `docs/reviews/admin-backoffice/schema-integration.md`。在 PostgreSQL up/down/up 與 E2E 完成前，`0012` 不得標示為已驗證。

## KEEL 來源與重用邊界

Lerniqa 透過 lockfile 使用已發布的 KEEL packages。唯讀 source 位於 `/Users/jean/Documents/GitHub/keel-design`，盤點時 HEAD 是 `f53704350e7756492ea0a8399877c457570dc3ca`；`@keel-design/ui@0.4.0-test.25` 的發布 commit 是 `bd03988eafc4d5fa7be9b6f35a435f7b7dfd7173`。

| 套件 | 版本 |
| --- | --- |
| `@keel-design/ui` | `0.4.0-test.25` |
| `@keel-design/icons` | `0.0.4-test.4` |
| `@keel-design/tailwind-config` | `0.0.5-test.3` |
| `@keel-design/themes` | `0.2.0-test.6` |
| `@keel-design/tokens` | `0.3.0-test.11` |

管理後台直接使用 KEEL 的 `AppShell`、`DataTable`、`Pagination`、Button、Badge、Card、表單控制、Alert、Drawer 與 Dialog。KEEL 沒有匯出 Textarea，因此題目長文字使用原生 `textarea`，由 KEEL `FormField` 提供 label 與 description，並沿用共同 focus token。不得從 `dist/*` deep import，也不得建立行為不同卻冒用 KEEL 名稱的元件。

ERP repository `/Users/jean/Documents/GitHub/erp_2026` 只用來參考後台資訊密度與頁面組合。不得搬入 ERP 客戶資料、fixture、Secret、`.env`、憑證、權限常數、Paces／Preline 外層或 ERP 專用業務狀態。

## 授權與請求邊界

- `/admin` 頁面與 `/api/v1/admin/*` 只接受伺服器從 session cookie 建立的登入 context。前端提交的 actor、owner、角色、origin 或管理員旗標都不可信。
- 未登入回傳 `401`，沒有有效 `system_admin` 回傳 `403`，找不到授權範圍內的資源回傳 `404`，樂觀鎖定或冪等內容衝突回傳 `409`，欄位或狀態轉換無效回傳 `422`。
- 每個管理頁及 GET API 在同一個 `READ ONLY REPEATABLE READ` transaction 中重新授權、解析受保護參數並查詢資料。授權與畫面資料不能落在不同 snapshot。
- 查詢先套用授權與資料範圍，再做篩選、排序與分頁。排序片段來自白名單，查詢值使用參數，不能把全量管理資料下載到瀏覽器後再過濾。
- 管理回應只包含畫面需要的欄位，並使用 `Cache-Control: private, no-store`。未知錯誤只回固定訊息與 request ID，不回 SQL、連線資料、stack、token 或完整 server error。
- 管理頁禁止被 iframe 嵌入，並使用 `Referrer-Policy: no-referrer`，避免管理路徑與查詢字串經 Referer 外流。

寫入端點在初次授權後檢查精確 Origin、`Sec-Fetch-Site`、CSRF header、UUID v4／v7 冪等鍵、64 KiB 上限與欄位 allowlist。交易開始後先取得 auth lock，再以原 session 重新授權。操作者或 session 改變時停止寫入。

`admin_mutation_receipts`、業務資料與 `admin_audit_logs` 在同一個 transaction runner 中完成。相同 actor、operation、key 與 payload 可以回放；同一 key 搭配不同 payload 要拒絕；業務或稽核失敗時全部回滾。這項行為目前有 unit test，仍需 PostgreSQL 併發與失敗注入驗收。

## 帳號與角色

帳號清單以 `users` 為根，詳情按需連接 `account_identities`、有效及歷史 `user_roles`、`learner_access` 與 `learners`。bootstrap 管理主體不在 `users`，因此不出現在帳號清單或報表。

清單支援關鍵字、帳號狀態、一般帳號身份、有效角色、信箱驗證與註冊日期篩選，以及白名單排序與伺服器分頁。詳情分開呈現登入身份是否驗證、是否撤銷，學習者關係是否接受／撤銷，以及學習者本身是否啟用。登入服務要求每個帳號只有一個有效 email identity；發現多筆時停止回傳，不任選其中一筆。

帳號管理維持唯讀。`users.status` 的 `active`、`suspended`、`closed` 可以查詢，但本輪不提供停權、關閉、角色授予、角色撤銷、人工驗證或學習者關係異動。任何真實安全變更都需要另一次明確授權與完整交易契約。

## 題庫與題目版本

題庫與題目沿用 `question_banks`、`question_bank_items`、`questions`、`question_revisions`、小題、答案、來源、審核及歷史練習引用。篩選使用正式關聯，不從顯示字串猜測科目、年級、出版社、單元或題號。

- `origin=system` 的有效題目可以建立新 draft revision。
- `origin=account` 的題目可檢視但不可由管理後台修改。
- 新 revision 複製固定版本後只接受允許的文字與答案變更，不原地改寫目前版本。
- 建立者不能審核自己的草稿。要求修改與拒絕保留原因；發布前重新檢查目前版本、審核者、完整答案與樂觀版本條件。
- 發布會保留舊 revision，讓既有 `practice_session_items` 與作答仍指向原版本。

第四課 279 題必須從題庫、來源文件、匯入項目與 revision 關聯動態查得。後台不能寫死筆數，也不能覆寫或刪除這批題目。隔離 E2E 需要在 migration 前後核對 279 題、337 parts、答案鏈與歷史作答引用。

## 訂閱方案目錄

本階段只管理未連接支付的方案目錄：

| 資料 | 用途 |
| --- | --- |
| `subscription_plans` | 穩定 code、名稱、說明與 `draft/active/retired` 狀態 |
| `subscription_plan_prices` | ISO 4217 幣別、minor-unit 金額、週期、狀態與生效區間 |
| `subscription_feature_definitions` | boolean／integer 功能的穩定 key、名稱、單位與狀態 |
| `subscription_plan_feature_limits` | 方案是否包含功能，以及有限數量或 unlimited |

已啟用價格不能原地修改金額、幣別、週期或起日；改價要停用舊價格並建立新草稿。功能型別與限制值必須一致，方案與功能的跨表狀態不能留下無法再調整的限制。

方案 `active` 只表示目錄可供未來選用，不表示支付可用。畫面固定顯示「支付尚未串接」。本階段沒有 account subscription、provider customer、checkout、payment method、invoice、payment、refund、webhook、稅務、proration、entitlement enforcement 或 revenue 報表，也不會建立假方案、付費用戶或收入。

## 管理導覽

| 導覽 | 路由 | 主要內容與操作 |
| --- | --- | --- |
| 總覽 | `/admin` | 帳號、題庫與資料狀態摘要，連到報表與明細 |
| 帳號 | `/admin/accounts` | 搜尋、篩選、排序、分頁與唯讀詳情 Drawer |
| 題庫 | `/admin/questions` | 全題庫、來源、分類、版本、草稿建立與詳情 Drawer |
| 題目審核 | `/admin/questions/reviews` | 待審與要求修改佇列，非建立者可審核或發布 |
| 訂閱方案 | `/admin/subscription-plans` | 管理方案、價格、功能與限制；不能付款或指派訂閱者 |
| 報表 | `/admin/reports` | 註冊、年級、活動、完成、作答與題庫品質 |
| 稽核 | `/admin/audit` | 依安全欄位 allowlist 查詢管理操作 |

桌面使用表格與右側 Drawer。小於 768 px 的 source 契約改用摘要卡；768 px 以上使用 KEEL DataTable，表格位於自己的水平捲動容器。這是原始碼設計，不是瀏覽器驗收結論。Dialog 用於發布等單一步驟確認；未儲存的題目變更在關閉或切換目標前要確認放棄。

## 報表定義

原始時間以 `timestamptz` 保存 UTC，日、週與月統一依 `Asia/Taipei` 分組。查詢區間包含開始時間，不包含結束日期次日零時。

| 指標 | 定義 |
| --- | --- |
| 註冊帳號 | 依 `users.created_at` 計算建立事件；closed 帳號仍留在歷史趨勢 |
| 帳號狀態 | 依 `users.status` 計算查詢當下快照 |
| 有效角色 | 只計未撤銷角色；同一帳號有多角色時可進入多個類別 |
| 年級 | 預設只計 active learner；不在學者獨立呈現 |
| 地區 | schema 沒有地區欄位時顯示「無資料（尚未蒐集）」，不得從學校名稱推測 |
| 活躍學習者 | 期間內有已提交作答的不同 learner；共享 learner 不重複計數 |
| 完成練習 | `completed_at` 落在期間的 completed session |
| 啟動 cohort 完成率 | 期間內開始的 session 中，目前已完成的比例；分母為零顯示無資料 |
| 非 score 作答 | 依保留的不可覆寫作答資料聚合 |
| score 送出 | 依 `practice_score_receipts.submitted_at` 計數，不包含答案 |
| score 結果 | 只加總期間內 completed score session 的五個 aggregate |
| 題庫品質 | 題目、版本、審核、匯入、來源與 `0009` 自動答案完整性 |

有資料列但欄位為 null 顯示「未填」；查詢成功但沒有資料顯示「無資料」；合法零值顯示 `0`；比率分母為零顯示「無資料」；樣本數未達政策門檻顯示「未達顯示門檻」。任何被抑制的結果若能由總數相減得出，相關總數也要抑制。

## 稽核與資料保存

題目版本、審核、發布、方案、價格、功能與限制的管理寫入，要在同一交易完成業務資料、耐久收據與 `admin_audit_logs`。稽核資料只保存 action 所需欄位，不保存密碼、token、request payload、完整答案影像、Secret、付款資料或模型 chain-of-thought。

題目 revision、審核、歷史作答與來源是耐久依據，不能為了簡化後台而覆寫或刪除。報表彙總可以重建；原始作答、session aggregate、score receipt 與稽核才是依據。

## 明確非目標

- 不連接、搬移或修改 production 資料。
- 不對真實帳號升權、撤權、停權、關閉或人工驗證。
- 不建立真實子女資料；資料庫測試只能使用隔離合成資料。
- 不覆寫或刪除第四課 279 題及其 revision、來源、答案或歷史作答。
- 不啟動真實 OCR、手寫辨識、AI 判分、題目 enrichment worker 或相近題 selector。`0012` 只建立可追溯、預設待人工確認的資料契約。
- 不連接 Ollama；目前偵測到的對外綁定也不能用於真實兒童資料。
- 不建立 SMTP durable outbox；現有郵件服務不提供本輪可宣稱的耐久排程、重試或送達保證。
- 不啟用 checkout、扣款、付款資料、訂閱指派或收入報表。
- 不新增 production 憑證、Secret、MFA、RLS／GRANT 或部署權限。
- 不推送、合併或部署公開環境。
- 不把 fixture、SQL test source、本機 build 或 CSS 程式稱為已上線、已通過資料庫或已通過瀏覽器。

## 交付界線

本輪交付是獨立分支上的本機 commit與驗證紀錄。資料庫、截圖與 `127.0.0.1:3617` 預覽只有在使用者明確通知安全維護時段、專用 PostgreSQL 與網站成功啟動並完成驗收後，才能列為交付內容。任何 production migration、真實安全變更、公開部署或支付串接都需要另一次明確授權。
