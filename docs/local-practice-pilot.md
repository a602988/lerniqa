# 本機 PostgreSQL 操作與診斷

正式匯入的題目、帳號、角色、學習者、練習與作答紀錄屬持久資料，不得用 seed、reset、fixture 還原或測試 cleanup 覆蓋。合成 fixture 只用於明確隔離的測試資料庫；資料量少不會改變持久資料的性質。

279 題的 parser v2 confirmed 批次為 `2d1ff794-f6f4-5e59-baaa-8d1c767438be`，來源 SHA-256 為 `c2b09d04ef9e0a32a2fbe71a8f8e930d2061fb87e78bb6bc60f694df6be8cfb2`。相同輸入重跑應重用批次，不重建或清空既有題目。

帳號郵件的驗證信、密碼重設與角色 PIN 設定／重設樣板，以及 Synology MailPlus adapter、Nodemailer transport 已完成不連網測試。密碼／PIN 復原的 API 與介面程式也已完成針對性測試，`0012` 已整合 challenge 固定綁定電子郵件 identity 的資料庫契約。ERP 現行 SMTP 的非機密 host、port 與 TLS 模式已核實；Lerniqa 自己的憑證、outbox、實際 handshake 與真實寄送仍未設定，也不得讀取或複製 ERP secret。目前同步寄信仍可能讓已知與未知帳號產生 timing enumeration；outbox／等時回應是獨立的上線阻擋，不屬於 `0012`。成人角色切換仍以帳號密碼重新確認，角色 PIN 尚不參與角色切換。教材 OCR 與 AI 拆題仍未串接。手寫分析已串接 PP-OCRv6、Apple Vision、固定 Ollama 模型及 sidecar worker；四張繁體中文真實筆跡已通過，人工審核介面仍待完成。

Lerniqa 是持續開發中的多科目正式產品。使用者從既有 `/practice` 選擇「國語 → 國一 → 翰林版 → 第一冊 → 第四課」，使用正式匯入的 279 題。題庫、學習者的練習必要資料、session、作答、歷程與錯題由本機 PostgreSQL 提供。auth 公開 DTO 已具備年級、學期、練習偏好、已啟用科目與書籍版本；`/practice` 已採用這份 DTO，且不保存瀏覽器學習者快照。瀏覽器只保存篩選與顯示等非識別性 UI 設定，以及尚未切換資料庫的計畫、排程與收藏。`/local-practice` 保留為內部診斷與相容入口，不是另一套產品流程，也不代表 production 切換已完成。本文件沿用既有檔名以保留舊連結，內容是正式產品的本機操作說明，不是另一個 pilot 產品。

目前沒有可操作的正式匯入 UI。舊 mock `/bank` 已從主導覽移除，直接開啟時轉址到 `/questions`；舊 `/api/v1/imports` 固定回 HTTP `410`。下方 Hanlin CLI 是受控的本機管理工具，隔離匯入測試也只驗證資料所有權，兩者都不代表使用者端 PostgreSQL 匯入 API／介面已交付。

## 啟動與停止

需要 Node.js 20+ 與可從 `PATH` 執行的 PostgreSQL 工具：`initdb`、`pg_ctl`、`pg_isready`、`createdb` 與 `psql`。

```bash
npm install
npm run db:local:ensure
npm run dev
```

開啟 http://localhost:3500/account，以合成的 `.invalid` 電子郵件完成註冊或登入，再前往 http://localhost:3500/practice 並選擇第四課。同一個 tailnet 也可使用 `https://linmacbook-pro.tailc132cc.ts.net:8443/account` 與 `https://linmacbook-pro.tailc132cc.ts.net:8443/practice`；不要使用 `https://100.86.149.1:3500`。此 Tailscale Serve 設定只新增 `8443` 對映，不修改既有 `443` handlers，也沒有啟用 Funnel；這是私有 tailnet HTTPS，不是 production HTTPS。換機時以 `tailscale serve status` 顯示的 MagicDNS 名稱為準。需要查看或停止資料庫時：

