# 正式資料庫完成對照

這份文件把目前已核准的產品需求，對照到正式 PostgreSQL 的資料表、關鍵欄位與關聯，再標示正式 API／表單是否已經接上。範圍以 `docs/PRODUCT_SPEC.md`、`docs/question-database-design.md` 與現有前端流程為準；不把未決定的產品功能或未完成的應用程式串接算成完成。

目前五個 migration 共涵蓋 94 張業務資料表，另有一張只供 migration 工具使用的 `schema_migrations`。資料庫結構與限制通過本機 migration 驗證，不等於正式後端已上線：現有畫面仍主要讀寫 JSON mock API，fixture 尚未正式搬入 PostgreSQL。

## 狀態定義

- **Schema 已驗證**：資料表、欄位、外鍵、主要值域與 migration 往返已有本機驗證。
- **待正式串接**：資料模型已具備，但現有 API 或表單仍讀寫 JSON、在瀏覽器運算，或尚未呼叫正式交易服務。
- **待決策**：沒有後端、登入、物件儲存、資料保存期限或權限政策的正式決定，不能安全切換。
- **不在本輪**：規格明確排除，不能用預留空欄位宣稱支援。

## 需求、資料模型與正式流程

| 需求與流程 | 資料表、關鍵欄位與關聯 | 正式 API／表單應完成的事 | 狀態 |
| --- | --- | --- | --- |
| 電子郵件與社群登入、帳號驗證 | `users`、`account_identities`、`verification_challenges`；登入身份以 `user_id` 歸戶，token 與密碼只存雜湊 | 登入服務驗證 provider、建立或撤銷 session，不把密碼、token 或驗證碼回傳 bootstrap | Schema 已驗證；現有登入頁仍為 mock，待決定登入服務 |
| 登入 session、角色與家長／家教 PIN | `auth_sessions`、`user_roles`、`role_pin_credentials`；有效角色與目前學習者要交叉驗證；session 建立／恢復與帳號、角色、存取權異動共用每帳號鎖；角色證據不可改寫或刪除，`system_admin` 授撤需同交易稽核 | 伺服器從 session 決定 `user_id`、角色與可用學習者；角色切換、授權與撤銷走受控高權限程序，不接受前端自報 actor | Schema 與每帳號鎖定機制已驗證；現有角色 PIN 在前端處理，可信 DB caller 邊界與雙連線 API 併發驗收待正式串接 |
| 一個帳號管理或分享多位學習者 | `learners`、`learner_access`；`user_id + learner_id` 唯一，權限與有效期限決定可見範圍 | 所有以學習者為範圍的 API 先檢查有效 `learner_access`，不得相信前端傳入的角色或學習者清單 | Schema 已驗證；正式授權層與交易服務待建 |
| 學習者基本資料、年級、就學狀態與代表圖片 | `learners.grade_id`、`education_status`、`school_name`、`avatar_asset_id`，搭配 `grades` 與 `assets` | 學習者表單驗證「在學必有年級、不在學不得留學校／學期」；圖片上傳與讀取走受權限保護的附件流程 | Schema 已驗證；現有表單仍寫 JSON，物件儲存待決策 |
| 科目、版本、學期與練習偏好 | `subjects`、`subject_aliases`、`grade_subjects`、`book_versions`、`learner_preferences`、`learner_subject_settings`；自訂目錄以 `origin + owner_user_id` 隔離 | 設定表單只列可見目錄；自訂科目與版本由後端建立，更新使用 `lock_version` | Schema 已驗證；正式目錄 API 與 UUID 轉換待建 |
| 考試名稱、日期與各科範圍 | `exams`、`exam_subject_ranges`；起訖單元、版本、科目與學習者必須一致 | 考試表單以同一交易保存主檔與各科範圍，拒絕跨教材樹或跨學習者關聯 | Schema 已驗證；現有表單仍寫 JSON |
| 題庫所有權、穩定題目身份與版本 | `question_banks`、`question_bank_learners`、`questions`、`question_identifiers`、`question_revisions`、`question_revision_reviews`、`question_bank_items`；系統題目的 `revision_number > 1` 時，`change_note` 必須包含非空白修改原因，既有資料升級及 `account -> system` 轉換也會檢查 | 題庫 CRUD 依系統／帳號所有權授權；修改題目建立新 revision 並填寫修改原因，發布與目前版本更新必須同一交易 | Schema、既有資料升級前置檢查與來源轉換反向檢查已驗證；正式 repository、審核 API 與後台表單待建 |
| 題幹、小題、選項、答案、解析與音訊 | `question_parts`、`question_options`、`question_content_blocks`、`question_answers`；每次練習固定引用 revision | 編輯與匯入表單依作答方式驗證內容、選項與答案；正式 API 不應把無權查看的答案送到作答端 | Schema 已驗證；現有題目由 bootstrap 整包送前端，待改造 |
| 單元、主題、知識點與課綱代碼 | `curriculum_units`、`topics`、`knowledge_points`、`curriculum_codes` 及四組 revision 關聯表；自訂單元、主題與知識點有帳號所有權 | 匯入與編輯只把核准對照寫入正式分類；跨版本歸檔與原生教材位置分開保存 | Schema 已驗證；自訂單元所有權由 `0005` 補齊，正式目錄／對照 API 待建 |
| 題目來源與來源專屬篩選 | `source_categories`、`source_category_dimensions`、`filter_fields`、scope／option／value 關聯；自訂來源有帳號所有權 | 依來源、科目、年級、版本與考試級別產生可用欄位；只允許核准欄位成為可搜尋資料 | Schema 已驗證；自訂來源所有權由 `0005` 補齊，正式查詢服務待建 |
| 圖片、掃描 PDF、文字貼上與逐題校正 | `assets`、`source_documents`、`source_document_classification_candidates`、`import_batches`、`import_batch_documents`、`import_items`、`question_revision_sources` | 上傳、掃描、OCR／拆題、人工校正與確認分階段處理；每題保存正確文件、頁碼、裁切圖、題號及冪等鍵 | Schema 已驗證；現有 `/api/v1/imports` 仍寫 JSON，OCR、物件儲存與正式交易 API 待建 |
| 一般作答附件與手寫內容 | `answer_part_assets` 關聯 `assets`；`assets.purpose` 分成 `handwriting` 與 `answer_attachment`；被作答引用期間凍結檔案內容與上傳證據 | 附件必須是 `private`、掃描狀態為 `clean` 且未刪除；`handwriting` 只收手寫，其他核准作答檔案使用 `answer_attachment`，讀取時從作答關聯反查權限；解除引用與物件刪除依核准保存政策執行 | Schema 已驗證；用途、引用與 evidence 限制由 `0005` 補齊，物件儲存、上傳 API 與刪除政策待建 |
| 收藏與題目清單 | `question_collections`、`question_collection_items`；收藏依學習者隔離並保存穩定的 `question_id` | 收藏表單以交易移動項目；收藏跟隨題目的目前發布版本，真正建立固定計畫、排程或 session 時才保存當時的 revision | Schema 已驗證；現有畫面仍寫 JSON |
| 題目總覽、錯題榜與開始練習共用查詢 | 題目 revision、分類、來源、收藏、`learner_question_stats`、`learner_part_stats`；權限從帳號與學習者關聯進入 | 三個入口共用同一個伺服器查詢服務，先授權再篩選、分頁或抽題，不能先下載全題庫給前端篩選 | Schema 已驗證；現有 `/api/v1/questions` 只涵蓋部分條件，UI 尚未採用 |
| 練習計畫、難易度比例、固定題目與排程 | `practice_plans`、`practice_plan_difficulty_mix`、`practice_plan_items`、`practice_schedules`、`practice_schedule_items` | 儲存計畫時固定篩選快照；建立排程時固定題目版本與順序；重送不得重複建立 session | Schema 已驗證；現有計畫與排程仍在 JSON |
| 全部作答後、逐題檢核與只顯示成績 | `practice_sessions`、`practice_session_items`、`answer_attempts`、`answer_part_results`；`check_mode` 與版本快照固定；有作答後 item 的 session／題目／版本／小題及 parent session learner 不可漂移 | 開始 session、提交作答與結束練習使用交易；原始嘗試不可覆寫，只顯示成績時 API 也不得洩漏個別答案 | Schema 與作答 provenance 已驗證；現有選題、判分與 session 主要在瀏覽器完成 |
| 人工檢視、手寫比對與改判 | `answer_reviews`、`answer_part_assets`；改判保留原判定並新增 review；attempt 的 `grading_source` 是不可變初始來源，part 的欄位是目前來源 | 審核者先通過角色與 learner access；合法 review 可更新 part 的目前結果與來源，並讓整題彙總及統計 outbox 在同一交易一致 | Schema 已驗證；現有檢視者與辨識狀態為 mock |
| 錯題、小題複習與後續練習 | `learner_practice_queue_items`、`practice_session_item_origins`、`learner_question_stats`、`learner_part_stats` | 錯題從不可變作答明細產生；立即練習或排入佇列都保存確切原始作答、小題與採用依據 | Schema 已驗證；相近群組欄位與外鍵由 `0005` 補齊，正式 API 待建 |
| 相近題候選、人工核准、正式群組與生成題追溯 | `question_similarity_candidates`、`question_similarity_groups`、`question_similarity_memberships`、`question_generation_relations` | 相似分數只能建立候選；人工核准後才加入正式群組，生成題另存來源與模型版本，不把 `generatedFrom` 當正式關聯 | Schema 已驗證（`0005_similarity_analytics_and_audit`）；現有 UI 使用 mock 關聯，審核與查詢 API 待建 |
| 題目、小題、相近群組與每日學習統計 | `learner_question_stats`、`learner_part_stats`、`learner_similarity_group_stats`、`learner_daily_stats`、`question_daily_stats` | 作答／改判交易寫 `analytics_outbox`，worker 更新可重建彙總；歷史查詢仍可回到明細 | Schema 已驗證（`0005`）；worker、重算命令與成果 API 待建 |
| 社群榜隱私門檻與統計重算 | `analytics_privacy_policies`、`analytics_outbox`、`analytics_jobs` | 只有有效政策且達匿名門檻才回傳跨帳號聚合；沒有政策時社群榜保持關閉 | Schema 已驗證（`0005`）；門檻、法源、worker 與 API 待決策／串接 |
| 管理員稽核與資料刪除／去識別化 | `admin_audit_logs`、`data_erasure_requests`；要求只能以 `pending` 建立並單向推進，身份／目標不可改、不可刪、終態不可變，完成需同交易管理員稽核 | 高權限變更與搬移寫不可變稽核；正式 worker 依核准保存政策真正刪除或去識別化，並留下不含個資的摘要 | 要求 ledger 與流程 Schema 已驗證（`0005`）；真正資料／物件刪除、保存政策與管理 API 待決策 |
| 正式目錄與 fixture 搬移 | `seed_manifests` 加上全部目標表；每批記錄來源版本、雜湊、筆數與 migration | 搬移工具保持 fixture 唯讀，可重跑，輸出舊 ID 對新 UUID、各表筆數、衝突與隔離報告 | Schema 已驗證；搬移工具與正式資料搬移尚未完成 |

