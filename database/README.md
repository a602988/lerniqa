# PostgreSQL migration

正式匯入的題目、帳號、角色、學習者、練習與作答紀錄屬持久資料，不得用 seed、reset、fixture 還原或測試 cleanup 覆蓋。合成 fixture 只用於明確隔離的測試資料庫；資料量少不會改變持久資料的性質。

Lerniqa 是持續開發中的多科目正式產品。PostgreSQL 的 `0001` 至 `0020` 共二十個 migration 定義 122 張業務資料表，另有技術性的 `schema_migrations`。`0016` 將出版社版本與冊次分開，`0017` 新增學習本版本與分享契約，`0018` 保存文字小題的答案欄位數，`0019` 加速每題首選題號查詢，`0020` 建立補充教材來源證據。二十個 migration 的隔離資料庫往返驗證已通過；`0020` 尚未套用持久本機資料庫。帳號、角色、學習者基本資料，以及 `/practice` 的題庫、學習本、排程、session、作答、歷程與錯題流程已接上本機 PostgreSQL。瀏覽器只保存非識別性的 UI 設定、尚未切換資料庫的收藏，以及安全搬移後保留的舊學習本原始備份。production 後端與完整授權尚未完成；`/local-practice` 是內部診斷與相容入口。

## 本機驗證

註冊與密碼重設的新密碼至少 8 字元，不要求字元種類混用，並阻擋常見弱密碼、全空白與首尾空白；只保存 scrypt 雜湊。既有密碼不批次修改，登入保留相容。信箱驗證、密碼重設及角色 PIN 設定／重設沿用 `verification_challenges`，一次性 token 只保存雜湊。密碼重設成功後不更新 `verified_at`，並撤銷該帳號的所有 session；角色 PIN 流程要求單一有效且已驗證的電子郵件與仍有效的目標角色，成功後只撤銷該目標角色的 session。這些程式與不連網針對性測試已完成，challenge 固定綁定電子郵件 identity 的資料庫契約已由 `0012` 整合。ERP 非機密 SMTP host、port 與 TLS 已核實；Lerniqa 憑證、outbox、實際 handshake 與真實寄信仍未設定，也不得讀取或複製 ERP secret。目前同步寄信仍有已知／未知帳號的 timing enumeration 風險；outbox 與等時回應不屬於 `0012`，是獨立的上線阻擋。

```bash
npm run db:test
npm run test:import-ownership
npm run test:local-practice
npm run test:account-recovery
npm run test:learning-books
npm run test:learning-books:db
node --test tests/practice-catalog-integration.test.mjs
```

資料庫 runner 使用隔離合成資料。`test:account-recovery` 不啟動資料庫或寄送真實郵件，檢查密碼／PIN 輸入、token、mail adapter 與 repository／route 契約。`test:learning-books` 檢查 API、權限、搬移與 session 契約；`test:learning-books:db` 在隔離 PostgreSQL 驗證建立、發布、多排程、分享、領取、同步、分叉、撤銷、通知、稽核與冪等生命週期。

預設模式需要 `initdb`、`pg_ctl`、`createdb`、`psql` 與 `pg_dump` 可由 `PATH` 執行。驗證腳本會在 `/tmp` 建立一次性 PostgreSQL cluster，關閉 TCP，只開啟權限為 `0700` 的私有 Unix socket，並清除可能把指令導向既有伺服器的 PostgreSQL 環境設定。每個資料庫指令都明確指定 host、port、user 與 database，且以 `PSQLRC=/dev/null` 執行。

macOS 的 SysV shared-memory 額度無法再建立短命 cluster 時，可明確設定 `LERNIQA_DB_TEST_EXISTING=1`，並同時指定 `LERNIQA_DB_TEST_SOCKET`、`LERNIQA_DB_TEST_PORT` 與 `LERNIQA_DB_TEST_DATA_DIRECTORY`。這個模式只接受本機 Unix socket，先核對 server 的實際 data directory，再建立具隨機名稱的 `lerniqa_schema_test_%` 隔離資料庫；清理也只接受本次登記的名稱。不得把它指向 production 或共用遠端資料庫。

