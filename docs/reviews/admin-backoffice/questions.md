# 題庫版本寫入交付紀錄

狀態：程式與無資料庫測試完成；隔離 PostgreSQL、瀏覽器操作與截圖仍待可用的系統共享記憶體時段。

## 已完成

- `POST /api/v1/admin/questions/:questionId/revisions` 從目前發布版本複製新草稿，只接受既有文字區塊與答案的稀疏修改。
- `POST /api/v1/admin/questions/:questionId/revisions/:revisionId/review` 保存要求修改或拒絕，並禁止建立者審核自己的版本。
- `POST /api/v1/admin/questions/:questionId/revisions/:revisionId/publish` 以樂觀版本條件發布草稿、將舊版本標記為已取代，保留歷史引用。
- 三個端點共用管理員寫入管線：先驗證 session 與 `system_admin`，再檢查同源、CSRF header、header 冪等鍵及受限 JSON，進入交易後取得帳號鎖並重新授權。
- 題目 service 與稽核、版本寫入及 `admin_mutation_receipts` 使用同一個 transaction runner。production 沒有記憶體收據 fallback。
- 題庫頁、清單 GET 與詳情 GET 都在 `READ ONLY REPEATABLE READ` 快照內重新確認管理員授權；題庫頁的清單、詳情與篩選選項使用同一個 runner。頁面錯誤處理先呼叫 `unstable_rethrow`，不會把登入 redirect 當成一般錯誤吞掉。
- `/admin/questions/reviews` 提供正式待審佇列。它只查詢未封存的系統題目草稿，以最新審核紀錄區分「尚未審核」與「已要求修改」，並支援搜尋、狀態篩選及分頁。佇列的授權與資料查詢也在同一個唯讀快照內完成。
- 題目詳情 Drawer 可從目前發布版建立草稿，另一位管理員可要求修改、拒絕或發布。帳號題目、封存題目、歷史與已退回版本維持唯讀。
- 審核與發布的權限分開判斷。草稿建立者不能審核自己的草稿；目前發布版本的建立者可以審核別人的草稿，但不能親自發布並取代自己建立的目前版本。畫面分別說明被擋下的原因。
- 發布前會呼叫 migration `0009_automatic_answer_completeness` 建立的完整性函式，檢查所有自動判分小題。單選題或是非題若同時出現兩個不同答案 key，API 會在任何審核、稽核或版本狀態寫入前回傳安全的 422，不會等到交易提交時才變成一般 500。
- 表單只送出實際變更的文字或答案；媒體、來源、分類與關係不能由請求覆寫。失敗後以相同內容重試會沿用同一冪等鍵。
- 重試識別同時包含 URL 與 request body，因此不同操作、題目或版本不會共用冪等鍵；使用者切換題目或版本時也會清除先前保留的重試資料。

## 已驗證

2026-10-16 執行：

```text
node --no-warnings --experimental-strip-types --test \
  tests/admin-input.test.ts \
  tests/admin-repository.test.ts \
  tests/admin-view-model.test.ts \
  tests/admin-question-mutation.test.ts \
  tests/admin-question-mutation-delivery.test.ts \
  tests/admin-question-read-handler.test.ts
```

結果：72 tests passed，0 failed。

涵蓋範圍包括：系統／帳號／封存題目、不可覆寫版本、文字與答案輸入限制、來源與 asset 欄位注入拒絕、過期版本衝突、審核與發布權限分離、要求修改後禁止原樣發布、單選與是非題的不同答案 key、重複提交、不同路由目標的重試識別、payload mismatch 409、失敗不完成 receipt、稽核失敗、稀疏表單 patch、待審佇列的篩選與分頁、mutation route 使用受保護交易管線，以及 GET、題庫頁和待審頁使用同一授權快照。

另執行：

```text
npm run lint -- --pretty false
```

結果：通過，0 type errors。

完整 `npm run test:admin` 結果為 158 passed、0 failed。題庫、共用 durable receipt、repository、view model、待審佇列與 read-snapshot 測試均通過。

## 待完成

- 尚未啟動後台專用 PostgreSQL `55439`；目前 macOS System V shared-memory slot 已滿，不能在未協調的情況停止或占用既有 `5432`、`55432`、`3500`、`8443`。
- 因此尚未宣稱 migration `0012`、真實 PostgreSQL 併發冪等、交易回滾、第四課 279 題不變量或完整 revision E2E 已通過。
- 尚未啟動 `3617`，因此沒有把未執行的桌機、平板、手機互動或截圖當成已驗收。
- 待維護時段釋放資源並重新盤點後，需在隔離合成資料庫執行 migration up/down/up、同鍵並行、payload mismatch、失敗 rollback、draft/review/publish 流程及舊作答引用核對，再啟動 `3617` 預覽做桌機、平板、手機與截圖驗收。