## 94 張業務資料表

| Migration | 數量 | 資料表 |
| --- | ---: | --- |
| `0001_identity_and_catalog` | 25 | `users`、`account_identities`、`verification_challenges`、`user_roles`、`role_pin_credentials`、`grades`、`semesters`、`publishers`、`subjects`、`subject_aliases`、`grade_subjects`、`book_versions`、`exam_programs`、`exam_program_levels`、`assets`、`learners`、`learner_access`、`auth_sessions`、`learner_preferences`、`learner_subject_settings`、`curriculum_units`、`curriculum_codes`、`source_categories`、`source_category_dimensions`、`seed_manifests` |
| `0002_question_core` | 32 | `topics`、`knowledge_points`、`unit_topics`、`unit_knowledge_points`、`question_types`、`difficulty_levels`、`filter_fields`、`filter_field_scopes`、`filter_field_scope_sources`、`filter_field_scope_subjects`、`filter_field_scope_grades`、`filter_field_scope_semesters`、`filter_field_scope_book_versions`、`filter_field_scope_exam_levels`、`filter_field_options`、`filter_field_option_scopes`、`question_banks`、`question_bank_learners`、`questions`、`question_identifiers`、`question_revisions`、`question_revision_reviews`、`question_parts`、`question_options`、`question_content_blocks`、`question_revision_units`、`question_answers`、`question_revision_topics`、`question_revision_knowledge_points`、`question_revision_curriculum_codes`、`question_revision_filter_values`、`question_bank_items` |
| `0003_import_and_collections` | 8 | `source_documents`、`source_document_classification_candidates`、`import_batches`、`import_batch_documents`、`import_items`、`question_revision_sources`、`question_collections`、`question_collection_items` |
| `0004_practice_and_attempts` | 15 | `exams`、`exam_subject_ranges`、`practice_plans`、`practice_plan_difficulty_mix`、`practice_plan_items`、`practice_schedules`、`practice_schedule_items`、`practice_sessions`、`practice_session_items`、`answer_attempts`、`answer_part_results`、`answer_part_assets`、`answer_reviews`、`learner_practice_queue_items`、`practice_session_item_origins` |
| `0005_similarity_analytics_and_audit` | 14 | `question_similarity_groups`、`question_similarity_candidates`、`question_similarity_memberships`、`question_generation_relations`、`learner_question_stats`、`learner_part_stats`、`learner_similarity_group_stats`、`learner_daily_stats`、`question_daily_stats`、`analytics_privacy_policies`、`analytics_outbox`、`analytics_jobs`、`admin_audit_logs`、`data_erasure_requests` |