匯入 ownership 與本機練習驗證也有各自的明確 opt-in。前者使用 `LERNIQA_IMPORT_OWNERSHIP_TEST_EXISTING=1`、`LERNIQA_IMPORT_OWNERSHIP_TEST_SOCKET`、`LERNIQA_IMPORT_OWNERSHIP_TEST_PORT`、`LERNIQA_IMPORT_OWNERSHIP_TEST_DATA_DIRECTORY`；後者使用同名的 `LERNIQA_PRACTICE_TEST_*` 四個環境變數。三個 runner 都只接受本機 Unix socket，核對實際 `data_directory`、port、目前作業系統使用者及伺服器未處於 recovery，再建立具隨機名稱與本次 ownership comment 的專用資料庫。清理前會重新核對伺服器身分及 comment，只刪除本次建立的資料庫，不停止共用伺服器。這個模式只能用於已確認的本機開發 PostgreSQL，不能指向 production。

正式本機前台使用 repository 管理、port 為 `55432` 的 PostgreSQL。執行 migration、import ownership 或 local practice 隔離驗證時，優先將各 runner 的四個 existing-server 環境變數明確指向這個 server 的 Unix socket、`55432` 及實際 `data_directory`。runner 只能建立帶本次 ownership token／comment 的隨機測試資料庫，不能停止這個由前台共用的 server；這項選擇需要操作者明確設定，腳本不會自行改接既有 server。

若 macOS 回報 `could not create shared memory segment`，先盤點所有仍在執行的 PostgreSQL cluster，以及哪些本機服務依賴它們。不得由測試或啟動流程靜默停止其他專案的 PostgreSQL。若操作者為了啟動 `55432` 而暫停 Homebrew 管理的 `5432`，應把它視為可逆的暫時措施；恢復 `5432` 前先確認 shared-memory slot 足夠，並確認依賴該 port 的服務可安全恢復。Lerniqa 腳本不會自動停止或恢復 Homebrew 服務。

腳本會自動找出每組 migration，依序執行前進與限制測試，再逐階段回滾、檢查 migration 紀錄／資料表／schema 回復，最後再次前進並比對 schema。預設模式結束時停止 cluster 並刪除整個暫存目錄；existing-local-server 模式則刪除本次建立的所有測試資料庫與 session，不停止既有 server。兩種模式都不得沿用未經明確核對的 `PGHOST` 或 production 連線。

`db:test` 會驗證 `0001` 至 `0020` 的兩次前進、限制案例、逐階段反向回滾、migration 紀錄／資料表／schema 回復及最終 schema parity。`test:import-ownership` 驗證匯入器不會建立固定的合成帳號、角色或學習者；`test:local-practice` 驗證 279 題規模的合成題庫、註冊、登入、作答、歷程、錯題、`score` aggregate／收據邊界及 PostgreSQL／Next.js 重啟後持久性。驗證只使用隔離合成資料，不會清理 `local-data` 的持久資料；預設模式會為各項驗證建立 `/tmp` 私有短命 cluster。`practice-catalog-integration` 另檢查 `/practice` 的題庫轉換、最多 500 題的分頁讀取、正式知識點關聯、session 恢復、三種檢核方式和 learner-keyed 瀏覽器設定邊界；不能用只涵蓋較早 migration 的結果代替目前二十個 migration 的驗收。

最近一次完整 `db:test` 已在隔離 PostgreSQL 通過二十個 migration。範圍包括首次前進、各 migration 限制測試、逐層 down、第二次前進與 schema parity；正式 `lerniqa_local` 未被修改。

## 持久的本機資料庫

`npm run db:test` 只用於一次性的 schema 往返驗證。要讓 `/practice` 的持久服務在重開應用程式後仍可讀取練習紀錄，使用下列指令：

```bash
npm run db:local:ensure
npm run db:local:status
npm run db:local:stop
```

`db:local:ensure` 會初始化或啟動 `local-data/postgres`，建立 `lerniqa_local`，再只向前套用尚未執行的 migration。它會拒絕未知版本、跳號、名稱不符與非 Lerniqa 管理的 cluster，不會對持久資料自動執行 down migration。

本機 cluster 只監聽 `local-data/postgres-socket` 內權限為 `0700` 的 Unix socket，不開啟 TCP。它使用本機作業系統使用者，不建立新的資料庫密碼或永久憑證。`local-data`、cluster、socket、log 與 asset 全部不進版控。不要把這個 cluster 改成共用 PostgreSQL，也不要將它連向 production。

