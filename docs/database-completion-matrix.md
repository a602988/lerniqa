# 正式資料庫完成對照

正式匯入的題目、帳號、角色、學習者、練習與作答紀錄屬持久資料，不得用 seed、reset、fixture 還原或測試 cleanup 覆蓋。合成 fixture 只用於明確隔離的測試資料庫；資料量少不會改變持久資料的性質。

279 題的 parser v2 confirmed 批次為 `2d1ff794-f6f4-5e59-baaa-8d1c767438be`，來源 SHA-256 為 `c2b09d04ef9e0a32a2fbe71a8f8e930d2061fb87e78bb6bc60f694df6be8cfb2`。相同輸入重跑應重用批次，不重建或清空既有題目。

這份文件把目前已核准的產品需求，對照到正式 PostgreSQL 的資料表、關鍵欄位與關聯，再標示正式 API／表單是否已經接上。範圍以 `docs/PRODUCT_SPEC.md`、`docs/question-database-design.md` 與現有前端流程為準；不把未決定的產品功能或未完成的應用程式串接算成完成。

目前十五個 migration 共涵蓋 110 張業務資料表，另有一張只供 migration 工具使用的 `schema_migrations`。`0014` 新增題目模板、模板成員、正式關鍵字與題目版本關鍵字關聯，並擴充推薦來源證據；`0015` 補上 AI／規則關鍵字目錄的待審與審核證據。`0001` 至 `0015` 已通過空庫、既有資料升級、逐層回滾、再次前進與 schema parity。Lerniqa 是持續開發中的多科目正式產品；帳號、角色、學習者基本資料，以及 `/practice` 的題庫、session、作答、歷程與錯題流程已使用 session 與學習者權限讀寫本機 PostgreSQL。`/practice` 不保留瀏覽器學習者快照；瀏覽器只保存非識別性的 UI 設定，以及尚未切換資料庫的計畫、排程與收藏。使用者沿既有 `/practice` 選擇「國語 → 國一 → 翰林版 → 第一冊 → 第四課」；`/local-practice` 僅供內部診斷與相容。這不等於 production 後端已上線。

## 狀態定義

- **Schema 已驗證**：資料表、欄位、外鍵、主要值域與 migration 往返已有本機驗證。
- **本機持久服務已串接**：服務已經依 session 與學習者權限讀寫持久 PostgreSQL；隔離合成帳號用於驗證，正式匯入資料仍須保存。
- **程式與針對性測試已完成**：API、repository 或 worker 契約已通過單元／靜態測試，但依賴的 migration 或完整資料庫 E2E 尚未完成；這個狀態不等於本機持久服務已串接。
- **待正式串接**：資料模型已具備，但現有 API 或表單仍讀寫 JSON、在瀏覽器運算，或尚未呼叫正式交易服務。
- **待決策**：production 後端、驗證信服務、物件儲存、資料保存期限或權限政策尚未決定，不能安全切換。
- **不在本輪**：規格明確排除，不能用預留空欄位宣稱支援。

## 需求、資料模型與正式流程