```bash
npm run db:local:status
npm run db:local:stop
```

`db:local:ensure` 會在必要時初始化 cluster、啟動 PostgreSQL，再依序套用尚未執行的 migration。它只接受 repository 內 migration 的完整前綴，遇到未知版本、跳號或名稱不符時會停止，不會自動執行 down migration。

目前 manifest 由 `0001` 至 `0011` 共十一個 migration 組成，合計 96 張業務資料表。`0008_auth_and_import_integrity` 要求有效 session 指定的學習者保持啟用；封存學習者時，要在同一交易撤銷仍指向該學習者的有效 session。它也只針對 confirmed 批次 `2d1ff794-f6f4-5e59-baaa-8d1c767438be`，把教材單元來源修正為 `native/document`。如果升級前已有有效 session 指向封存學習者，migration 會停止，不會默默改寫或刪除資料。`0008` 的 down 採 forward-only 資料修正策略，只移除新增的 schema 物件，不把正確的 `native/document` 資料改回舊分類。

`0014` 已進入 migration manifest，建立題目模板、模板成員、正式關鍵字、題目版本關鍵字關聯與推薦來源證據；`0015` 補上 AI／規則關鍵字目錄的 pending 與審核證據。15 組 migration 的空庫前進、限制測試、逐階段回滾、再次前進與 schema parity 已通過；本機持久資料庫已在備份後升級，不得以測試資料覆蓋。

`0009_automatic_answer_completeness` 要求 published／superseded 版本的自動判分小題具備可用參考答案。單選、複選與是非題至少要有一個屬於同一小題有效選項的非空白答案鍵；文字題至少要有一個非空白可接受答案。人工檢視與 AI 輔助檢視可以沒有答案。升級前置檢查發現既有缺漏時會直接停止，不會補造答案；down 只移除這個 migration 新增的限制，不修改答案資料。

`0010_account_role_and_self_learner` 加入一般帳號主要身分、每帳號唯一 self learner、名稱同步與設定權限完整性。`0011_score_session_aggregates` 在 `practice_sessions` 加入五個計分彙總欄位，並新增 `practice_score_receipts` 與 `asset_object_cleanup_jobs`。`score` 收據只標記哪個 session item 已送出及冪等鍵，不包含答案、逐題判定、小題、耗時或附件；非 `score` session 的計分欄位必須維持為 0。

升級既有資料時，`0011` 先從每個舊 `score` item 的最新 attempt 回填 aggregate 與收據，再清除該模式的逐題作答、附件關聯、審核、來源、佇列與 outbox。`learner_question_stats`、`learner_part_stats`、`learner_similarity_group_stats`、`learner_daily_stats`、`question_daily_stats` 會清空後，只由剩餘 `instant` 與已完成 `complete` 明細重建。非 `score` 原始明細不刪除。

如果 private `handwriting`／`answer_attachment` 在舊 `score` 關聯移除後已無任何其他引用，migration 會寫入 `assets.deleted_at`，建立 pending 的 `asset_object_cleanup_jobs` 及稽核；仍被題目、文件、學習者或非 `score` 作答共用的 asset 不變。這只完成資料庫端隱私清理與清理排程，不會刪除真實 storage 物件；受控 worker 實際確認刪除後，才可把工作標為 completed 並寫入 `object_deleted_at`。

`0011` down 不能重建已清除明細，也不反向取消 asset 的邏輯刪除；它會移除 job table 與 migration 產生的清理稽核，只供可丟棄的隔離資料庫驗證 schema 往返。有 pending 物件工作的環境必須先完成或受控移交工作並另留操作稽核，不得執行這個 down 作為營運回滾。

持久資料放在不進版控的 `local-data`：

