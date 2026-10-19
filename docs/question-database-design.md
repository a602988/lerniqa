# 題目與學習資料庫規劃

正式匯入的題目、帳號、角色、學習者、練習與作答紀錄屬持久資料，不得用 seed、reset、fixture 還原或測試 cleanup 覆蓋。合成 fixture 只用於明確隔離的測試資料庫；資料量少不會改變持久資料的性質。

279 題的 parser v2 confirmed 批次為 `2d1ff794-f6f4-5e59-baaa-8d1c767438be`，來源 SHA-256 為 `c2b09d04ef9e0a32a2fbe71a8f8e930d2061fb87e78bb6bc60f694df6be8cfb2`。相同輸入重跑應重用批次，不重建或清空既有題目。

狀態：正式 schema（資料庫結構）基底。程式庫包含 `0001` 至 `0020` 共二十個 migration（資料庫遷移），涵蓋身份與目錄、題目核心、匯入與收藏、練習與作答、相近題與統計、Word 來源、答案與文件完整性、session／匯入完整性、自動判分答案完整性、一般帳號角色與 self learner 完整性、`score` session 的彙總與逐題資料隱私、管理目錄與題庫補全 sidecar、十二年國教年級目錄、可審核的題目關聯、出版社版本與冊次分離、學習本版本及分享、經來源核准的文字答案欄位數，以及補充教材來源證據。二十個 migration 的隔離資料庫往返驗證已通過；`0020` 尚未套用持久本機資料庫。應用程式切換與正式環境部署仍須先確認後端、登入服務、物件儲存、ORM（物件關聯對映工具）及資料保存期限。

## 評估結論

本規劃已處理題目版本、文字／圖片／音訊內容、跨版本多單元歸檔、正式課綱代碼、來源適用維度、匯入來源、逐次作答、排程練習、相近題追溯、題目審核與統計重建。固定教材分類使用正式外鍵，來源特有欄位使用資料驅動規則；兩者不混用。正式應用程式切換前仍須確認後端服務與資料保存期限，不能先以應用程式預設值代替產品決策。

正式資料庫以 PostgreSQL 為基準；大型 PDF、圖片及手寫內容放在物件儲存，資料庫只保存檔案資訊與儲存鍵值。

## 實作狀態

`database/migrations/0001_identity_and_catalog.up.sql` 已建立身份、學習者、檔案與基礎目錄資料表，並提供對應的回滾 migration。前進、欄位限制、回滾及再次前進已在只含合成資料的隔離 PostgreSQL 測試資料庫通過。`learner_preferences.active_exam_id` 已由練習與作答階段加入，並以複合外鍵限制為同一學習者的考試。舊 JSON HTTP 端點已封閉；尚未資料庫化的偏好、考試、計畫、排程與收藏不得改回舊 JSON 路徑。

`database/migrations/0002_question_core.up.sql` 已建立題庫、題目版本、小題、內容、答案、分類關聯及來源專屬篩選欄位。`database/migrations/0003_import_and_collections.up.sql` 已建立來源文件、匯入、來源追溯與收藏資料表，並補上文件內題號的欄位與限制。`database/migrations/0004_practice_and_attempts.up.sql` 已建立考試、計畫、排程、練習、逐次作答、小題結果、手寫檔案、審核、後續練習佇列及來源追溯。

`database/migrations/0005_similarity_analytics_and_audit.up.sql` 已建立相近題、統計、隱私政策、outbox、重算工作、管理員稽核與資料刪除共 14 張業務資料表，並為 `learner_practice_queue_items` 與 `practice_session_item_origins` 加入 `similarity_group_id`、外鍵與 `confirmed_group` 值域。它也補上 `curriculum_units`、`source_categories` 的系統／帳號所有權，以及代表圖片、題目內容、來源文件、裁切圖、手寫與一般作答附件的用途、掃描狀態和刪除狀態完整性。`0006` 補齊 Word 來源型別，`0007` 補齊選項答案與 ready DOCX 來源的交易結束完整性限制。`0008` 要求有效 session 指定啟用中的學習者，固定帳號／學習者鎖定順序，並只把指定 confirmed Hanlin 批次的教材關聯修正為 `native/document`。`0009` 要求 published／superseded 版本中的自動判分小題具備可用答案，升級前發現既有缺漏就停止，不猜測或補造答案。`0010` 加入 `users.account_role`、self learner 唯一性、名稱與設定權限一致性，以及相關登入身份、角色與學習者關係的交易最終狀態限制。`0011` 為 `practice_sessions` 加入五個 `score` 彙總欄位，新增不含答案與判定的 `practice_score_receipts`，將舊版 `score` 逐題資料改為只保留彙總與收據，從剩餘非 `score` 明細重建五張統計表，並以 `asset_object_cleanup_jobs` 追蹤只屬於舊 `score` 的私有作答物件清理。

### `0012` 管理目錄與題庫補全契約

`0012` 把密碼／角色 PIN 復原 challenge 固定綁定到電子郵件 identity，同時擴充錯題佇列與 session origin 的同細題型值域，新增 `question_enrichment_runs`、`question_revision_enrichment_suggestions`、`handwriting_analysis_jobs` 與 `handwriting_analysis_runs`；它不包含 SMTP outbox。欄位、限制與索引以已整合的 migration SQL 為權威。

題庫補全以 dry-run 為預設，寫入也只能建立 pending suggestion，核准前不改寫已發布題目。手寫 AI 只能分析 payload 為空且結果為 pending／manual 的手寫小題；計算過程附件不進入 job。辨識方式由 `question_revisions.original_question_type_label` 的正式細題型契約決定：「寫出國字、注音」使用單一字元模式，「注釋」使用單行多字模式；未設定的細題型不進入 worker。模型輸出是建議，不得直接改寫 `current_result`、錯題佇列或統計，只有授權審核者新增的 `answer_reviews` 能改判。

二十個 migration 合計 122 張業務資料表；技術性的 `schema_migrations` 不列入。Lerniqa 是持續開發中的多科目正式產品。帳號、角色、學習者基本資料，以及 `/practice` 的題庫、學習本、排程、session、作答、歷程與錯題流程已讀寫本機 PostgreSQL。`/system-settings` 處理帳號身分、有效角色與學習者關係，`/settings` 獨立處理目前學習者。公開契約分開一般帳號的 `accountRole`、session 目前角色／學習者與 `system_admin` 授權。瀏覽器只保存非識別性 UI 設定、尚未切換資料庫的收藏，以及明確搬移後保留的舊學習本原始備份；舊 JSON HTTP 端點固定回 `410`。`/local-practice` 僅供內部診斷與相容。

Migration 層以 PostgreSQL 原生 SQL 保存 schema，不先綁定 ORM。ORM 會在後端服務技術選型確認後接入，不能反過來改變已核准的資料模型。

## 共通規則

- 資料表與欄位使用 `snake_case`。主鍵使用 `uuid`，由後端產生。
- 所有時間使用 `timestamptz` 並保存 UTC；日統計依 `Asia/Taipei` 換日。
- `created_at`、`updated_at` 由後端或資料庫維護。一般業務操作不得覆寫或實體刪除歷史作答、審核與稽核資料；依法提出的刪除要求依資料保存政策刪除或去識別化，不受一般業務限制阻擋。
- 列舉值先使用 `text` 搭配 `CHECK` 或參照表；正式值域集中管理，不散落在應用程式。
- `jsonb` 只保存匯入原文、選題快照、作答內容及稽核差異等結構可能變動的資料，不取代可查詢的正式關聯欄位。
- 系統預設管理員不寫入本資料庫。其不可變身份與驗證資料放在後端的 Secret Manager（密鑰管理服務）或身份服務。
- 題目、答案、分類或解析一旦供練習使用，不原地修改；更正時建立新的 `question_revisions`。
- 外鍵預設禁止連鎖刪除。只有純關聯表可依交易需求使用連鎖刪除；題目版本、作答、稽核與來源紀錄不得連鎖刪除。
- 所有可由多帳號修改的設定資料使用 `lock_version` 進行 optimistic locking（樂觀鎖定）。更新時必須同時比對主鍵與目前版本；不相符時回傳衝突，不能以最後寫入覆蓋前一位使用者。

表格中的「—」表示該欄位沒有額外參數或限制需要補充。

## 帳號、角色與學習者

### `users` 帳號

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 帳號識別碼 | 主鍵 |
| `display_name` | `varchar(80)` | 必填 | 帳號顯示名稱 | — |
| `account_role` | `varchar(30)` | 有有效登入身份時必填 | 一般帳號本人身分 | `parent`、`learner` 或 `tutor`；`system_admin` 不寫入此欄 |
| `status` | `varchar(20)` | 必填；`active` | 帳號狀態 | `active`、`suspended`、`closed` |
| `created_at` | `timestamptz` | 必填；目前時間 | 建立時間 | — |
| `updated_at` | `timestamptz` | 必填；目前時間 | 最近更新時間 | — |
| `closed_at` | `timestamptz` | 選填 | 關閉帳號時間 | 關閉後仍保留依法必須保存的交易與稽核資料 |

`0010` 要求有未撤銷登入身份的帳號具有 `account_role`，並保留相符且未撤銷的 `user_roles` 授權。`account_role=learner` 還必須具有已接受、未撤銷且指向啟用中學習者的本人關係。既有資料依有效 session、學習者關係與成人角色授權按固定順序回填；無法安全判定時 migration 會停止，不猜測帳號身分。

### `account_identities` 登入身份

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 登入身份識別碼 | 主鍵 |
| `user_id` | `uuid` | 必填 | 所屬帳號 | 外鍵至 `users.id` |
| `provider` | `varchar(30)` | 必填 | 登入方式 | `email`、`google`、`line`、`facebook` 或後續核准值 |
| `provider_subject` | `varchar(255)` | 必填 | 登入服務提供的不可變身份 | 與 `provider` 組合唯一 |
| `email_normalized` | `varchar(320)` | 選填 | 正規化電子郵件 | 電子郵件登入、密碼重設或角色 PIN 設定／重設時使用；有值時唯一 |
| `password_hash` | `text` | 選填 | 電子郵件登入密碼雜湊 | 不得保存明碼；社群登入為空 |
| `verified_at` | `timestamptz` | 選填 | 身份驗證完成時間 | — |
| `created_at` | `timestamptz` | 必填；目前時間 | 綁定時間 | — |
| `revoked_at` | `timestamptz` | 選填 | 解除綁定時間 | — |

### `auth_sessions` 登入工作階段

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 工作階段識別碼 | 主鍵 |
| `user_id` | `uuid` | 必填 | 登入帳號 | 外鍵至 `users.id` |
| `token_hash` | `text` | 必填 | 工作階段 token（權杖）雜湊 | 唯一；瀏覽器只持有原始 token，不寫入資料庫或 log（執行紀錄） |
| `active_role` | `varchar(30)` | 必填；`learner` | 目前操作角色 | 必須是帳號有效角色；登入預設為 `learner` |
| `active_learner_id` | `uuid` | 選填 | 目前選取的學習者 | 必須有有效 `learner_access` |
| `expires_at` | `timestamptz` | 必填 | 到期時間 | — |
| `last_seen_at` | `timestamptz` | 必填；目前時間 | 最近活動時間 | — |
| `created_at` | `timestamptz` | 必填；目前時間 | 登入時間 | — |
| `revoked_at` | `timestamptz` | 選填 | 撤銷時間 | 權限重大異動時可撤銷既有工作階段 |

建立、恢復或切換有效 session 時，必須和 `users` 狀態、`user_roles` 及 `learner_access` 異動使用同一個每帳號 transaction advisory lock，鎖後再重新驗證目前權限。migration 以 trigger 提供資料庫層防漏；正式服務仍應在相關 DML 前先取得同一把鎖並處理可重試的併發錯誤。

### `verification_challenges` 帳號與角色 PIN 驗證

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 驗證要求識別碼 | 主鍵 |
| `user_id` | `uuid` | 必填 | 驗證帳號 | 外鍵至 `users.id` |
| `purpose` | `varchar(30)` | 必填 | 驗證用途 | `email_verify`、`password_reset`、`role_pin_reset`、`sensitive_action` |
| `target_role` | `varchar(30)` | 選填 | 要重設的角色 | `purpose=role_pin_reset` 時必填 |
| `token_hash` | `text` | 必填 | 一次性驗證 token 雜湊 | 不保存明碼 |
| `attempt_count` | `smallint` | 必填；`0` | 驗證失敗次數 | — |
| `expires_at` | `timestamptz` | 必填 | 到期時間 | — |
| `consumed_at` | `timestamptz` | 選填 | 使用完成時間 | 已使用或過期的 token 不得再次使用 |
| `created_at` | `timestamptz` | 必填；目前時間 | 建立時間 | — |

信箱驗證、密碼重設與角色 PIN 設定／重設的本機 challenge、API 與介面已完成。新的申請會使同一帳號、用途與目標角色的舊 challenge 失效，並套用每帳號的重寄間隔與每小時上限；公開申請回應不揭露帳號或電子郵件是否存在。密碼重設只要求唯一有效的電子郵件身份，不會更新 `verified_at`，成功後撤銷該帳號的所有 session。角色 PIN 設定／重設要求唯一有效且已驗證的電子郵件身份，以及確認時仍有效的 parent／tutor 目標角色；成功後只撤銷該目標角色的 session。目前同步寄信仍可能讓已知與未知帳號產生 timing enumeration；SMTP outbox／等時回應、Lerniqa 憑證與 handshake、真實投遞、公開／production HTTPS 及公開登入 rate limit 都尚未完成，且 outbox 不屬於 `0012`。

### `user_roles` 帳號角色與系統管理員授權

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 角色授權識別碼 | 主鍵 |
| `user_id` | `uuid` | 必填 | 被授權帳號 | 外鍵至 `users.id` |
| `role` | `varchar(30)` | 必填 | 帳號角色 | `parent`、`learner`、`tutor`、`system_admin` |
| `granted_by_type` | `varchar(30)` | 必填 | 授權者類型 | `user` 或 `bootstrap_admin` |
| `granted_by_user_id` | `uuid` | 選填 | 授權者帳號 | `granted_by_type=user` 時必填 |
| `granted_at` | `timestamptz` | 必填；目前時間 | 授權時間 | — |
| `revoked_by_type` | `varchar(30)` | 選填 | 移除角色者類型 | 參數同 `granted_by_type` |
| `revoked_by_user_id` | `uuid` | 選填 | 移除角色者帳號 | — |
| `revoked_at` | `timestamptz` | 選填 | 角色失效時間 | 同一帳號與角色只能有一筆有效授權 |

新帳號建立時由後端依選定的 `account_role` 一併建立相符有效角色；前端不能用 `active_role` 自行授予角色。角色授權對象、角色、授權者與授權時間不可改寫或刪除，撤銷只能從有效狀態單向發生。`system_admin` 的授予或撤銷必須由當下有效的管理員，或受控的 `bootstrap_admin` 路徑執行，並在同一交易建立目標為該 `user_roles.id` 的相符管理員稽核。

### `role_pin_credentials` 角色 PIN 憑證

此表已接上角色 PIN 設定／重設 challenge、API 與介面，但尚未接入角色切換驗證。現行 parent／tutor 角色切換仍使用帳號密碼重新確認；角色 PIN 只建立或更新下列憑證，不得描述為目前的切換密碼。

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 角色 PIN 識別碼 | 主鍵 |
| `user_id` | `uuid` | 必填 | 所屬帳號 | 外鍵至 `users.id` |
| `role` | `varchar(30)` | 必填 | 受保護角色 | 首批只允許 `parent`、`tutor` |
| `pin_hash` | `text` | 必填 | 六位數角色 PIN 雜湊 | 只保存雜湊，不保存原始數字 |
| `failed_attempts` | `smallint` | 必填；`0` | 連續失敗次數 | 用於限制暴力嘗試 |
| `locked_until` | `timestamptz` | 選填 | 暫停嘗試截止時間 | — |
| `updated_at` | `timestamptz` | 必填；目前時間 | 最近設定時間 | `user_id + role` 唯一 |

### `learners` 學習者

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 學習者識別碼 | 主鍵 |
| `display_name` | `varchar(80)` | 必填 | 畫面顯示稱呼 | 介面除最上方身份區外不重複顯示 |
| `education_status` | `varchar(20)` | 必填；`enrolled` | 就學狀態 | `enrolled`、`not_enrolled` |
| `grade_id` | `uuid` | 選填 | 目前年級 | 外鍵至 `grades.id`；在學時必填，不在學時為空 |
| `semester_id` | `uuid` | 選填 | 目前學期 | 外鍵至 `semesters.id` |
| `school_name` | `varchar(120)` | 選填 | 學校名稱 | 採最少蒐集原則 |
| `avatar_asset_id` | `uuid` | 選填 | 代表圖片 | 外鍵至 `assets.id` |
| `status` | `varchar(20)` | 必填；`active` | 學習者狀態 | `active`、`archived` |
| `created_at` | `timestamptz` | 必填；目前時間 | 建立時間 | — |
| `updated_at` | `timestamptz` | 必填；目前時間 | 最近更新時間 | — |

`education_status=enrolled` 時 `grade_id` 必填；`education_status=not_enrolled` 時 `grade_id`、`semester_id` 與 `school_name` 必須為空。不建立「不在學」假年級，避免把就學狀態混入年級目錄及年級統計。不在學學習者可用 `learner_subject_settings` 啟用語言檢定或國家考試科目。

### `learner_access` 學習者分享與角色權限

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 存取授權識別碼 | 主鍵 |
| `learner_id` | `uuid` | 必填 | 學習者 | 外鍵至 `learners.id` |
| `user_id` | `uuid` | 必填 | 可存取帳號 | 外鍵至 `users.id` |
| `access_role` | `varchar(30)` | 必填 | 帳號與此學習者的關係 | `parent`、`learner`、`tutor`；不作為帳號可切換角色的授權來源 |
| `can_view_results` | `boolean` | 必填；`true` | 是否可查看學習成果 | — |
| `can_create_plans` | `boolean` | 必填；`false` | 是否可建立練習計畫 | — |
| `can_review_answers` | `boolean` | 必填；`false` | 是否可審核答案 | — |
| `can_manage_settings` | `boolean` | 必填；`false` | 是否可修改學習者設定 | — |
| `invited_by_user_id` | `uuid` | 選填 | 發出邀請的帳號 | 外鍵至 `users.id` |
| `accepted_at` | `timestamptz` | 選填 | 接受邀請時間 | 未接受前不得讀取學習資料 |
| `revoked_at` | `timestamptz` | 選填 | 取消授權時間 | `learner_id + user_id + access_role` 只能有一筆有效授權 |

`access_role` 用於顯示關係與套用新授權的預設值，實際授權以四個 `can_*` 欄位為準。審核者是 `can_review_answers=true` 的能力，不是可登入或切換的帳號角色；`auth_sessions.active_role` 只能使用 `user_roles` 的有效角色。應用程式公開的 `accountRole` 只代表一般帳號的主要身分是 `parent`、`tutor` 或 `learner`，不把 `system_admin` 混進一般身分，也不等同 session 的 `active_role`。變更 `accountRole` 不會自動撤銷其他有效一般角色；目前可用能力以 `active_role` 及其有效授權為準。

`learner_access(learner_id, user_id, access_role)` 在 `revoked_at IS NULL` 時唯一。`0010` 另以 `learner_access(user_id)` 的部分唯一索引限制每個帳號至多一筆未撤銷的 `access_role=learner` 關係。已接受且啟用中的 self learner 必須與帳號顯示名稱一致，並具有 `can_manage_settings=true`；這些規則由可延後限制檢查交易最終狀態。parent／tutor 切入受管 learner mode 時，帳號層系統設定 API 回 `403`；目前學習者設定仍可依有效關係及 `can_manage_settings` 讀寫。

### `learner_preferences` 學習偏好

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `learner_id` | `uuid` | 必填 | 學習者 | 主鍵及外鍵至 `learners.id` |
| `question_limit_options` | `smallint[]` | 必填 | 常用題數清單 | 最多 20 個不重複的正整數，每個值為 1 至 500；依陣列順序顯示 |
| `default_question_limit` | `smallint` | 必填 | 預設每輪題數 | 範圍 1 至 500，且必須存在於 `question_limit_options` |
| `default_check_mode` | `varchar(20)` | 必填；`complete` | 預設答案檢核方式 | `complete`、`instant`、`score` |
| `active_exam_id` | `uuid` | 選填 | 目前練習套用的考試 | 必須屬於同一學習者；外鍵至 `exams.id` |
| `lock_version` | `integer` | 必填；`1` | 樂觀鎖定版本 | 每次成功更新加 1 |
| `updated_at` | `timestamptz` | 必填；目前時間 | 最近更新時間 | — |

## 教材與分類目錄

### `grades` 年級

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 年級識別碼 | 主鍵 |
| `stage` | `varchar(20)` | 必填 | 教育階段 | `elementary`、`junior_high`、`senior_high` |
| `code` | `varchar(30)` | 必填 | 年級穩定代碼 | 唯一，例如 `junior-high-1` |
| `name` | `varchar(40)` | 必填 | 年級顯示名稱 | 例如「國一」 |
| `sort_order` | `smallint` | 必填 | 排序 | — |
| `status` | `varchar(20)` | 必填；`active` | 使用狀態 | `active`、`inactive` |

`0013` 建立 `elementary-1` 至 `elementary-6`、`junior-high-1` 至 `junior-high-3`、`senior-high-1` 至 `senior-high-3` 共十二個啟用年級，並以 `seed_manifests` 保存來源與 checksum。教育階段及年級順序由資料庫目錄與公開 catalog API 提供，前端不維護另一份固定清單。

### `semesters` 學期

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 學期識別碼 | 主鍵 |
| `code` | `varchar(20)` | 必填 | 學期代碼 | 唯一 |
| `name` | `varchar(40)` | 必填 | 學期名稱 | 例如「上學期」 |
| `sort_order` | `smallint` | 必填 | 排序 | — |
| `status` | `varchar(20)` | 必填；`active` | 使用狀態 | `active`、`inactive` |

`0013` 建立 `semester-1` 上學期與 `semester-2` 下學期。學生必須從啟用中的學期選擇；社會人士不保存學期。

