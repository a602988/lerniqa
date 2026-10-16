# PostgreSQL migration

正式資料庫以 PostgreSQL 為基準。`0001` 至 `0005` 定義 94 張業務資料表，另有一張技術性的 `schema_migrations`。現有 `/api/v1`、表單與 fixture 仍主要讀寫 JSON；這些 migration 只建立正式 schema，不會自動切換應用程式資料來源。

## 本機驗證

```bash
npm run db:test
```

需要 `initdb`、`pg_ctl`、`createdb`、`psql` 與 `pg_dump` 可由 `PATH` 執行。驗證腳本會在 `/tmp` 建立一次性 PostgreSQL cluster，關閉 TCP，只開啟權限為 `0700` 的私有 Unix socket，並清除可能把指令導向既有伺服器的 PostgreSQL 環境設定。每個資料庫指令都明確指定 host、port、user 與 database，且以 `PSQLRC=/dev/null` 執行。

腳本會自動找出每組 migration，依序執行前進與限制測試，再逐階段回滾、檢查 migration 紀錄／資料表／schema 回復，最後再次前進並比對 schema。結束時停止 cluster 並刪除整個暫存目錄，不會連線或修改既有資料庫。在限制本機程序或共享記憶體的 sandbox 中執行時，可能需要允許本機 PostgreSQL 程序；不要改以現成或 production 的 `PGHOST` 迴避隔離。

目前 `0001` 至 `0005` 的兩次前進與限制測試、逐階段反向回滾、migration 紀錄／資料表／schema 回復及最終 schema parity 均已通過。

## Migration 清單

### `0001_identity_and_catalog`

建立帳號、登入身份、角色、學習者、分享權限、檔案、年級、學期、科目、教材版本、考試體系、教材單元、課綱代碼、來源固定維度及種子版本資料表。

`learner_preferences.active_exam_id` 已由 `0004_practice_and_attempts` 加入並建立同一學習者限制。`0005` 另補上有效登入工作階段與角色／學習者存取權的交叉限制；session 建立／恢復與帳號狀態、角色、學習者存取權異動使用同一個每帳號 transaction advisory lock，避免撤權與新 session 交錯通過。考試級別樹不得循環、科目別名只能指向系統科目；正式種子紀錄只能從 `pending`／`failed` 建立，套用證據與 `applied -> superseded` 歷程不可偽造或覆寫。可信登入 context、科目樹循環、教材單元樹循環及完整來源維度發布規則仍需要正式後端交易服務驗證，不能只依賴欄位限制。

### `0002_question_core`

建立題庫、題目身份、版本、審核、小題、選項、內容區塊、參考答案、題型、難易度、主題、知識點、教材單元關聯、課綱代碼關聯及來源專屬篩選欄位。

`question_identifiers.source_document_id` 依賴 `0003` 的 `source_documents`，因此由匯入 migration 一起加入欄位、值域及外鍵；`0002` 本身只允許 `legacy` 與 `publisher_question` 題號，不先建立無法驗證參照完整性的文件題號。

### `0003_import_and_collections`

建立來源文件、分類候選、匯入批次、批次文件、匯入題目草稿、題目版本來源追溯、收藏清單及收藏項目。這個 migration 同時為 `question_identifiers` 加入文件題號欄位、值域與唯一索引。

回滾 `0003` 會刪除本階段建立的匯入、來源及收藏資料，並移除 `source_document_question` 題號，保留 `0001` 與 `0002` 的身份、目錄及題目核心 schema。

### `0004_practice_and_attempts`

建立考試與科目範圍、練習計畫、難易度比例、排程、固定題目、實際練習、逐次作答、小題結果、手寫檔案、審核、後續練習佇列及來源追溯。本階段同時加入 `learner_preferences.active_exam_id`，並限制考試、計畫、排程、作答與錯題來源不可跨學習者誤連。

`question_similarity_groups` 由 `0005` 建立；`0005` 同時為 `learner_practice_queue_items` 與 `practice_session_item_origins` 加入 `similarity_group_id`、外鍵與 `confirmed_group` 值域，並補上難易度比例合計、作答改判／outbox 同交易與登入工作階段授權一致性。有作答或來源追溯後，練習項目的 session、題目、版本、小題與選入原因，以及其 parent session 的學習者都不可漂移。固定模式至少一題、可信登入 context、題目發布內容驗證及各資源操作授權仍須由後端交易服務處理。

### `0005_similarity_analytics_and_audit`

建立相近題群組、候選、成員、生成題來源，學習者題目／小題／相近群組統計、學習者與題目每日統計、統計隱私政策、outbox、重算工作、管理員稽核及資料刪除要求，共 14 張業務資料表。

本階段也補上先前跨階段保留的完整性：