- `local-data/postgres` 保存 PostgreSQL cluster。
- `local-data/postgres-socket` 是權限 `0700` 的私有 Unix socket 目錄。
- `local-data/assets` 保存本機匯入產生的來源與題目檔案。

這個 cluster 不監聽 TCP，並且使用目前的本機作業系統使用者，不另建帳號、密碼或長期憑證。`55432` 只用來區分這個本機伺服器，連線仍必須經過指定的 Unix socket。若本機路徑不同，可參照 `.env.example` 設定 `LOCAL_PG_SOCKET`、`LOCAL_PG_PORT`、`LOCAL_PG_DATABASE` 與 `LOCAL_PG_USER`；不需要 `DATABASE_URL`。

## 舊版 Word 題庫匯入

本機匯入器的入口是 npm 指令；它會先執行匯入前置回歸測試：

```bash
npm run db:import:hanlin -- \
  "/題庫路徑/05_第四課_論語選（一）子游問孝（二）譬如為山（三）三省吾身.doc" \
  --asset-root ./local-data/assets
```

加上 `--dry-run` 可只做解析與驗證，不寫入資料庫。`--dry-run` 可以接受單一 `.doc` 或題庫資料夾；資料夾模式只盤點其頂層 `.doc`。沒有 `--dry-run` 時，命令必須明確指定上述第四課單一檔案，傳入資料夾或其他檔案都會停止，不會寫入。

本機整合只將 `05_第四課_論語選（一）子游問孝（二）譬如為山（三）三省吾身.doc` 歸入「國語／國一／翰林版／第一冊／第四課」。parser v2 的 confirmed 批次已寫入 279 題，279 題均已發布且目前版本為 revision 2，沒有待核對或拒絕的匯入項目；同一輸入重跑會重用原批次，不增加題目。279 筆教材單元關聯均為文件原生位置 `native/document`，舊的 `manual_classification/user` 為 0；匯入器仍保留原檔檔名、內容雜湊、原始課次／單元及文件內來源欄位，也不會建立固定的合成帳號、角色、學習者、偏好或題庫成員關係。

其餘 14 份題庫文件尚未匯入。它們只能先用 `--dry-run` 盤點；在各自的正確教材分類確認前，不會寫入第四課或其他正式分類。

題庫補全命令只讀取目前已發布的系統題目，預設生成 JSONL dry-run，對細題型、主要知識點與解題方法提出結構化建議。`--persist` 也只能讀取一份完整、通過驗證且與目標資料庫快照相符的 JSONL，再寫入 pending suggestion；它不會直接改寫已發布題目。目前 `0012` 尚未整合，279 題尚未套用任何補全結果。先以抽樣通過品質門檻與人工核准後，才可在受控流程另行 apply。

已遇過的匯入錯誤、修正方式、重跑順序與驗證條件記在 [翰林題庫匯入與排錯](hanlin-import-runbook.md)。

第四課原始 `.doc` 含 VBA，不會直接成為可發布的來源。匯入器將原檔保存在 `local-data/assets/quarantine/source-documents`，標記為 `rejected`，且 `source_documents` 不引用這份原檔。接著使用全新的 LibreOffice profile、關閉巨集執行並以 headless 模式產生 DOCX 衍生檔。這份 DOCX 必須通過格式、VBA、Macro 與 ActiveX 內容檢查，才會以 `clean` 狀態保存在 `local-data/assets/sanitized-source-documents` 並作為 `source_documents.input_type=document` 的來源。PDF 與 HTML 衍生物只用於本機的頁碼、圖片配對與安全檢查。任一個步驟失敗時，該文件保持待核對或失敗，不會發布其題目。

匯入流程只在本機處理文件，不把題庫或個人路徑送到外部服務。資料庫只保留相對的 asset storage key，不儲存 Google Drive 帳號、本機絕對路徑或 Office 作者個資。

## 練習 API 與判分