### `subjects` 科目

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 科目識別碼 | 主鍵 |
| `code` | `varchar(60)` | 必填 | 科目穩定代碼 | 唯一；系統科目使用固定代碼，自訂科目由後端產生 |
| `name` | `varchar(80)` | 必填 | 科目名稱 | 同一所有者範圍內不可重複 |
| `normalized_name` | `varchar(80)` | 必填 | 正規化科目名稱 | 去除前後空白並套用統一大小寫規則；只供唯一性檢查 |
| `parent_subject_id` | `uuid` | 選填 | 上層科目 | 外鍵至 `subjects.id`；例如社會為歷史、地理及公民的上層科目 |
| `subject_kind` | `varchar(20)` | 必填；`leaf` | 科目節點種類 | `group` 或 `leaf`；題目只能直接關聯 `leaf` |
| `origin` | `varchar(20)` | 必填 | 科目來源 | `system` 或 `account` |
| `owner_user_id` | `uuid` | 選填 | 自訂科目建立者 | `origin=account` 時必填；系統科目為空 |
| `status` | `varchar(20)` | 必填；`active` | 使用狀態 | 自訂科目可封存；系統預設科目不得由一般帳號刪除 |
| `created_at` | `timestamptz` | 必填；目前時間 | 建立時間 | — |

系統科目的 `normalized_name` 全域唯一；自訂科目在同一建立者範圍內唯一。建立自訂科目前，後端還要比對目前可見的系統科目名稱與別名；名稱相同時要求使用既有系統科目，不另建平行科目。

科目樹只表達彙整關係，不取代年級適用設定。題目保存到歷史、地理、公民等最末層科目；畫面選取社會等上層科目時，查詢服務展開其所有有效子科目。自訂科目首批只允許建立 `leaf`，避免帳號自行改變系統科目樹。

語言檢定與國家考試科目沿用同一科目樹，例如行政法、民法建立為系統 `leaf`，需要彙整時掛在系統 `group` 下，不另建平行科目機制。

### `subject_aliases` 科目別名

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 別名識別碼 | 主鍵 |
| `subject_id` | `uuid` | 必填 | 所屬系統科目 | 外鍵至 `subjects.id`；只允許系統科目 |
| `alias` | `varchar(80)` | 必填 | 科目別名 | 例如教材或匯入資料中的替代名稱 |
| `normalized_alias` | `varchar(80)` | 必填 | 正規化別名 | 全域唯一，規則同 `subjects.normalized_name` |
| `status` | `varchar(20)` | 必填；`active` | 使用狀態 | `active`、`inactive` |

### `grade_subjects` 年級可用科目

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `grade_id` | `uuid` | 必填 | 年級 | 外鍵至 `grades.id` |
| `subject_id` | `uuid` | 必填 | 科目 | 外鍵至 `subjects.id` |
| `is_default` | `boolean` | 必填；`false` | 是否為該年級系統預設科目 | 預設科目不可由學習者設定刪除 |
| `sort_order` | `smallint` | 必填 | 顯示順序 | — |
| `active_from` | `date` | 選填 | 啟用日期 | 未填表示立即適用 |
| `active_until` | `date` | 選填 | 停用日期 | 之後加入理化只需新增關聯，不影響舊資料 |

主鍵為 `grade_id + subject_id`。國一是否顯示理化由此表與學習者科目設定共同決定，不寫死在前端。

### `publishers` 出版社

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 出版社識別碼 | 主鍵 |
| `code` | `varchar(40)` | 必填 | 出版社代碼 | 唯一 |
| `name` | `varchar(80)` | 必填 | 出版社名稱 | — |
| `status` | `varchar(20)` | 必填；`active` | 使用狀態 | `active`、`inactive` |

### `book_versions` 書籍版本

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 書籍版本識別碼 | 主鍵 |
| `subject_id` | `uuid` | 必填 | 所屬科目 | 外鍵至 `subjects.id` |
| `grade_id` | `uuid` | 選填 | 適用年級 | 空值表示跨年級自訂版本 |
| `publisher_id` | `uuid` | 選填 | 出版社 | 外鍵至 `publishers.id` |
| `name` | `varchar(100)` | 必填 | 版本名稱 | 例如「康軒版」 |
| `origin` | `varchar(20)` | 必填 | 版本來源 | `system` 或 `account` |
| `owner_user_id` | `uuid` | 選填 | 自訂版本建立者 | `origin=account` 時必填 |
| `status` | `varchar(20)` | 必填；`active` | 使用狀態 | — |
| `created_at` | `timestamptz` | 必填；目前時間 | 建立時間 | — |

`book_versions` 表示科目、年級與出版社的版本，例如「國一數學康軒版」，不包含上、下學期。學期與冊次由 `curriculum_units` 的 `volume` 節點表達；同一版本可同時具有上冊與下冊。

### `exam_programs` 考試體系

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 考試體系識別碼 | 主鍵 |
| `code` | `varchar(60)` | 必填 | 穩定代碼 | 唯一，例如 `gept`、`cambridge_english`、`civil_service` |
| `name` | `varchar(120)` | 必填 | 顯示名稱 | 例如「全民英檢」 |
| `authority_name` | `varchar(160)` | 必填 | 主辦或發證機關 | — |
| `source_reference` | `text` | 必填 | 正式分類來源 | 主辦機關文件名稱或網址 |
| `status` | `varchar(20)` | 必填；`active` | 使用狀態 | `active`、`inactive` |
| `sort_order` | `smallint` | 必填 | 顯示順序 | — |

### `exam_program_levels` 考試級別與類別

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 級別識別碼 | 主鍵 |
| `exam_program_id` | `uuid` | 必填 | 所屬考試體系 | 外鍵至 `exam_programs.id` |
| `parent_level_id` | `uuid` | 選填 | 上層級別或類別 | 外鍵至同表；例如類科可掛在考試等別下 |
| `code` | `varchar(60)` | 必填 | 體系內穩定代碼 | 同一體系內唯一 |
| `name` | `varchar(120)` | 必填 | 顯示名稱 | 例如「中級」「B1 Preliminary」「一般行政」 |
| `level_kind` | `varchar(20)` | 必填；`level` | 節點種類 | `level`、`category`、`track` |
| `cefr_level` | `varchar(10)` | 選填 | CEFR 對照 | 語言類考試使用；非語言考試為空 |
| `sort_order` | `smallint` | 必填 | 顯示順序 | 只表示同層顯示順序，不一律代表難度高低 |
| `status` | `varchar(20)` | 必填；`active` | 使用狀態 | `active`、`inactive` |

考試級別是跨出版社、跨教材的正式分類，不併入 `curriculum_units`，也不把每個級別建立成 `source_categories`。語言檢定可使用平面級別；國家考試等非線性分類可用 `parent_level_id` 與 `level_kind` 表達等別、類科或組別。正式目錄只能依主辦機關可查證資料建立，來源參照失效時不得自行補造級別。

### `seed_manifests` 正式種子資料版本

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 種子資料版本識別碼 | 主鍵 |
| `catalog_key` | `varchar(80)` | 必填 | 目錄穩定鍵值 | 例如 `question_types`、`curriculum_codes`、`exam_programs` |
| `version` | `varchar(60)` | 必填 | 來源或發布版本 | 同一目錄內唯一 |
| `source_reference` | `text` | 必填 | 正式來源參照 | 內部核准文件名稱或權威網址 |
| `content_checksum` | `varchar(128)` | 必填 | 種子內容雜湊 | 用於偵測檔案與已套用內容不一致 |
| `item_count` | `integer` | 必填 | 項目數量 | 不得小於 0 |
| `status` | `varchar(20)` | 必填；`pending` | 套用狀態 | `pending`、`applied`、`superseded`、`failed` |
| `applied_at` | `timestamptz` | 選填 | 套用完成時間 | `status=applied` 或 `superseded` 時必填並保留原值 |
| `migration_name` | `varchar(160)` | 必填 | 對應 migration 名稱 | 可由部署紀錄追溯 |

正式目錄以版本化種子檔搭配 migration 管理，穩定代碼與固定 UUID 不因顯示名稱修改而改變。紀錄只能以 `pending` 或 `failed` 建立；核對完成後由既定狀態流程標記為 `applied`，只有已套用版本能轉成 `superseded`。套用證據一旦成立，不得改寫來源、雜湊、筆數、migration 名稱或完成時間。套用前驗證來源、雜湊、筆數與參照完整性；失敗時整批回滾。正式環境不得由前端自動建立系統題型、課綱代碼或考試級別。

## 題目來源與資料驅動篩選

### `source_categories` 題目來源

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 來源識別碼 | 主鍵 |
| `code` | `varchar(60)` | 必填 | 來源穩定代碼 | 唯一 |
| `name` | `varchar(100)` | 必填 | 來源名稱 | 首批包含題庫題目、課本自我評量、課本例題、課本隨堂、兩類習作、素養題、仿會考非選題、基測、會考、校內卷 |
| `exam_program_id` | `uuid` | 選填 | 所屬考試體系 | 外鍵至 `exam_programs.id`；只在來源本身限定體系時填寫 |
| `origin` | `varchar(20)` | 必填 | 來源建立範圍 | `system` 或 `account` |
| `owner_user_id` | `uuid` | 選填 | 自訂來源建立者 | `origin=account` 時必填；系統來源為空 |
| `status` | `varchar(20)` | 必填；`active` | 使用狀態 | 新來源以新增資料處理 |
| `sort_order` | `smallint` | 必填 | 顯示順序 | — |

系統來源由正式種子資料管理；帳號自訂來源只在建立者有權使用的題庫與匯入流程中可見。後端不得讓帳號把自訂來源偽裝成系統來源，也不得因同名就改寫正式來源。

### `source_category_dimensions` 來源固定維度規則

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `source_category_id` | `uuid` | 必填 | 題目來源 | 外鍵至 `source_categories.id` |
| `dimension` | `varchar(30)` | 必填 | 固定分類維度 | `grade`、`semester`、`book_version`、`exam_level`、`unit`、`topic`、`knowledge_point`、`curriculum_code` |
| `native_requirement` | `varchar(20)` | 必填 | 來源原生分類要求 | `required`、`optional`、`not_applicable` |
| `sort_order` | `smallint` | 必填 | 篩選顯示順序 | 只排序適用的維度 |

主鍵為 `source_category_id + dimension`。每個有效來源都要建立完整的固定維度規則；沒有資料列不能解讀成不適用。`native_requirement` 只約束來源原本具有的分類：`required` 表示發布前必須有原生值，`optional` 表示原生值可有可無，`not_applicable` 表示禁止保存原生值。空值只表示尚未取得或選填未填，不再同時表示「不適用」。後續人工分類或跨版本對照不屬於來源原生分類，不受 `not_applicable` 禁止。

套用到單元時，`required` 必須至少有一筆 `question_revision_units.assignment_type=native`，`optional` 允許沒有 `native` 關聯，`not_applicable` 禁止建立 `native` 關聯。三種狀態都允許後續建立 `cross_version_alignment` 或 `manual_classification`。套用到版本時，`not_applicable` 要求 `question_revisions.book_version_id` 為空，但不妨礙題目歸入特定版本的教材單元。主題、知識點與課綱代碼同樣只以來源直接提供的關聯判斷原生要求，後續人工分類需以 `value_source` 區分。

考試體系來源通常將 `exam_level` 設為 `required`，並將 `grade`、`semester` 與 `book_version` 設為 `not_applicable`。不限定特定考試體系的通用來源也能使用 `exam_level`，但題目級別仍須對應正式考試體系。

### `filter_fields` 來源專屬篩選欄位

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 欄位識別碼 | 主鍵 |
| `key` | `varchar(80)` | 必填 | API（應用程式介面）穩定鍵值 | 唯一，例如 `exam_round`、`paper_variant` |
| `name` | `varchar(100)` | 必填 | 畫面欄位名稱 | 例如「回次」「卷別」 |
| `value_type` | `varchar(20)` | 必填 | 值的型別 | `option`、`text`、`integer`、`year`、`date` |
| `selection_mode` | `varchar(20)` | 必填；`single` | 篩選選取方式 | `single` 或 `multiple` |
| `sort_order` | `smallint` | 必填 | 篩選面板中的預設順序 | 同一畫面依此排序 |
| `status` | `varchar(20)` | 必填；`active` | 使用狀態 | — |

`來源路徑`、重複的`來源類型`及重複知識點不建立可見篩選欄位。來源中的「學習內容」不建立 `filter_fields`；通過驗證的官方代碼改寫入 `curriculum_codes` 與題目版本關聯。無法驗證的原文留在匯入資料等待校正，不能只因介面不顯示該欄位就丟棄。

認知向度首批以 `filter_fields.key=cognitive_dimension` 建立全域適用的選項型欄位，選項由正式種子資料管理，不寫死在前端。若後續確認認知向度需要獨立權限、階層或跨題統計，再以 migration 升為正式分類表；目前不建立第二套平行欄位。

### `filter_field_scopes` 篩選欄位適用規則

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 適用規則識別碼 | 主鍵 |
| `filter_field_id` | `uuid` | 必填 | 篩選欄位 | 外鍵至 `filter_fields.id` |
| `name` | `varchar(120)` | 選填 | 管理用規則名稱 | 只供管理介面辨識，不參與比對 |
| `required_on_publish` | `boolean` | 必填；`false` | 發布題目時是否必填 | 只影響符合此範圍的題目 |
| `status` | `varchar(20)` | 必填；`active` | 使用狀態 | `active`、`inactive` |
| `created_at` | `timestamptz` | 必填；目前時間 | 建立時間 | — |

`filter_field_scopes` 不直接保存來源、科目、年級、學期或版本。每個維度都由下列具正式外鍵的關聯表管理，新增來源或版本只需增加資料，不需修改程式或 schema。

### `filter_field_scope_sources` 適用來源

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `filter_field_scope_id` | `uuid` | 必填 | 適用規則 | 外鍵至 `filter_field_scopes.id` |
| `source_category_id` | `uuid` | 必填 | 題目來源 | 外鍵至 `source_categories.id` |
| `effect` | `varchar(20)` | 必填；`include` | 比對效果 | `include` 或 `exclude`；前兩欄為主鍵 |

### `filter_field_scope_subjects` 適用科目

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `filter_field_scope_id` | `uuid` | 必填 | 適用規則 | 外鍵至 `filter_field_scopes.id` |
| `subject_id` | `uuid` | 必填 | 科目 | 外鍵至 `subjects.id` |
| `effect` | `varchar(20)` | 必填；`include` | 比對效果 | `include` 或 `exclude`；前兩欄為主鍵 |

### `filter_field_scope_grades` 適用年級

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `filter_field_scope_id` | `uuid` | 必填 | 適用規則 | 外鍵至 `filter_field_scopes.id` |
| `grade_id` | `uuid` | 必填 | 年級 | 外鍵至 `grades.id` |
| `effect` | `varchar(20)` | 必填；`include` | 比對效果 | `include` 或 `exclude`；前兩欄為主鍵 |

### `filter_field_scope_semesters` 適用學期

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `filter_field_scope_id` | `uuid` | 必填 | 適用規則 | 外鍵至 `filter_field_scopes.id` |
| `semester_id` | `uuid` | 必填 | 學期 | 外鍵至 `semesters.id` |
| `effect` | `varchar(20)` | 必填；`include` | 比對效果 | `include` 或 `exclude`；前兩欄為主鍵 |

### `filter_field_scope_book_versions` 適用書籍版本

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `filter_field_scope_id` | `uuid` | 必填 | 適用規則 | 外鍵至 `filter_field_scopes.id` |
| `book_version_id` | `uuid` | 必填 | 書籍版本 | 外鍵至 `book_versions.id` |
| `effect` | `varchar(20)` | 必填；`include` | 比對效果 | `include` 或 `exclude`；前兩欄為主鍵 |

### `filter_field_scope_exam_levels` 適用考試級別

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `filter_field_scope_id` | `uuid` | 必填 | 適用規則 | 外鍵至 `filter_field_scopes.id` |
| `exam_program_level_id` | `uuid` | 必填 | 考試級別或類別 | 外鍵至 `exam_program_levels.id` |
| `effect` | `varchar(20)` | 必填；`include` | 比對效果 | `include` 或 `exclude`；前兩欄為主鍵 |

同一維度內的 `include` 關聯採任一符合，不同維度之間必須全部符合；命中任何 `exclude` 關聯時該規則不成立。某個維度沒有關聯資料代表不限制該維度。一個欄位可以有多筆規則，任一規則成立就顯示欄位；若任一符合規則的 `required_on_publish=true`，發布時該欄位必填。完全沒有維度關聯的規則代表所有情境都適用。欄位沒有任何有效規則時不在介面顯示；要讓欄位全域適用，必須明確建立一筆沒有維度關聯的有效規則。

來源、科目、年級、學期、版本與考試級別是目前已確認的核心維度，因此保留各自的正式外鍵。未來新增資料值只需新增資料列；若產品新增全新的核心維度，例如學校或學年度，才新增對應關聯表與查詢條件。這項 schema 變更是為了保留外鍵與封存檢查，不以通用文字欄位或任意 JSON 迴避資料完整性。

### `filter_field_options` 篩選欄位選項

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 選項識別碼 | 主鍵 |
| `filter_field_id` | `uuid` | 必填 | 所屬欄位 | 外鍵至 `filter_fields.id` |
| `parent_option_id` | `uuid` | 選填 | 上層選項 | 可表達第一回下的 A、B、C 版等階層 |
| `value` | `varchar(160)` | 必填 | API 與資料庫值 | 同一欄位內唯一 |
| `label` | `varchar(160)` | 必填 | 顯示文字 | — |
| `sort_order` | `smallint` | 必填 | 顯示順序 | — |
| `status` | `varchar(20)` | 必填；`active` | 使用狀態 | — |

### `filter_field_option_scopes` 篩選選項適用規則

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `filter_option_id` | `uuid` | 必填 | 篩選選項 | 外鍵至 `filter_field_options.id` |
| `filter_field_scope_id` | `uuid` | 必填 | 適用規則 | 外鍵至 `filter_field_scopes.id`；兩者必須屬於同一篩選欄位 |

前兩欄為主鍵。選項沒有任何適用規則關聯時，套用到該欄位的所有情境；有關聯時，只在其中至少一筆規則符合目前來源、科目、年級、學期、版本與考試級別時顯示。這讓同一個「回次」欄位可依教材版本顯示不同選項，也能讓考試梯次依正式級別顯示，不需要複製欄位定義。

## 題庫、題目與版本

### `question_banks` 題庫或匯入本

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 題庫識別碼 | 主鍵 |
| `name` | `varchar(120)` | 必填 | 題庫名稱 | — |
| `origin` | `varchar(20)` | 必填 | 題庫來源 | `system` 或 `account` |
| `owner_user_id` | `uuid` | 選填 | 題庫擁有者 | 帳號題庫必填；系統題庫為空 |
| `created_role` | `varchar(30)` | 選填 | 建立時使用角色 | `parent`、`learner`、`tutor`；只供追溯，不作授權依據 |
| `is_default` | `boolean` | 必填；`false` | 是否為擁有者的預設匯入題庫 | 未選擇匯入本時使用；每個擁有者最多一筆有效預設題庫 |
| `status` | `varchar(20)` | 必填；`active` | 題庫狀態 | `active`、`archived` |
| `created_at` | `timestamptz` | 必填；目前時間 | 建立時間 | — |
| `updated_at` | `timestamptz` | 必填；目前時間 | 最近更新時間 | — |

### `question_bank_learners` 題庫適用學習者

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `question_bank_id` | `uuid` | 必填 | 題庫 | 外鍵至 `question_banks.id` |
| `learner_id` | `uuid` | 必填 | 適用學習者 | 外鍵至 `learners.id` |
| `added_at` | `timestamptz` | 必填；目前時間 | 加入時間 | 前兩欄為主鍵 |

### `question_bank_items` 題庫收錄項目

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `question_bank_id` | `uuid` | 必填 | 題庫 | 外鍵至 `question_banks.id` |
| `question_id` | `uuid` | 必填 | 題目 | 外鍵至 `questions.id` |
| `added_by_user_id` | `uuid` | 選填 | 加入題庫的帳號 | 系統搬移可為空 |
| `added_at` | `timestamptz` | 必填；目前時間 | 加入時間 | 前兩欄為主鍵 |

### `questions` 題目穩定身份

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 題目識別碼 | 主鍵 |
| `origin` | `varchar(20)` | 必填 | 題目來源身份 | `system` 或 `account` |
| `owner_user_id` | `uuid` | 選填 | 題目擁有者 | 帳號題目必填；系統題目為空 |
| `current_revision_id` | `uuid` | 選填 | 目前發布版本 | 必須屬於同一題；草稿可為空 |
| `status` | `varchar(20)` | 必填；`draft` | 題目狀態 | `draft`、`published`、`archived` |
| `created_method` | `varchar(20)` | 必填 | 建立方式 | `manual`、`import`、`generated`、`migration` |
| `created_by_user_id` | `uuid` | 選填 | 建立帳號 | 系統搬移可為空 |
| `created_at` | `timestamptz` | 必填；目前時間 | 建立時間 | — |
| `archived_at` | `timestamptz` | 選填 | 封存時間 | 封存不刪除歷史版本與作答 |

### `question_identifiers` 題目外部編號

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 編號紀錄識別碼 | 主鍵 |
| `question_id` | `uuid` | 必填 | 題目 | 外鍵至 `questions.id` |
| `identifier_type` | `varchar(30)` | 必填 | 編號種類 | `legacy`、`publisher_question`、`source_document_question` |
| `publisher_id` | `uuid` | 選填 | 出版社 | 出版社題號使用；外鍵至 `publishers.id` |
| `book_version_id` | `uuid` | 選填 | 書籍版本 | 題號只在特定教材版本內穩定時使用 |
| `source_document_id` | `uuid` | 選填 | 來源文件 | 文件內題號使用；外鍵至 `source_documents.id` |
| `value` | `varchar(120)` | 必填 | 題目編號原文 | 不轉成資料庫主鍵 |
| `normalized_value` | `varchar(120)` | 必填 | 正規化題號 | 去除不具識別意義的空白及全半形差異 |

`legacy` 只允許 `publisher_id`、`book_version_id` 與 `source_document_id` 全部為空，並以 `identifier_type + normalized_value` 去重。出版社題號至少要有 `publisher_id`，文件內題號必須有 `source_document_id`。出版社題號依實際穩定範圍，以 `publisher_id + book_version_id + normalized_value` 或 `publisher_id + normalized_value` 建立部分唯一索引；不能把自由格式的命名空間當成出版社與版本外鍵的替代品。

搬移或匯入題號前，先以已確認的出版社、書籍版本及來源文件決定識別範圍。能唯一確認出版社時不得建立 `legacy`。既有 `legacy` 日後補齊出版社時，要在同一交易檢查目標範圍是否已有相同 `normalized_value`：沒有重複時更新原紀錄的類型與外鍵；已有重複時停止更新並進入合併審核，不能新增第二題或靜默合併歷史作答。