`schema_migrations` 是技術性版本紀錄，不列入 94 張業務資料表。每張表的完整欄位、值域與索引以 `docs/question-database-design.md` 和 migration SQL 為準；本表不重複另一份容易失同步的逐欄位定義。

## 目前網站的實際資料來源

| 資料域 | `3500` 本機網站目前如何載入與保存 | PostgreSQL 狀態 |
| --- | --- | --- |
| 題庫與匯入 | `data/fixtures/database.json` 提供合成初始題庫；第一次啟動複製到不進版控的 `runtime-data/database.json`。確認匯入會把題目、批次及圖片寫入 runtime JSON／assets；OCR／AI 拆題仍是模擬結果 | 未連線；正式題目、版本、內容、來源及匯入表只存在 migration schema |
| 帳號、角色與學習者 | 登入、註冊、重設密碼與社群綁定只顯示 UI 狀態，不送出或保存。學習者與角色示範設定由 fixture 初始化，修改後跟整份 state 寫入 runtime JSON；PIN 與驗證碼是前端示範 | 未連線；正式 identity、session、role 與 learner access 尚未由 runtime 使用 |
| 計畫、排程與已送出作答 | React 從 `/api/v1/bootstrap` 載入，變更後以 250 ms debounce 呼叫 `PUT /api/v1/state`，整份寫回 runtime JSON | 未連線；正式交易、資料列授權、冪等與樂觀鎖定尚未串接 |
| 進行中的練習 | session、尚未送出的答案與手寫內容只在 React 記憶體；重新整理會遺失。送出後才加入 state 並等待 JSON API 保存 | 未連線 |
| 錯題、進度與相近題佇列 | 個人錯題、正確率、連續天數與示範社群統計由瀏覽器從 `attemptsByLearner` 計算；queue 隨 state 寫 runtime JSON；固定 `generatedFrom` 不是正式相近群組 | 未連線；正式明細、outbox 與可重建統計表尚未由 worker／API 使用 |