| 需求與流程 | 資料表、關鍵欄位與關聯 | 正式 API／表單應完成的事 | 狀態 |
| --- | --- | --- | --- |
| 電子郵件與社群登入、帳號驗證 | `users`、`account_identities`、`verification_challenges`；登入身份以 `user_id` 歸戶，token 與密碼只存雜湊。`0012` 已補上 challenge 與電子郵件 identity 的固定綁定，但不含 SMTP outbox | 登入服務驗證 provider、建立或撤銷 session，不把密碼、token 或驗證碼回傳 bootstrap | `/account` 與 auth API 已完成電子郵件密碼註冊、登入、登出與 `me`。密碼重設與角色 PIN 設定／重設的 API、介面、MailPlus adapter、Nodemailer transport 與不連網針對性測試已完成；密碼重設不改動 `verified_at`，並撤銷全帳號 session。ERP 非機密 SMTP host／port／TLS 已核實，`0012` identity binding 已整合；Lerniqa 憑證、outbox、實際 handshake 與真實投遞尚未完成；不得讀取或複製 ERP secret。同步寄信仍有 timing enumeration 風險，outbox／等時回應是 `0012` 之外的上線阻擋。OAuth、公開／production HTTPS 與公開登入 rate limit 也待完成 |
| 登入 session、帳號身分與角色 | `users.account_role`、`auth_sessions`、`user_roles`、`role_pin_credentials`；一般帳號本人身分、session 目前角色／學習者及 `system_admin` 授權分開；session 建立／恢復與帳號、角色、存取權異動依固定順序取得帳號及學習者鎖 | 公開帳號契約分開回傳 `accountRole`、`activeRole`、`activeLearner` 與管理員授權；`accountRole` 表示主要身分，能力由 `activeRole` 及對應的有效授權決定。快速切換只更新目前 session，不改帳號身分，也不新增角色或學習者存取權 | `0008` 要求 active learner 仍啟用，封存前須同交易撤銷相關 session；`0010` 限制 `account_role` 為 parent／tutor／learner 且必須有相符有效授權。帳號可同時保留其他有效一般角色，因此 `accountRole=learner` 但具有有效 parent／tutor 授權時，切到該 `activeRole` 仍有相應成人能力。角色 PIN 設定／重設要求單一有效且已驗證的電子郵件與仍有效的目標角色，成功後只撤銷該角色的 session。成人角色切換仍以帳號密碼重新確認，角色 PIN 尚不參與切換。`system_admin` 與 production DB caller 邊界仍待完成 |
| 一個帳號管理或分享多位學習者 | `learners`、`learner_access`；`learner_access` 是唯一正式關係表，不建立 `user_learner_access` 或其他平行表。`(learner_id, user_id, access_role)` 在 `revoked_at IS NULL` 時唯一，`0010` 另限制每帳號至多一筆未撤銷的 self learner 關係 | `/system-settings` 管理帳號身分、有效角色與可存取學習者；所有學習者 API 先檢查已接受、未撤銷的 `learner_access`。有效 `activeRole` 為 parent／tutor 時可使用成人管理能力；切到受管 learner mode 時，帳號身分、建立、帳號層更新與選取端點回 `403`。只有 self learner 能力的帳號可查看自己的系統設定，但不能建立受管學習者 | PostgreSQL 的建立、選取、更新、self learner 唯一性與名稱同步已串接。`/settings` 另管理目前學習者；寫入要求目前 learner、有效關係及 `can_manage_settings=true`。邀請與跨帳號分享仍待建 |
| 學習者基本資料、年級、就學狀態與代表圖片 | `learners.display_name`、`grade_id`、`semester_id`、`education_status`、`school_name`、`avatar_asset_id`，搭配 `grades`、`semesters` 與 `assets` | `/settings` 只操作目前學習者；表單驗證「在學必有年級、不在學不得留學校／學期」，圖片上傳與讀取走受權限保護的附件流程 | 顯示名稱、年級與學期已由正式 API 讀寫 PostgreSQL。就學狀態、學校與代表圖片尚未進入公開 DTO／寫入 API；沒有 `can_manage_settings` 時介面只讀 |
| 科目、版本、學期與練習偏好 | `subjects`、`subject_aliases`、`grade_subjects`、`book_versions`、`learner_preferences`、`learner_subject_settings`；自訂目錄以 `origin + owner_user_id` 隔離 | 設定表單只列當前學習者可用目錄；科目版本更新驗證科目、年級、出版社與書籍版本，並使用 `lock_version` 防止並行覆寫 | auth 公開 DTO 已提供學期、練習偏好、已啟用科目、出版社、書籍版本及可選版本。`PATCH /api/v1/auth/learners/subject-settings` 只能更新 session 目前學習者，並要求有效 `learner_access.can_manage_settings`；相同值重送不重複改版本。自訂目錄與練習偏好的正式寫入仍待建 |
| 考試名稱、日期與各科範圍 | `exams`、`exam_subject_ranges`；起訖單元、版本、科目與學習者必須一致 | 考試表單以同一交易保存主檔與各科範圍，拒絕跨教材樹或跨學習者關聯 | Schema 已驗證；現有表單狀態仍保存在瀏覽器，尚未寫入正式資料表 |
| 題庫所有權、穩定題目身份與版本 | `question_banks`、`question_bank_learners`、`questions`、`question_identifiers`、`question_revisions`、`question_revision_reviews`、`question_bank_items`；系統題目的 `revision_number > 1` 時，`change_note` 必須包含非空白修改原因，既有資料升級及 `account -> system` 轉換也會檢查 | 題庫 CRUD 依系統／帳號所有權授權；修改題目建立新 revision 並填寫修改原因，發布與目前版本更新必須同一交易 | Schema、既有資料升級前置檢查與來源轉換反向檢查已驗證；正式 repository、審核 API 與後台表單待建 |
| 題幹、小題、選項、答案、解析與音訊 | `question_parts`、`question_options`、`question_content_blocks`、`question_answers`；每次練習固定引用 revision；選擇類題目的答案鍵值必須屬於同一小題的選項 | 編輯與匯入表單依作答方式驗證內容、選項與答案；正式 API 不應把無權查看的答案送到作答端 | `0007` 檢查答案鍵與同一小題選項；`0009` 進一步要求 published／superseded 的自動判分選擇類小題至少有一個有效答案鍵，自動判分文字題至少有一個非空白可接受答案。人工與 AI 輔助檢視可無答案；升級前發現缺漏即停止，不補造資料。`/practice` 作答前只取得題幹、小題與選項 |
| 單元、主題、知識點與課綱代碼 | `curriculum_units`、`topics`、`knowledge_points`、`curriculum_codes` 及四組 revision 關聯表；自訂單元、主題與知識點有帳號所有權 | 匯入與編輯只把核准對照寫入正式分類；跨版本歸檔與原生教材位置分開保存 | Schema 已驗證；`/practice` 題庫 API 會從 `question_revision_knowledge_points` 與 `knowledge_points` 讀取正式知識點，不再把題型名稱當成知識點。自訂目錄與完整對照 API 待建 |
| 題目來源與來源專屬篩選 | `source_categories`、`source_category_dimensions`、`filter_fields`、scope／option／value 關聯；自訂來源有帳號所有權 | 依來源、科目、年級、版本與考試級別產生可用欄位；只允許核准欄位成為可搜尋資料 | Schema 已驗證；自訂來源所有權由 `0005` 補齊。現有 publisher 題庫只設定已確認的 4 組來源維度規則，其餘維度需先有產品規格；正式查詢服務待建 |
| 圖片、掃描 PDF、舊版 Word、文字貼上與逐題校正 | `assets`、`source_documents`、`source_document_classification_candidates`、`import_batches`、`import_batch_documents`、`import_items`、`question_revision_sources`；`0012` 已建立 `question_enrichment_runs` 與 revision pending suggestions | 上傳、掃描、OCR／拆題、人工校正與確認分階段處理；每題保存正確文件、頁碼、裁切圖、題號及冪等鍵。補全建議只能先進 pending sidecar，核准前不得改寫已發布 revision | Schema `0001`–`0015` 已驗證；Hanlin CLI 的 279 題已匯入。題庫補全 CLI、dry-run／checkpoint 與針對性測試已完成，`0012` 已整合，但 279 題尚未 apply；必須先做品質抽檢與人工核准。正式 PostgreSQL 匯入 API／介面、OCR／AI 拆題與受權 apply 流程待建 |
| 一般作答附件與手寫內容 | `answer_part_assets` 關聯 `assets`；`assets.purpose` 分成 `handwriting` 與 `answer_attachment`；被作答引用期間凍結檔案內容與上傳證據 | 附件必須是 `private`、格式驗證通過且未刪除；讀取時從作答關聯反查權限。缺文字答案時手寫小題保持 pending／manual；已有完整答案時手寫只作為第一小題的計算過程附件，不改變判分。`score` 不建立逐題附件 | `instant`／`complete` private PNG 的驗證、冪等儲存、受權讀取與 UI 串接程式已通過針對性測試；完整 DB E2E 仍需涵蓋 private PNG 路徑。一般附件、刪除政策與 production 物件儲存待建 |
| 收藏與題目清單 | `question_collections`、`question_collection_items`；收藏依學習者隔離並保存穩定的 `question_id` | 收藏表單以交易移動項目；收藏跟隨題目的目前發布版本，真正建立固定計畫、排程或 session 時才保存當時的 revision | Schema 已驗證；`/practice` 的收藏目前依學習者存在 `localStorage`，尚未寫入正式收藏表 |
| 題目總覽、錯題榜與開始練習共用查詢 | 題目 revision、分類、來源、收藏、`learner_question_stats`、`learner_part_stats`；權限從帳號與學習者關聯進入 | 三個入口共用同一個篩選元件與伺服器查詢規則。單元、來源、題型與難易度使用陣列傳遞；同欄多值為 OR，跨欄為 AND，空陣列表示該欄不限定。服務先授權再篩選、分頁或抽題，不能先下載全題庫給前端篩選 | 前端共用篩選契約已對齊題目總覽、錯題與練習；`/practice` 已從登入 session 取得學習者、檢查題庫成員關係，再以最多 500 題一頁列出第四課的已發布題目，且作答前不回傳答案。其他科目保留正常分類與無資料狀態；動態多科目伺服器查詢及全部正式篩選欄位仍待建 |
| 練習計畫、難易度比例、固定題目與排程 | `practice_plans`、`practice_plan_difficulty_mix`、`practice_plan_items`、`practice_schedules`、`practice_schedule_items` | 練習不另設「篩選方式」選擇器；除共用題目篩選外，只增加本輪題數與難易度比例。儲存計畫時固定篩選快照；建立排程時固定題目版本與順序；重送不得重複建立 session | Schema 已驗證；現有計畫與排程依學習者存在 `localStorage`，尚未寫入正式資料表 |
| 全部作答後、逐題檢核與只顯示成績 | `practice_sessions`、`practice_session_items`、`answer_attempts`、`answer_part_results`、`practice_score_receipts`；`check_mode` 與版本快照固定。`score` 的五個 aggregate 欄位只能反映 session item 與收據數量；收據不含答案、逐題判定、小題或耗時 | 開始 session、提交作答與結束練習使用交易。`instant`／`complete` 需保留的原始嘗試不可覆寫；`score` 只新增每個 item 一筆的冪等收據並累加 aggregate，不建立逐題明細。歷程與錯題佇列不得繞過檢核模式的揭露時機 | `/practice` 的三種模式都建立 PostgreSQL session。`instant` 送出後回傳逐題明細；`complete` 完成前遮住明細、完成後才揭露；`score` 進行中遮住明細，完成後保存並只回傳 `{total, correct, wrong, pending, accuracy}`。重載後仍可讀回 session aggregate，但不保存各題送出的答案內容。所有 item 都有收據後才完成；從任意題開始作答時會尋找下一道未送出的題目，直接作答畫面最後一題不會提早完成 session |
| 人工檢視、手寫比對與改判 | `answer_reviews`、`answer_part_assets`；`0012` 已建立 `handwriting_analysis_jobs` 與 append-only runs sidecar；改判保留原判定並新增 review | 授權審核者才可新增 review。AI 輸出只是建議，不得直接更新目前結果、錯題佇列或統計；只有作答 payload 為空且結果為 pending／manual 的手寫小題可排入 AI job，計算過程附件不排入 | 人工 review 的 schema 已驗證。AI sidecar schema 已由 `0012` 整合，worker 與品質驗收尚未完成。Ollama metadata、digest 與 vision capability 已核實，但沒有手寫 inference、worker 呼叫或品質樣本驗收 |
| 錯題、小題複習與後續練習 | `learner_practice_queue_items`、`practice_session_item_origins`、`question_templates`、`question_template_memberships`、`relation_keywords`、`question_revision_keywords`、學習統計表 | `instant`／已完成 `complete` 的錯題依已確認模板、相似群組、共同正式關鍵字與共同主題逐層建立關連練習；同層尚未作答者優先，最近已答對者排除。`score` 不建立逐題來源、錯題或推薦佇列 | `0014`／`0015` schema、推薦查詢、pending 分析匯入、管理員核准／退回、來源證據與學生端層級說明已完成。279 題尚未全量分析；目前只有一題煙霧測試的 1 個待審模板、1 個待審成員與 2 個待審關鍵字關聯，confirmed 關聯仍為 0，因此學生端仍不會使用這批資料 |
| 相近題候選、人工核准、正式群組與生成題追溯 | `question_similarity_candidates`、`question_similarity_groups`、`question_similarity_memberships`、`question_generation_relations` | 相似分數只能建立候選；人工核准後才加入正式群組，生成題另存來源與模型版本，不把 `generatedFrom` 當正式關聯 | Schema 已驗證（`0005_similarity_analytics_and_audit`）；現有 UI 使用 mock 關聯，審核與查詢 API 待建 |
| 題目、小題、相近群組與每日學習統計 | `learner_question_stats`、`learner_part_stats`、`learner_similarity_group_stats`、`learner_daily_stats`、`question_daily_stats` | `instant`／`complete` 的作答或改判交易寫 `analytics_outbox`，worker 更新可重建彙總；歷史查詢仍可回到明細。`score` 不寫逐題 outbox，且 aggregate 不可反推明細 | Schema 已驗證（`0005`、`0011`）；本機 `instant`／`complete` 作答交易已寫入 `analytics_outbox`，worker、重算命令與成果 API 待建 |
| 舊 `score` 作答 asset 的兩階段清理 | `assets.deleted_at`、`asset_object_cleanup_jobs`、`admin_audit_logs` | 只有解除 `score` 關聯後無其他引用的 private `handwriting`／`answer_attachment` 才能標記刪除並排程；共用 asset 保留。worker 實際刪除外部物件後才可寫 `object_deleted_at` 並完成工作 | `0011` 已完成資料庫解除引用、邏輯刪除、pending 工作與稽核；本輪未對真實 storage 執行破壞性清理，受控 worker 與操作程序待建 |
| 社群榜隱私門檻與統計重算 | `analytics_privacy_policies`、`analytics_outbox`、`analytics_jobs` | 只有有效政策且達匿名門檻才回傳跨帳號聚合；沒有政策時社群榜保持關閉 | Schema 已驗證（`0005`）；門檻、法源、worker 與 API 待決策／串接 |
| 管理員稽核與資料刪除／去識別化 | `admin_audit_logs`、`data_erasure_requests`；要求只能以 `pending` 建立並單向推進，身份／目標不可改、不可刪、終態不可變，完成需同交易管理員稽核 | 高權限變更與搬移寫不可變稽核；正式 worker 依核准保存政策真正刪除或去識別化，並留下不含個資的摘要 | 要求 ledger 與流程 Schema 已驗證（`0005`）；真正資料／物件刪除、保存政策與管理 API 待決策 |
| 正式目錄與 fixture 搬移 | `seed_manifests` 加上全部目標表；每批記錄來源版本、雜湊、筆數與 migration | 搬移工具保持 fixture 唯讀，可重跑，輸出舊 ID 對新 UUID、各表筆數、衝突與隔離報告 | Schema 已驗證；Hanlin 單檔匯入器已可重跑並驗證不建立固定合成身份，但通用 fixture／JSON 搬移工具與 production 資料搬移尚未完成 |