- `curriculum_units` 與 `source_categories` 新增 `origin`、`owner_user_id` 及所有權限制。舊 schema 沒有保存所有者，非空資料庫升級前必須先盤點並確認既有列都是系統目錄；無法確認的自訂資料要先建立所有者對照或隔離，不能默默當成系統資料。
- `learner_practice_queue_items` 與 `practice_session_item_origins` 新增 `similarity_group_id`；`match_basis=confirmed_group` 時必須且只能引用已確認群組。
- `assets.purpose` 新增 `answer_attachment`。手寫只能引用 `handwriting`，一般作答附件只能引用 `answer_attachment`；兩者都必須是 private、掃描狀態為 `clean` 且未邏輯刪除。
- 學習者代表圖片、題目內容、來源文件與頁面裁切圖也會驗證用途相容、掃描通過且未刪除；被引用後不能改成不相容或失效狀態。檔案被作答引用期間，儲存鍵值、MIME、大小、尺寸、雜湊、上傳者與建立時間也不可覆寫；`answer_part_assets` 關聯本身仍可依核准的保存／刪除流程調整。
- 考試級別父子關係不得形成多層循環；科目別名只能指向系統科目；正式種子只允許既定狀態流程，已套用或已取代版本保留原始雜湊、筆數、來源與套用時間。
- 已發布或已取代的題目版本保留發布時間，且版本核心、內容、答案、分類、來源與審核歷史不可原地覆寫；系統題目的 `revision_number > 1` 時，`change_note` 必須包含非空白修改原因。`0005` 會在建立限制前檢查既有系統版本，遇到缺少修改原因的舊資料就拒絕升級；把 `account` 題目改為 `system` 時，也會在交易結束前反向檢查所有既有後續版本。系統題目版本的狀態異動必須在同一交易留下相符審核與管理員稽核，目前版本在交易結束時必須仍是同一題的已發布版本。
- 原始作答、逐小題初始結果、人工審核與管理員稽核保留歷史；`answer_attempts.grading_source` 是不可變的初始來源，`answer_part_results.grading_source` 是目前來源，只能隨合法 review 更新；改判、彙總結果與 `analytics_outbox` 事件必須在同一交易保持一致。
- 角色授權證據不可改寫或刪除，撤銷只能單向進行；`system_admin` 的授予與撤銷必須由有效管理員或受控 bootstrap 路徑執行，並在同一交易留下相符稽核。
- 資料刪除要求只能以 `pending` 建立，依 `approved`／`rejected`、`processing`、`completed` 的單向流程推進；身份與目標不可改寫、紀錄不可刪除、終態不可變，完成時必須有同一交易的管理員稽核。這張表只保護要求與執行證據，不會自行刪除或去識別化資料。

相近候選分數不能直接成為正式關聯；只有已確認群組及成員能用於相近題練習或掌握度排除。統計表是可由不可變作答明細重建的讀取模型；沒有有效 `analytics_privacy_policies` 時，社群榜必須維持關閉。

`0005` 的 down migration 只供尚未承載正式資料的 DDL 往返驗證。若相近題審核、隱私政策、來源追溯、管理員稽核、資料刪除要求或帳號自訂目錄已有資料，腳本會拒絕破壞性回滾；正式使用後應停用功能並只重建或清除可重建統計，不能用 down migration 刪除耐久紀錄。

`0001` 至 `0004` 的 down migration 也是供一次性空白／合成測試資料庫驗證 schema 對稱性，不是正式環境的資料復原程序；它們會刪除各階段資料表。資料庫開始承載正式資料後，回復舊版必須使用已演練的向前修正與 operational rollback，保留作答、來源與稽核紀錄，不能直接執行這些 down 檔。

## 尚未完成的正式串接

Schema 通過不代表產品已切換。下列工作完成前，不得把 JSON mock 當成正式資料庫 API：

- 選定後端、ORM／查詢層、登入服務、PostgreSQL 託管位置、物件儲存與 Secret Manager。
- 由可信 session 建立伺服器端帳號、角色與學習者授權，不接受前端自報身份。
- 使用受限的應用程式資料庫角色及受控的高權限程序，補上 RLS／GRANT／必要的 `SECURITY DEFINER` 邊界；`bootstrap_admin`、`system_job` 只是資料列中的來源類型，不能單獨證明 caller 身份。
- 把整份狀態覆寫拆成題庫、匯入、考試、計畫、排程、作答、審核、統計與附件交易 API。
- 建立可重跑的 fixture／JSON 搬移工具，輸出舊 ID 對新 UUID、筆數、雜湊、衝突與隔離報告。
- 核准兒童資料、作答、來源文件、附件、IP 與稽核的保存／刪除政策，定義 `answer_part_assets` 解除引用及物件刪除的受權限路徑，並完成真正的去識別化／刪除 worker、統計 worker、重算命令及管理 API。

正式切換時要先停止 JSON 寫入，完成最後增量搬移及數量核對，再讓 PostgreSQL 成為唯一可寫入來源；不得讓 JSON 與 PostgreSQL 同時充當權威資料。完整需求與狀態對照見 `../docs/database-completion-matrix.md`。