| 端點 | 用途 |
| --- | --- |
| `POST /api/v1/auth/register` | 建立本機電子郵件密碼帳號、國一學習者、`learner_access`、練習偏好、科目設定與第四課題庫成員關係。 |
| `POST /api/v1/auth/login` | 驗證 scrypt 密碼並建立不透明 session；資料庫只保存 token 的 SHA-256 雜湊。 |
| `POST /api/v1/auth/logout`、`GET /api/v1/auth/me` | 撤銷目前 session，或從 HttpOnly cookie 讀取目前帳號。公開 learner DTO 包含年級、學期、練習偏好，以及已啟用科目的出版社與書籍版本，不包含學校或 private asset。 |
| `POST /api/v1/auth/password-reset`、`POST /api/v1/auth/password-reset/confirm` | 申請與確認一次性密碼重設。申請回應不揭露帳號是否存在；確認不改動電子郵件的 `verified_at`，成功後撤銷該帳號的所有 session。 |
| `POST /api/v1/auth/role-pin-reset`、`POST /api/v1/auth/role-pin-reset/confirm` | 登入後為仍有效的 parent／tutor 角色申請與確認 PIN 設定／重設；要求單一有效且已驗證的電子郵件，成功後只撤銷該目標角色的 session。此 PIN 尚不參與角色切換。 |
| `PATCH /api/v1/auth/role` | 只把目前 session 切換至同一帳號已有、未撤銷的角色；不建立角色、不改寫 `learner_access`，也不是帳號角色管理 API。 |
| `GET /api/v1/local-practice/questions` | 只回傳目前分類中已發布題目的題幹、小題、選項與正式知識點，不回傳參考答案或解析；單頁上限為 500 題。 |
| `POST /api/v1/local-practice/sessions` | 以登入 session 可存取的學習者建立練習，並固定當時的題目版本與順序。呼叫端提供 session UUID；完全相同的重送會重用同一筆，不同帳號、設定或題目不能占用同一 UUID。 |
| `GET /api/v1/local-practice/sessions?id=...` | 讀取同一帳號與學習者可存取的練習、固定題目版本及各題是否已送出；答案明細依 `check_mode` 與完成狀態揭露。 |
| `PATCH /api/v1/local-practice/sessions` | 將自己的 session 切換為 `active`、`paused` 或 `abandoned`；不能修改其他帳號的 session。 |
| `POST /api/v1/local-practice/attempts` | 由伺服器讀取標準答案並判分。`instant`／`complete` 在單一交易內寫入作答、逐小題結果、允許的錯題佇列與 `analytics_outbox`，並可儲存通過驗證的 private 手寫 PNG；`score` 只累加 session aggregate 並寫入不含答案／判定的冪等收據，手寫與其他逐題附件一律拒絕。 |
| `POST /api/v1/local-practice/recommendations` | 從允許揭露的錯題產生關連練習。依已確認相同模板、已確認相似群組、共同正式關鍵字最多、共同主題最多逐層選擇；同層尚未作答者優先，最近已答對者排除，並保存模板或共同關鍵字證據。`score` 禁止。279 題尚未完成分析與人工核准，因此正式關聯為空時回傳沒有推薦。 |
| `GET /api/v1/local-practice/history` | 回傳持久的練習、作答結果與待複習錯題摘要，不回傳學習者的作答 payload 或標準答案。 |
| `GET /api/v1/local-practice/assets/:assetId` | 題目圖片只讀取已通過檢查、未刪除且被已發布題目引用的檔案；作答手寫則必須從相同學習者的 attempt／part 關聯與結果揭露規則反查權限。 |

伺服器只會對「判分政策為自動判分，且標準答案完整」的小題判定對錯。沒有作答、要求人工檢視或要求 AI 輔助後確認的小題都保持 `pending`。本機整合不生成虛構答案，也不把未核對的內容當成標準答案。相同 idempotency key 只可重播完全相同的提交；同一 session 題目改用新 key 再送，或沿用 key 改變答案，都會回傳衝突，不會建立第二筆作答。