### `question_revisions` 題目版本

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 題目版本識別碼 | 主鍵 |
| `question_id` | `uuid` | 必填 | 所屬題目 | 外鍵至 `questions.id` |
| `revision_number` | `integer` | 必填 | 版本序號 | 同一題內唯一，從 1 遞增 |
| `question_type_id` | `uuid` | 必填 | 標準題型 | 外鍵至 `question_types.id` |
| `original_question_type_label` | `varchar(120)` | 選填 | 來源文件中的原始題型名稱 | 無法可靠對照時仍保留原文，不作題目來源欄位 |
| `subject_id` | `uuid` | 選填 | 科目 | 外鍵至 `subjects.id`；有值時必須是 `subject_kind=leaf` |
| `grade_id` | `uuid` | 選填 | 年級 | 外鍵至 `grades.id` |
| `semester_id` | `uuid` | 選填 | 學期 | 外鍵至 `semesters.id` |
| `book_version_id` | `uuid` | 選填 | 書籍版本 | 不使用版本的來源保持空值 |
| `exam_program_level_id` | `uuid` | 選填 | 考試級別或類別 | 外鍵至 `exam_program_levels.id` |
| `difficulty_level_id` | `uuid` | 選填 | 難易度 | 外鍵至 `difficulty_levels.id` |
| `source_category_id` | `uuid` | 選填 | 題目來源 | 外鍵至 `source_categories.id` |
| `search_text` | `text` | 必填；空字串 | 搜尋用衍生文字 | 由內容區塊重建；公式同時收錄 canonical TeX 與可讀別名，不是題目內容來源 |
| `status` | `varchar(20)` | 必填；`draft` | 版本狀態 | `draft`、`published`、`superseded`、`rejected` |
| `change_note` | `varchar(500)` | 選填 | 修改原因 | 系統題目在 `revision_number > 1` 時必填，去除前後空白後不得為空；由 `0005` 在資料庫層強制 |
| `created_by_type` | `varchar(30)` | 必填 | 建立者類型 | `user`、`bootstrap_admin`、`system_job`、`migration` |
| `created_by_user_id` | `uuid` | 選填 | 建立此版本的帳號 | `created_by_type=user` 時必填 |
| `created_at` | `timestamptz` | 必填；目前時間 | 建立時間 | 版本發布後不可原地修改 |
| `published_at` | `timestamptz` | 選填 | 發布時間 | `status=published` 或 `superseded` 時必填並保留原發布時間 |

`question_revisions` 的科目、年級、學期與版本表示題目原生分類。教材單元改由 `question_revision_units` 多對多保存，避免會考、基測或校內卷等不綁定出版社版本的題目，因後續歸入某一教材版本的單元而被迫填入錯誤版本。`book_version_id` 有值時，後端仍要驗證該版本的科目與年級不和題目版本衝突。

發布版本時，後端依 `source_category_dimensions.native_requirement` 驗證固定分類。`required` 必須有對應原生欄位或正式關聯，`not_applicable` 不得保存原生值，`optional` 則允許空值。跨版本單元歸檔不算成題目原生 `book_version`，因此來源的版本規則為 `not_applicable` 時，仍可建立 `cross_version_alignment` 單元關聯。

`exam_program_level_id` 有值且來源的 `exam_program_id` 也有值時，兩者必須屬於同一考試體系。來源未限定體系時，只要 `exam_level` 規則允許，仍可保存正式級別；這讓一般題庫來源能收錄已分類的檢定題，而不用複製來源類型。

`0005` 會先執行 preflight，若既有系統題目在 `revision_number > 1` 時缺少非空白 `change_note`，migration 會停止，不替資料編造原因。套用後，`question_revisions_change_note_check` trigger 會在版本新增或相關欄位更新時拒絕缺少原因的系統題目後續版本；`questions_system_revision_change_note_check` 則在 `questions.origin` 變更時反查既有版本，並以 deferred constraint trigger 驗證交易最終狀態，讓帳號題目轉成系統題目時可在同一交易先補原因或先改來源，但提交前必須完整。這項規則已由資料庫強制並納入限制測試。正式 API 仍應在送出 SQL 前提供同樣的友善驗證與明確錯誤訊息，但 API 驗證不是唯一防線。

### `question_revision_reviews` 題目版本審核紀錄

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 審核識別碼 | 主鍵 |
| `question_revision_id` | `uuid` | 必填 | 被審核版本 | 外鍵至 `question_revisions.id` |
| `reviewer_type` | `varchar(30)` | 必填 | 審核者類型 | `user` 或 `bootstrap_admin` |
| `reviewer_user_id` | `uuid` | 選填 | 審核帳號 | `reviewer_type=user` 時必填，且必須是有效 `system_admin` |
| `decision` | `varchar(20)` | 必填 | 審核決定 | `approved`、`rejected`、`changes_requested` |
| `reason` | `text` | 選填 | 審核說明 | `rejected` 或 `changes_requested` 時必填 |
| `from_status` | `varchar(20)` | 必填 | 審核前狀態 | 保存當時狀態，不從目前版本狀態反推 |
| `to_status` | `varchar(20)` | 必填 | 審核後狀態 | 必須符合下方狀態轉換規則 |
| `created_at` | `timestamptz` | 必填；目前時間 | 審核時間 | 新決定新增一列，不修改舊紀錄 |

帳號自有題目可由擁有者將 `draft` 發布為 `published`，不需要管理員審核。系統題目必須由有效系統管理員或預設系統管理員留下審核紀錄。允許的狀態轉換為 `draft → published`、`draft → rejected`、`rejected → draft`、`published → superseded`。退回修改使用 `changes_requested` 審核決定，版本維持 `draft`；已發布版本不得退回草稿或原地修改。

### `question_parts` 小題

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 小題識別碼 | 主鍵 |
| `question_revision_id` | `uuid` | 必填 | 所屬題目版本 | 外鍵至 `question_revisions.id` |
| `parent_part_id` | `uuid` | 選填 | 上層小題 | 只在巢狀題組使用 |
| `stable_key` | `varchar(80)` | 必填 | 版本內穩定鍵值 | 同一版本內唯一 |
| `position` | `smallint` | 必填 | 顯示與作答順序 | — |
| `answer_mode` | `varchar(30)` | 必填 | 作答方式 | 首版為 `single_choice`、`multiple_choice`、`boolean`、`text` |
| `answer_field_count` | `smallint` | 必填；`1` | 同一小題的文字答案欄位數 | `1` 至 `8`；大於 `1` 時只允許 `text` 與 `manual_review` |
| `grading_policy` | `varchar(30)` | 必填 | 判分政策 | `automatic`、`manual_review`、`ai_assisted_review` |
| `is_independently_gradable` | `boolean` | 必填；`true` | 是否可獨立判分 | 為真時可只複習此小題 |

一般單題仍建立一筆根小題，讓所有答案與作答都使用同一條路徑，避免整題與小題出現兩套平行實作。多個輸入框不代表多個可獨立判分的小題；同一來源小題需要數個有順序的答案時，以 `answer_field_count` 保存欄位數，作答值依原順序以全形逗號組成單一文字值。欄位數必須來自原始文件中已人工核對的空格結構或同等可追溯證據，並綁定來源 SHA-256、題號與 `stable_key`；不得由參考答案的逗號數、題幹空白或瀏覽器畫面推測。作答前 API 可揭露欄位數，但不得揭露 `question_answers`。送出時伺服器要求欄位數完全相符且每欄非空白，多欄文字題維持 `manual_review`。作答介面依 `question_parts.position` 在每列輸入欄位前顯示 `(1)`、`(2)` 等可見編號，不另存一份顯示編號，也不從題幹文字推測順序。

顯示層不得把文字小題只轉成沒有列號的空白欄位。題幹已有足量空格且同頁顯示多個文字小題時，即使每個 `answer_field_count` 都是 `1`，每列仍依 `question_parts.position` 顯示來源小題編號。`answer_field_count > 1` 的小題使用相同規則。每列編號必須是一般可見文字，桌面與手機實測字級不得低於 `1.125rem`；無障礙 `legend` 與 `aria-label` 仍保留，但不能取代畫面上的編號。

`grading_policy` 表示題目設定的判分方式；`answer_attempts.grading_source` 記錄送出時採用的初始判分方式，`answer_part_results.grading_source` 則記錄目前有效判定的來源，合法人工審核改判時可連同 `current_result` 一併更新。三個欄位共用同一組值，不做額外字串對照。

### `question_options` 選項

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 選項識別碼 | 主鍵 |
| `question_part_id` | `uuid` | 必填 | 所屬小題 | 外鍵至 `question_parts.id` |
| `option_key` | `varchar(30)` | 必填 | 判分用選項鍵值 | 例如 `A`、`B`；同一小題內唯一 |
| `position` | `smallint` | 必填 | 顯示順序 | 不以鍵值推斷順序 |

### `question_content_blocks` 題目內容區塊

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 內容區塊識別碼 | 主鍵 |
| `question_revision_id` | `uuid` | 必填 | 題目版本 | 外鍵至 `question_revisions.id` |
| `question_part_id` | `uuid` | 選填 | 對應小題 | 共用大題內容可為空 |
| `question_option_id` | `uuid` | 選填 | 對應選項 | 只有選項內容使用 |
| `parent_block_id` | `uuid` | 選填 | 所屬內容區塊 | 錄音稿連到對應音訊；外鍵至同表 `id` |
| `placement` | `varchar(20)` | 必填 | 顯示位置 | `prompt`、`option`、`answer`、`explanation`、`transcript` |
| `content_type` | `varchar(20)` | 必填 | 內容格式 | `text`、`image`、`audio`、`transcript`、`formula`、`table`、`page_crop` |

`table` block 的 `text_content` 使用 tab 分隔欄、換行分隔列；空字串儲存格仍須保留，顯示層依此契約產生真正的 table、row 與 cell 結構。題目總覽與正式練習共用同一個表格 renderer，顯示格線並在窄螢幕限制水平捲動於表格容器內，不得把 `table` block 放進 `pre` 當成純文字。舊版 Word 原生表格匯入時，核准契約必須包含來源檔 SHA-256、題號、來源頁碼、表格順序、原始表格 XML SHA-256、標準化逐格文字 SHA-256 與逐格文字；匯入器以來源 SHA、表格順序及逐格文字 checksum 驗證可重現內容，原 XML checksum 供稽核而不依賴轉檔器的揮發性屬性。驗證後再移除題幹中由轉檔產生的同一組逐行文字，避免表格與扁平文字重複。若轉檔只留下部分儲存格，只能移除與核准儲存格完整相等的獨立行；來源漂移、模糊吻合或缺少 Word PDF 畫面證據時，該題維持待檢，不得猜測欄列關係。

若選項本身以原生表格的欄或列呈現，選項修復契約還必須綁定該表格的原始物件 checksum；執行時只有同一來源 SHA、題號與核准表格同時匹配才可建立「表格中的（A）欄／列」等作答選項。這類修復不得只憑答案代號建立選項，也不得放寬一般選項解析器。
| `position` | `smallint` | 必填 | 同一位置中的順序 | — |
| `text_content` | `text` | 選填 | 文字、公式或表格內容 | 與 `asset_id` 依格式至少擇一 |
| `asset_id` | `uuid` | 選填 | 圖片、音訊或原頁裁切圖 | 外鍵至 `assets.id` |
| `alt_text` | `varchar(300)` | 選填 | 替代文字 | 圖片發布前必填；音訊以錄音稿提供等價內容 |

填空位置需在文字內容中使用經驗證的結構化標記，例如 `{{blank:part-1}}`，顯示時轉成底線或答案欄，不以連續空白推測。`audio` 必須使用 `asset_id`；錄音稿建立 `transcript` 區塊並以 `parent_block_id` 連到音訊區塊。發布英聽題前必須有錄音稿，除非正式無障礙政策核准其他等價方式。

多小題來源圖片以 `partStableKey` 對應 `question_parts.stable_key`，writer 再把內容區塊的 `question_part_id` 寫成實際小題 ID。同一題可能在 Word 中重複使用完全相同的圖片 bytes，因此 checksum 與 `asset_id` 只代表資產身分，不代表來源中的單一出現位置。匯入 registry 使用以 1 起算的 `sourceOccurrence` 區分同一正規化題號與 checksum 的多次出現；同組序號必須完整、不重複並連續為 `1..N`。匯入器依來源出現順序選擇 mapping，不依 registry 陣列順序。相同 `asset_id` 可以產生數個內容區塊，但每個區塊必須保留各自的 `question_part_id`、placement 與 position。單一 checksum 的既有 mapping 可以省略 `sourceOccurrence`。

若 Word 題目或小題的提示完全由圖片構成，已通過來源 checksum 與 `partStableKey` 驗證的 prompt 圖片本身就是可發布題幹；writer 不得要求另造空泛文字題幹。沒有文字且也沒有已驗證 prompt 圖片的紀錄仍須拒絕發布。

`formula` 的 `text_content` 保存 canonical TeX，`asset_id` 必須為空；顯示端以共用 KaTeX 元件呈現，並禁用可建立 URL 或 HTML 的信任模式。`\\phantom` 是公式內容的一部分，用來保存來源題目的作答空格，不代表資料缺漏，也不得由答案補值。純文字答案或解析中的明確 `\\frac{分子}{分母}` 標記使用共同行內分數元件；分數線需和相鄰運算符號對齊。匯入器只有在固定來源 SHA-256、題號與原始公式資產 checksum 皆命中人工覆核 registry 時，才能把舊公式圖轉成 `formula`。未核准或無法唯一判讀的來源維持 `image`，不得以 OCR 或前端推測轉換。搜尋索引要同時包含 canonical TeX 與可讀別名，例如 `\\frac{6}{8}` 另加入 `6/8`；別名只供搜尋，不得取代內容來源。

純文字內容中的 `∵` 與 `∴` 是可追溯來源字元，資料庫與搜尋文字保持原值。學習者畫面的共用文字元件分別顯示「因為」與「所以」；管理與來源審核畫面顯示原始字元，避免審核者誤認來源已被改寫。

### `question_revision_units` 題目版本教材單元歸檔

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `question_revision_id` | `uuid` | 必填 | 題目版本 | 外鍵至 `question_revisions.id` |
| `curriculum_unit_id` | `uuid` | 必填 | 教材單元 | 外鍵至 `curriculum_units.id` |
| `assignment_type` | `varchar(30)` | 必填 | 歸檔種類 | `native`、`cross_version_alignment`、`manual_classification` |
| `is_primary` | `boolean` | 必填；`false` | 是否為主要單元 | 同一版本最多一筆主要單元 |
| `value_source` | `varchar(30)` | 必填 | 歸檔來源 | `document`、`user`、`migration`、`system_rule` |
| `confidence` | `numeric(5,4)` | 選填 | 自動判定信心值 | 範圍 0 至 1；人工指定可為空 |

前兩欄為主鍵。`native` 表示題目原始文件直接屬於該教材單元，單元的科目、年級、學期與版本不得和題目原生分類衝突。`cross_version_alignment` 與 `manual_classification` 是後續歸檔，必須科目相符，但允許題目版本為空或與單元版本不同。尚未確認的搬移候選只保存在來源文件分類候選或匯入草稿，不寫入本表。

### `question_answers` 參考答案

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 答案識別碼 | 主鍵 |
| `question_part_id` | `uuid` | 必填 | 對應小題 | 外鍵至 `question_parts.id` |
| `answer_key` | `varchar(80)` | 選填 | 選項或空格鍵值 | 選項題使用選項鍵值；文字題可為空 |
| `accepted_value` | `text` | 選填 | 可接受答案 | 同一小題可有多筆 |
| `position` | `smallint` | 必填；`0` | 多答案順序 | — |

作答方式只由 `question_parts.answer_mode` 決定。`question_answers` 保存可接受答案，不重複保存作答方式。每列只能使用 `answer_key` 或 `accepted_value` 其中一種答案表示；多選題以多筆 `answer_key` 表示正確集合，首版必須完整符合才判定為正確。文字答案只有在產品已明確設定可自動比對時才使用 `automatic`，否則使用人工檢視或 AI 輔助後人工確認。

`0009_automatic_answer_completeness` 對已發布與已取代版本檢查交易的最終狀態：`single_choice`、`multiple_choice` 與 `boolean` 的自動判分小題至少要有一個非空白 `answer_key`，且該鍵值對應同一小題的有效選項；`text` 的自動判分小題至少要有一個非空白 `accepted_value`。`manual_review` 與 `ai_assisted_review` 可以沒有參考答案。限制在 revision、小題、選項及答案異動後延後檢查，允許同一交易按安全順序組裝資料，但提交時不得留下無法判分的發布版本。

### `question_revision_topics` 題目主題關聯

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `question_revision_id` | `uuid` | 必填 | 題目版本 | 外鍵至 `question_revisions.id` |
| `topic_id` | `uuid` | 必填 | 主題 | 外鍵至 `topics.id` |
| `is_primary` | `boolean` | 必填；`false` | 是否為主要主題 | 同一版本最多一筆主要主題 |
| `value_source` | `varchar(30)` | 必填 | 分類來源 | `document`、`user`、`migration`、`system_rule` |

### `question_revision_knowledge_points` 題目知識點關聯

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `question_revision_id` | `uuid` | 必填 | 題目版本 | 外鍵至 `question_revisions.id` |
| `knowledge_point_id` | `uuid` | 必填 | 知識點 | 外鍵至 `knowledge_points.id` |
| `is_primary` | `boolean` | 必填；`false` | 是否為主要知識點 | 同一版本最多一筆主要知識點 |
| `value_source` | `varchar(30)` | 必填 | 分類來源 | `document`、`user`、`migration`、`system_rule` |

### `question_revision_curriculum_codes` 題目版本課綱代碼關聯

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `question_revision_id` | `uuid` | 必填 | 題目版本 | 外鍵至 `question_revisions.id` |
| `curriculum_code_id` | `uuid` | 必填 | 課綱代碼 | 外鍵至 `curriculum_codes.id` |
| `is_primary` | `boolean` | 必填；`false` | 是否為主要課綱代碼 | 同一版本最多一筆主要代碼 |
| `value_source` | `varchar(30)` | 必填 | 對照來源 | `document`、`user`、`migration`、`system_rule` |
| `confidence` | `numeric(5,4)` | 選填 | 自動對照信心值 | 範圍 0 至 1；人工指定可為空 |

前兩欄為主鍵。來源中的「學習內容」只有通過課綱版本、科目與代碼格式驗證後才建立正式關聯；無法辨識的原文留在匯入資料並列入人工校正，不得建立假的知識點或課綱代碼。

### `question_revision_filter_values` 題目來源專屬欄位值

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 欄位值識別碼 | 主鍵 |
| `question_revision_id` | `uuid` | 必填 | 題目版本 | 外鍵至 `question_revisions.id` |
| `filter_field_id` | `uuid` | 必填 | 欄位定義 | 外鍵至 `filter_fields.id` |
| `filter_option_id` | `uuid` | 選填 | 標準選項 | 選項型欄位使用 |
| `raw_label` | `varchar(160)` | 選填 | 來源文件中的原始欄位名稱 | 來源文件或搬移資料有原文時保存 |
| `raw_value` | `text` | 選填 | 來源文件中的原始值 | 來源文件或搬移資料有原文時保存，不改寫原文 |
| `normalized_value` | `varchar(240)` | 選填 | 可查詢的標準值 | 非選項型欄位必填；選項型欄位為空 |
| `value_source` | `varchar(20)` | 必填 | 判定來源 | `document`、`path`、`ai`、`user`、`migration` |
| `confidence` | `numeric(4,3)` | 選填 | 自動判定信心值 | 0 至 1；人工確認可為 1 |

多值欄位每個值保存一列。欄位與選項是否能套用到此題，由符合的 `filter_field_scopes` 與 `filter_field_option_scopes` 驗證。`value_type=option` 時 `filter_option_id` 必填且 `normalized_value` 為空；其他型別時 `filter_option_id` 為空且 `normalized_value` 必填。`value_source=user` 不要求原始文件欄位，`raw_label` 與 `raw_value` 可為空。這些互斥規則以 CHECK constraint（檢查約束）及外鍵所屬欄位檢查執行。

## 檔案、來源文件與匯入

### `assets` 檔案

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 檔案識別碼 | 主鍵 |
| `storage_key` | `varchar(500)` | 必填 | 物件儲存鍵值 | 唯一；不可使用公開網址作主鍵 |
| `mime_type` | `varchar(120)` | 必填 | 檔案格式 | 上傳時需驗證實際內容 |
| `byte_size` | `bigint` | 必填 | 檔案大小 | 必須大於 0 |
| `width` | `integer` | 選填 | 圖片寬度 | 像素 |
| `height` | `integer` | 選填 | 圖片高度 | 像素 |
| `checksum` | `varchar(128)` | 必填 | 內容雜湊 | 用於完整性與重複檔案判斷 |
| `purpose` | `varchar(30)` | 必填 | 檔案用途 | `question_content`、`source_document`、`source_page`、`handwriting`、`answer_attachment`、`learner_avatar`、`page_crop` |
| `sensitivity` | `varchar(20)` | 必填；`private` | 存取敏感度 | `public_content` 或 `private`；教材頁、手寫與學習者資料固定為 `private` |
| `scan_status` | `varchar(20)` | 必填；`pending` | 惡意內容掃描狀態 | `pending`、`clean`、`rejected` |
| `created_by_user_id` | `uuid` | 選填 | 上傳帳號 | — |
| `created_at` | `timestamptz` | 必填；目前時間 | 上傳時間 | — |
| `deleted_at` | `timestamptz` | 選填 | 邏輯刪除時間 | 確認無引用後才移除實體檔案 |

`assets` 不直接授予存取權。讀取檔案時必須從題目內容、來源文件、作答或學習者代表圖片等引用關係反查權限，再產生短效簽名網址；只知道 `asset_id` 或 `storage_key` 不代表可以下載。沒有正式引用的上傳檔案只能由上傳帳號在隔離區存取，並依保存政策清理。

`handwriting` 只保存手寫板影像；其他經題型與表單核准的一般作答檔案使用 `answer_attachment`。兩種作答附件都必須是 `sensitivity=private`、`scan_status=clean` 且 `deleted_at IS NULL`，才能建立 `answer_part_assets` 關聯。用途分開可避免把一般附件假裝成手寫內容，也能讓後端依題型限制可接受的檔案；附件仍須從作答及學習者授權鏈反查權限，不因掃描通過而變成公開檔案。作答仍引用檔案時，`storage_key`、MIME、大小、圖片尺寸、內容雜湊、上傳者與建立時間視為證據，不可原地覆寫。

### `asset_object_cleanup_jobs` 外部物件清理工作

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `asset_id` | `uuid` | 必填 | 待清理資產 | 主鍵；外鍵至 `assets.id` |
| `reason` | `varchar(60)` | 必填 | 排程原因 | `0011` 使用 `legacy_score_detail_purge`；不可為空白 |
| `status` | `varchar(20)` | 必填；`pending` | 清理狀態 | `pending`、`processing`、`completed`、`failed` |
| `requested_at` | `timestamptz` | 必填；目前時間 | 排程時間 | 建立後不可改 |
| `last_attempted_at` | `timestamptz` | 選填 | 最近執行時間 | 進入 `processing`、`completed` 或 `failed` 時必填，且不得早於排程時間 |
| `object_deleted_at` | `timestamptz` | 選填 | 外部物件確認刪除時間 | 只有 `completed` 可填，且不得早於最近執行時間 |
| `last_error` | `text` | 選填 | 最近失敗摘要 | 只有 `failed` 必填且不得為空白；不得保存答案或其他敏感內容 |