## 110 張業務資料表

| Migration | 數量 | 資料表 |
| --- | ---: | --- |
| `0001_identity_and_catalog` | 25 | `users`、`account_identities`、`verification_challenges`、`user_roles`、`role_pin_credentials`、`grades`、`semesters`、`publishers`、`subjects`、`subject_aliases`、`grade_subjects`、`book_versions`、`exam_programs`、`exam_program_levels`、`assets`、`learners`、`learner_access`、`auth_sessions`、`learner_preferences`、`learner_subject_settings`、`curriculum_units`、`curriculum_codes`、`source_categories`、`source_category_dimensions`、`seed_manifests` |
| `0002_question_core` | 32 | `topics`、`knowledge_points`、`unit_topics`、`unit_knowledge_points`、`question_types`、`difficulty_levels`、`filter_fields`、`filter_field_scopes`、`filter_field_scope_sources`、`filter_field_scope_subjects`、`filter_field_scope_grades`、`filter_field_scope_semesters`、`filter_field_scope_book_versions`、`filter_field_scope_exam_levels`、`filter_field_options`、`filter_field_option_scopes`、`question_banks`、`question_bank_learners`、`questions`、`question_identifiers`、`question_revisions`、`question_revision_reviews`、`question_parts`、`question_options`、`question_content_blocks`、`question_revision_units`、`question_answers`、`question_revision_topics`、`question_revision_knowledge_points`、`question_revision_curriculum_codes`、`question_revision_filter_values`、`question_bank_items` |
| `0003_import_and_collections` | 8 | `source_documents`、`source_document_classification_candidates`、`import_batches`、`import_batch_documents`、`import_items`、`question_revision_sources`、`question_collections`、`question_collection_items` |
| `0004_practice_and_attempts` | 15 | `exams`、`exam_subject_ranges`、`practice_plans`、`practice_plan_difficulty_mix`、`practice_plan_items`、`practice_schedules`、`practice_schedule_items`、`practice_sessions`、`practice_session_items`、`answer_attempts`、`answer_part_results`、`answer_part_assets`、`answer_reviews`、`learner_practice_queue_items`、`practice_session_item_origins` |
| `0005_similarity_analytics_and_audit` | 14 | `question_similarity_groups`、`question_similarity_candidates`、`question_similarity_memberships`、`question_generation_relations`、`learner_question_stats`、`learner_part_stats`、`learner_similarity_group_stats`、`learner_daily_stats`、`question_daily_stats`、`analytics_privacy_policies`、`analytics_outbox`、`analytics_jobs`、`admin_audit_logs`、`data_erasure_requests` |
| `0006_source_documents_word` | 0 | 擴充 `source_documents.input_type` 與輸入限制，不新增資料表 |
| `0007_practice_answer_integrity` | 0 | 補上選項答案與 ready DOCX 來源的交易結束完整性限制，不新增資料表 |
| `0008_auth_and_import_integrity` | 0 | 補上 active learner session 完整性、帳號／學習者鎖定順序，以及指定 confirmed 批次的原生文件分類修正，不新增資料表 |
| `0009_automatic_answer_completeness` | 0 | 補上已發布／已取代版本的自動判分答案完整性與升級前置檢查，不新增資料表 |
| `0010_account_role_and_self_learner` | 0 | 加入 `users.account_role`、self learner 唯一性、名稱／設定權限與帳號角色授權的一致性；既有資料修正只向前，不新增資料表 |
| `0011_score_session_aggregates` | 2 | `practice_score_receipts`、`asset_object_cleanup_jobs`；另為 `practice_sessions` 加入五個計分彙總欄位，清除既有 `score` session 的逐題明細、錯題／相近題佇列與 outbox，從剩餘非 `score` 明細重建五張統計表，並排程清理只屬於舊 `score` 的私有作答物件 |
| `0012_admin_catalog_and_question_enrichment` | 10 | 帳號復原 identity binding、同題型來源值域、題庫補全 pending suggestion、手寫 AI sidecar 與管理目錄；不含 SMTP outbox |
| `0013_education_stage_catalog` | 0 | 擴充 `grades.stage` 至高中，建立小一至高三共十二個年級與上下學期正式目錄，不新增資料表 |
| `0014_question_relation_profiles` | 4 | `question_templates`、`question_template_memberships`、`relation_keywords`、`question_revision_keywords`；另擴充 `practice_session_item_origins` 的模板、共同關聯數量、方法版本與證據欄位 |
| `0015_relation_keyword_review` | 0 | AI／規則產生的 `relation_keywords` 先進 pending；新增來源、方法版本、證據、審核者與審核時間限制，不新增資料表 |