本機應用以 `pg` 直接執行參數化 SQL。`instant` 與 `complete` 在交易內保存練習、需要保留的作答、錯題佇列與 `analytics_outbox`；`score` 只保存 session aggregate 與不含答案、逐題判定或耗時的冪等收據。`/account` 提供電子郵件與密碼的註冊、登入、登出、目前帳號查詢、驗證信寄送及忘記密碼流程，`/account/verify-email` 使用一次性 token 完成確認。密碼使用 scrypt 雜湊，瀏覽器只持有 HttpOnly session cookie，資料庫只保存 session 與驗證 token 的 SHA-256 雜湊。密碼重設成功後撤銷該帳號的所有 session，但不把電子郵件標為已驗證。未登入、cookie 無效或 session 到期時，當頁會清除帳號範圍狀態。登出、session 到期、角色、目前學習者或信箱驗證狀態改變時，其他已開分頁會重新驗證 `auth/me`，清除失效的帳號工作區或載入新的操作情境；頁面重新取得焦點與恢復可見時也會重新驗證。公開的帳號 DTO 會從 PostgreSQL 讀出學習者年級、學期、練習偏好，以及已啟用科目的出版社與書籍版本；學校與代表圖片等非練習必要資料不包含在這個回應。

`/system-settings` 是帳號層設定。`account_role` 表示帳號主要身分，session 的 `active_role` 表示目前能力；只要帳號仍有有效的 parent 或 tutor 授權，即使 `account_role=learner`，切到相應 `active_role` 後也可從 PostgreSQL 建立、選取及管理有權存取的學習者。切入受管學習者的 learner 模式後，帳號身分、建立、帳號層更新與選取端點回傳 `403`。只有 self learner 能力的帳號可以查看自己的系統設定，但不能建立受管學習者。`/settings` 是目前學習者的獨立設定頁；切入受管學習者模式後仍可進入，但只有有效、已接受、未撤銷且 `can_manage_settings=true` 的關係可寫入。目前資料庫寫入已涵蓋顯示名稱、年級、學期與各科書籍版本；就學狀態、學校、代表圖片、練習偏好與考試仍待正式寫入 API。

一般帳號本身的 `account_role`、session 的目前角色／學習者與 `system_admin` 授權是不同概念。`account_role` 是主要身分，不會撤銷帳號另外持有的有效一般角色；實際可用能力由 `active_role` 與對應的有效 `user_roles` 授權決定。每個帳號只允許一位名稱與帳號同步的 self learner。角色 PIN 的設定／重設 challenge、API 與介面已完成，且要求已驗證的電子郵件與仍有效的 parent／tutor 目標角色；成功後只撤銷該角色的 session。角色端點仍以帳號密碼重新確認，並只允許目前 session 切換至帳號已獲授、未撤銷的角色，不新增或修改 `system_admin` 授權；角色 PIN 尚不參與角色切換。

`/api/v1/local-practice/*` 從 session 取得帳號與學習者，並以 `learner_access` 及 `question_bank_learners` 限制可讀題庫、練習、作答與歷程。進行中的練習以伺服器 session UUID 恢復可安全恢復的進度，重新整理後先暫停；尚未送出的文字與手寫內容不保存。`instant` 可在送出後取得逐題結果；`complete` 在 session 完成前遮住結果，完成後才回傳明細；`score` 進行中只確認送出，完成後保存並回傳總題數、答對、答錯、待檢視與正確率，重載後仍能讀回 aggregate 與已送出狀態，但資料庫只留下不含答案／判定的冪等收據，不建立逐題明細或錯題佇列。歷程與錯題佇列遵守同一揭露規則，不能成為旁路。歷史資料若找不到建立 session 時使用的安全 revision 快照，只回傳結果、時間與內容無法安全顯示的狀態，不以題目目前版本代替。恢復 session 時若固定 revision 與可用內容不一致，伺服器會把舊 session 標記為 `abandoned` 並要求建立新練習。從任意題開始作答時會尋找下一道尚未送出的題目，只有全部 item 都完成才結束 session。驗證帳號使用合成資料；已匯入題庫與已建立的帳號、角色、學習者、練習及作答是持久資料。同一 tailnet 可使用 Tailscale Serve 顯示的私有 HTTPS 網址，實際入口以當機 `tailscale serve status` 為準。本機信箱驗證、密碼重設與角色 PIN 設定／重設的 challenge、API 與介面已完成；SMTP 真實投遞、公開／production HTTPS、公開登入 rate limit、OAuth、RLS／production GRANT 與正式角色授權尚未完成。完整操作、匯入安全限制與 production 邊界見 `../docs/local-practice-pilot.md`。