工作只能從已解除所有產品引用、已寫入 `deleted_at`、用途為 `handwriting`／`answer_attachment` 且敏感度為 `private` 的 asset 建立。新工作固定從 `pending` 開始，`last_attempted_at`、`object_deleted_at` 與 `last_error` 都必須為空；允許 `pending → processing → completed|failed`，失敗後可再回到 `processing`，completed 為終態。工作不可刪除，資產、原因、排程時間、`assets.deleted_at` 與待刪物件的儲存證據不可改寫。

這張表是資料庫與外部物件儲存之間的兩階段邊界。Migration 只對移除舊 `score` 作答關聯後不再被題目、來源文件、裁切內容、學習者或非 `score` 作答引用的資產進行邏輯刪除與排程；共用資產保留。受控 worker 實際確認外部物件已刪除後，才能寫 `object_deleted_at` 並完成工作。本輪沒有對真實 storage 執行破壞性刪除。

### `source_documents` 來源文件

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 來源文件識別碼 | 主鍵 |
| `owner_user_id` | `uuid` | 選填 | 文件擁有者 | 系統搬移文件可為空 |
| `asset_id` | `uuid` | 選填 | 原始檔案 | 貼上文字時可為空 |
| `input_type` | `varchar(20)` | 必填 | 輸入方式 | `image`、`pdf`、`text`、`document` |
| `original_file_name` | `varchar(255)` | 選填 | 原始檔名 | 不作權限或分類依據 |
| `pasted_text` | `text` | 選填 | 使用者貼上的原文 | `input_type=text` 時必填 |
| `document_title` | `varchar(300)` | 選填 | 文件標題 | 可作 AI 建議依據，使用者確認後才寫正式分類 |
| `status` | `varchar(20)` | 必填；`uploaded` | 文件處理狀態 | `uploaded`、`processing`、`ready`、`failed`、`archived` |
| `created_at` | `timestamptz` | 必填；目前時間 | 建立時間 | — |

檔名與文件標題只提供分類建議，不直接建立或改寫正式教材目錄。解析器先保存原始字串，再依已核准規則提出出版社、科目、年級、學期、書籍版本、考試體系、考試級別、冊次、單元、課綱代碼與來源候選；無法完整對照時保持待確認，不能把整段檔名直接寫成 `curriculum_units.code` 或 `curriculum_units.name`。題號不是分類維度；從檔名、頁面或題目標示擷取的題號直接寫入 `import_items.source_question_number`，確認後再寫入 `question_revision_sources.source_question_number` 及適用的 `question_identifiers`。

### `source_document_classification_candidates` 來源文件分類候選

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 分類候選識別碼 | 主鍵 |
| `source_document_id` | `uuid` | 必填 | 來源文件 | 外鍵至 `source_documents.id` |
| `dimension` | `varchar(30)` | 必填 | 候選維度 | `publisher`、`subject`、`grade`、`semester`、`book_version`、`exam_program`、`exam_level`、`unit`、`curriculum_code`、`source_category` |
| `raw_value` | `text` | 必填 | 檔名或標題中的原文 | 不改寫原文 |
| `publisher_id` | `uuid` | 選填 | 出版社候選 | 外鍵至 `publishers.id` |
| `subject_id` | `uuid` | 選填 | 科目候選 | 外鍵至 `subjects.id` |
| `grade_id` | `uuid` | 選填 | 年級候選 | 外鍵至 `grades.id` |
| `semester_id` | `uuid` | 選填 | 學期候選 | 外鍵至 `semesters.id` |
| `book_version_id` | `uuid` | 選填 | 書籍版本候選 | 外鍵至 `book_versions.id` |
| `exam_program_id` | `uuid` | 選填 | 考試體系候選 | 外鍵至 `exam_programs.id` |
| `exam_program_level_id` | `uuid` | 選填 | 考試級別候選 | 外鍵至 `exam_program_levels.id` |
| `curriculum_unit_id` | `uuid` | 選填 | 教材單元候選 | 外鍵至 `curriculum_units.id` |
| `curriculum_code_id` | `uuid` | 選填 | 課綱代碼候選 | 外鍵至 `curriculum_codes.id` |
| `source_category_id` | `uuid` | 選填 | 題目來源候選 | 外鍵至 `source_categories.id` |
| `parser_version` | `varchar(80)` | 必填 | 解析規則版本 | 規則更新後可重算候選 |
| `confidence` | `numeric(5,4)` | 選填 | 自動判定信心值 | 範圍 0 至 1 |
| `review_status` | `varchar(20)` | 必填；`pending` | 確認狀態 | `pending`、`approved`、`rejected` |
| `reviewed_by_user_id` | `uuid` | 選填 | 確認帳號 | 外鍵至 `users.id` |
| `reviewed_at` | `timestamptz` | 選填 | 確認時間 | — |

候選資料依 `dimension` 只允許對應的一個正式外鍵有值；尚未找到正式資料時所有候選外鍵皆為空。只有 `approved` 候選能在確認匯入時轉成正式分類；無法對照的候選保留在匯入批次與隔離報告中。解析規則至少要記錄可接受的檔名格式、全半形與空白正規化、同名衝突處理，以及每個擷取片段對應的正式維度。

### 教材頁面與題目版本證據

`0020_teaching_source_evidence` 把補充教材解析與原始題目匯入出處分開。`question_revision_sources` 繼續保存題目原始來源；下列資料只表示經人工核准、可供解題說明引用的補充教材證據。

| 資料表 | 主要內容 | 關鍵限制 |
| --- | --- | --- |
| `source_document_catalog_profiles` | `academic_year`、年級、科目、學期、書籍版本與冊次 | 一份文件一個正式範圍；版本與冊次必須屬於同一目錄；只能由有效 `system_admin` 從 `pending` 核准或退回 |
| `source_document_processing_runs` | 來源 checksum、設定 checksum、parser version、OCR 引擎／模型與執行狀態 | 相同來源、設定與 parser version 唯一；`pending → processing → completed|failed`；終態與執行身分不可覆寫 |
| `source_document_pages` | PDF 頁序、印刷頁碼、課次、private `source_page` asset、尺寸與渲染版本 | PDF 頁序與印刷頁碼在同文件內唯一；頁面只能連到同冊教材樹中的課次；影像必須是尺寸相符、clean、未刪除的 private asset |
| `source_document_blocks` | 處理批次、順序、區塊類型、四個正規化座標、OCR 原文、人工校正、模型身分、信心值與審核資料 | 原文、模型身分與來源位置不可覆寫；只有完成批次的區塊可核准；撤回另記管理員與時間 |
| `question_revision_source_evidence` | 固定題目版本、教材區塊、用途、順序、建立／審核／撤回證據 | 題目版本與教材的年級、科目、學期及書籍版本必須一致；只有有效核准目錄與區塊能成為核准證據 |

來源檔名保存教材原文，例如「國文」；正式外鍵仍使用系統既有「國語」科目及其別名對照。`academic_year` 明確保存在來源目錄範圍，不在查詢時從檔名推測。學生端日後只讀取未撤回的核准資料，並只顯示來源檔名與印刷頁碼。

### `import_batches` 匯入批次

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 匯入批次識別碼 | 主鍵 |
| `question_bank_id` | `uuid` | 必填 | 寫入題庫 | 外鍵至 `question_banks.id` |
| `learner_id` | `uuid` | 選填 | 當時套用的學習者 | 用於帶入年級與版本，不代表題目只能給此學習者使用 |
| `created_by_user_id` | `uuid` | 必填 | 執行匯入帳號 | 從登入狀態取得 |
| `status` | `varchar(20)` | 必填；`draft` | 匯入狀態 | `draft`、`recognizing`、`review`、`confirmed`、`failed`、`cancelled` |
| `idempotency_key` | `varchar(120)` | 必填 | 冪等鍵 | 同一建立帳號內唯一 |
| `recognizer_version` | `varchar(80)` | 選填 | OCR 或拆題服務版本 | — |
| `created_at` | `timestamptz` | 必填；目前時間 | 建立時間 | — |
| `confirmed_at` | `timestamptz` | 選填 | 全批確認時間 | 確認後才建立正式題目版本 |

### `import_batch_documents` 匯入批次來源文件

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `import_batch_id` | `uuid` | 必填 | 匯入批次 | 外鍵至 `import_batches.id` |
| `source_document_id` | `uuid` | 必填 | 來源文件 | 外鍵至 `source_documents.id` |
| `position` | `integer` | 必填 | 檔案順序 | 同一批次內唯一 |

前兩欄為主鍵。單一批次可包含多份圖片或 PDF；不得只把第一個檔案連到批次。

### `import_items` 匯入題目草稿

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 匯入項目識別碼 | 主鍵 |
| `import_batch_id` | `uuid` | 必填 | 匯入批次 | 外鍵至 `import_batches.id` |
| `source_document_id` | `uuid` | 必填 | 項目來源文件 | 必須已存在於同一批次的 `import_batch_documents` |
| `source_page` | `integer` | 選填 | 原始頁碼 | 從 1 起算 |
| `source_question_number` | `varchar(80)` | 選填 | 原始題號 | 保留原文字樣 |
| `source_order` | `integer` | 必填 | 原始順序 | 同批次內唯一 |
| `draft_payload` | `jsonb` | 必填 | 待校正的辨識內容 | 包含尚未正式化的題幹、選項、答案與欄位 |
| `recognition_confidence` | `numeric(4,3)` | 選填 | 整體辨識信心值 | 0 至 1 |
| `review_status` | `varchar(20)` | 必填；`pending` | 人工校正狀態 | `pending`、`approved`、`rejected` |
| `question_id` | `uuid` | 選填 | 確認後建立的題目 | 外鍵至 `questions.id` |
| `question_revision_id` | `uuid` | 選填 | 確認後建立的版本 | 外鍵至 `question_revisions.id` |
| `reviewed_by_user_id` | `uuid` | 選填 | 完成人工校正的帳號 | — |
| `reviewed_at` | `timestamptz` | 選填 | 校正完成時間 | — |

### `question_revision_sources` 題目版本來源位置

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 來源關聯識別碼 | 主鍵 |
| `question_revision_id` | `uuid` | 必填 | 題目版本 | 外鍵至 `question_revisions.id` |
| `source_document_id` | `uuid` | 必填 | 來源文件 | 外鍵至 `source_documents.id` |
| `import_item_id` | `uuid` | 選填 | 匯入項目 | 外鍵至 `import_items.id` |
| `source_page` | `integer` | 選填 | 原始頁碼 | — |
| `source_question_number` | `varchar(80)` | 選填 | 原始題號 | — |
| `crop_asset_id` | `uuid` | 選填 | 原頁裁切圖 | 外鍵至 `assets.id` |
| `is_primary` | `boolean` | 必填；`true` | 是否為主要來源 | 同一版本最多一筆主要來源 |

## 學習者教材設定與題目分類

### `learner_subject_settings` 學習者科目與版本設定

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 設定識別碼 | 主鍵 |
| `learner_id` | `uuid` | 必填 | 學習者 | 外鍵至 `learners.id` |
| `subject_id` | `uuid` | 必填 | 科目 | 外鍵至 `subjects.id` |
| `book_version_id` | `uuid` | 選填 | 選定書籍版本 | 空值代表「無版本」 |
| `enabled` | `boolean` | 必填；`true` | 是否顯示此科目 | 介面只顯示已啟用且符合就學狀態的科目 |
| `is_default_subject` | `boolean` | 必填；`false` | 建立設定時是否屬系統預設 | 保留當時狀態，避免目錄改版後誤刪使用者設定 |
| `position` | `smallint` | 必填 | 顯示順序 | — |
| `lock_version` | `integer` | 必填；`1` | 樂觀鎖定版本 | 每次成功更新加 1 |
| `created_at` | `timestamptz` | 必填；目前時間 | 建立時間 | `learner_id + subject_id` 唯一 |
| `updated_at` | `timestamptz` | 必填；目前時間 | 最近更新時間 | — |

`enabled=true` 且 `book_version_id` 為空是合法狀態，表示學習者使用此科目，但沒有指定教材版本。`enabled=false` 時科目不出現在一般題目與練習入口，既有版本設定保留，重新啟用時可繼續使用。歷史作答、錯題與成果不受目前啟用狀態限制。在學學習者由 `grade_subjects` 建立系統預設設定；不在學學習者不建立年級預設，可從有效系統 `leaf` 與帳號自訂科目中加入設定。系統預設科目可以停用但不能刪除設定；自訂科目可在沒有歷史引用時刪除，有引用時只能停用或封存。

### `curriculum_units` 教材單元

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 單元識別碼 | 主鍵 |
| `subject_id` | `uuid` | 必填 | 科目 | 外鍵至 `subjects.id` |
| `grade_id` | `uuid` | 選填 | 年級 | 外鍵至 `grades.id` |
| `semester_id` | `uuid` | 選填 | 學期 | 外鍵至 `semesters.id` |
| `book_version_id` | `uuid` | 選填 | 書籍版本 | 外鍵至 `book_versions.id` |
| `parent_unit_id` | `uuid` | 選填 | 上層單元 | 支援冊、章、課、回次等階層 |
| `unit_type` | `varchar(30)` | 必填 | 單元層級 | 例如 `volume`、`chapter`、`lesson`、`round`；顯示名稱由資料決定 |
| `code` | `varchar(80)` | 選填 | 來源中的單元代碼 | 同一版本與父層下有值時唯一 |
| `name` | `varchar(120)` | 必填 | 單元名稱 | — |
| `position` | `smallint` | 必填 | 同層順序 | — |
| `origin` | `varchar(20)` | 必填 | 單元建立範圍 | `system` 或 `account` |
| `owner_user_id` | `uuid` | 選填 | 自訂單元建立者 | `origin=account` 時必填；系統單元為空 |
| `status` | `varchar(20)` | 必填；`active` | 使用狀態 | — |

系統單元由正式教材目錄建立；帳號自訂單元只能由建立者及其授權範圍使用。後端交易另須驗證父子單元的科目、版本、年級、學期與所有權相容；帳號自訂單元不得掛到其他帳號的單元下。

### `curriculum_codes` 正式課綱代碼

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 課綱代碼識別碼 | 主鍵 |
| `curriculum_version` | `varchar(40)` | 必填 | 課綱版本 | 例如 `108`；使用正式穩定代碼 |
| `code_type` | `varchar(30)` | 必填 | 代碼種類 | `learning_content`、`learning_performance` 或後續核准值 |
| `code` | `varchar(80)` | 必填 | 官方課綱代碼 | 例如 `N-7-5`、`Da-IV-1` |
| `subject_id` | `uuid` | 必填 | 科目或領域 | 外鍵至 `subjects.id`；允許 `group` 或 `leaf` |
| `grade_id` | `uuid` | 選填 | 適用年級 | 跨年級代碼可為空 |
| `name` | `varchar(240)` | 選填 | 官方名稱或說明 | 只保存可追溯的正式內容 |
| `authority_name` | `varchar(160)` | 必填 | 發布機關或權威來源 | 例如教育主管機關 |
| `source_reference` | `text` | 必填 | 來源參照 | 保存正式文件名稱、版本或可查證網址 |
| `status` | `varchar(20)` | 必填；`active` | 使用狀態 | `active`、`inactive` |

`curriculum_version + code_type + code` 唯一。課綱代碼是跨出版社的正式分類鍵，不併入 `knowledge_points`；知識點仍是平台或帳號用來教學與複習的可編輯分類。課綱代碼可屬於自然科學等 `group`，也可屬於生物或理化等 `leaf`。題目使用課綱代碼時，題目科目必須等於代碼科目，或是該群組科目的有效子科目；以群組科目篩選課綱代碼時展開有效子科目，以子科目篩選時同時包含其上層領域適用的代碼。正式目錄必須記錄資料來源與版本，未取得權威目錄前只能把匯入值當成待確認候選。

### `topics` 主題

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 主題識別碼 | 主鍵 |
| `subject_id` | `uuid` | 必填 | 科目 | 外鍵至 `subjects.id` |
| `code` | `varchar(80)` | 選填 | 主題代碼 | 有權威代碼時使用 |
| `name` | `varchar(120)` | 必填 | 跨版本共用主題名稱 | — |
| `origin` | `varchar(20)` | 必填 | 建立來源 | `system` 或 `account` |
| `owner_user_id` | `uuid` | 選填 | 自訂主題建立者 | `origin=account` 時必填 |
| `status` | `varchar(20)` | 必填；`active` | 使用狀態 | — |

### `knowledge_points` 知識點

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 知識點識別碼 | 主鍵 |
| `subject_id` | `uuid` | 必填 | 科目 | 外鍵至 `subjects.id` |
| `parent_id` | `uuid` | 選填 | 上層知識點 | 支援知識樹 |
| `code` | `varchar(80)` | 選填 | 權威知識點代碼 | 沒有正式來源時不得自行編造 |
| `name` | `varchar(160)` | 必填 | 知識點名稱 | — |
| `origin` | `varchar(20)` | 必填 | 建立來源 | `system` 或 `account` |
| `owner_user_id` | `uuid` | 選填 | 自訂知識點建立者 | `origin=account` 時必填 |
| `status` | `varchar(20)` | 必填；`active` | 使用狀態 | — |

### `unit_topics` 單元與主題關聯

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `curriculum_unit_id` | `uuid` | 必填 | 教材單元 | 外鍵至 `curriculum_units.id` |
| `topic_id` | `uuid` | 必填 | 主題 | 外鍵至 `topics.id` |
| `position` | `smallint` | 必填；`0` | 顯示順序 | 主鍵為前兩欄 |

### `unit_knowledge_points` 單元與知識點關聯

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `curriculum_unit_id` | `uuid` | 必填 | 教材單元 | 外鍵至 `curriculum_units.id` |
| `knowledge_point_id` | `uuid` | 必填 | 知識點 | 外鍵至 `knowledge_points.id` |
| `position` | `smallint` | 必填；`0` | 顯示順序 | 主鍵為前兩欄 |

### `question_types` 標準題型

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 題型識別碼 | 主鍵 |
| `code` | `varchar(60)` | 必填 | 題型代碼 | 唯一 |
| `name` | `varchar(100)` | 必填 | 題型名稱 | 例如填充題、配合題、題組 |
| `supports_parts` | `boolean` | 必填；`false` | 是否允許多個小題 | — |
| `status` | `varchar(20)` | 必填；`active` | 使用狀態 | — |

`question_types` 只描述題目的教學與內容型態，不參與判分。作答方式與判分政策由每個 `question_parts` 決定，因此同一題組可包含不同作答方式的小題。

### `difficulty_levels` 難易度

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 難易度識別碼 | 主鍵 |
| `code` | `varchar(30)` | 必填 | 穩定代碼 | 首批為 `basic`、`medium`、`advanced` |
| `name` | `varchar(40)` | 必填 | 顯示名稱 | 首批為基礎、中等、進階 |
| `sort_order` | `smallint` | 必填 | 排序 | — |
| `status` | `varchar(20)` | 必填；`active` | 使用狀態 | — |

## 收藏、相近題與考試

### `question_collections` 收藏清單

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 收藏清單識別碼 | 主鍵 |
| `learner_id` | `uuid` | 必填 | 所屬學習者 | 外鍵至 `learners.id` |
| `name` | `varchar(100)` | 必填 | 收藏清單名稱 | 同一學習者內有效名稱唯一 |
| `created_by_user_id` | `uuid` | 必填 | 建立帳號 | — |
| `lock_version` | `integer` | 必填；`1` | 樂觀鎖定版本 | 每次成功更新加 1 |
| `created_at` | `timestamptz` | 必填；目前時間 | 建立時間 | — |
| `archived_at` | `timestamptz` | 選填 | 封存時間 | — |

### `question_collection_items` 收藏項目

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `collection_id` | `uuid` | 必填 | 收藏清單 | 外鍵至 `question_collections.id` |
| `question_id` | `uuid` | 必填 | 題目 | 外鍵至 `questions.id` |
| `added_by_user_id` | `uuid` | 必填 | 加入收藏的帳號 | — |
| `added_at` | `timestamptz` | 必填；目前時間 | 加入時間 | 前兩欄為主鍵 |

題目可同時存在多份收藏。「移動收藏」是一個交易：先刪除該學習者其他收藏中的題目，再加入目標收藏。

### `question_similarity_groups` 相近題群組

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 群組識別碼 | 主鍵 |
| `name` | `varchar(160)` | 選填 | 管理用群組名稱 | 不作相近判斷依據 |
| `status` | `varchar(20)` | 必填；`pending` | 群組狀態 | `pending`、`confirmed`、`inactive` |
| `created_source` | `varchar(20)` | 必填 | 建立來源 | `manual`、`rule`、`ai` |
| `method_version` | `varchar(80)` | 選填 | 判定方法版本 | 規則或 AI 建立時必填 |
| `created_by_user_id` | `uuid` | 選填 | 建立帳號 | — |
| `created_at` | `timestamptz` | 必填；目前時間 | 建立時間 | — |
| `confirmed_by_user_id` | `uuid` | 選填 | 確認帳號 | — |
| `confirmed_at` | `timestamptz` | 選填 | 確認時間 | — |

### `question_similarity_candidates` 相近題候選與評分

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 候選識別碼 | 主鍵 |
| `left_question_revision_id` | `uuid` | 必填 | 第一個題目版本 | 外鍵至 `question_revisions.id` |
| `right_question_revision_id` | `uuid` | 必填 | 第二個題目版本 | 外鍵至 `question_revisions.id`；不得與第一個相同 |
| `method_key` | `varchar(80)` | 必填 | 判定方法鍵值 | 例如人工規則或核准模型名稱 |
| `method_version` | `varchar(80)` | 必填 | 判定方法版本 | 模型、特徵或規則變動時建立新版本 |
| `similarity_score` | `numeric(6,5)` | 選填 | 候選相似度 | 範圍 0 至 1；人工候選可為空 |
| `evidence` | `jsonb` | 必填；`{}` | 可審核判定依據 | 只保存核准欄位、命中關係與必要摘要 |
| `status` | `varchar(20)` | 必填；`pending` | 候選狀態 | `pending`、`approved`、`rejected`、`expired` |
| `reviewed_by_user_id` | `uuid` | 選填 | 審核帳號 | 外鍵至 `users.id` |
| `reviewed_at` | `timestamptz` | 選填 | 審核時間 | 已審核狀態時必填 |
| `created_at` | `timestamptz` | 必填；目前時間 | 建立時間 | — |