應用程式沒有使用 `localStorage`、`sessionStorage` 或 IndexedDB。Next runtime 也沒有 PostgreSQL client、ORM 或 `DATABASE_URL`；`npm run db:test` 只在 `/tmp` 建立 Unix-socket-only 的短命隔離 cluster，測完即停止並刪除。

## 現有 mock API 與正式 API 的界線

| 現有端點 | 現況 | 正式切換前的必要改造 |
| --- | --- | --- |
| `GET /api/v1/bootstrap` | 從 JSON 組成大包狀態，含多個前端不應直接持有的授權與答案資訊 | 改成依登入帳號、角色及學習者授權組合最小回應；答案與敏感設定分流 |
| `PUT /api/v1/state` | 覆寫整份 JSON 狀態，缺少資料列級授權、交易與樂觀鎖定 | 拆成學習者、設定、考試、計畫、排程與作答等正式資源 API；使用交易與 `lock_version` |
| `GET /api/v1/questions` | 僅涵蓋部分 mock 篩選，現有 UI 也未用它作為共同查詢來源 | 建立單一授權後查詢服務，完整處理固定分類、來源欄位、收藏、作答狀態與相近題條件 |
| `POST /api/v1/imports` | 寫 JSON，OCR／AI 拆題與檔案配對為模擬 | 拆成上傳、處理、校正、確認；每步保存批次狀態、文件／頁碼來源、冪等鍵及錯誤 |
| `GET /api/v1/assets/[storageKey]` | 只靠儲存鍵值讀檔，不足以證明存取權 | 以 `asset_id` 從正式引用反查權限，僅對用途相容、`clean`、未刪除且有權的檔案產生短效網址；作答與學習者檔案另固定為 private |
| `POST /api/v1/reset` | 重設 mock runtime JSON | 不提供 production 清庫端點；測試資料重設只存在隔離的本機／測試環境 |

正式 API 可以沿用 `/api/v1` 路徑，但不能只把目前 JSON 讀寫函式換成 SQL。伺服器必須先建立可信的登入 context，再由資料層集中處理授權、交易、樂觀鎖定、冪等、答案揭露與附件存取。JSON 與 PostgreSQL 不得同時成為可寫入的權威資料來源。

## 已知契約落差