`instant`／`complete` 的手寫提交程式只接受通過嚴格格式與尺寸驗證的 PNG，以 private asset 儲存，並從作答關聯與 `learner_access` 反查讀取權限。文字小題沒有其他答案時，手寫連結只會產生 `pending`／`manual` 結果；同題已有完整文字或選項答案時，手寫圖只連到第一個小題作為計算過程附件，不改變自動判分。`score` 在寫入任何逐題檔案前就會拒絕手寫提交。這些路徑已通過針對性單元與契約測試，完整資料庫 E2E 必須以已整合的 `0012` 執行。

錯題建議練習先建立完整的同細題型候選集；只有數量為 0 時，才可查詢同一已確認相近題群組。沒有同題型候選或已確認群組時回傳無建議，不放寬成同單元或同科目猜測。`score` 不允許建立這種逐題來源的練習。API、選題與來源記錄程式已通過針對性測試；`0012` 已提供正式值域；完整 DB E2E 仍需覆蓋該路徑。

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
- 已建立的原始作答、逐小題初始結果、人工審核與管理員稽核保留歷史；`answer_attempts.grading_source` 是不可變的初始來源，`answer_part_results.grading_source` 是目前來源，只能隨合法 review 更新；改判、彙總結果與 `analytics_outbox` 事件必須在同一交易保持一致。`score` runtime 不保存各題送出的答案內容，因此不為了套用這項限制而補造明細。
- 角色授權證據不可改寫或刪除，撤銷只能單向進行；`system_admin` 的授予與撤銷必須由有效管理員或受控 bootstrap 路徑執行，並在同一交易留下相符稽核。
- 資料刪除要求只能以 `pending` 建立，依 `approved`／`rejected`、`processing`、`completed` 的單向流程推進；身份與目標不可改寫、紀錄不可刪除、終態不可變，完成時必須有同一交易的管理員稽核。這張表只保護要求與執行證據，不會自行刪除或去識別化資料。

相近候選分數不能直接成為正式關聯；只有已確認群組及成員能用於相近題練習或掌握度排除。統計表是可由不可變作答明細重建的讀取模型；沒有有效 `analytics_privacy_policies` 時，社群榜必須維持關閉。

`0005` 的 down migration 只供尚未承載正式資料的 DDL 往返驗證。若相近題審核、隱私政策、來源追溯、管理員稽核、資料刪除要求或帳號自訂目錄已有資料，腳本會拒絕破壞性回滾；正式使用後應停用功能並只重建或清除可重建統計，不能用 down migration 刪除耐久紀錄。

### `0006_source_documents_word`

擴充 `source_documents.input_type` 加入 `document`，供 Word 等一般文件匯入使用。`document` 與圖片、PDF 一樣必須引用檔案且不可同時保留貼上文字；若已有 `document` 來源資料，down migration 會拒絕回復成舊值域，避免刪除已支援類型的證據。本機整合中的舊版 `.doc` 含 VBA，原檔只保存為隔離且拒絕的 asset；只有經過關閉巨集轉換並確認不含 VBA、Macro 或 ActiveX 的 DOCX 衍生檔，才能以 `clean` 狀態被 `source_documents` 引用。

### `0007_practice_answer_integrity`

選擇題、複選題與是非題的 `question_answers.answer_key` 必須對應同一小題的有效選項。限制在交易結束前檢查，讓匯入器可以在同一交易依任意安全順序建立小題、選項與答案，但不能留下畫面無法選到的標準答案。已就緒的 `document` 來源只能引用 private、clean、未刪除且 MIME 為 DOCX 的 `source_document` asset；後續把該 asset 改成其他 MIME 或公開資料也會被拒絕。

### `0008_auth_and_import_integrity`