`schema_migrations` 是技術性版本紀錄，不列入 110 張業務資料表。每張已整合資料表的完整欄位、值域與索引以 `docs/question-database-design.md` 和 migration SQL 為準；本表不重複另一份容易失同步的逐欄位定義。

## 目前網站的實際資料來源

| 資料域 | `3500` 本機網站目前如何載入與保存 | PostgreSQL 狀態 |
| --- | --- | --- |
| 舊 JSON 題庫與匯入 | 舊 `/api/v1/bootstrap`、`state`、`reset`、`questions`、`imports` 與 storage-key asset 路徑固定回 HTTP `410`，不再向正式主流程提供 fixture 或 runtime JSON | 舊 mock `/bank` 已移除並轉址 `/questions`；需另建受權限、可追溯的 PostgreSQL 匯入 API／介面，不能重新開啟舊端點 |
| 本機整合題庫與來源文件 | `/practice` 正常分類接入國語／國一／翰林版／第一冊／第四課的已發布題目；內部 `/local-practice` 使用相同持久服務。只有第四課原始 Word 文件會先在本機做巨集隔離與安全轉換，asset 存在 `local-data/assets`；其餘 14 份文件尚未匯入 | 本機持久服務已串接；第四課 279 題均為 published/current，279 筆教材單元關聯是 `native/document`，舊分類為 0。匯入批次、文件、版本、內容與來源關聯保存在持久 PostgreSQL |
| 帳號、角色與學習者 | `/account`、`/system-settings` 與 auth API 實際讀寫 PostgreSQL。持有有效 parent／tutor 授權的帳號切到相應 `activeRole` 後可管理有權存取的學習者，無論主要 `accountRole` 為何；受管 learner mode 的帳號層操作回 `403`；只有 self learner 能力的帳號可查看自己的帳號設定 | 本機身份、session、一般帳號角色、self learner 與學習者關係已串接。信箱驗證已串接；密碼重設與角色 PIN 設定／重設的程式與不連網測試已完成，`0012` identity binding 已整合；帳號復原 DB E2E 狀態以本節驗證紀錄為準。SMTP outbox／等時回應、Lerniqa 憑證、handshake 與實際投遞另列為上線阻擋；OAuth、邀請分享、角色 PIN 切換、`system_admin` 管理與 production 帳號生命週期尚未完成 |
| 目前學習者設定 | `/settings` 從 session 的 active learner 載入；先區分在學或不在學。在學者依資料庫目錄選教育階段、年級與學期，各科書籍版本另行設定；不在學者不保存年級或學期 | 顯示名稱、就學狀態、年級、學期與各科書籍版本由受權限 API 寫入 PostgreSQL。學校、代表圖片、練習偏好與考試的正式寫入仍待完成 |
| 練習 UI 設定、計畫、排程與收藏 | 非識別性的篩選與顯示設定，以及尚未切換 PostgreSQL 的計畫、排程與收藏，以 learner ID 分區保存在瀏覽器 `localStorage`。切換 learner 時從新學習者的學期與各科已保存版本重建基準；缺少版本不猜測，同一 learner 的背景重新載入不覆寫使用者手動選擇 | 計畫、排程與收藏尚未寫入 PostgreSQL；清除瀏覽器資料會失去這些本機項目，但不會刪除伺服器上的學習者、練習或作答 |
| `/practice` 的練習、作答與錯題 | `/api/v1/local-practice/*` 在伺服器交易內保存 session。`instant`／`complete` 另保存逐題作答、允許的 `wrong_review` 佇列與 `analytics_outbox`；`score` 只保存 aggregate 與不含答案的冪等收據。瀏覽器只以 session UUID 提示恢復，不保存作答結果 | 基本練習、作答與錯題的本機持久服務已串接，結果揭露與保存範圍由 `check_mode` 控制。private 手寫 PNG 與階段性推薦程式已通過針對性測試，`0012` 已整合；private 手寫仍須完成完整 E2E，推薦功能另缺文字骨架、可變值、正式關鍵字資料與完整 E2E |
| 總覽與成果 | 成果摘要使用既有作答與統計資料，併入總覽；舊 `/results` 只保留轉址 | 導覽合併與轉址仍在本輪整合，完成前不宣稱獨立成果頁已移除 |