候選配對先以較小的題目版本 UUID 放在 `left_question_revision_id`，避免同一配對正反各存一筆。分數只用於排序人工審核工作，不得直接進入相近題篩選、排除已掌握題組或正式練習。候選核准後，才在同一交易建立或更新已確認的相近題群組與成員；題目改版後舊候選標記為 `expired`，不沿用舊分數判定新版題目。

### `question_similarity_memberships` 相近題成員

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `similarity_group_id` | `uuid` | 必填 | 相近題群組 | 外鍵至 `question_similarity_groups.id` |
| `question_id` | `uuid` | 必填 | 題目 | 外鍵至 `questions.id` |
| `based_on_revision_id` | `uuid` | 必填 | 判定時使用的題目版本 | 題目改版後可要求重新審核 |
| `status` | `varchar(20)` | 必填；`pending` | 成員狀態 | `pending`、`confirmed`、`rejected` |
| `evidence` | `jsonb` | 選填 | 判定依據 | 不得只以相同題型作為已確認關聯 |
| `confidence` | `numeric(4,3)` | 選填 | 自動判定信心值 | 0 至 1 |
| `reviewed_by_user_id` | `uuid` | 選填 | 審核帳號 | — |
| `reviewed_at` | `timestamptz` | 選填 | 審核時間 | 前兩欄為主鍵 |

### `question_generation_relations` 生成題來源

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `source_question_id` | `uuid` | 必填 | 原始題目 | 外鍵至 `questions.id` |
| `generated_question_id` | `uuid` | 必填 | 生成題目 | 外鍵至 `questions.id`；不得與原始題相同 |
| `method_version` | `varchar(80)` | 必填 | 生成方法版本 | — |
| `created_at` | `timestamptz` | 必填；目前時間 | 建立時間 | 前兩欄為主鍵 |

生成關係不等於相近關係。只有已確認的相近題群組，以及經核准並寫入正式題目關聯的關鍵字、主題或知識點，能用於「相近題」篩選；未核准的模型分數不得直接參與推薦。排除已掌握題組仍以已確認的相近題群組為單位，不能用即時計算結果臨時組群。

### `question_templates` 與 `question_template_memberships` 相同題模板

`question_templates` 保存穩定的 `template_key`、正規化文字骨架 `normalized_pattern`、解題邏輯 `logic_key`、建立來源、方法版本、證據與確認人。模板狀態為 `pending`、`confirmed` 或 `inactive`；非人工來源必須保存方法版本，確認或停用都必須保存確認人與時間。

`question_template_memberships` 把題目及判定時的確切 revision 關聯到模板，並以 `variable_values` 保存該題替換的數字、人物、名稱、目標字或其他可變值。成員狀態為 `pending`、`confirmed`、`rejected` 或 `expired`；confirmed 成員只能引用 confirmed 模板。題目改版後必須以新 revision 重新分析，不能沿用舊成員關係。

兩題只有在目前 revision 都是同一 confirmed 模板的 confirmed 成員時，才能以 `same_template` 推薦。相同來源題型、科目或單元不構成模板相同證據。

### `relation_keywords` 與 `question_revision_keywords` 正式關鍵字

`relation_keywords` 保存正規化 key、顯示名稱與類型；類型涵蓋人物、作品、篇章、目標字、概念、主題、知識點及其他經核准關係。`question_revision_keywords` 保存題目 revision、關鍵字、資料來源、方法版本、狀態、證據與審核資訊。規則或 AI 產生的關聯必須先保存為 pending 並附方法版本，只有 confirmed 且關鍵字仍為 active 的關聯能進入推薦。

相近度以兩題共同 confirmed 關鍵字的不同 ID 數量計算，重複 ID 不得增加分數。查詢只採目前合格候選中的最高共同數量級距；這一級沒有候選時，才進入較弱的下一個關聯層。每次選入都要把共同關鍵字 ID、共同數量與推薦規則版本保存到 `practice_session_item_origins`。

### `exams` 考試設定

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 考試識別碼 | 主鍵 |
| `learner_id` | `uuid` | 必填 | 所屬學習者 | 外鍵至 `learners.id` |
| `name` | `varchar(120)` | 必填 | 考試名稱 | — |
| `exam_date` | `date` | 必填 | 考試日期 | 上方倒數天數由此欄位即時計算 |
| `status` | `varchar(20)` | 必填；`active` | 考試狀態 | `active`、`completed`、`archived` |
| `created_by_user_id` | `uuid` | 必填 | 建立帳號 | — |
| `lock_version` | `integer` | 必填；`1` | 樂觀鎖定版本 | 每次成功更新加 1 |
| `created_at` | `timestamptz` | 必填；目前時間 | 建立時間 | — |
| `updated_at` | `timestamptz` | 必填；目前時間 | 最近更新時間 | — |

### `exam_subject_ranges` 考試科目範圍

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 範圍識別碼 | 主鍵 |
| `exam_id` | `uuid` | 必填 | 考試 | 外鍵至 `exams.id` |
| `subject_id` | `uuid` | 必填 | 科目 | 外鍵至 `subjects.id` |
| `book_version_id` | `uuid` | 選填 | 當時使用版本 | 空值代表無版本 |
| `start_unit_id` | `uuid` | 選填 | 起始單元 | 外鍵至 `curriculum_units.id` |
| `end_unit_id` | `uuid` | 選填 | 結束單元 | 必須與起始單元屬同一教材樹 |
| `target_level_id` | `uuid` | 選填 | 目標考試級別或類別 | 外鍵至 `exam_program_levels.id` |
| `created_at` | `timestamptz` | 必填；目前時間 | 建立時間 | `exam_id + subject_id` 唯一 |

教材範圍與目標考試級別二擇一。使用 `target_level_id` 時 `book_version_id`、`start_unit_id` 與 `end_unit_id` 必須為空；使用教材範圍時 `target_level_id` 必須為空，且起訖單元需同時有值。目前目標級別只選取相同級別的題目，是否包含較低級別待產品規則確認後再擴充。

## 練習計畫與選題

### `practice_plans` 練習計畫

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 練習計畫識別碼 | 主鍵 |
| `learner_id` | `uuid` | 必填 | 適用學習者 | 外鍵至 `learners.id` |
| `created_by_user_id` | `uuid` | 必填 | 建立帳號 | — |
| `created_role` | `varchar(30)` | 必填 | 建立時角色 | `parent`、`learner`、`tutor` |
| `name` | `varchar(140)` | 必填 | 計畫名稱 | — |
| `is_default` | `boolean` | 必填；`false` | 是否為學習者預設計畫 | 每位學習者最多一筆有效預設計畫 |
| `basis` | `varchar(20)` | 必填；`chapter` | 範圍依據 | `chapter` 或 `assessment` |
| `exam_id` | `uuid` | 選填 | 套用考試 | `basis=assessment` 時必填 |
| `check_mode` | `varchar(20)` | 必填 | 答案檢核方式 | `complete`、`instant`、`score` |
| `question_limit` | `smallint` | 必填 | 預計題數 | 1 至 500；題目不足時使用全部符合題目 |
| `selection_mode` | `varchar(20)` | 必填；`dynamic` | 選題方式 | `dynamic` 或 `fixed` |
| `difficulty_mix_enabled` | `boolean` | 必填；`false` | 是否啟用難易度比例 | 啟用後一般難易度條件不生效 |
| `filter_schema_version` | `smallint` | 必填；`1` | 篩選快照格式版本 | 後端依此選用驗證與轉換規則 |
| `filter_snapshot` | `jsonb` | 必填；`{}` | 建立計畫時的完整篩選快照 | 寫入前依共用篩選 schema 驗證；保存穩定識別碼、運算子與值 |
| `status` | `varchar(20)` | 必填；`active` | 計畫狀態 | `draft`、`active`、`completed`、`archived` |
| `lock_version` | `integer` | 必填；`1` | 樂觀鎖定版本 | 每次成功更新加 1 |
| `created_at` | `timestamptz` | 必填；目前時間 | 建立時間 | — |
| `updated_at` | `timestamptz` | 必填；目前時間 | 最近更新時間 | — |

`filter_snapshot` 是刻意採用的弱型別快照，不依賴無外鍵的 EAV（實體－屬性－值）表。它只用來重現計畫與稽核，不作目錄項目存在與否的權威來源。建立計畫與每次開始練習前，後端都要依 `filter_schema_version` 驗證欄位、運算子、UUID、來源適用規則及目前權限；目錄項目封存後不得默默改用其他項目。固定條件包含 `subject`、`semester`、`book_version`、`exam_level`、`source`、`unit`、`topic`、`knowledge`、`difficulty`、`question_type`、`creator`、`collection`、`search`、`attempt_state`、`similar_to_wrong` 與 `exclude_mastered`。`attempt_state` 的已做過、未做過及最近答錯依目前學習者最新一筆已提交作答判定。

### `practice_plan_difficulty_mix` 難易度比例

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `practice_plan_id` | `uuid` | 必填 | 練習計畫 | 外鍵至 `practice_plans.id` |
| `difficulty_level_id` | `uuid` | 必填 | 難易度 | 外鍵至 `difficulty_levels.id` |
| `percentage` | `numeric(5,2)` | 必填 | 題數比例 | 0 至 100；同一計畫合計必須為 100 |

前兩欄為主鍵。個別難度題目不足時，剩餘名額由其他符合一般條件的題目補足，不能放寬學習者、科目、版本、來源或權限條件。

### `practice_plan_items` 計畫固定題目

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 計畫項目識別碼 | 主鍵 |
| `practice_plan_id` | `uuid` | 必填 | 練習計畫 | 外鍵至 `practice_plans.id` |
| `question_id` | `uuid` | 必填 | 題目 | 外鍵至 `questions.id` |
| `question_revision_id` | `uuid` | 必填 | 固定題目版本 | 外鍵至 `question_revisions.id` |
| `question_part_id` | `uuid` | 選填 | 只練習的小題 | 錯一小題時建立此欄；空值代表整題 |
| `position` | `integer` | 必填 | 題目順序 | 同一計畫內唯一 |
| `reason` | `varchar(30)` | 必填；`selected` | 納入原因 | `selected`、`wrong_review`、`similar_review`、`manual` |

### `practice_schedules` 排程練習

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 排程識別碼 | 主鍵 |
| `learner_id` | `uuid` | 必填 | 適用學習者 | 外鍵至 `learners.id` |
| `practice_plan_id` | `uuid` | 選填 | 來源計畫 | 外鍵至 `practice_plans.id`；計畫日後修改不改變本排程題目 |
| `name` | `varchar(140)` | 必填 | 排程名稱 | — |
| `scheduled_for` | `timestamptz` | 必填 | 預定練習時間 | 一份計畫可建立多筆排程 |
| `check_mode` | `varchar(20)` | 必填 | 排程採用的答案檢核方式 | 建立排程時由計畫複製，後續不連動 |
| `status` | `varchar(20)` | 必填；`scheduled` | 排程狀態 | `scheduled`、`available`、`completed`、`cancelled`、`missed` |
| `created_by_user_id` | `uuid` | 必填 | 建立排程的帳號 | — |
| `lock_version` | `integer` | 必填；`1` | 樂觀鎖定版本 | 每次成功更新加 1 |
| `created_at` | `timestamptz` | 必填；目前時間 | 建立時間 | — |
| `updated_at` | `timestamptz` | 必填；目前時間 | 最近更新時間 | — |

### `practice_schedule_items` 排程固定題目

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 排程項目識別碼 | 主鍵 |
| `practice_schedule_id` | `uuid` | 必填 | 所屬排程 | 外鍵至 `practice_schedules.id` |
| `question_id` | `uuid` | 必填 | 題目 | 外鍵至 `questions.id` |
| `question_revision_id` | `uuid` | 必填 | 排程採用版本 | 外鍵至 `question_revisions.id` |
| `question_part_id` | `uuid` | 選填 | 只練習的小題 | 空值代表整題 |
| `position` | `integer` | 必填 | 固定順序 | 同一排程內唯一 |
| `reason` | `varchar(30)` | 必填 | 納入原因 | 參數同 `practice_plan_items.reason` |

建立排程時就把題目版本與順序複製到 `practice_schedule_items`。同一計畫可重複排程，每筆排程各自保存當時內容與完成結果，之後修改計畫不會改變既有排程。

### `learner_practice_queue_items` 後續練習佇列

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 佇列項目識別碼 | 主鍵 |
| `learner_id` | `uuid` | 必填 | 適用學習者 | 外鍵至 `learners.id` |
| `question_id` | `uuid` | 必填 | 後續練習題目 | 外鍵至 `questions.id` |
| `question_revision_id` | `uuid` | 必填 | 加入時採用版本 | 外鍵至 `question_revisions.id` |
| `question_part_id` | `uuid` | 選填 | 只練習的小題 | 空值代表整題 |
| `reason` | `varchar(30)` | 必填 | 加入原因 | `wrong_review`、`similar_review`、`manual`、`legacy_migration` |
| `source_answer_part_result_id` | `uuid` | 選填 | 觸發此項目的原始小題作答 | 外鍵至 `answer_part_results.id`；錯題與相近題正常流程必填 |
| `match_basis` | `varchar(30)` | 選填 | 相近題選入依據 | `confirmed_group`、`same_topic`、`same_knowledge_point`、`same_unit`、`same_subject`；`similar_review` 必填 |
| `similarity_group_id` | `uuid` | 選填 | 採用的相近題群組 | `match_basis=confirmed_group` 時必填 |
| `matched_topic_id` | `uuid` | 選填 | 採用的主題 | `match_basis=same_topic` 時必填；外鍵至 `topics.id` |
| `matched_knowledge_point_id` | `uuid` | 選填 | 採用的知識點 | `match_basis=same_knowledge_point` 時必填；外鍵至 `knowledge_points.id` |
| `matched_curriculum_unit_id` | `uuid` | 選填 | 採用的教材單元 | `match_basis=same_unit` 時必填；外鍵至 `curriculum_units.id` |
| `matched_subject_id` | `uuid` | 選填 | 採用的科目 | `match_basis=same_subject` 時必填；外鍵至 `subjects.id` |
| `status` | `varchar(20)` | 必填；`pending` | 佇列狀態 | `pending`、`consumed`、`removed` |
| `added_by_user_id` | `uuid` | 選填 | 加入佇列的帳號 | 自動加入或舊資料搬移可為空 |
| `created_at` | `timestamptz` | 必填；目前時間 | 加入時間 | — |
| `consumed_at` | `timestamptz` | 選填 | 建立練習工作階段的時間 | `status=consumed` 時必填 |

立即練習直接建立 `practice_sessions`；加入後續練習則先建立佇列項目。相近題選入時要保存當時實際使用的單一 `match_basis` 及其對應外鍵，不能在事後從題目目前分類反推。舊 JSON 沒有保存原始錯題作答時，搬移為 `reason=legacy_migration` 且來源作答為空，不能偽造追溯關係。

`0012` 新增 `reason=same_type_review`，並以 `same_question_type`／`matched_question_type_label` 保存階段性同細題型來源。產品要求的「相同題」不是只比對題型名稱，而是題幹文字骨架與解題邏輯相同，只替換數字、人物、名稱、目標字等可變值；「相近題」則依已確認相似群組與正式關鍵字、人物、作品、篇章、主題或知識點的共同數量計算，重疊越多越優先。每一個相近程度內先選尚未作答者，排除最近已答對者；只有較相近層級沒有符合條件的候選時，才往共同關聯較少的層級遞補。

`0014` 以 `question_templates` 保存正規化文字骨架與解題邏輯，以 `question_template_memberships.variable_values` 保存各題替換的數字、人物、名稱、目標字或其他可變值；`relation_keywords` 與 `question_revision_keywords` 保存經核准的正式關鍵字及題目版本關聯。模板成員與關鍵字關聯都分成 pending、confirmed、rejected、expired，只有 confirmed 關聯可參與推薦。`0015` 讓 AI／規則建立的關鍵字目錄本身也先進 pending，核准時才切為 active。`questions:relations` 分開執行唯讀分析與 pending 匯入，`/admin/questions/relations` 再以管理員交易核准或退回並留下稽核；不得從模型輸出直接確認。現有 `same_question_type`、`same_unit`、`same_subject` 只供歷史相容或縮小候選範圍，不能單獨證明題目相同或相近。`score` 不允許這種逐題來源。

### `practice_sessions` 實際練習

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 練習識別碼 | 主鍵 |
| `practice_plan_id` | `uuid` | 選填 | 來源計畫 | 臨時練習可為空 |
| `practice_schedule_id` | `uuid` | 選填 | 來源排程 | 外鍵至 `practice_schedules.id`；排程啟動時必填 |
| `learner_id` | `uuid` | 必填 | 作答學習者 | 外鍵至 `learners.id` |
| `created_by_user_id` | `uuid` | 必填 | 啟動練習的帳號 | — |
| `mode` | `varchar(20)` | 必填 | 練習用途 | `practice`、`review`、`similar` |
| `check_mode` | `varchar(20)` | 必填 | 實際檢核方式 | 建立時由計畫複製，後續計畫變更不影響 |
| `status` | `varchar(20)` | 必填；`active` | 練習狀態 | `active`、`paused`、`completed`、`abandoned` |
| `score_total_count` | `integer` | 必填；`0` | `score` session 的總題數 | 必須與 session item 數相同；非 `score` 必須為 0 |
| `score_answered_count` | `integer` | 必填；`0` | 已送出題數 | 必須與收據數相同且不大於總題數；非 `score` 必須為 0 |
| `score_correct_count` | `integer` | 必填；`0` | 答對題數 | 不得小於 0；非 `score` 必須為 0 |
| `score_wrong_count` | `integer` | 必填；`0` | 答錯題數 | 不得小於 0；非 `score` 必須為 0 |
| `score_pending_count` | `integer` | 必填；`0` | 尚未作答或待檢視題數 | `correct + wrong + pending = total`；非 `score` 必須為 0 |
| `started_at` | `timestamptz` | 必填；目前時間 | 開始時間 | — |
| `completed_at` | `timestamptz` | 選填 | 完成時間 | — |

`check_mode` 同時約束 API 的答案揭露與保存範圍。`instant` 可在每題送出後回傳該題明細；`complete` 在 session 完成前只回傳已送出狀態，完成後才回傳逐題明細；`score` 進行中只回傳遮罩狀態，完成後保存並只回傳總題數、答對、答錯、待檢視與正確率。`score` 的 aggregate 可在重新整理或重新開啟後讀回，但各題送出的答案、判定、附件與審核不保存，也不建立錯題／相近題佇列、來源追溯或統計 outbox。歷程及錯題佇列必須套用相同規則，不能成為旁路。瀏覽器只保存 session UUID；重新整理時由資料庫恢復可安全恢復的進度並把進行中 session 暫停。固定 revision 與可用題目內容不一致時，把舊 session 標記為 `abandoned` 並要求建立新練習；尚未送出的文字或手寫內容不屬於資料庫恢復範圍。從任意題開始作答時，伺服器與介面都以尚未送出的 item 決定下一題，只有全部 item 都完成才結束 session。

### `practice_session_items` 練習固定題目

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 練習項目識別碼 | 主鍵 |
| `practice_session_id` | `uuid` | 必填 | 實際練習 | 外鍵至 `practice_sessions.id` |
| `question_id` | `uuid` | 必填 | 題目 | 外鍵至 `questions.id` |
| `question_revision_id` | `uuid` | 必填 | 開始練習時的題目版本 | 不隨日後修題變更 |
| `question_part_id` | `uuid` | 選填 | 只作答的小題 | 空值代表依題目版本顯示全部小題 |
| `position` | `integer` | 必填 | 題目順序 | 同一練習內唯一 |
| `selection_reason` | `varchar(30)` | 必填 | 選入原因 | `filter`、`fixed`、`wrong_review`、`similar_review`、`difficulty_fill` |

一旦練習項目已有來源追溯或一般作答，`practice_session_id`、題目、版本、小題與選入原因不可改寫；parent session 也不可換成另一位學習者。`score` item 已有收據後，`practice_session_id`、題目、版本與小題不可改寫，parent session 也不可更換學習者或 `check_mode`。這些限制保留 `practice_sessions.status`、`completed_at` 等正常生命週期欄位可更新。

歷程顯示必須使用 `question_revision_id` 指向的當時版本。若資料保存或舊資料搬移沒有留下可安全顯示的 revision 快照，查詢只回傳結果、時間與內容不可用狀態，不得拿 `questions.current_revision_id` 指向的目前題目補上舊內容。

### `practice_score_receipts` 計分模式送出收據

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 收據識別碼 | 主鍵；重播相同提交時回傳同一識別碼 |
| `practice_session_item_id` | `uuid` | 必填 | 已送出的練習項目 | 外鍵至 `practice_session_items.id`；每個 item 最多一筆 |
| `learner_id` | `uuid` | 必填 | 作答學習者 | 必須與所屬 `score` session 相同 |
| `idempotency_key` | `varchar(120)` | 必填 | 送出冪等鍵 | 不可為空白；`learner_id + idempotency_key` 唯一 |
| `submitted_at` | `timestamptz` | 必填；目前時間 | 送出時間 | — |

收據只證明某個 `score` item 已送出，不能保存或推導答案、逐題判定、question part、耗時、附件或審核內容。每個 item 最多一筆，收據建立後不可修改或刪除；只有所屬 session 的學習者可以建立，且該 session 必須是 `score`。交易提交時，session 的 `score_total_count` 必須等於 item 數，`score_answered_count` 必須等於收據數；所有 item 都有收據後才能完成。相同冪等鍵可重播原提交，同一 item 改用新鍵送出會衝突，不建立第二筆收據。

### `practice_session_item_origins` 練習項目來源追溯

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 來源追溯識別碼 | 主鍵 |
| `practice_session_item_id` | `uuid` | 必填 | 練習項目 | 外鍵至 `practice_session_items.id` |
| `source_answer_part_result_id` | `uuid` | 必填 | 觸發練習的原始小題作答 | 外鍵至 `answer_part_results.id` |
| `queue_item_id` | `uuid` | 選填 | 消耗的後續練習項目 | 外鍵至 `learner_practice_queue_items.id` |
| `relation_kind` | `varchar(30)` | 必填 | 追溯關係 | `wrong_review` 或 `similar_review` |
| `match_basis` | `varchar(30)` | 選填 | 相近題選入依據 | 值域同後續練習佇列；`relation_kind=similar_review` 時必填 |
| `similarity_group_id` | `uuid` | 選填 | 採用的相近題群組 | `match_basis=confirmed_group` 時必填；外鍵至 `question_similarity_groups.id` |
| `matched_topic_id` | `uuid` | 選填 | 採用的主題 | `match_basis=same_topic` 時必填；外鍵至 `topics.id` |
| `matched_knowledge_point_id` | `uuid` | 選填 | 採用的知識點 | `match_basis=same_knowledge_point` 時必填；外鍵至 `knowledge_points.id` |
| `matched_curriculum_unit_id` | `uuid` | 選填 | 採用的教材單元 | `match_basis=same_unit` 時必填；外鍵至 `curriculum_units.id` |
| `matched_subject_id` | `uuid` | 選填 | 採用的科目 | `match_basis=same_subject` 時必填；外鍵至 `subjects.id` |
| `question_template_id` | `uuid` | 選填 | 採用的已確認模板 | `match_basis=same_template` 時必填；來源與目標版本都必須是 confirmed 成員 |
| `shared_relation_count` | `smallint` | 選填 | 實際共同關聯數量 | `same_template` 為 0；`shared_keyword` 必須大於 0 |
| `relation_method_version` | `varchar(80)` | 選填 | 推薦規則版本 | `same_template`、`shared_keyword` 必填 |
| `relation_evidence` | `jsonb` | 選填 | 模板或共同關鍵字證據 | `shared_keyword.keyword_ids` 數量、有效狀態與兩題 confirmed 關聯由資料庫驗證 |
| `created_at` | `timestamptz` | 必填；目前時間 | 建立時間 | — |

