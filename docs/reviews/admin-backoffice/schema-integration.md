# 管理後台 schema 整合紀錄

狀態：`0008` 至 `0011` 已從前台正式 commit 整合；`0012` 已取得主線 disposable database 的 PostgreSQL migration 證據。本 worktree 仍未使用專用 `55439`。

## 來源與 commit

| 項目 | 值 |
| --- | --- |
| worktree 基準 | `6ef62eb139d35693e31ed78ee966f2d1f37a61f9` |
| 前台正式 commit | `b21b9d4d74678f79a4146e850f9f75d22380dd50` |
| 本分支整合 commit | `a52ee0b17be13c538e1ac5d62144026c3f85baa1` |
| 下一個 migration | `0012_admin_catalog_and_question_enrichment` |

前台 commit 以 cherry-pick 帶入，沒有從前台工作目錄複製未提交檔案。帳號與學習者沿用 `users`、`user_roles`、`learners` 與 `learner_access`；不存在也不得建立 `user_learner_access`。

## 已整合的契約

### `0008_auth_and_import_integrity`

有效 session 指向的 active learner、帳號與學習者固定鎖定順序，以及 active learner 查詢索引已納入。資料修正只針對指定 confirmed Hanlin 批次，把教材關聯改為 `native/document`；migration 不建立平行身份或題庫資料。

### `0009_automatic_answer_completeness`

已發布與已取代版本的 automatic 小題必須有可用答案。升級前置檢查遇到缺漏會停止，不補造答案。題目發布 API 也在寫入審核與版本狀態前呼叫相同完整性判斷，將可辨認的輸入問題回覆為 `422`。

### `0010_account_role_and_self_learner`

`users.account_role` 的值域是 parent、tutor、learner。每個 learner 帳號要有唯一、未撤銷的 self learner，並維持名稱與 `can_manage_settings=true`。登入身份、一般角色與 self learner 在交易完成時必須一致。

帳號後台不把 `account_role` 當成 `system_admin`。前者是一般帳號身份，後者仍由未撤銷的 `user_roles` 授權。

### `0011_score_session_aggregates`

`practice_sessions` 有 total、answered、correct、wrong、pending 五個 score aggregate。`practice_score_receipts` 只保存 answer-free 送出證據；`asset_object_cleanup_jobs` 保存外部物件清理工作。Score session 的逐題答案、錯題或相近題 queue 與相關 outbox 已依 migration 契約移除，五張可重建統計表只從保留的非 score 明細重建。

後台報表因此遵守兩個資料來源：送出活動依 receipt 的 `submitted_at`，結果依 completed session 的 aggregate 與 `completed_at`。它不連接或推導已刪除的 score 答案明細。

## `0012` 封版範圍

`0012` 目前同時承載下列正式契約，不能拆成另一個平行 migration：

- 未連接支付的方案、價格、功能定義與功能限制。
- 題目與方案管理寫入的耐久冪等收據，以及與管理稽核的同交易關係。
- 同題型優先推薦的來源追溯。粗型別需要固定 revision 上的來源分類與原始題型標籤一致，其他題型使用正式 type identity；same unit 不能冒充 same type。
- 固定 revision 的 enrichment run 與 suggestion，保留 provider、model、version、input hash、evidence、confidence 及人工審核狀態，不修改 frozen revision。
- 手寫分析的 durable queue、lease／attempt 狀態、每次執行結果與人工採用鏈結。模型不得寫成 human reviewer，也不得直接修改正式答案、目前判定、錯題 queue 或統計。
- 復原 challenge 綁定建立當下的登入 identity。舊資料無法唯一對應 active email 時要失效，不能猜測。
- 練習推薦開始請求的 session 冪等識別、canonical v1 hash、來源 queue／result 陣列、limit 與 check mode。
- 推薦 origin 不得用於 score；已有 origin 的 session 也不能改成 score。

Selector 的「完整同題型集合為零才可使用已確認相似群組」是應用程式交易規則。Migration 可以驗證保存的來源依據，但不能靠 constraint 證明 selector 已先完整列舉候選。這項整合依賴必須由前台推薦 service 另行驗證。

帳號復原的 identity 綁定只處理 token 與登入身份的資料完整性。本輪沒有建立 SMTP durable outbox；既有 mail unit test 也不能證明復原郵件具有耐久排程、重試或送達保證。

精確表名、欄位、索引、trigger、狀態轉換與 down 拒絕以 `0012_admin_catalog_and_question_enrichment` 的 up、down 與 SQL test 為準。後續若修改 production schema，必須重新執行完整 migration 驗證。

## PostgreSQL 整合證據

2026-10-17，主線整合任務使用既有 `55432` 的 PostgreSQL 服務，在隨機命名的 `lerniqa_schema_test_*` disposable database 執行 `scripts/verify-database-migrations.sh`。候選內容由主線正式 commit 與本分支的四個 `0012` migration／test 檔組成，沒有套用到 `lerniqa_local`。

驗證結果為 12 組 migration 第一次前進與限制測試通過，逐層 down 與上一層 schema 比對通過，第二次前進與 schema parity 通過，指令 exit code 為 `0`。驗證後查詢 `pg_database`，沒有留下 `lerniqa_schema_test_*` database。

同一節點也通過 question enrichment 23 項、handwriting worker 14 項、handwriting persistence 11 項與 recommendation contract 10 項測試。這些結果涵蓋 worker 與 migration 的欄位、狀態及資料保存契約；它們不代替管理後台 API、報表手算、併發與瀏覽器驗收。

## 尚待驗收的資料庫範圍

最近一次在臺北時間 02:07 完成的唯讀盤點仍有 32 個 macOS System V shared-memory segments，`55439` 沒有 listener。使用中的 13 個 attached segments 不可停止；19 個 unattached stale segments 沒有清理批准。依隔離規則，本分支沒有啟動 `55439`，也沒有執行 `ipcrm` 或碰觸 `5432`、`55432`、`3500`、`8443`。

主線 migration 驗證已完成。下列管理後台情境仍未執行：

- 管理 durable receipt 的同鍵併發、不同 payload conflict、稽核失敗回滾與 lock 行為。
- 管理 API 的授權拒絕、資料範圍、分頁、排序、篩選與報表手算。
- 279 題、337 parts、答案鏈、固定 revision 與歷史作答引用的前後數量核對。

本分支仍不得使用 `55432`。只有使用者另行明確通知安全維護時段，且重新盤點後確定有可用 shared-memory slot，才可使用專用 data、socket、port `55439` 與 database `lerniqa_admin_e2e` 執行其餘測試。