- 產品規格把匯入時的科目、版本、單元、主題、難易度與來源列為選填；現有 mock 匯入 API 仍要求多個欄位不得為空。正式 API 應依來源維度規則決定發布前必填項，不沿用 mock 的一律必填。
- 產品規格要求正式相近題關聯完成前不顯示成正式功能；現有 fixture 與畫面使用 `generatedFrom`、`queuedSimilarByLearner` 模擬。搬移時要分成生成來源、舊佇列與已確認相近群組，不能把 mock 字段直接當正式關聯。
- 現有 `Question.kind` 表達選擇、文字或多小題等作答形態，`typeLabel` 才保存來源題型名稱；正式資料庫以 `question_types`、`question_parts.answer_mode` 與內容區塊分開表示。搬移需使用核准對照表，不能以畫面名稱猜測。
- 現有匯入把一批題目共用 `fileNames`，實作上可能把每題都連到第一個檔名；正式流程必須逐題保存 `source_document_id`、頁碼、裁切圖與來源題號。
- `docs/plan.md` 前段仍描述完整前端模擬系統，後段才記錄正式資料庫施工；兩者不是同一個完成狀態。本文件以「schema 已驗證」與「應用程式待正式串接」分開記錄，避免再用單一完成勾選混淆。

## 安全切換邊界

1. 選定正式後端執行環境、PostgreSQL 託管位置、ORM／查詢層、登入服務、物件儲存與 Secret Manager，並建立非 production 的整合環境。
2. 核准學習者資料、作答、來源文件、手寫／一般附件、IP 與稽核紀錄的保存期限、刪除及去識別化政策；政策未定前不搬入真實兒童資料。
3. 先完成伺服器端 session、角色與 `learner_access` 檢查，再建立正式 repository 與交易服務。現有 migration 沒有建立 RLS、正式 GRANT 或可驗證 caller 身份的 `SECURITY DEFINER` 邊界；`bootstrap_admin`、`system_job` 只是資料列值。正式環境必須使用受限的應用程式資料庫角色與受控高權限路徑，資料庫連線及物件儲存憑證只留在伺服器。
4. 建立可重跑的 fixture／JSON 搬移工具。工具保持來源唯讀，輸出舊 ID 對新 UUID、各表筆數、內容雜湊、衝突與隔離項目；本機驗收只使用合成 fixture。
5. 在隔離資料庫演練空庫前進、既有資料升級、完整性拒絕案例、回滾、再次前進與搬移重跑。`0005` 以前的 `curriculum_units`、`source_categories` 沒有所有者欄位，非空資料庫要先證明既有列是系統目錄；無法確認者先對照所有者或隔離。之後再以非 production 物件儲存驗證附件權限。
6. 正式切換窗口先停止 JSON 寫入，完成最後增量搬移與數量核對，再一次切換讀寫。切換後 PostgreSQL 是唯一權威來源，不做沒有一致性保證的雙寫。
7. 上線前移除或封閉未授權的 reset、storage-key 直讀、前端 PIN 驗證、完整答案 bootstrap 與瀏覽器端權威判分；含個資或作答的回應使用 `Cache-Control: private, no-store`，跨帳號統計在隱私政策生效前維持關閉。
8. 通過正式 API 的授權、表單讀寫、併發衝突、附件、作答不可變性、資料隔離、型別檢查、lint、build 與瀏覽器核心流程後，才可標記應用程式切換完成。migration 通過本身不是上線證據。

## 本機 migration 驗收

需要本機可執行的 PostgreSQL 工具：`initdb`、`pg_ctl`、`createdb`、`psql` 與 `pg_dump`。唯一建議入口是：

```bash
npm run db:test
```

驗證腳本必須自行在 `/tmp` 建立一次性 PostgreSQL cluster，關閉 TCP、使用私有 Unix socket，並對每個資料庫命令明確指定 host、port、user 與 database；同時以 `PSQLRC=/dev/null` 避免本機設定改變測試行為。它不得沿用 `DATABASE_URL`、`PGHOST` 或既有 cluster，也不得連接 production。完成後再執行：

```bash
npm run lint
npm test
npm run build
git diff --check
```

## 明確不在本輪

- 排序、拖曳配對、圖片熱區、自由繪圖、錄音作答與通用互動版面；需求確認後再以新 migration 擴充。
- 真實 OCR、AI 拆題、手寫辨識、AI 判分與生成題服務；本輪只建立可追溯的資料邊界。
- 未核准的考試級別展開規則、社群榜門檻、管理員跨帳號改題權限與資料保存期限。
- production 資料搬移、production migration、Vercel 部署及永久憑證／權限；都需要另行明確授權與正式環境決策。