`/practice` 的題庫、session、作答、歷程與錯題不以瀏覽器儲存為權威來源。PostgreSQL auth DTO 已提供學習者的年級、學期、偏好、科目與版本，頁面不保留 learner snapshot。`localStorage` 只保留篩選與顯示等 UI 設定、計畫、排程及收藏。Next runtime 已透過 `pg` 連接持久的本機 PostgreSQL，連線只使用 `local-data/postgres-socket` 中的私有 Unix socket，不需要 `DATABASE_URL`。自動化預設在 `/tmp` 建立短命隔離 cluster；`db:test` 也提供明確 opt-in 的 existing-local-server 模式，只在指定的本機 Unix-socket server 建立具隨機名稱的隔離測試資料庫，完成後全部刪除。`npm run db:local:ensure` 才會維護不進版控、可跨進程重啟保留的持久資料庫。

## 已封閉的舊 API 與後續替代

| 舊端點 | 現況 | 後續替代 |
| --- | --- | --- |
| `/api/v1/bootstrap`、`/api/v1/state` | 固定回傳 HTTP `410`，正式頁面不再載入大包 fixture 或覆寫 JSON state | 依資源使用 auth、learner、practice 與後續考試／計畫 API，回傳目前權限所需的最小資料 |
| `/api/v1/questions` | 固定回傳 HTTP `410`，不再公開含答案的舊題庫資料 | 受 session 保護的 `/api/v1/local-practice/questions` 只回傳作答所需內容；後續共用查詢服務再補完整篩選 |
| `/api/v1/imports` | 固定回傳 HTTP `410`；目前沒有可操作的正式匯入 UI，舊 `/bank` 轉址 `/questions` | 另建上傳、處理、校正、確認流程；每步保存批次狀態、來源、冪等鍵及錯誤 |
| `/api/v1/assets/[storageKey]` | 固定回傳 HTTP `410`，不能只憑儲存鍵值取檔 | 以正式引用反查權限；只對用途相容、`clean`、未刪除且有權的檔案提供內容或短效網址 |
| `/api/v1/reset` | 固定回傳 HTTP `410` | 持久資料不提供 reset；只有隔離合成測試可在自己的短命資料庫清理資料 |