有效 session 若指定學習者，該學習者必須仍為 `active`；封存學習者時，必須在同一交易撤銷仍指向該學習者的有效 session。session 的應用角色與 `learner_access.access_role` 分別表達目前操作角色及對學習者的關係，不要求兩者字面相同。相關異動依帳號後學習者的固定順序取得 transaction advisory lock，並為有效 session 的學習者與到期時間建立查詢索引。

這個 migration 也只針對 confirmed 批次 `2d1ff794-f6f4-5e59-baaa-8d1c767438be`，把第四課教材單元關聯從舊的 `manual_classification/user` 修正為 `native/document`；同批次原本正確的 `native/document`、其他批次或人工分類不會被改寫。升級前若已有未撤銷、未到期的 session 指向封存學習者，migration 會停止，要求先以保留資料的方式撤銷該 session。

### `0009_automatic_answer_completeness`

已發布或已取代版本中的自動判分小題必須有可用參考答案。單選、複選及是非題至少要有一個非空白 `answer_key`，而且鍵值必須對應同一小題的有效選項；文字題至少要有一個非空白 `accepted_value`。`manual_review` 與 `ai_assisted_review` 小題可以不附參考答案，因為它們不會由伺服器直接判定對錯。

Migration 會在建立限制前檢查既有的 published／superseded 版本；有缺漏時直接停止，不猜測或補造答案。限制使用可延後的 final-state trigger，讓同一交易能依安全順序建立小題、選項與答案，但提交時不能留下不完整狀態。down 只移除 `0009` 新增的 trigger、函式與 migration 紀錄，不修改題目、選項或答案資料。

### `0010_account_role_and_self_learner`

為 `users` 加入 `account_role`，只允許 `parent`、`tutor` 或 `learner`。有有效登入身份的帳號必須同時具有相符且未撤銷的 `user_roles` 授權；learner 帳號還必須具有已接受、未撤銷且指向啟用中學習者的本人關係。Migration 依既有有效 session、學習者關係與成人角色授權做固定順序的回填；無法安全判定時會整批停止，不猜測帳號身分。

`learner_access` 原有的部分唯一索引是 `(learner_id, user_id, access_role)` 且只套用於 `revoked_at IS NULL`。`0010` 另加 `learner_access(user_id)` 的 active-self 部分唯一索引，限制每個帳號至多一筆未撤銷的 `access_role=learner` 關係。已接受且啟用中的 self learner 必須與帳號顯示名稱一致，並具有 `can_manage_settings=true`。相關帳號、登入身份、角色、學習者與存取權異動共用固定的 transaction advisory lock 順序，再由可延後限制檢查交易最終狀態，避免併發寫入繞過規則。

升級會同步既有 self learner 名稱，並修正本人關係及由建立者持有的 tutor 關係之設定權限。這些修正是只向前的資料修復；down 只移除 `0010` 的欄位、索引、trigger、函式與 migration 紀錄，不反向猜測舊名稱或權限。

### `0011_score_session_aggregates`

為 `practice_sessions` 加入 `score_total_count`、`score_answered_count`、`score_correct_count`、`score_wrong_count` 與 `score_pending_count`。這些欄位只供 `check_mode=score` 使用；其他模式必須全部保持為 0。限制也要求 `correct + wrong <= answered <= total`，且 `correct + wrong + pending = total`。

臨時建立的練習 session 以呼叫端指定的題目版本與可選小題為目標，資料庫查詢只要求題目、目前版本與分類節點仍啟用並已發布，且學習者仍屬於包含該題的有效題庫。題庫清單使用的預設年級、科目、版本、冊次與課次只負責列出清單，不得再次限制 session target；隔離驗證會暫時把已授權題目改成非預設課次，確認仍可建立 session，並確認移除題庫成員關係後會被拒絕。

新增的 `practice_score_receipts` 每個 session item 最多一筆，並以 `(learner_id, idempotency_key)` 阻止同一學習者重複提交。收據只保存識別碼、session item、學習者、冪等鍵與送出時間，不保存答案、逐題判定、小題、耗時或附件。`score` 提交仍由伺服器在交易內判分，但只寫入收據並累加 session aggregate；所有 item 都有收據後才把 session 標記為完成。相同冪等鍵的相同提交可安全重播，同一 item 換新鍵重送則回傳衝突。