每個錯題或相近題練習項目都要連到觸發它的確切 `answer_part_results`。同一練習項目可由多筆歷史錯題觸發，因此使用關聯表而不是在工作階段或題目上保存單一來源。新推薦依 `same_template`、`confirmed_group`、`shared_keyword`、`same_topic` 的順序選擇第一個有合格候選的層級；關鍵字與主題層只選共同數量最高的級距，不以較弱關聯補滿題數。同層先排未作答者，最近答對者排除。每筆來源保存實際採用的單一主要依據、規則版本與排序證據；查詢歷史結果不從題目目前分類反推來源。

## 作答、審核與逐小題複習

### `answer_attempts` 每次送出作答

這張表只保存 `instant` 與 `complete` 的逐題作答。`score` 使用 `practice_score_receipts` 標記已送出 item，不能在這張表建立答案或判定明細。

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 作答識別碼 | 主鍵 |
| `practice_session_item_id` | `uuid` | 必填 | 練習題目 | 外鍵至 `practice_session_items.id` |
| `learner_id` | `uuid` | 必填 | 作答學習者 | 必須與練習工作階段相同 |
| `attempt_number` | `integer` | 必填 | 此練習項目的送出次數 | 從 1 遞增 |
| `idempotency_key` | `varchar(120)` | 必填 | 送出冪等鍵 | `learner_id + idempotency_key` 唯一 |
| `overall_result` | `varchar(20)` | 必填 | 整題目前判定 | `correct`、`wrong`、`pending`；由各小題目前結果重算 |
| `grading_source` | `varchar(20)` | 必填 | 初始判定來源 | `automatic`、`manual_review`、`ai_assisted_review` |
| `duration_seconds` | `integer` | 選填 | 作答耗時秒數 | 不得小於 0 |
| `submitted_at` | `timestamptz` | 必填；目前時間 | 送出時間 | 不可覆寫 |

### `answer_part_results` 小題作答與結果

這張表只屬於需要保留逐題明細的作答；`score` 不建立小題結果。

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 小題作答識別碼 | 主鍵 |
| `answer_attempt_id` | `uuid` | 必填 | 所屬作答 | 外鍵至 `answer_attempts.id` |
| `question_part_id` | `uuid` | 必填 | 作答小題 | 外鍵至 `question_parts.id` |
| `answer_payload` | `jsonb` | 必填 | 學習者原始答案 | 保存選項鍵值、文字或多值答案，不保存可執行內容 |
| `initial_result` | `varchar(20)` | 必填 | 初始判定 | `correct`、`wrong`、`pending` |
| `current_result` | `varchar(20)` | 必填 | 目前有效判定 | `correct`、`wrong`、`pending`；審核歷程另存 |
| `grading_source` | `varchar(20)` | 必填 | 目前判定來源 | `automatic`、`manual_review`、`ai_assisted_review`；合法審核改變目前判定時一併更新，原始答案與 `initial_result` 不變 |
| `recognized_text` | `text` | 選填 | AI 手寫辨識文字 | 不能覆蓋原始手寫或使用者答案 |
| `recognition_confidence` | `numeric(4,3)` | 選填 | 手寫辨識信心值 | 0 至 1 |

`answer_attempt_id + question_part_id` 唯一。錯題與複習清單以這張表判定；只有答錯的小題進入複習，不自動擴成整個大題。

### `answer_part_assets` 小題作答檔案

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `answer_part_result_id` | `uuid` | 必填 | 小題作答 | 外鍵至 `answer_part_results.id` |
| `asset_id` | `uuid` | 必填 | 作答檔案 | 外鍵至 `assets.id` |
| `asset_role` | `varchar(20)` | 必填 | 檔案用途 | 首版為 `handwriting`、`attachment` |
| `position` | `smallint` | 必填；`0` | 同用途順序 | — |

前三欄為主鍵。`asset_role=handwriting` 只能引用 `assets.purpose=handwriting`；`asset_role=attachment` 只能引用 `assets.purpose=answer_attachment`。兩者都必須為 private、掃描狀態為 `clean` 且未邏輯刪除。檔案讀取權限沿小題作答、練習與學習者授權反查；刪除或去識別化時不得只清掉 `answer_payload` 而留下可辨識的作答檔案。此關聯可依受權限的保存／刪除流程更新或移除，不是 append-only；正式政策必須先定義解除引用、物件刪除與稽核的順序。

目前手寫提交程式只接受通過嚴格格式、尺寸、解壓上限與可見墨跡檢查的 PNG，並以 private asset 冪等儲存。缺少文字答案的手寫小題保持 pending／manual；同題已有完整文字或選項答案時，手寫只連到第一個小題作為計算過程附件，不改變判分。`score` 不建立這類關聯。這些程式已通過針對性測試，完整 DB E2E 需涵蓋已整合的 `0012`。

### `answer_reviews` 人工或輔助審核

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 審核識別碼 | 主鍵 |
| `answer_part_result_id` | `uuid` | 必填 | 被審核的小題作答 | 外鍵至 `answer_part_results.id` |
| `reviewer_user_id` | `uuid` | 必填 | 審核帳號 | 後端檢查其對學習者的審核權限 |
| `result` | `varchar(20)` | 必填 | 審核結果 | `correct`、`wrong`、`pending` |
| `reason` | `text` | 選填 | 判定說明 | — |
| `created_at` | `timestamptz` | 必填；目前時間 | 審核時間 | 每次改判新增一筆，不修改舊紀錄 |

## 統計與排行

### `learner_question_stats` 學習者題目統計

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `learner_id` | `uuid` | 必填 | 學習者 | 與 `question_id` 組成主鍵 |
| `question_id` | `uuid` | 必填 | 題目 | — |
| `total_attempts` | `integer` | 必填；`0` | 總作答次數 | — |
| `graded_attempts` | `integer` | 必填；`0` | 已檢核次數 | 不含待審核 |
| `correct_attempts` | `integer` | 必填；`0` | 答對次數 | — |
| `wrong_attempts` | `integer` | 必填；`0` | 答錯次數 | — |
| `pending_attempts` | `integer` | 必填；`0` | 待審核次數 | — |
| `first_attempted_at` | `timestamptz` | 選填 | 第一次作答時間 | — |
| `last_attempted_at` | `timestamptz` | 選填 | 最近作答時間 | — |
| `last_result` | `varchar(20)` | 選填 | 最近結果 | `correct`、`wrong`、`pending` |
| `last_revision_id` | `uuid` | 選填 | 最近作答題目版本 | — |
| `updated_at` | `timestamptz` | 必填；目前時間 | 統計更新時間 | 可由作答明細重建 |

### `learner_part_stats` 學習者小題統計

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `learner_id` | `uuid` | 必填 | 學習者 | 與 `question_part_id` 組成主鍵 |
| `question_part_id` | `uuid` | 必填 | 小題 | — |
| `total_attempts` | `integer` | 必填；`0` | 小題作答次數 | — |
| `correct_attempts` | `integer` | 必填；`0` | 小題答對次數 | — |
| `wrong_attempts` | `integer` | 必填；`0` | 小題答錯次數 | — |
| `pending_attempts` | `integer` | 必填；`0` | 小題待審核次數 | — |
| `last_result` | `varchar(20)` | 選填 | 小題最近結果 | — |
| `last_attempted_at` | `timestamptz` | 選填 | 小題最近作答時間 | 錯一小題的複習入口以此表加速查詢 |
| `updated_at` | `timestamptz` | 必填；目前時間 | 統計更新時間 | 可重建 |

### `learner_similarity_group_stats` 相近題掌握統計

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `learner_id` | `uuid` | 必填 | 學習者 | 與群組組成主鍵 |
| `similarity_group_id` | `uuid` | 必填 | 已確認相近題群組 | — |
| `attempted_question_count` | `integer` | 必填；`0` | 已做過的不同題數 | 同題重做只算一題 |
| `correct_question_count` | `integer` | 必填；`0` | 最新已檢核結果答對的不同題數 | 達 2 題時可視為已掌握 |
| `wrong_question_count` | `integer` | 必填；`0` | 最新已檢核結果答錯的不同題數 | — |
| `is_mastered` | `boolean` | 必填；`false` | 是否達排除門檻 | 由規則計算，不由前端直接寫入 |
| `updated_at` | `timestamptz` | 必填；目前時間 | 統計更新時間 | 可由作答與已確認群組重建 |

### `learner_daily_stats` 學習者每日練習統計

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `stat_date` | `date` | 必填 | 臺北日期 | 與 `learner_id` 組成主鍵 |
| `learner_id` | `uuid` | 必填 | 學習者 | 外鍵至 `learners.id` |
| `session_count` | `integer` | 必填；`0` | 完成練習次數 | — |
| `attempt_count` | `integer` | 必填；`0` | 送出作答次數 | 同一天多次作答仍只影響一次連續天數判斷 |
| `correct_part_count` | `integer` | 必填；`0` | 答對小題數 | — |
| `wrong_part_count` | `integer` | 必填；`0` | 答錯小題數 | — |
| `pending_part_count` | `integer` | 必填；`0` | 待審核小題數 | — |
| `total_duration_seconds` | `bigint` | 必填；`0` | 總作答秒數 | — |
| `updated_at` | `timestamptz` | 必填；目前時間 | 最近重算時間 | 連續練習天數由此表計算；可由原始作答重建 |

### `question_daily_stats` 每日題目統計

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `stat_date` | `date` | 必填 | 臺北日期 | 與題目版本組成主鍵 |
| `question_id` | `uuid` | 必填 | 題目 | — |
| `question_revision_id` | `uuid` | 必填 | 當時題目版本 | — |
| `total_attempts` | `integer` | 必填；`0` | 作答次數 | — |
| `unique_learner_count` | `integer` | 必填；`0` | 不重複學習者數 | — |
| `wrong_learner_count` | `integer` | 必填；`0` | 曾答錯的不重複學習者數 | — |
| `correct_attempts` | `integer` | 必填；`0` | 答對次數 | — |
| `wrong_attempts` | `integer` | 必填；`0` | 答錯次數 | — |
| `pending_attempts` | `integer` | 必填；`0` | 待審核次數 | — |
| `total_duration_seconds` | `bigint` | 必填；`0` | 總作答秒數 | — |
| `updated_at` | `timestamptz` | 必填；目前時間 | 最近重算時間 | 可由原始作答重建 |

`0011` 的隱私升級會重新建立上述五張統計表。合格明細只包括所有 `instant` 作答，以及 session 已完成的 `complete` 作答；進行中的 `complete` 與任何 `score` 都不納入。每日統計以 `Asia/Taipei` 換日；相近題掌握度先取每位學習者對每題的最新整題結果，再依已確認群組計算不同題目數；學習者每日 session 數只計已完成的 `instant`／`complete` session。重建不從舊統計扣除 `score`，也不從 session aggregate 反推逐題結果。

錯題英雄榜不永久保存名次。查詢依日期範圍與共用篩選條件聚合後，再用資料庫排名函式計算；畫面額外顯示答錯次數、錯誤率、最後作答時間等錯題資料。

### `analytics_privacy_policies` 統計隱私政策

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 政策識別碼 | 主鍵 |
| `policy_key` | `varchar(80)` | 必填 | 政策穩定鍵值 | 首批為 `community_question_ranking`；有效政策內唯一 |
| `aggregation_scope` | `varchar(30)` | 必填 | 聚合範圍 | 首批只允許 `platform` |
| `min_distinct_learners` | `smallint` | 必填 | 最少不重複學習者數 | 必須大於 1；未達門檻的題目不回傳 |
| `status` | `varchar(20)` | 必填；`draft` | 政策狀態 | `draft`、`active`、`retired` |
| `effective_at` | `timestamptz` | 選填 | 生效時間 | `status=active` 時必填 |
| `created_by_user_id` | `uuid` | 必填 | 建立政策的系統管理員 | 外鍵至 `users.id` |
| `created_at` | `timestamptz` | 必填；目前時間 | 建立時間 | 政策生效後不原地修改；調整門檻時建立新版本 |

個人榜只從目前學習者的歷史作答與統計取得題目。社群榜排行的是已發布的系統題目，不排行學習者，也不納入帳號自有題目；它只提供給已登入且具有有效學習者存取權的帳號。社群榜可跨學習者聚合已檢核作答，但 API 只回傳題目、總作答次數、答錯次數、不重複作答人數、不重複答錯人數與錯誤率，不回傳學習者識別碼、姓名、帳號、學校或個別作答時間。資料保存或刪除政策要求排除的作答不得進入聚合。

社群榜只有在 `community_question_ranking` 存在有效政策時才開放。每道題目在整個查詢期間的不重複學習者數必須達到 `min_distinct_learners` 才能顯示；未達門檻時整列省略，不回傳實際人數或零值。跨多日查詢不能直接加總 `question_daily_stats.unique_learner_count`，因同一位學習者可能跨日重複出現；必須從作答明細計算期間內的不重複學習者，或使用能保存期間去重集合的可重建彙總。

### `analytics_outbox` 統計待處理事件

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 事件識別碼 | 主鍵 |
| `event_type` | `varchar(60)` | 必填 | 事件類型 | 例如 `attempt_submitted`、`answer_reviewed` |
| `source_record_id` | `uuid` | 必填 | 來源明細識別碼 | 與事件類型唯一，避免重複累加 |
| `aggregate_key` | `varchar(240)` | 必填 | 分派用彙總鍵值 | — |
| `occurred_at` | `timestamptz` | 必填 | 業務事件時間 | — |
| `processed_at` | `timestamptz` | 選填 | 處理完成時間 | — |
| `retry_count` | `integer` | 必填；`0` | 重試次數 | — |
| `last_error` | `text` | 選填 | 最近失敗摘要 | 不記錄答案、密碼或其他敏感內容 |

### `analytics_jobs` 統計重算工作

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 工作識別碼 | 主鍵 |
| `job_type` | `varchar(30)` | 必填 | 工作類型 | `full_rebuild`、`date_range`、`refresh_view` |
| `range_start` | `date` | 選填 | 重算起始日期 | — |
| `range_end` | `date` | 選填 | 重算結束日期 | 不得早於起始日期 |
| `status` | `varchar(20)` | 必填；`queued` | 工作狀態 | `queued`、`running`、`completed`、`failed` |
| `cursor` | `jsonb` | 選填 | 大量資料處理進度 | — |
| `aggregation_version` | `varchar(60)` | 必填 | 統計規則版本 | 相同版本與範圍重跑應得到相同結果 |
| `started_at` | `timestamptz` | 選填 | 開始時間 | — |
| `completed_at` | `timestamptz` | 選填 | 完成時間 | — |
| `last_error` | `text` | 選填 | 最近失敗摘要 | — |

## 稽核與敏感操作

### `admin_audit_logs` 管理員稽核紀錄

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 稽核紀錄識別碼 | 主鍵 |
| `actor_type` | `varchar(30)` | 必填 | 操作者類型 | `user`、`bootstrap_admin`、`system_job` |
| `actor_user_id` | `uuid` | 選填 | 操作者帳號 | `actor_type=user` 時必填 |
| `action` | `varchar(80)` | 必填 | 操作代碼 | 例如 `admin_role_granted`、`system_question_revision_status_changed`、`data_erasure_completed` |
| `target_type` | `varchar(60)` | 必填 | 目標資源類型 | — |
| `target_id` | `uuid` | 選填 | 目標資源識別碼 | 預設系統管理員使用固定文字目標時可為空 |
| `before_data` | `jsonb` | 選填 | 異動前內容 | 排除密碼、token、完整答案影像等敏感資料 |
| `after_data` | `jsonb` | 選填 | 異動後內容 | — |
| `request_id` | `varchar(120)` | 必填 | 請求識別碼 | 用於串連 API 與伺服器紀錄 |
| `source_ip` | `inet` | 選填 | 來源 IP | 依隱私保存期限處理 |
| `user_agent` | `text` | 選填 | 操作端資訊 | — |
| `created_at` | `timestamptz` | 必填；目前時間 | 操作時間 | 不提供一般管理介面修改或刪除 |

### `data_erasure_requests` 資料刪除與去識別化要求

| 欄位 | 型別 | 必填／預設 | 中文說明 | 備註 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 必填 | 要求識別碼 | 主鍵 |
| `requested_by_user_id` | `uuid` | 必填 | 提出要求的帳號 | 外鍵至 `users.id` |
| `target_user_id` | `uuid` | 選填 | 要處理的帳號 | 帳號關閉或個資刪除時使用 |
| `target_learner_id` | `uuid` | 選填 | 要處理的學習者 | 外鍵至 `learners.id`；與目標帳號至少一項必填 |
| `request_type` | `varchar(30)` | 必填 | 要求類型 | `account_closure`、`learner_erasure`、`asset_erasure` |
| `status` | `varchar(20)` | 必填；`pending` | 處理狀態 | `pending`、`approved`、`processing`、`completed`、`rejected` |
| `reviewed_by_user_id` | `uuid` | 選填 | 審核帳號 | `pending` 時可空；任何非 `pending` 狀態都必須是當下有效的 `system_admin` |
| `decision_reason` | `text` | 選填 | 核准或拒絕原因 | 拒絕時必填 |
| `result_summary` | `jsonb` | 選填 | 處理結果摘要 | 只保存資料類別與筆數，不保存已刪除內容 |
| `requested_at` | `timestamptz` | 必填；目前時間 | 提出時間 | — |
| `completed_at` | `timestamptz` | 選填 | 完成時間 | `status=completed` 時必填 |

要求只能以 `pending` 建立，再依 `pending -> approved -> processing -> completed` 或 `pending -> rejected` 單向推進；要求身份、目標、類型與提出時間不可改，離開 `pending` 後審核者與決定原因不可改，紀錄不可刪除且終態不可覆寫。完成必須在同一交易留下 `data_erasure_completed` 管理員稽核。

這張表只保存要求與處理 ledger，不會自行刪除資料。保存期限由正式政策設定，不寫死在應用程式。帳號與學習者顯示資料在核准後去識別化；未達法定或契約保存期限的作答、審核與稽核資料保留不可回推個人的替代識別碼；手寫影像、代表圖片與未發布來源文件在沒有其他保存義務時刪除物件及 `assets` 引用。正式 worker 必須驗證 requester 與 target、依政策解除引用並刪除物件，每次執行產生不含個資的摘要與管理員稽核紀錄。期限尚未核准前，不得把正式學習者資料搬入 production（正式環境）。

## 關聯與權限規則

下列資料不另建第二份權威資料：

- 不建立獨立錯題表。`instant` 與 `complete` 的錯題由 `answer_part_results` 的最新已檢核結果與可重建統計取得，避免改判後錯題表不同步；`score` 不保存逐題結果，因此不產生錯題明細。
- 不建立永久名次表。排行榜依日期範圍及篩選條件從每日統計計算。
- 不建立平行的題組內容表。同一大題的共用內容放在 `question_revisions` 的內容區塊，各小題放在 `question_parts`。兩個以上可獨立作答的小題依 `position` 逐題切換，共用內容保持可見，答案仍以 `question_part_id` 分別保存。只有題幹已有足量空格且每個文字小題各對應一個空格時，輸入欄位同行顯示，不使用逐小題切換。
- 不把來源路徑、重複來源類型或重複知識點再存成可見條件。原始證據留在來源文件與匯入草稿；可驗證的正式課綱代碼另存到 `curriculum_codes`，不能因畫面不顯示「學習內容」就丟棄代碼。

```text
users ──< account_identities
      ├──< auth_sessions
      ├──< verification_challenges
      ├──< user_roles
      ├──< role_pin_credentials
      └──< learner_access >── learners ──< learner_subject_settings

assets ──0..1 asset_object_cleanup_jobs

subjects(parent) ──< subjects(child)
         ├──< subject_aliases
         └──< grade_subjects >── grades
subjects ──< book_versions ──< curriculum_units
exam_programs ──< exam_program_levels
             └──< source_categories
curriculum_units ──< unit_topics >── topics
curriculum_units ──< unit_knowledge_points >── knowledge_points
curriculum_codes ──< question_revision_curriculum_codes

questions ──< question_revisions ──< question_parts ──< question_options
                                  │                 ├──< question_answers
                                  │                 └──< answer_part_results ──< answer_part_assets
                                  ├──< question_revision_reviews
                                  ├──< question_content_blocks
                                  ├──< question_revision_units >── curriculum_units
                                  ├──< question_revision_topics
                                  ├──< question_revision_knowledge_points
                                  ├──< question_revision_curriculum_codes
                                  └──< question_revision_filter_values
exam_program_levels ──< question_revisions

question_revisions ──< question_similarity_candidates >── question_revisions
questions ──< question_similarity_memberships >── question_similarity_groups

source_documents ──< import_batch_documents >── import_batches ──< import_items
source_documents ──< source_document_classification_candidates
source_documents ──< question_revision_sources >── question_revisions
source_categories ──< source_category_dimensions
filter_fields ──< filter_field_scopes ──< filter_field_scope_sources
              │                       ├──< filter_field_scope_subjects
              │                       ├──< filter_field_scope_grades
              │                       ├──< filter_field_scope_semesters
              │                       ├──< filter_field_scope_book_versions
              │                       └──< filter_field_scope_exam_levels
              ├──< filter_field_options ──< filter_field_option_scopes >── filter_field_scopes
              └──< question_revision_filter_values

learners ──< exams ──< exam_subject_ranges
exam_program_levels ──< exam_subject_ranges
learners ──< practice_plans ──< practice_plan_items
                         └──< practice_plan_difficulty_mix
learners ──< practice_schedules ──< practice_schedule_items
         └──< learner_practice_queue_items
practice_plans ──< practice_sessions
practice_schedules ──0..1 practice_sessions
practice_sessions ──< practice_session_items ──< answer_attempts ──< answer_part_results ──< answer_reviews
                                  └──0..1 practice_score_receipts
practice_session_items ──< practice_session_item_origins >── answer_part_results
```