正式 API 可以沿用 `/api/v1` 路徑，但不能重新開啟舊 JSON 契約或只把其存取函式換成 SQL。伺服器必須先建立可信的登入 context，再由資料層集中處理授權、交易、樂觀鎖定、冪等、答案揭露與附件存取。

## 本機整合 API 邊界

`/api/v1/auth/register`、`login`、`logout` 與 `me` 提供本機電子郵件密碼 session。`/api/v1/auth/identity` 讀寫一般帳號本人身分，`/api/v1/auth/role` 只切換目前 session 至既有有效角色，`/api/v1/auth/learners` 列出及管理目前帳號有權存取的學習者；`update-current` 只允許修改 session 的 active learner，並檢查 `can_manage_settings`。`accountRole` 不會覆蓋其他有效角色；包含 `accountRole=learner` 的帳號，只要仍有 parent／tutor 授權，切到相應 `activeRole` 後就使用成人管理能力。`me` 的公開 learner DTO 由資料庫讀出年級、學期、練習偏好及已啟用科目的出版社與書籍版本，不包含學校或 private asset。既有 `/practice` 使用 `/api/v1/local-practice/questions`、`sessions`、`attempts` 與 `history`；這些端點從 session 取得學習者並檢查題庫成員關係，只回傳已發布題目的題幹、小題、選項與正式知識點，作答前不查詢或回傳標準答案。題庫頁面大小上限為 500。

三種檢核方式都建立持久 session。`instant` 與 `complete` 的作答由伺服器判分，並依模式以單一交易寫入需要保存的逐小題結果、錯題佇列與 outbox；`instant` 可逐題回傳明細，`complete` 只在 session 完成後回傳明細。`score` 也由伺服器判分，但只累加 session aggregate，並為每個已送出 item 建立不含答案、逐題結果、小題與耗時的 `practice_score_receipts`；它不寫入 attempt、part result、附件、審核、錯題／相近題佇列、來源追溯或 outbox。相同 idempotency key 可安全重播原提交，同一 item 改用新 key 重送會衝突。歷程與錯題佇列套用相同揭露規則，asset 端點也以相同帳號與學習者權限反查允許顯示的引用。歷史項目若缺少建立 session 時可安全顯示的 revision 快照，只回傳結果、時間與內容不可用狀態，不以目前題目代替；resume 發現 revision 不一致時，把舊 session 標記為 `abandoned` 並要求建立新練習。

判分政策為 `automatic` 且具有完整標準答案時，伺服器才會回傳 `correct` 或 `wrong`。`0009` 讓已發布或已取代版本不能留下缺少可用答案的自動判分小題；人工與 AI 輔助檢視仍可沒有參考答案，結果保持 `pending`。完整操作說明見 `docs/local-practice-pilot.md`。

這些端點已能辨識本機 session 並隔離合成帳號，但不會代理主應用的 JSON 寫入。未驗證電子郵件可在 localhost 或同一 tailnet 的私有 HTTPS 入口使用；本機信箱驗證、密碼重設與角色 PIN 設定／重設的 challenge、API 與介面已完成，但 SMTP 執行環境與真實投遞尚未設定。公開／production HTTPS、公開登入 rate limit、OAuth、跨帳號分享、RLS、production GRANT 與正式角色授權仍未完成，因此不能在 Vercel 或 production 資料庫上當成正式 API。

## 本輪有界驗收矩陣

這個 P0 回歸最早出現在 `6ef62eb`：頁面先載入未登入的 fixture bootstrap，之後 `auth/me` 失敗時又保留既有帳號狀態。現在正式頁面改為 `auth/me` 優先，驗證失敗就清除帳號範圍狀態；hydration guard 會等登入狀態確定後才呈現工作區，舊 bootstrap／state 路徑則固定回 HTTP `410`。下列項目是本輪有界的回歸邊界，不把尚未接線的 production 服務納入完成範圍。