升級既有資料時，每個舊版 `score` item 只取最新一次 attempt 回填收據及 aggregate，接著刪除該模式留下的 `analytics_outbox`、來源追溯、錯題／相近題佇列、審核、作答附件、小題結果與作答。五張可重建統計表 `learner_question_stats`、`learner_part_stats`、`learner_similarity_group_stats`、`learner_daily_stats` 與 `question_daily_stats` 會先清空，再只從仍可保留的 `instant` 作答及已完成 `complete` session 明細確定性重建；不從舊 aggregate 猜測或扣除 `score` 貢獻。非 `score` 原始作答與審核明細不會被刪除。

`0011` 也新增 `asset_object_cleanup_jobs`。升級只處理用途為 `handwriting` 或 `answer_attachment`、敏感度為 `private`，而且移除舊 `score` 關聯後不再被任何題目、文件、學習者或非 `score` 作答引用的 asset：先寫入 `deleted_at`，再建立 `reason=legacy_score_detail_purge`、`status=pending` 的清理工作與不含作答內容的管理稽核。共用 asset 保持原狀。Migration 不會連線刪除外部物件；worker 必須從 `pending` 進入 `processing`，只有實際確認物件刪除後才能改為 `completed` 並寫入 `object_deleted_at`，失敗則保存非敏感錯誤摘要後重試。

down 可回到 `0010` 的 schema，但無法也不應虛構已由這次隱私修正刪除的舊版 `score` 明細，也不復原已標記的 `assets.deleted_at`。為通過 `0005` 的精確 DDL／資料往返 guard，標準 down 會移除 job table、相關 guard，以及 `0011` 產生的 `asset_object_cleanup_queued` 稽核。這只適用於可丟棄的隔離驗證資料庫；有 pending 物件工作的環境不得把 down 當成營運回滾。正式變更 schema 前必須先完成或受控移交工作，並另外保存操作稽核。

### `0012_admin_catalog_and_question_enrichment`

`0012` 補上帳號復原的電子郵件 identity binding、同細題型的佇列／session 來源值域、題庫補全 run／pending suggestion，以及手寫 AI job／run sidecar；它不包含 SMTP outbox。migration 已納入 manifest，並通過空庫、既有資料升級、逐層 down／up 與 schema parity。

題庫補全以 dry-run 為預設；即使未來開啟寫入，也只能新增 `pending` 建議，不得直接改寫已發布的題目版本。手寫 AI sidecar 已接上作答交易、worker 與本機 Ollama；固定模型 metadata、digest、vision capability、合成品質 inference 及隔離的佇列 E2E 均已驗證。手寫 worker 只保存逐字辨識結果與可讀性資料，sidecar 的判定相容欄位固定保持 `pending`；它不接收參考答案，也不能更新 `current_result`、錯題佇列或統計。真實學習者筆跡樣本與人工檢視介面仍未驗收。

各 down migration 只供一次性空白／合成測試資料庫驗證 schema 對稱性，不是正式環境的資料復原程序。資料庫開始承載正式資料後，回復舊版必須使用已演練的向前修正與 operational rollback，保留作答、來源與稽核紀錄，不能直接執行 down 檔。`0008` 的教材分類修正刻意採 forward-only：因為沒有可長久辨識「由 0008 修正」與「原本正確或之後新增」資料列的標記，down 只回滾索引、函式、trigger 與 migration 紀錄，不把 `native/document` 反向改回舊分類。`db:test` 會在 down 後驗證已修正及原本正確的分類都維持不變。

### `0013_education_stage_catalog`

`0013` 將 `grades.stage` 正式限制為 `elementary`、`junior_high`、`senior_high`，建立小一至高三共十二個啟用年級，以及上學期、下學期兩筆學期目錄。公開 `/api/v1/auth/catalog` 依資料庫排序回傳 no-store 目錄；註冊與學習者設定先選教育階段，再從該階段選年級。不在學學習者不保存年級或學期。

### `0018_question_answer_field_count`

`0018` 在 `question_parts` 新增 `answer_field_count`。預設為 `1`；只有 `answer_mode=text` 且 `grading_policy=manual_review` 的小題可使用 `2` 至 `8`。欄位數屬於題目 revision 的公開作答版面契約，不從參考答案、逗號數、空白或畫面內容推測。多欄答案在既有字串契約中依原順序以全形逗號保存，送出時必須欄位數完全相符且每欄非空白；參考答案仍只留在伺服器端。