既有 `/practice` 使用上述 API。使用者選擇「全部作答後檢核」、「逐題檢核」或「只顯示成績」時，都會建立 PostgreSQL session；保存內容依模式分開：

- `instant` 在每次送出後回傳逐題結果。
- `complete` 在 session 完成前只標記已送出，不回傳逐題判定；完成後才回傳詳細結果。
- `score` 進行中只回傳遮罩狀態；完成後只回傳 `{total, correct, wrong, pending, accuracy}`，任何狀態都不回傳個別結果、答案或解析。資料庫只保存 aggregate 與不含答案／判定的收據，不建立 attempt、part result、附件、審核、錯題／相近題佇列、來源追溯或 outbox。

`instant`／`complete` 的手寫上傳只接受通過簽章、chunk、CRC、尺寸、解壓上限與可見墨跡檢查的 PNG，儲存為 private asset，並以學習者、session item、冪等鍵與內容雜湊建立穩定身份。文字小題沒有其他答案時，手寫只連到實際由手寫作答的小題，結果保持 `pending`／`manual`；同題已有完整文字或選項答案時，同一張圖只連到第一個小題作為計算過程附件，不改變自動判分。這些程式已通過針對性測試，但尚未在 `0012` 整合後完成整體資料庫 E2E。

送出前的手寫辨識先把透明畫布合成白底並裁切筆跡，再由 PP-OCRv6 在同一批次辨識原始筆畫及加粗單字版。兩個版本一致時採用較高信心；衝突時只接受信心至少 0.9 且明顯領先的候選。純漢字的高信心結果可以直接回填，英文與數字仍需和 Apple Vision 一致；其餘情況才在互動時限內呼叫固定 Ollama 模型。無法確認時保持 `pending`，交由人工判別。三個辨識器都只接收手寫圖片，不接收題幹、參考答案、解析或評分規則。相同 PNG 的結果在網站程序記憶體快取十分鐘，正式送出可以重用剛完成的「AI 分析」。

`0012` job／run sidecar、作答交易生產者及受控 worker 保留既有契約。只有 payload 為空且結果為 pending／manual 的手寫文字小題能進入 AI 佇列；計算過程附件不排入。六張英文、數字、空白與模糊合成圖通過品質門檻；四張已保存的繁體中文真實筆跡「謀、儒、省、覆」也逐字相符，暖機後單張為 422 至 469 毫秒。這四張樣本仍不足以代表不同年級與多字答案，需繼續擴充去識別化測試集。

關聯題目練習只適用於允許揭露逐題錯誤的 `instant` 與已完成 `complete`。相同題必須共享 confirmed 模板；相近題依 confirmed 相似群組、共同 confirmed 關鍵字數量及共同主題數量逐層選擇。關鍵字與主題只採共同數量最高的級距，該級距沒有合格候選才往下一層；同層尚未作答者優先，最近已答對者排除。來源題型與同單元不再產生新推薦，只保留舊 session 相容。

歷程與錯題佇列套用同一規則，不能讓 `complete` 的進行中 session 或任何 `score` session 藉由其他端點看出逐題結果。只有允許揭露且已判定為錯誤的小題，才會出現在可見的待複習摘要。重新整理進行中的練習時，瀏覽器只用 learner-keyed session UUID 從資料庫恢復已送出的進度，並先切成暫停；尚未送出的文字答案與手寫內容不保存。固定 revision 與可用內容不一致時，舊 session 會標記為 `abandoned`。新推薦 session 已把實際模板、共同關鍵字數量、規則版本與證據寫入 `practice_session_item_origins`；關聯分析、人工審核與核准寫入流程仍待完成。