| 驗收項目 | 必須成立的行為 | 交付邊界 |
| --- | --- | --- |
| 帳號生命週期 | 合成 `.invalid` 帳號可註冊、登入、重新整理與重新開頁；登出或 session 到期後 cookie 與資料庫 session 都失效。密碼重設不改動 `verified_at`，成功後撤銷全帳號 session；角色 PIN 設定／重設要求已驗證電子郵件與有效目標角色，成功後只撤銷目標角色 session | 基本帳號、信箱驗證、密碼／PIN 復原與 `0012` identity binding 已通過隔離 DB E2E。同步寄信 timing enumeration、SMTP outbox／等時回應與真實投遞是 `0012` 之外的上線阻擋，不得標示為 production 復原已交付。角色 PIN 尚不參與成人角色切換 |
| P0 登入狀態遺失 | 正式頁面先查 `auth/me`。未登入、cookie 無效或 session 過期時，當頁立即清除帳號、學習者、題目、作答與角色等帳號範圍狀態，導回 `/account`；不得載入 fixture、預設帳號或先前瀏覽器學習者快照。任一分頁登出或確認 session 失效時，其他分頁也會清除相同工作區狀態；角色或目前學習者改變時，其他分頁重新載入操作情境 | 跨分頁訊號不保存帳號或學習者個資；頁面重新取得焦點或恢復可見時會再查 `auth/me`。非識別性的 UI 設定、計畫、排程與收藏仍可能留在瀏覽器，但不能使未登入者取得伺服器資料 |
| 系統設定權限 | 具有有效 parent／tutor 授權的 session 切到相應 `activeRole` 後，可進 `/system-settings` 管理有權存取的學習者，無論主要 `accountRole` 為何；受管 learner mode 看不到此入口，帳號層 identity、create、update 與 select 回 `403`；只具 self learner 能力的帳號可查看自己的帳號設定但不能建立受管學習者 | `system_admin` 管理、邀請與跨帳號分享不在本輪 |
| 學習者設定權限 | `/settings` 永遠以 session 的 active learner 為目標。受管 learner mode 可進入；只有有效、已接受、未撤銷且 `can_manage_settings=true` 的 `learner_access` 可寫入 | 顯示名稱、年級、學期與各科書籍版本已有正式寫入；其餘欄位依完成對照保持只讀或瀏覽器狀態 |
| 題庫與作答持久性 | 依「國語 → 國一 → 翰林版 → 第一冊 → 第四課」可讀 279 題，建立 session、送出作答並從 PostgreSQL 讀回結果、歷程與錯題；重新整理與重開後以 session UUID 恢復已送出進度。從任意題開始時會尋找下一道未送出題目，只有全部 item 都完成才結束 session | 尚未送出的文字與手寫內容不保存；其他科目尚未接入正式題庫。`score` 只有 aggregate 與不含答案／判定的冪等收據，不會出現在逐題歷程或錯題中 |
| private 手寫 PNG | `instant`／`complete` 只接受格式、尺寸與可見墨跡通過驗證的 PNG，以 private asset 冪等儲存，取回時從作答關聯反查權限。手寫替代缺少文字答案時結果保持 pending／manual；已有完整答案時只作為計算過程附件 | 針對性單元／契約測試已通過；已整合 `0012`；private PNG 的 DB E2E 與瀏覽器驗收尚未執行。`score` 不允許手寫或其他逐題附件 |
| 相同／相近題推薦 | 相同題要求文字骨架與解題邏輯一致，只允許核准的可變值不同；相近題依已確認群組及共同正式關鍵字／主題數量排序。同一相近程度內尚未作答者優先，較相近層級沒有符合條件的候選時才向外遞補；`score` 禁止 | `0014`／`0015` 已完成資料模型、正式關聯查詢、排序、來源證據、pending 分析管線、管理員審核介面與學生端層級文案。279 題尚未全量分析與核准；目前 confirmed 關聯仍為 0，不能宣告已有可用的正式相同／相近題內容 |
| 題庫補全 | 對已發布系統題提出細題型、主要知識點與解題方法建議；dry-run 為預設，寫入時也只能建立 pending suggestion | CLI／checkpoint 與針對性測試已完成；`0012` run／suggestion schema 已整合，279 題尚未 apply。先通過品質抽檢與人工核准，才能另行建立新 revision |
| 歷史版本與安全恢復 | 歷程使用當時固定的 revision；缺少安全快照時只顯示結果、時間與無法安全顯示內容的提示，不用目前題目冒充。resume 發現 revision mismatch 時把舊 session 標記為 `abandoned`，提示重新建立練習 | 不為修復舊歷程而補造題目內容或改寫原 session 的 revision |
| 帳號隔離 | 直接改 learner、session、attempt 或 asset 識別碼不能讀寫其他帳號或學習者資料；切換角色或學習者後只看目前授權範圍 | production RLS／GRANT 與可信高權限 caller 尚未建立 |
| 舊端點 | `/bootstrap`、`state`、`reset`、`questions`、`imports` 與 storage-key asset 端點一律回 HTTP `410`，回應不得快取 | 正式 PostgreSQL 匯入 API／介面尚未交付；舊 `/bank` 不得恢復成 mock 寫入入口 |
| 響應式與路由 | `/account`、`/system-settings`、`/settings`、`/practice` 及專注練習在桌面、平板與手機寬度可操作；重新整理、上一頁與下一頁維持正確網址與權限狀態 | 私有 tailnet HTTPS 是本機驗收入口，不是 production 部署 |

## 已知契約落差

- 產品規格把匯入時的科目、版本、單元、主題、難易度與來源列為選填；舊 mock 匯入契約曾要求多個欄位不得為空，現已封閉。正式 API 應依來源維度規則決定發布前必填項，不沿用舊契約的一律必填。
- 產品規格要求正式相近題關聯完成前不顯示成正式功能；現有 fixture 與畫面使用 `generatedFrom`、`queuedSimilarByLearner` 模擬。搬移時要分成生成來源、舊佇列與已確認相近群組，不能把 mock 字段直接當正式關聯。
- 現有 `Question.kind` 表達選擇、文字或多小題等作答形態，`typeLabel` 才保存來源題型名稱；正式資料庫以 `question_types`、`question_parts.answer_mode` 與內容區塊分開表示。搬移需使用核准對照表，不能以畫面名稱猜測。
- 現有匯入把一批題目共用 `fileNames`，實作上可能把每題都連到第一個檔名；正式流程必須逐題保存 `source_document_id`、頁碼、裁切圖與來源題號。
- 本機題庫只允許原本屬於第四課的單一來源文件歸入第四課，並保留原檔課次、檔名與來源 metadata。其餘 14 份文件尚未匯入，必須先依原生教材位置確認分類，不可套用第四課分類。
- `/practice` 已保留多科目介面，但 PostgreSQL 題庫查詢目前仍固定為已串接的國一／國語／翰林版／第一冊／第四課。其他科目顯示無資料，不代表動態多科目伺服器契約已完成。
- `docs/plan.md` 同時記錄已封閉的歷史 JSON 功能、本機 PostgreSQL 持久服務與正式資料庫切換。這些功能不是同一個完成狀態；本文件分開標示「schema 已驗證」、「本機持久服務已串接」與「待正式串接」。