後端授權必須遵守以下規則：

- 一般帳號只能修改自己擁有的 `origin=account` 題目。系統題目只有有效的 `system_admin` 或預設系統管理員可建立新版本。
- 系統題目版本須由另一位有效系統管理員審核；建立版本與審核決定要分離，不能自行核准。
- 一次性的 fixture 搬移不建立虛構審核者。第一版直接發布的例外只適用於固定順序：先套用 `0001` 至 `0004`，再執行通過筆數、內容雜湊、必要欄位與來源檢查的受控 fixture 搬移並寫入 `admin_audit_logs`，最後套用 `0005`；若無法使用此順序，必須由專用、一次性且可稽核的受控 migration 明確處理。`0005` 套用後，新版本必須先以 `draft` 建立，發布或取代系統題目版本也必須在同一交易留下審核與稽核；一般搬移工具不得再使用直接發布例外。
- 系統管理員授予與移除必須同時寫入 `user_roles` 及 `admin_audit_logs`，兩者在同一個 transaction（資料庫交易）提交。
- 預設系統管理員從可信後端身份取得 `bootstrap_admin` 操作者，不在 `users` 建立假帳號。`bootstrap_admin` 與 `system_job` 只是資料列中的 actor 類型，正式資料庫必須另以受限應用程式角色、RLS／GRANT 及受控高權限程序驗證 caller，不能只相信這個字串。
- 所有學習資料查詢同時限制 `learner_id` 及目前帳號有效的 `learner_access`，只知道資源 ID 不代表有權讀取。
- 檔案下載權限由引用 `assets` 的正式資源決定，物件儲存鍵值與檔案識別碼都不是授權憑證。
- 家長或家教建立的計畫可由學習者執行，但只有具修改權限的建立者能改變範圍與練習方式。
- 未確認的 OCR、AI 分類、相近題關係與手寫辨識不能直接成為正式答案或已確認關聯。
- 只有有效 `system_admin` 或預設系統管理員能建立及啟用統計隱私政策。社群榜查詢不得接受繞過最小樣本門檻或要求學習者明細的前端參數。

## 必要限制與索引

| 目的 | 限制或索引 |
| --- | --- |
| 登入身份去重 | `UNIQUE(provider, provider_subject)`；`email_normalized` 有值時唯一 |
| 登入工作階段 | `UNIQUE(token_hash)`；索引 `user_id, revoked_at, expires_at` |
| 登入與撤權併發 | session 建立／恢復、帳號狀態、角色及學習者存取權異動以同一個每帳號 transaction advisory lock 序列化，鎖後重新驗證有效權限 |
| 一次性驗證 | `UNIQUE(token_hash)`；索引 `user_id, purpose, consumed_at, expires_at` |
| 有效角色去重 | `user_roles(user_id, role)` 在 `revoked_at IS NULL` 時唯一 |
| 角色授權歷史 | 授權證據不可改寫或刪除，撤銷只能單向進行；`system_admin` 授撤必須同交易寫入 actor 與 target 相符的管理員稽核 |
| 學習者分享 | `learner_access(learner_id, user_id, access_role)` 在 `revoked_at IS NULL` 時唯一；另建 `user_id, revoked_at, learner_id` 索引。`0010` 再以 `learner_access(user_id)` 的部分唯一索引限制每帳號至多一筆未撤銷的 `access_role=learner` 關係 |
| 學習者就學狀態 | CHECK constraint 確保 `enrolled` 時有 `grade_id`，`not_enrolled` 時 `grade_id`、`semester_id` 與 `school_name` 為空 |
| 學習者科目 | `UNIQUE(learner_id, subject_id)`；索引 `learner_id, enabled, position` |
| 科目名稱與階層 | 系統科目的 `normalized_name` 與 `subject_aliases.normalized_alias` 各自全域唯一；帳號科目 `UNIQUE(owner_user_id, normalized_name)`；後端另拒絕與可見系統科目名稱或別名重名，並防止 `parent_subject_id` 形成循環 |
| 系統與帳號所有權 | `subjects`、`book_versions`、`curriculum_units`、`source_categories`、`topics`、`knowledge_points`、題庫與題目皆限制 `origin=system` 時 `owner_user_id IS NULL`、`origin=account` 時 `owner_user_id IS NOT NULL`；帳號目錄的可見與引用範圍仍由後端授權服務檢查 |
| 預設題庫 | 每個 `owner_user_id` 在 `status=active AND is_default=true` 時最多一筆；系統題庫另以系統範圍限制 |
| 題目版本 | `UNIQUE(question_id, revision_number)`；索引 `question_id, revision_number DESC` |
| 系統題目修改原因 | `0005` preflight 拒絕既有缺漏；`question_revisions` trigger 拒絕新增、改號、換題或清空原因；`questions.origin` 的 deferred constraint trigger 反查後續版本，確保交易最終狀態下所有系統題目 `revision_number > 1` 都有非空白 `change_note` |
| 考試體系與級別 | `UNIQUE(exam_programs.code)`；`UNIQUE(exam_program_id, code)`；索引 `exam_program_levels(parent_level_id, sort_order)` 與 `source_categories(exam_program_id, status)`；父子級別必須屬於同一體系並防止循環 |
| 題目外部編號 | `legacy` 使用 `UNIQUE(identifier_type, normalized_value)`；出版社與文件題號依有效範圍建立部分唯一索引，禁止兩題取得同一有效來源識別 |
| 題目審核 | 索引 `question_revision_reviews(question_revision_id, created_at DESC)`；`reviewer_type=user` 時審核帳號必須存在，預設系統管理員則不得建立假帳號 |
| 小題作答與判分政策 | `UNIQUE(question_revision_id, stable_key)`；`answer_mode` 限首版四種作答方式；`grading_policy` 限系統自動判分、人工檢視或 AI 輔助後人工確認 |
| 參考答案表示 | CHECK constraint 確保每列只有 `answer_key` 或 `accepted_value` 一項有值；`0009` 的 deferred constraint triggers 要求 published／superseded 的自動判分選擇類小題至少有一個同小題有效答案鍵，自動判分文字題至少有一個非空白可接受答案；manual／AI 輔助檢視可無答案 |
| 目前題目版本 | `questions.current_revision_id` 必須屬於同一題且狀態為 `published`；以延後限制或同交易的後端檢查完成 |
| 題目篩選 | 索引 `question_revisions(subject_id, grade_id, semester_id, book_version_id, source_category_id, difficulty_level_id, question_type_id)`、`question_revisions(exam_program_level_id)`；另索引 `question_revision_units(curriculum_unit_id, question_revision_id)` |
| 題目全文搜尋 | 先量測中文斷詞；沒有品質證據前不引入外部搜尋服務 |
| 來源固定維度 | `PRIMARY KEY(source_category_id, dimension)`；每個有效來源發布前必須具備完整維度規則 |
| 篩選適用規則 | 六張維度關聯表各以兩個識別碼為主鍵，並索引維度識別碼與 `effect`；`filter_field_option_scopes` 必須驗證選項與規則屬於同一欄位 |
| 來源專屬條件 | 選項型與非選項型欄位的 CHECK constraint 必須互斥；分別索引 `filter_option_id, question_revision_id` 與 `filter_field_id, normalized_value, question_revision_id` |
| 單元、主題、知識點與課綱代碼 | 索引四張題目關聯表的分類 ID 與版本 ID；每個版本在各分類最多一筆 `is_primary=true` |
| 來源文件分類候選 | 索引 `source_document_id, review_status, dimension`；以 CHECK constraint 確保每列最多一個候選外鍵，且與 `dimension` 相符 |
| 考試範圍 | `exam_subject_ranges` 以 CHECK constraint 確保教材起訖與 `target_level_id` 互斥；目標級別模式禁止保存書籍版本；發布題目時驗證級別與來源限定的考試體系一致 |
| 匯入冪等 | `UNIQUE(created_by_user_id, idempotency_key)`；`UNIQUE(import_batch_id, source_order)`；`UNIQUE(import_batch_id, position)` 及批次文件複合外鍵驗證 |
| 收藏去重 | `PRIMARY KEY(collection_id, question_id)`；索引 `question_id, collection_id` |
| 相近題 | `PRIMARY KEY(similarity_group_id, question_id)`；索引 `question_id, status` |
| 相近題候選 | `left_question_revision_id < right_question_revision_id`；`UNIQUE(left_question_revision_id, right_question_revision_id, method_key, method_version)`；索引 `status, similarity_score DESC`；已審核狀態必須有審核者與時間 |
| 計畫、排程與練習順序 | `UNIQUE(practice_plan_id, position)`、`UNIQUE(practice_schedule_id, position)`、`UNIQUE(practice_session_id, position)` |
| 作答來源固定 | 有來源追溯或一般作答後，練習項目的 session、題目、版本、小題及選入原因不可漂移；parent session 不可改換學習者。`score` item 有收據後，session、題目、版本與小題不可漂移，parent session 不可改換學習者或 `check_mode` |
| 預設計畫 | 每個 `learner_id` 在 `status <> archived AND is_default=true` 時最多一筆 |
| 排程執行 | `practice_sessions.practice_schedule_id` 有值時唯一；索引 `practice_schedules(learner_id, status, scheduled_for)` |
| 後續練習佇列 | 索引 `learner_practice_queue_items(learner_id, status, created_at)`；正常錯題與相近題流程必須有來源小題作答 |
| 相近題追溯 | `UNIQUE(practice_session_item_id, source_answer_part_result_id, relation_kind)`；索引 `source_answer_part_result_id, relation_kind`；相近題來源以 CHECK constraint 驗證 `match_basis` 與唯一一個依據外鍵一致 |
| 難易度比例 | 啟用比例的計畫必須有有效比例，且同一計畫比例合計為 100；在提交交易前驗證 |
| 作答冪等 | 一般作答以 `UNIQUE(learner_id, idempotency_key)` 及 `UNIQUE(practice_session_item_id, attempt_number)` 去重；`score` 收據以 `UNIQUE(practice_session_item_id)` 及 `UNIQUE(learner_id, idempotency_key)` 去重，建立後不可修改或刪除 |
| 計分模式彙總 | `score_total_count` 等於 session item 數，`score_answered_count` 等於收據數；`correct + wrong <= answered <= total` 且 `correct + wrong + pending = total`；非 `score` session 的五個欄位全部為 0 |
| 外部物件清理 | `asset_object_cleanup_jobs(asset_id)` 為主鍵；索引 `status, requested_at`。只接受已邏輯刪除的 private 作答 asset；工作由 pending 單向進入 processing，再完成或失敗，只有實際刪除物件後可寫 `object_deleted_at` |
| 小題結果 | `UNIQUE(answer_attempt_id, question_part_id)`；索引 `question_part_id, current_result` |
| 檔案引用完整性 | 代表圖片、題目內容、來源文件、頁面裁切圖與作答附件只接受用途相容、`scan_status=clean`、`deleted_at IS NULL` 的檔案；手寫與一般作答附件另要求 `sensitivity=private`，被引用後不得改成不相容或失效狀態；作答引用期間另凍結儲存鍵值、內容／尺寸雜湊與上傳證據 |
| 作答附件 | `PRIMARY KEY(answer_part_result_id, asset_id, asset_role)`；索引 `asset_id`；引用資產的用途與附件角色必須相容 |
| 錯題與最近作答 | 索引 `learner_question_stats(learner_id, last_result, last_attempted_at DESC)` 及 `learner_part_stats(learner_id, last_result, last_attempted_at DESC)` |
| 錯題排行 | 索引 `question_daily_stats(stat_date, wrong_attempts DESC)` 與 `stat_date, wrong_learner_count DESC` |
| 社群榜隱私政策 | `analytics_privacy_policies(policy_key)` 在 `status=active` 時唯一；`min_distinct_learners > 1`；啟用、停用與改版都要寫入管理員稽核 |
| 統計事件冪等 | `UNIQUE(event_type, source_record_id)`；索引 `processed_at, occurred_at` |
| 稽核查詢 | 索引 `admin_audit_logs(target_type, target_id, created_at DESC)` 及 `actor_user_id, created_at DESC` |
| 樂觀鎖定 | 更新 `learner_preferences`、`learner_subject_settings`、`question_collections`、`exams`、`practice_plans`、`practice_schedules` 時比對主鍵與 `lock_version`；成功後版本加 1 |
| 資料刪除要求 | 索引 `data_erasure_requests(status, requested_at)`、`target_user_id` 及 `target_learner_id`；只允許既定單向狀態流程，身份／目標不可改、不可刪、終態不可變，完成需同交易稽核 |
| 正式種子資料 | `UNIQUE(catalog_key, version)`；同版本的來源、內容雜湊與筆數必須一致；已套用版本不得覆寫或重新解讀 |

## 寫入交易與資料生命週期

| 操作 | 同一交易內必須完成的內容 | 失敗處理 |
| --- | --- | --- |
| 新增題目 | 建立 `questions`、第一版、小題、內容、選項、答案、分類、來源與題庫收錄；驗證作答方式與判分政策 | 任一項失敗全部回滾 |
| 修改題目 | 驗證所有權並建立新版本；帳號題目發布時更新 `current_revision_id`，系統題目先保持草稿並另寫稽核 | 保留原版本，不產生半套新版本 |
| 發布或取代題目版本 | 鎖定版本並驗證所有 automatic 小題的參考答案完整；選擇類答案鍵須屬於同一小題有效選項，文字答案不可只有空白 | 任一自動判分小題缺少可用答案時整筆交易失敗，不補造答案或把判分政策改成人工 |
| 發布考試題目 | 驗證來源固定維度、正式級別及來源限定的考試體系，發布版本並更新目前版本 | 體系或必要級別不一致時維持草稿 |
| 補齊題號來源 | 鎖定 `legacy` 識別、查找目標出版社與版本範圍的相同正規化題號，確認無衝突後更新原識別 | 發現既有題目時進入合併審核，不新增識別、不合併作答 |
| 審核系統題目 | 鎖定版本、驗證審核者不是建立者、新增審核紀錄、轉換版本狀態、更新目前發布版本及稽核 | 任一項失敗維持原狀態 |
| 搬移既有系統題目 | 僅在 `0001` 至 `0004` 完成、`0005` 尚未套用時，驗證 fixture 雜湊、題目筆數、必要欄位與來源後建立第一版並直接發布，同時寫入 migration 稽核；其他部署順序須使用專用的一次性受控 migration | 任一核對失敗時整批不發布；不建立虛構審核紀錄；`0005` 套用後一般搬移工具不得繞過 `draft`、審核與稽核 |
| 確認匯入 | 鎖定批次、驗證全部核准項目、建立正式題目與來源關聯、標記批次確認 | 冪等重試回傳同一結果 |
| 移動收藏 | 移除該學習者其他收藏項目，再加入目標收藏 | 失敗時維持原收藏狀態 |
| 開始練習 | 依有效條件選題，固定版本與小題到 `practice_session_items` | 不建立空的練習工作階段；題數不足回傳實際題數 |
| 建立排程 | 鎖定來源計畫、固定題目版本與順序、建立排程及排程項目 | 不建立沒有題目的排程 |
| 消耗後續練習 | 鎖定待處理佇列項目、建立練習與來源追溯、將項目標記為已使用 | 重試不得建立第二個工作階段或遺失追溯關係 |
| 提交作答 | `instant` 與 `complete` 依小題作答方式驗證並保存原始答案與附件，依判分政策新增自動結果或待檢視結果，並寫入統計 outbox 事件；`score` 在同一交易由伺服器暫時計分，只累計 session aggregate 並新增不含答案／判定的冪等收據，全部 item 有收據後才完成 session | 資料格式不合時拒絕整次提交；AI 或自動判分無法完成時，需保留明細的模式保存原始答案並標記為 `pending`。`score` 相同 key 重播原收據，同一 item 改用新 key 回傳衝突；不得因重載需求改存逐題內容、附件、佇列、來源追溯或 outbox |
| 清理外部作答物件 | worker 鎖定 pending／failed 工作，標記 processing，依凍結的 asset 儲存證據刪除物件；只有儲存服務確認不存在或刪除成功後，才在後續交易寫 `object_deleted_at` 並標記 completed | 失敗時標記 failed 並保存不含答案或個資的摘要；不得只因 migration 已寫 `deleted_at` 就宣稱外部物件刪除完成 |
| 人工改判 | 新增 `answer_reviews`，更新目前結果並寫入統計 outbox | 不修改初始判定或舊審核；任一資料無效時整次回滾 |
| 核准相近題候選 | 鎖定候選與兩個題目版本，建立或更新已確認群組及成員，保存判定版本與審核紀錄，再標記候選為已核准 | 任一項失敗時不產生正式相近關聯，候選維持原狀態 |
| 套用正式種子資料 | 驗證來源、內容雜湊、筆數、穩定鍵值與外鍵後套用正式目錄，最後寫入 `seed_manifests` | 已存在相同版本且內容不同時停止；任一核對失敗時整批回滾 |
| 授予管理員 | 驗證操作者、建立角色授權、寫入稽核 | 角色與稽核要一起成功 |
| 啟用統計隱私政策 | 驗證系統管理員、停用同鍵舊政策、啟用新政策並寫入稽核 | 任一項失敗時沿用舊政策；沒有舊政策時社群榜保持關閉 |
| 執行資料刪除要求 | 依既定狀態流程鎖定要求，驗證 requester、target、執行管理員及保存政策，刪除或去識別化資料與物件，寫入不含個資的結果摘要及完成稽核 | 任一項失敗時不得標記為 `completed`；保留要求與失敗診斷供重試，不製造半套刪除完成證據 |
| 封存題目 | 標記題目封存，停止新的練習工作階段選入 | 保留歷史版本、作答與來源 |

## 共用篩選查詢規則

題目總覽、錯題英雄榜與開始練習必須呼叫同一個後端查詢服務，並共用相同的固定條件、來源專屬條件與權限範圍。三個入口只增加各自的輸出或操作：

- 題目總覽增加分頁、批次選取與收藏操作。
- 錯題英雄榜增加日期範圍、答錯次數、錯誤率、最後作答時間與即時計算名次。
- 開始練習增加題數、檢核方式及難易度比例。啟用比例時忽略一般難易度條件。

一般題目總覽與開始練習先套用帳號及學習者權限，再依就學狀態、目前年級與已啟用科目限制候選題，接著套用固定教材條件、考試級別、來源固定維度規則、來源專屬欄位、收藏、作答狀態及相近題條件，最後才分頁或抽題。不能先取出所有資料再由前端過濾。

題目來源將 `grade` 設為 `not_applicable` 時，不套用學習者年級過濾，但仍須符合已啟用科目；其他來源仍以題目版本的 `grade_id` 比對目前年級。在學學習者可同時看到符合目前年級的教材題與不綁年級的考試題。不在學學習者的通用查詢只納入 `grade=not_applicable` 的題目，科目候選完全依 `learner_subject_settings` 決定，不從 `grade_subjects` 推導。

`exam_level` 是固定篩選條件。篩選面板只在目前來源的 `exam_level` 規則不是 `not_applicable` 時顯示；指定來源限定考試體系時，只列該體系級別。以 `exam_subject_ranges.target_level_id` 建立練習時，首版只選相同級別，不自行展開較低級別或兄弟類別。

錯題英雄榜與歷史練習明細先從該學習者的 `answer_part_results` 或統計明細取得歷史題目，不套用目前年級、目前啟用科目或目前書籍版本限制；這些欄位只能作為歷史題目的篩選條件。從歷史錯題產生相近題時，同年級條件使用原錯題版本的 `grade_id`，不使用學習者目前年級。這可避免升年級後舊錯題消失，也不會把舊錯題的相近題錯配到目前年級。

社群錯題排行從 `question_daily_stats` 與必要的作答明細依日期範圍聚合，不套用查詢者目前年級、啟用科目或版本；只套用共用篩選條件、已發布系統題目限制及有效統計隱私政策。API 只回傳題目層級聚合值，不回傳學習者識別資料。可見範圍尚未核准前不開放跨帳號或全站查詢，只提供查詢者有權存取的學習者資料所構成的範圍。

「排除已掌握題組」只使用已確認群組與已確認成員。學習者在同一群組中至少有兩個不同題目的最新已檢核結果為答對時，才排除整組；同題重做不重複計數，待審核不計入。

## JSON 搬移規則