### `0019_question_identifier_question_lookup`

`0019` 為題目清單的首選題號查詢新增複合索引。索引先依 `question_id` 找出同一題的題號，再優先選擇 `publisher_question`，最後依 `value` 排序。這個索引不改變題號內容、優先順序或公開回傳契約，也不新增資料表。

### `0014_question_relation_profiles` 與 `0015_relation_keyword_review`

`0014` 建立可審核的題目模板、模板成員、正式關鍵字及題目版本關鍵字關聯，並擴充推薦來源證據。`0015` 要求 AI／規則建立的關鍵字先保持 `pending`，保存方法版本與證據，再由人工核准或退回。

### `0020_teaching_source_evidence`

`0020` 新增教材目錄範圍、可重跑處理批次、逐頁 private `source_page` asset、OCR 區塊與題目版本補充證據。來源檔名與 OCR 原文保留不變；正式目錄以學年度及既有年級、科目、學期、書籍版本、冊次外鍵表示。核准與撤回要求有效 `system_admin`，題目證據必須與教材的年級、科目、學期及版本完全一致。down 只供尚未承載 `source_page` asset 的隔離資料庫往返驗證；持久資料庫套用後應以向前修正處理。

## 尚未完成的 production 串接

Schema 與本機整合通過不代表全部功能已切換至 production 後端。下列工作完成前，不得把已封閉的 JSON 契約或 `/local-practice` 當成 production API：

- 選定 production 後端、ORM／查詢層或 repository 邊界、PostgreSQL 託管位置、驗證信服務、物件儲存與 Secret Manager。
- 把本機 session 與 `learner_access` 檢查擴充到正式角色、跨帳號分享與主應用全部資源；任何 API 都不得接受前端自報身份。
- 補齊 `/settings` 尚未寫入 PostgreSQL 的就學狀態、學校、代表圖片、練習偏好與考試；各科書籍版本已具正式寫入 API，受管學習者的寫入仍須檢查 `can_manage_settings`。
- 在開放公開／production 登入前完成 HTTPS、SMTP 真實投遞、登入 rate limit、OAuth 與正式帳號復原政策；本機密碼重設與角色 PIN 設定／重設流程不能替代這些上線條件。
- 使用受限的應用程式資料庫角色及受控的高權限程序，補上 RLS／GRANT／必要的 `SECURITY DEFINER` 邊界；`bootstrap_admin`、`system_job` 只是資料列中的來源類型，不能單獨證明 caller 身份。
- 建立正式匯入、考試、計畫、排程、收藏、審核、統計與附件交易 API。舊 `/api/v1/bootstrap`、`state`、`reset`、`questions`、`imports` 與 storage-key asset 端點已封閉並固定回傳 HTTP `410`；舊 mock `/bank` 已從主導覽移除並轉址 `/questions`。Hanlin CLI 與隔離測試不是產品匯入入口，不能重新包裝舊路徑當成正式資料來源。
- 帳號復原已在整合 `0012` 的隔離資料庫通過 API E2E；同題型推薦、private 手寫 PNG 與題庫補全仍須各自完成完整 E2E，針對性測試不能取代這項驗收。
- 完成相近題候選審核、正式群組關聯與授權後查詢 API。同題型推薦只會使用既有已確認群組當候補，不會建立或核准新群組。
- 建立可重跑的 fixture／JSON 搬移工具，輸出舊 ID 對新 UUID、筆數、雜湊、衝突與隔離報告。
- 核准兒童資料、作答、來源文件、附件、IP 與稽核的保存／刪除政策，定義一般 `answer_part_assets` 解除引用及物件刪除的受權限路徑；實作 `asset_object_cleanup_jobs` worker，確認外部物件確實刪除後才寫 `object_deleted_at`。另外完成一般資料刪除 worker、統計 worker、重算命令及管理 API。

舊 JSON HTTP 寫入已停止。若要搬移仍需保留的歷史 JSON，先凍結來源、完成一次性搬移及數量核對，再開放對應的 PostgreSQL API；不得恢復雙寫。完整需求與狀態對照見 `../docs/database-completion-matrix.md`。