## 安全切換邊界

1. 選定正式後端執行環境、PostgreSQL 託管位置、ORM／查詢層、驗證信服務、物件儲存與 Secret Manager，並建立非 production 的整合環境。
2. 核准學習者資料、作答、來源文件、手寫／一般附件、IP 與稽核紀錄的保存期限、刪除及去識別化政策；政策未定前不搬入真實兒童資料。
3. 把本機已完成的 session 與 `learner_access` 檢查擴充到正式角色、跨帳號分享及主應用所有資源，並在開放遠端登入前完成公開 HTTPS、SMTP 真實投遞、OAuth 與 rate limit。現有 migration 沒有建立 RLS、正式 GRANT 或可驗證 caller 身份的 `SECURITY DEFINER` 邊界；`bootstrap_admin`、`system_job` 只是資料列值。正式環境必須使用受限的應用程式資料庫角色與受控高權限路徑，資料庫連線及物件儲存憑證只留在伺服器。
4. 建立可重跑的 fixture／JSON 搬移工具。工具保持來源唯讀，輸出舊 ID 對新 UUID、各表筆數、內容雜湊、衝突與隔離項目。本機驗收可使用已授權的題庫文件，帳號、學習者與作答仍只能使用合成資料。
5. 在隔離資料庫演練空庫前進、既有資料升級、完整性拒絕案例、回滾、再次前進與搬移重跑。`0005` 以前的 `curriculum_units`、`source_categories` 沒有所有者欄位，非空資料庫要先證明既有列是系統目錄；無法確認者先對照所有者或隔離。之後再以非 production 物件儲存驗證附件權限。
6. 舊 JSON HTTP 寫入已停止。若要搬移仍需保留的歷史 JSON，只能先凍結來源、完成一次性搬移與數量核對，再開放對應的 PostgreSQL 正式 API；不得恢復雙寫。
7. 未授權的 reset、storage-key 直讀、完整答案 bootstrap 與瀏覽器端權威判分已封閉；含個資或作答的回應使用 `Cache-Control: private, no-store`。上線前仍須完成 production 身分、附件與管理員邊界，跨帳號統計在隱私政策生效前維持關閉。
8. 通過正式 API 的授權、表單讀寫、併發衝突、附件、作答不可變性、資料隔離、型別檢查、lint、build 與瀏覽器核心流程後，才可標記應用程式切換完成。migration 通過本身不是上線證據。

## 本機 migration 驗收

需要本機可執行的 PostgreSQL 工具：`initdb`、`pg_ctl`、`createdb`、`psql` 與 `pg_dump`。唯一建議入口是：

```bash
npm run db:test
npm run test:import-ownership
npm run test:local-practice
npm run test:account-recovery
npm run test:handwriting
npm run test:question-enrichment
node --test tests/practice-catalog-integration.test.mjs
```

最近一次完整 `npm run db:test` 使用明確 opt-in 的本機 Unix-socket PostgreSQL，在具隨機名稱的隔離資料庫中通過十五個 migration。範圍包括首次前進、既有完整性與併發回歸、`0014` 的模板／關鍵字與來源證據限制、`0015` 的 AI 關鍵字審核限制、逐層 down、第二次前進與 schema parity。完成後沒有留下 `lerniqa_schema_test_%` 資料庫或測試 session。

驗證預設自行在 `/tmp` 建立一次性 PostgreSQL cluster，關閉 TCP、使用私有 Unix socket，並對每個資料庫指令明確指定 host、port、user 與 database；同時以 `PSQLRC=/dev/null` 避免本機設定改變測試行為。`db:test`、import ownership 與 local practice runner 也分別提供 `LERNIQA_DB_TEST_*`、`LERNIQA_IMPORT_OWNERSHIP_TEST_*`、`LERNIQA_PRACTICE_TEST_*` 的 existing-local-server 明確 opt-in。這些模式都要提供本機 Unix socket、port 及預期 data directory，並核對目前作業系統使用者與 non-recovery 狀態；runner 只建立具隨機名稱及本次 ownership comment 的隔離資料庫，清理前再次核對身分，不停止共用 server，也不得連接 production。import ownership 測試只檢查隔離匯入後的資料所有權；local practice 測試使用 279 題規模的合成題庫完成註冊、登入、session 恢復、三種模式的保存與答案揭露、歷程、錯題及 PostgreSQL／Next.js 重啟驗證。`test:account-recovery`、`test:handwriting` 與 `test:question-enrichment` 檢查程式、輸入限制、安全邊界與 repository／route 契約；migration 契約另由 `db:test` 驗證。現有階段性推薦案例由整體 `npm test` 執行，但不代表文字骨架、可變值與正式關鍵字關係已完成。`practice-catalog-integration` 另檢查主 `/practice` 的題庫轉換、最多 500 題的分頁讀取、正式知識點關聯及 learner-keyed `localStorage` 邊界。完成後再執行：

```bash
npm run lint
npm test
npm run build
git diff --check
```

## 明確不在本輪

- 排序、拖曳配對、圖片熱區、自由繪圖、錄音作答與通用互動版面；需求確認後再以新 migration 擴充。
- 真實 OCR、AI 拆題、AI 自動判分與生成題服務；本地手寫 AI 目前只產生可追溯的逐字辨識紀錄，不接收參考答案或判斷正誤，真實筆跡品質與人工檢視介面仍待驗收。
- 相近題候選審核、正式群組關聯與共用查詢 API，以及複習／相近題 session 的完整 `practice_session_item_origins` 寫入；現有 schema 或畫面中的固定關係不代表這些流程已完成。
- 計畫、排程、收藏及其他仍由 `localStorage` 保存的資料寫入 API；schema 已存在不代表表單已經切換。
- 未核准的考試級別展開規則、社群榜門檻、管理員跨帳號改題權限與資料保存期限。
- production 資料搬移、production migration、Vercel 部署及永久憑證／權限；都需要另行明確授權與正式環境決策。