| 現有資料 | 正式資料表 | 搬移規則 |
| --- | --- | --- |
| `Learner` | `learners`、`learner_preferences` | 現有資料都有年級，搬移為 `education_status=enrolled`；常用題數轉成 `question_limit_options` 陣列，各科版本拆到 `learner_subject_settings`，空字串版本轉為空值 |
| `customSubjects` | `subjects`、`learner_subject_settings` | 建立 `origin=account` 科目並保留建立帳號；找不到帳號則隔離，不自行指派 |
| `Question` | `questions`、`question_revisions` | 一題建立穩定身份與第一版；既有 fixture 明確標記為系統題目。直接發布只允許在 `0001` 至 `0004` 後、`0005` 前完成整批核對與 migration 稽核，或由專用的一次性受控 migration 執行，不建立虛構審核者；`0005` 套用後一般搬移工具只能走 `draft`、審核與稽核流程 |
| `code` | `question_identifiers` | 先以核准對照規則及已確認的 `bookVersion`、出版社與來源文件判斷題號範圍；能唯一確認出版社時建立 `identifier_type=publisher_question` 並保存出版社及適用版本，無法確認時才建立 `legacy`。搬移前先查找同範圍的正規化題號，不能因識別種類不同而建立重複題目；對照規則、各類結果筆數及同一出版社範圍內一號多題的隔離紀錄寫入搬移報告，不自動合併 |
| `subject`、`grade`、`semester`、`bookVersion` | `question_revisions` | 逐項對照正式目錄後寫入原生分類；找不到唯一對照時列入隔離報告，不依顯示文字自行新增系統目錄 |
| `chapter`、`unit` | `curriculum_units`、`question_revision_units` | 只有能對照到既有教材層級時建立 `assignment_type=native` 關聯；「相近題模擬」等非教材位置不得建立單元，原文保留在搬移報告 |
| `Question.topic` | `question_types`、`topics`、隔離報告 | 先以核准對照表判斷原值是標準題型或教學主題；「填充題」「配合題」「單一選擇題」等寫入題型，「角的分類」「異分母加法」等確認後寫入主題。未列入對照表的值不得自動建立主題或題型，保留原文並列入人工校正 |
| `knowledge` | `knowledge_points`、`question_revision_knowledge_points`、隔離報告 | 只對照平台知識點；符合正式課綱代碼格式的值改走課綱代碼流程，不得同時寫入兩種分類 |
| `blocks` | `question_content_blocks` | 有 blocks 時為唯一顯示來源；沒有時才由舊 prompt、options、answer、explanation 轉換。內容依原始順序保存，不依畫面座標推測額外版面結構 |
| `parts` | `question_parts`、`question_answers` | 一般單題也建立根小題，多小題保持原順序。依既有資料對照首版作答方式及判分政策；無法判定標準答案或判分政策的題目隔離，不以顯示文字推測 |
| `metadata` | `question_revision_filter_values`、`question_revision_knowledge_points`、`curriculum_codes`、`question_revision_curriculum_codes` | 重複來源與來源路徑不建立介面欄位；知識點只對照到知識點目錄；`N-7-5`、`Da-IV-1` 等通過格式與目錄驗證的學習內容代碼寫入課綱代碼關聯。無法確認層級或代碼的原文保留並列入人工校正，不混寫到知識點 |
| `sourceDetail` | `source_documents`、`source_document_classification_candidates`、`import_items`、`question_revision_sources` | 保存原始檔名、頁碼、題號、判定來源與信心值；檔名解析只建立分類候選，題號直接保存到匯入項目及確認後的來源位置，經確認的分類候選才寫入正式版本、單元或來源分類 |
| `QuestionCollection` | `question_collections`、`question_collection_items` | 依學習者分開搬移 |
| `ExamSetting` | `exams`、`exam_subject_ranges` | 既有起訖值須先對照到正式單元；無法對照者列入隔離報告。舊資料沒有考試級別，不建立 `target_level_id` |
| `plansByLearner` | `practice_plans`、`practice_plan_difficulty_mix`、`practice_plan_items` | 每位學習者的舊計畫搬成 `is_default=true`，名稱固定為「預設練習計畫」；保存版本化篩選快照，固定清單不得只留查詢條件 |
| `ScheduledPractice` | `practice_schedules`、`practice_schedule_items`、`practice_sessions` | 日期與時間轉為臺北時區的 `scheduled_for`；保存當時檢核方式及固定題目順序；舊結果的 `sessionId` 對照既有工作階段，總題數、錯題數與正確率由作答明細重算，找不到工作階段時列入隔離報告 |
| `queuedSimilarByLearner` | `learner_practice_queue_items` | 題號對照正式題目與目前版本，標記為 `legacy_migration`；舊資料沒有原始錯題作答，`source_answer_part_result_id` 保持空值並在搬移報告列出數量 |
| `ImportBook` | `question_banks`、`question_bank_learners` | 保留名稱、建立角色與適用學習者；同一擁有者的名稱衝突需隔離，不自行改名 |
| `ImportBatch` | `import_batches`、`import_batch_documents`、`import_items` | `fileNames` 每個檔名建立或對照來源文件，`questionIds` 建立已確認匯入項目並連回正式題目版本；有 `bookId` 時對照匯入本，沒有時使用該帳號 `is_default=true` 的題庫；預設題庫不存在時先建立一筆名稱為「系統預設」的帳號題庫 |
| `RoleAccess` | `account_identities`、`user_roles`、`role_pin_credentials`、`learner_access`、`auth_sessions` | 只搬到已知的 fixture 帳號；`registrationEmail` 正規化後寫入登入身份，角色清單建立授權，各角色學習者清單轉為存取關係，`activeRole` 只在有效角色內寫入工作階段。舊 PIN 若不是可確認版本與格式的受支援雜湊，不得直接搬入、重新包裝或當成明碼；需列入隔離報告，要求帳號透過已驗證電子郵件重新設定。找不到帳號時整組隔離 |
| 作答狀態 | `practice_sessions`、`practice_score_receipts`，以及非 `score` 使用的 `answer_attempts`、`answer_part_results`、`answer_part_assets` | 必須連結當時題目版本；`instant`／`complete` 手寫檔案以附件角色連結。`score` 只搬移 session aggregate 與不含答案／判定的冪等收據，不搬逐題答案或附件。無法判斷小題的非 `score` 舊資料只建立根小題結果；無法確認原判定依據時保留原始結果並標記為搬移資料，不重新判分 |

搬移工具需輸出舊 ID 對新 UUID 對照與隔離報告，並核對題目、版本、小題、選項、答案、圖片、來源文件、收藏、計畫、作答及關聯失敗數。原始 fixture 保持唯讀，搬移可重跑。

## Migration 施工順序

| 階段 | 建立範圍 | 完成條件 | 可直接丟棄的本機資料庫之 down 測試界線 |
| --- | --- | --- | --- |
| 身份與目錄 | 帳號、登入身份、工作階段、角色、學習者、年級、科目樹、版本、考試體系、考試級別、教材單元、課綱代碼、來源固定維度及種子資料版本 | 所有權、角色、學習者隔離、正式考試目錄、來源維度限制及種子資料內容核對通過 | 回滾新 schema（資料庫結構），不修改 fixture |
| 題目核心 | 題庫、題目身份、外部編號、版本、小題、內容、答案、多單元歸檔、課綱代碼、來源條件與檔案 | 既有題型、圖片、題目音訊與錄音稿可由單一題目模型重現；跨版本歸檔不改寫原生版本 | 保留身份與目錄，回滾題目核心 migration |
| 匯入與收藏 | 來源文件、匯入批次、草稿、來源追溯及收藏 | 同一冪等鍵不重複寫入，未確認草稿不進正式題庫 | 刪除該次匯入批次，不刪除原始檔案前先核對引用 |
| 練習與作答 | 考試、計畫、排程、後續練習佇列、固定題目、練習工作階段、逐次作答、作答附件、小題結果及審核 | 歷史題目版本與原始判定不漂移，錯一小題只產生該小題複習；同一排程只能建立一個工作階段 | 停止新寫入，保留已提交作答 |
| 相近題與統計 | 相近候選、相近群組、原始錯題追溯、掌握度、每日彙總、統計隱私政策、outbox（待處理事件表）與重算工作 | 每次相近題練習可追溯確切錯題作答；候選分數不能直接成為正式關聯；統計可從明細全量重建，未確認群組不參與排除；沒有有效隱私政策時社群榜保持關閉 | 清空可重建彙總，不動原始作答、政策版本與關聯審核紀錄 |
| Word 來源 | 擴充 `source_documents.input_type=document` 及 ready DOCX 限制 | 文件來源只引用 private、clean、未刪除且 MIME 正確的 DOCX asset | 有 document 資料時拒絕縮回舊值域 |
| 答案與來源完整性 | 選擇類答案鍵、ready 文件與被引用 asset 的交易最終狀態 | 答案鍵只指向同一小題有效選項，被引用來源不可改成不相容狀態 | 只移除本階段的限制物件，不修改業務資料 |
| Session 與匯入完整性 | active learner session、鎖定順序與 confirmed Hanlin 教材分類修正 | 封存學習者時同交易撤銷 session；指定批次分類為 `native/document`，其他資料不變 | Schema 物件可移除；教材分類修正保持 forward-only |
| 自動判分答案完整性 | published／superseded 版本的 automatic 小題答案檢查 | 選擇類有同小題有效答案鍵，文字題有非空白可接受答案；既有缺漏使升級停止 | 只移除 `0009` 限制物件，不修改題目或答案 |
| 帳號角色與 self learner 完整性 | `users.account_role`、本人關係唯一索引、名稱與設定權限、登入身份及角色授權的一致性 | 有效登入身份具備可判定的一般角色；learner 帳號有一位有效 self learner，且名稱同步並可管理設定 | 移除 `0010` schema 物件；既有名稱與權限修正保持 forward-only |
| 計分模式彙總與隱私清理 | session 五個計分彙總欄位、`practice_score_receipts`、`asset_object_cleanup_jobs`，以及五張可重建統計表 | `score` 只保存 aggregate 與不含答案／判定的收據；既有逐題明細與衍生資料清除，統計只由合格非 `score` 明細重建。exclusive 私有作答 asset 邏輯刪除並排程，共用 asset 保留 | 隔離 down 移除 `0011` schema 與 migration 清理稽核，但不重建明細、不取消 asset 邏輯刪除；有 pending 工作時不得作營運回滾 |

每一階段都有 up 與 down migration。down 只用於空白或只含合成資料、可直接丟棄的本機資料庫，以驗證物件移除順序與再次前進；正式資料庫開始承載耐久資料後，不執行這些 down migration，改用保留資料的 forward fix migration，並以停止寫入、切回上一版服務或關閉功能等營運方式回復服務。`0008` 的教材分類修正是 forward-only，down 不把 `native/document` 改回舊分類；`0009` down 只移除新增的 trigger、函式與 migration 紀錄，不修改題目、選項或答案；`0010` down 不反向猜測 migration 修正前的 self learner 名稱或設定權限；`0011` down 不虛構已刪除的 `score` 明細，也不取消只屬於舊 `score` 資產的邏輯刪除，但會移除 job table 與 migration 產生的清理稽核。有 pending 工作的環境須先完成或受控移交工作並另留操作稽核，不能用 DDL down 當營運回滾。接近正式資料量的驗證也必須使用隔離副本，不得把 down 當成正式資料的復原方案。

舊 JSON HTTP 寫入已停止。若要搬移仍需保留的歷史 JSON，先凍結來源、完成一次性搬移及數量核對，再開放對應的 PostgreSQL API；不能恢復雙寫。若 fixture 系統題第一版要使用直接發布例外，部署順序固定為 `0001` 至 `0004`、受控 fixture 搬移、`0005`；否則另寫專用的一次性受控 migration。一般搬移工具在 `0005` 之後不得繞過 `draft`、審核與稽核限制。

## 學習工作區題庫讀取契約

- `GET /api/v1/local-practice/questions` 不帶題庫分類與分頁參數時，表示讀取目前 session 學習者的完整可用題庫。範圍由有效 `learner_access`、active `question_banks`、`question_bank_learners`、`question_bank_items`、學習者年級與 enabled `learner_subject_settings` 決定；科目設定有 `book_version_id` 時只包含該版本。前端不得保存可用課次清單或在空集合時自行補資料。
- 帶分類時必須同時提供年級、科目、出版社、冊次及課次，並可帶 page／limit；只提供部分分類或只對未篩選查詢提供分頁參數時回傳 `400`。兩種查詢都只選 `questions.current_revision_id` 指向的 published revision，並以 active 目錄與題庫成員關係授權。
- 一次可用題庫讀取先做一個 base selection，再以 revision ID 集合讀取小題、選項、題幹／選項內容、metadata 與知識點。公開題庫路徑不可讀取 `question_answers` 或 explanation placement。session 恢復另沿 `practice_session_items.question_revision_id` 讀取固定版本，不受目前版本與目前設定變更影響。
- 工作區初次載入只呼叫一次可用題庫查詢；作答完成後只更新 history／wrong-review 摘要。這個合併讀取仍會一次傳輸完整可用題庫，若五次實測中位數未低於三秒，下一階段必須改為路由範圍摘要與分頁載入，不得以提高併發或持久瀏覽器快取掩蓋問題。
- 完整可用題庫回應在客戶端接受時使用 gzip 傳輸，保留 `private, no-store` 與 `Vary: Accept-Encoding`；壓縮不得改變 JSON envelope、答案不外洩規則或授權範圍。客戶端明確拒絕 gzip 時仍須回傳同一份未壓縮 JSON。

## 正式切換前仍需確認

- 正式後端、PostgreSQL 託管位置、ORM、物件儲存、登入服務及 Secret Manager。
- 資料庫系統管理員是否能修改其他帳號建立的題目；目前規則為拒絕。
- 系統預設科目是否允許個別學習者停用；本模型支援停用但不允許刪除預設設定。
- 學習者、作答、上傳文件、手寫檔案、來源 IP 與稽核紀錄的保存期限及刪除流程。
- 社群錯題榜的 `min_distinct_learners` 初始門檻及未成年者資料用於平台聚合統計的法律依據；確認並啟用政策前不提供社群榜，只提供有權帳號可見的個人榜。
- 中文全文搜尋品質標準與正式教材目錄的權威資料來源。
- 各考試體系與級別的主辦機關正式清單、更新責任及停用規則。
- 目標考試級別練習是否包含較低級別；首版只選相同級別。
- 手寫附件的檔案大小、格式及保存期限上限。
- 相近題候選的審核操作、正式群組關聯與授權後查詢 API，以及複習／相近題 session 寫入 `practice_session_item_origins` 的交易流程；現有資料表不代表這些服務已經串接。
- `/settings` 尚未正式寫入的就學狀態、學校、代表圖片、練習偏好與考試；各科書籍版本已有受權限且具 optimistic lock 的正式寫入，`system_admin` 的管理與升權邊界仍須另外完成。
- 計畫、排程與收藏仍由 `localStorage` 保存，其正式寫入 API 與表單切換尚未完成。
- 若未來要支援排序、拖曳配對、圖片熱區、繪圖或錄音作答，需先確認產品需求，再以新 migration 增加互動格式、判分方式與必要版面資料；首版不預留空表或發布前置條件。

## 驗證計畫

- schema 限制：帳號身份、角色、題目與自訂目錄所有權、版本歸屬、學習者科目、動態欄位適用規則、選項適用規則及各唯一鍵。
- 就學狀態：在學學習者必須有年級；不在學學習者不得保存年級、學期或學校，且能依啟用科目查到不綁年級的考試題。
- 科目與來源目錄：社會、自然科學等上層科目可展開有效子科目；領域課綱代碼可套用到有效子科目；系統單元／來源不可冒用帳號所有權，帳號自訂項目也不能跨帳號引用；來源固定維度能分辨必填、選填與不適用，缺少規則時不得發布來源設定。
- 來源原生分類：單元設為 `not_applicable` 時禁止 `native` 關聯，但允許跨版本或人工歸檔；版本設為 `not_applicable` 時題目版本保持空值，跨版本單元歸檔仍可使用。
- 考試體系：不綁年級的考試題可供任一年級及不在學學習者查詢；級別與來源限定體系不一致時拒絕發布；目標級別首版只選相同級別。
- 跨版本歸檔：不綁版本的會考或校內卷題目可歸入多個出版社單元，題目原生 `book_version_id` 仍保持空值；原生教材題目的 `native` 單元不得和科目、年級、學期或版本衝突。
- 課綱代碼：`N-7-5`、`Da-IV-1` 等通過目錄驗證後可查詢；未知原文進入人工校正，不得寫成知識點或自行建立正式代碼。
- migration 結構往返：在空白或只含合成資料、可直接丟棄的本機資料庫前進、回滾並再次前進後，最終 schema 與第一次前進的 schema parity（結構一致性）相符。現有 verifier 不驗證種子資料的 round-trip parity（往返後資料一致性）；正式種子資料另依下一項的版本、雜湊、筆數與外鍵規則驗證。
- 帳號角色與 self learner：`0010` 對既有資料做固定順序回填；無法安全判定的一般角色或 learner 帳號缺少 self learner 時停止。併發撤銷目前帳號角色授權，或同時改動 self 關係與學習者名稱，都不能留下只通過其中一側檢查的狀態。
- 正式種子資料：同一目錄版本重跑不新增資料；內容雜湊或筆數不符時整批停止；穩定鍵值與既有外鍵在升版後仍可追溯。
- fixture 搬移：既有八種題型、圖片、兩個以上填空、小題、收藏、考試與動態來源欄位可重現；能確認出版社的既有 `code` 搬成 `publisher_question`，其餘才搬成 `legacy`；`Question.topic` 依核准對照表分流至題型或主題。系統題目第一版直接發布需有搬移稽核、不能產生虛構審核者，且只能依 `0001` 至 `0004`、受控 fixture 搬移、`0005` 的順序，或由專用的一次性受控 migration 執行。
- 音訊內容：音訊檔案、錄音稿、顯示順序與權限可由同一內容模型重現，缺少必要錄音稿時不得發布英聽題。
- 作答答案：選項、是非、文字與多值答案通過首版格式驗證；未知欄位、跨小題選項鍵值與不相容附件必須拒絕。
- 自動判分答案完整性：既有 published／superseded 版本有缺漏時 `0009` preflight 停止；新交易中，單選、複選與是非題缺少同小題有效答案鍵，或文字題缺少非空白可接受答案時不得發布或取代。人工與 AI 輔助檢視無答案仍可提交，down 後既有題目與答案保持不變。
- 判分政策：系統自動判分、人工檢視與 AI 輔助後人工確認都有允許及拒絕案例；AI 結果未經確認時維持待檢視。
- 判分歷史：`instant` 與 `complete` 的原始答案與初始結果不可覆寫；只有新增審核紀錄才能改變目前結果，不得因後續程式更新重新改判。`score` 只保留 session aggregate 與不含答案／判定的冪等收據，不補造逐題答案內容。
- 舊 `score` 隱私清理：升級只用每個 item 最新 attempt 回填 aggregate／收據，之後清除所有 `score` attempt、part result、附件關聯、審核、來源、錯題／相近題佇列及 outbox。非 `score` 原始明細保留；五張統計表只從 `instant` 與已完成 `complete` 明細確定性重建，不由 aggregate 反推。
- 出版來源去重：同一出版社、版本或來源文件範圍內的相同題號不能建立成兩個題目；fixture 搬入的出版社題號與後續匯入的同一題號必須解析到同一個 `questions.id`；不同合法範圍可使用相同題號。
- 檔名解析：原始檔名保持不變；分類解析結果先建立候選，未確認候選不能污染正式單元、版本、來源或課綱目錄；題號直接進入匯入項目與來源位置，不建立題號分類候選。
- 舊資料搬移：排程、後續相近題、匯入本、匯入批次與角色權限逐項核對筆數；無法建立的追溯關係必須出現在隔離報告。
- 歷史一致性：更正答案後，舊作答仍引用舊版本，新練習使用新版本。沒有安全 revision 快照的舊歷程只顯示結果、時間與內容不可用狀態，不得以目前版本冒充。
- 題目審核：`0005` 套用後，一般搬移工具與應用程式都不能繞過先建立 `draft`、另一位管理員審核及同交易稽核；退回原因、狀態轉換與目前發布版本保持一致。一次性 fixture 直接發布例外只適用於前述受控順序或專用受控 migration。
- 系統題目修改原因：`0005` preflight 會拒絕既有缺漏；系統題目新增或更新 `revision_number > 1` 的版本時，缺少或只有空白的 `change_note` 會由 revision trigger 拒絕；帳號題目含有缺漏的後續版本時，`questions.origin` 的 deferred constraint trigger 會阻止交易以 `origin=system` 提交。這些允許與拒絕案例已納入資料庫限制測試；正式 API 另提供送出前的友善驗證。
- 小題複習：只有答錯的小題進入複習；其他小題與大題共用內容仍可正確顯示。
- 排程與佇列：同一計畫可建立多個固定排程；重送啟動要求不重複建立工作階段；後續練習項目消耗後仍能追溯來源。
- 篩選一致性：總覽、錯題英雄榜與開始練習共用欄位解析及條件語意；一般候選題查詢結果一致，錯題英雄榜以歷史作答為資料範圍，不受目前年級與啟用科目限制。
- 適用規則：驗證同一維度任一符合、跨維度全部符合、排除優先、全域規則及版本專屬選項；封存來源或版本後不得顯示失效選項。
- 比例選題：比例合計、一般難度停用、難度不足補題及總題數不足都符合契約。
- 相近題掌握：只計不同題目的最新已檢核答對結果，待審核與未確認群組不得觸發排除。
- 相近題候選：分數只改變審核排序；未核准、已拒絕或已過期候選都不能進入正式相近題查詢、掌握判定或練習選題；題目改版後舊候選失效。
- 相近題追溯：每筆正常流程的相近題結果可回到觸發它的歷史錯題小題作答，並可按該錯題重算累計結果。
- 相近題選入依據：沒有已確認群組時，主題、知識點、單元或科目的實際命中依據會固定保存；後續修改題目分類不改變歷史追溯。
- 歷史查詢：學習者升年級、停用科目或更換版本後，既有錯題與練習明細仍可查詢；由舊錯題產生相近題時使用原題年級。
- 社群榜隱私：只有已發布系統題目能進入社群排行；未達有效政策最小樣本數的題目整列省略；跨日不重複學習者數不得由每日人數直接加總。
- 權限與資料隔離：一般帳號、資料庫管理員、預設系統管理員、家長、學習者與家教的允許及拒絕案例。
- 併發更新：兩個帳號同時修改學習者設定、收藏、考試或計畫時，後提交者收到衝突且不覆蓋前一筆更新。
- 檔案與刪除：直接使用檔案識別碼不能繞過引用資源權限；核准的資料刪除要求依政策移除或去識別化且留下不含個資的摘要。
- 作答附件：手寫只接受 `handwriting`，一般附件只接受 `answer_attachment`；兩者都必須是 private、掃描通過且未刪除。用途、權限及順序可由作答結果重現；資產刪除前檢查所有引用，不能留下可繞過授權的孤立下載入口。
- 物件清理工作：移除舊 `score` 關聯後，只有無任何其他引用的 private 作答 asset 會寫入 `deleted_at` 與 pending 工作，共用 asset 不變；未確認外部物件刪除時，工作不得標成 completed 或填入 `object_deleted_at`。隔離 down 會移除工作與 migration 清理稽核但保留 `assets.deleted_at`，因此 pending 工作存在時不得執行營運 down。
- 冪等與交易：重送匯入、提交答案及敏感權限操作不產生重複資料或半套狀態。
- 檢核模式與恢復：`instant` 可逐題揭露；`complete` 只有 completed session 可回傳明細；`score` 進行中遮罩，completed session 對外只回傳 aggregate，資料庫保存 aggregate 與不含答案／判定的冪等收據，不保存逐題答案內容。歷程與錯題佇列不得旁路洩漏；重新整理後只依 session UUID 恢復可安全恢復的進度並暫停，revision mismatch 時關閉舊 session 並要求建立新練習。
- 統計重建：清空明細型彙總後，可由所有 `instant` 與已完成 `complete` session 的不可覆寫作答及審核明細重建相同結果。`score` 的 aggregate 不得反推出或補造逐題答案。

## 依據

- `docs/PRODUCT_SPEC.md`：帳號、學習者、題目、匯入、練習、錯題、收藏、相近題及統計規則。
- `docs/system-admin-plan.md`：預設系統管理員、題目所有權、授權與稽核邊界。
- `docs/plan.md`：歷史 JSON API 邊界、目前 PostgreSQL 前端狀態及正式資料庫施工確認節點。
- `docs/database-completion-matrix.md`：目前規劃需求、122 張業務資料表、正式 API／表單與安全切換狀態對照。
- `app/lib/demo-data.ts`：歷史介面與 fixture 搬移來源；目前正式主流程不以它作為帳號、題目或作答的權威資料契約。
- `app/lib/question-filters.ts`：目前共用篩選欄位、來源分類及來源專屬欄位行為。
- `app/lib/mock-store.ts`：既有 JSON 驗證與舊資料轉換規則。