主導覽「系統設定」已從 PostgreSQL 建立、選取與編輯有權存取的學習者；每次操作都使用目前 session 的帳號、有效角色與 `learner_access` 授權。一般帳號的 `accountRole`、session 的 `activeRole`／目前學習者，以及 `system_admin` 授權分開處理；每個帳號只保留一位名稱同步的 self learner。parent／tutor 在旗下學習者的 learner mode 看不到「系統設定」，直接呼叫設定 API 也會收到 `403`；只有 self learner 能力的帳號可以查看自己的帳號設定，但不能建立受管學習者。登出、session 到期、角色或目前學習者改變時會同步其他已開分頁；頁面重新取得焦點或恢復可見時也會重新查詢 `auth/me`。`system_admin` 管理、邀請及跨帳號分享仍未完成。

## 隔離自動化驗證

```bash
npm run db:test
npm run test:import-ownership
npm run test:local-practice
npm run test:account-recovery
npm run test:handwriting
npm run test:question-enrichment
node --test tests/practice-catalog-integration.test.mjs
```

前三個指令預設在 `/tmp` 建立權限受限的一次性目錄與私有 Unix socket，不沿用 `DATABASE_URL`、`PGHOST` 或 `local-data`。migration 往返測試目前涵蓋 `0015`；推薦契約測試涵蓋正式模板與關鍵字層級、最近答對排除及來源證據。隔離 local-practice E2E 已通過 confirmed 模板的預覽、session、來源證據與冪等重播，之後被既有手寫辨識案例維持 `manual_review` 擋住，因此整套 E2E 仍不是全綠。測試結束只清理具有專用 marker 的暫存目錄，不會清除持久題庫或帳號資料。

macOS 無法再建立短命 PostgreSQL cluster 時，三個 runner 都可明確借用已確認的本機 Unix-socket server：`db:test` 使用 `LERNIQA_DB_TEST_*`，import ownership 使用 `LERNIQA_IMPORT_OWNERSHIP_TEST_*`，local practice 使用 `LERNIQA_PRACTICE_TEST_*`。每組都要啟用 `*_EXISTING=1`，並指定 socket、port 與實際 data directory。runner 會核對 canonical 路徑、目前作業系統使用者及 non-recovery 狀態，只建立具隨機名稱和本次 ownership comment 的專用資料庫；清理前再核對一次，只刪除本次資料庫，不停止共用 server。這個模式不能連接 production，也不能拿來測試 `local-data` 的持久資料。

## 身分、資料與 production 邊界

本機整合會實際建立電子郵件密碼帳號與 session。密碼以 scrypt 雜湊保存；session cookie 使用 HttpOnly 與 SameSite=Lax，HTTPS 時再加上 Secure，資料庫只保存 token 雜湊。練習 API 不接受前端自報使用者或學習者，而是從 session 取得帳號，再檢查有效的 `learner_access` 與 `question_bank_learners`；練習、作答、歷程及題目 asset 都依這個學習者範圍隔離。

本機與私有 tailnet 已提供持久帳號、信箱驗證、密碼重設、角色 PIN 設定／重設的 challenge／API／介面及練習服務；production 帳號生命週期仍未完成。SMTP 真實投遞、公開／production HTTPS、公開登入 rate limit、OAuth、跨帳號分享、角色 PIN 切換、RLS、production GRANT、正式角色授權、托管式物件儲存與真實兒童資料的保存／刪除政策尚未完成。因此：

- 自動化測試使用隔離合成資料，不輸入真實學生個資；已建立的帳號、角色、學習者、練習與作答仍須持久保存。
- 不連接 production 資料庫，不對 production 執行 migration。
- 不把 `local-data` 上傳到 Vercel，也不把本機驗收當成正式帳號與權限驗收。
- 本機資料庫只在這個 repository 管理的私有 socket 上使用，不改用共用 Homebrew PostgreSQL cluster。

要確認持久性，先完成一次練習，記下畫面顯示的歷程與錯題摘要，再執行 `npm run db:local:stop` 與 `npm run db:local:ensure`。重開 `/practice`（內部診斷亦可使用 `/local-practice`）後，同一筆歷程與錯題摘要應仍可讀取。
