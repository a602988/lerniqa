# Lerniqa｜學習卡

給國小／國中學生的多科目題目練習與錯題複習平台，持續開發中的正式產品。各項功能依串接與驗證狀態交付，不以臨時網站取代既有產品流程。

## 目前已建立
- Next.js 15 + React 19 + TypeScript + Tailwind CSS 專案
- 以 Keel 元件建立的響應式操作介面
- 多學習者切換與兩層設定介面：`/system-settings` 管理登入帳號、本人的一般角色與可存取學習者；`/settings` 管理目前學習者的個人資料與學習設定
- 練習企劃、依章節／依考試範圍、三種練習方式，以及預設收合的進階篩選；進階設定可調整難易度占比、來源、題型、知識點、建立者與本輪題數
- 專注練習版面、每題大型手寫板、畫筆／橡皮擦，以及暫時關閉／結束練習流程。`instant`／`complete` 的 private PNG 儲存、受權讀取與冪等重送程式已通過針對性測試：文字題沒有其他答案時，手寫小題保持 `pending`／`manual`；已有完整答案時，手寫圖只作為第一個小題的計算過程附件，不改變判分。`score` 不接受手寫或任何逐題作答附件。完整資料庫 E2E 仍待 `0012` 整合後驗證
- 每個主要頁面有固定網址，重新整理後維持原頁面
- 本地 AI 手寫辨識沿用 ERP 的 `OLLAMA_BASE_URL`、`OLLAMA_MODEL` 與 `OLLAMA_KEEP_ALIVE` 設定，固定核對 `qwen3.8:27b` 的 digest 與 vision capability。手寫補足的文字答案會在同一個作答交易建立 `0012` sidecar job；worker 只讀取 private PNG 並逐字辨識手寫內容，不會把題幹、參考答案、解析或評分規則送給模型，也不會解題或判斷正誤。六張合成品質圖已完成真實 Ollama inference：四張可讀筆跡有三張逐字相符，一張外形相近的「4」辨識為「A」；空白及模糊圖均保持無法辨識。真實學習者筆跡樣本與人工檢視介面仍待驗收
- 錯題複習、成果統計與檢視設定介面。錯題的「同細題型」推薦 API 與作答串接已通過針對性測試：先完整尋找同一標準細題型的候選，只有候選數為 0 才查詢經人工確認的相近題群組；沒有同題型候選也沒有已確認群組時可回傳無推薦。`score` 不允許建立逐題推薦練習。此路徑仍待 `0012` 的來源值域整合與資料庫 E2E；人工審核與新的正式相近題關聯尚未交付
- 圖片／PDF／貼上文字匯入與多題校正仍是待建功能。主導覽已移除舊的 mock 匯入入口，直接開啟 `/bank` 會轉到 `/questions`；OCR／AI 拆題與受權限的 PostgreSQL 匯入 API／介面尚未串接，測試替代結果不能視為已辨識或已保存的教材
- `/account` 已接上本機 PostgreSQL，支援電子郵件密碼註冊、登入、登出、目前帳號查詢與忘記密碼流程；密碼、session token 與一次性重設 token 都只保存雜湊。社群登入與帳號綁定仍未開放
- 註冊與密碼重設使用同一套新密碼規則：至少 8 個字元，不要求大小寫、數字或符號混用，並拒絕常見弱密碼、全空白及首尾空白。密碼重設的 challenge、API 與介面程式已完成不連網針對性測試；成功後不改動電子郵件的 `verified_at`，並撤銷該帳號的所有 session。將 challenge 固定綁定到電子郵件 identity 的資料庫契約屬於尚未整合的 `0012`，因此不得把目前的單元測試當成已通過資料庫 E2E
- 信箱驗證、密碼重設及角色 PIN 設定／重設都使用 `verification_challenges` 與一次性確認頁；token 只保存雜湊，過期、重寄失效、重播、單一有效 email identity 與申請頻率限制已有不連網測試。角色 PIN 只允許透過已驗證的電子郵件為仍有效的目標角色設定，成功後只撤銷該角色的 session。成人角色切換仍以帳號密碼重新確認，角色 PIN 尚不參與切換。ERP 的非機密 SMTP host、port 與 TLS 模式已核實，但 Lerniqa 尚未設定自己的憑證、outbox 與實際 handshake；不得讀取或複製 ERP secret 來當作完成。目前申請流程同步嘗試寄信，已知與未知帳號仍可能產生 timing enumeration，outbox／等時回應與真實寄送驗證是獨立的上線阻擋，不屬於 `0012`
- 正式主流程不再從 fixture 或 runtime JSON 還原帳號範圍資料。舊 `/api/v1/bootstrap`、`state`、`reset`、`questions`、`imports` 與 storage-key asset 端點固定回傳 HTTP `410`；`/questions` 是目前題目入口，舊 `/bank` 只會轉址到此頁。正式 PostgreSQL 匯入 API／介面尚未交付；Hanlin CLI 與隔離匯入測試不等於可操作的產品匯入流程
- 題目可保存版本、章節、單元、主題、難易度、來源，以及題幹與答案中的圖片區塊
- PostgreSQL 欄位、關聯與限制由 `0001` 至 `0011` 共十一個原生 SQL migration 建立，合計 96 張業務資料表。`0010` 加入 `users.account_role`、每帳號唯一 self learner、名稱與設定權限一致性；`0011` 加入 `practice_score_receipts`、`asset_object_cleanup_jobs` 與練習 session 的計分彙總欄位。升級會清除舊版 `score` 逐題明細，並從仍可保留的非 `score` 明細重建五張統計表
- `0012` 已整合帳號復原 identity binding、同題型來源值域、題庫補全建議及手寫 AI sidecar，並通過 migration 與隔離的作答佇列 E2E。手寫 worker 仍需由受控的本機程序啟動，不會由網站程序自動下載或替換模型
- 題庫補全命令已建立可重跑的 dry-run／checkpoint 程式與針對性測試，但目前的 279 題尚未寫入補全結果。即使 `0012` 整合後，程式也只能先建立 `pending` 建議，不會直接改寫已發布題目；只有通過品質抽檢與人工核准後才可另行 apply
- `/practice` 已從本機 PostgreSQL 載入已發布題庫並保存練習 session。`instant` 與 `complete` 保存已送出的作答、歷程、錯題佇列與 outbox；`score` 只保存 session 整體統計，以及不含答案與逐題判定的冪等收據，不寫入 `answer_attempts`、逐小題結果、錯題／相近題佇列或 `analytics_outbox`。重新整理進行中的練習時，畫面會用伺服器 session UUID 恢復可安全恢復的進度並暫停；尚未送出的文字與手寫內容不會保存
- `0011` 會把只由舊 `score` 作答引用的 private `handwriting`／`answer_attachment` asset 解除引用、標記 `deleted_at`，並建立 pending 的物件清理工作；仍被題目、文件、學習者或非 `score` 作答共用的 asset 保留。migration 不會直接刪除真實物件，只有受控 worker 實際確認刪除後，才能把工作標為 completed 並寫入 `object_deleted_at`
- 正式工作區先確認目前登入 session；未登入、cookie 無效或 session 到期時，當頁會清除帳號範圍狀態並導回 `/account`，不會改用 fixture、預設帳號或先前的瀏覽器學習者快照。登出、session 到期、角色或目前學習者改變時，其他已開分頁會同步重新驗證 `auth/me`，清除失效的帳號工作區或載入新的操作情境；頁面重新取得焦點與恢復可見時也會重新驗證
- 三種答案檢核方式都使用 PostgreSQL session。「逐題檢核」在送出後提供逐題結果；「全部作答後檢核」在整份完成前遮住結果，完成後才提供明細；「只顯示成績」進行中只確認送出，完成後只提供總題數、答對、答錯、待檢視與正確率，重新整理後仍可讀回這份整體統計，但不會保存或經由歷程、錯題佇列洩漏逐題答案內容。`/local-practice` 只保留內部診斷與相容用途
- 帳號 API 從 PostgreSQL 提供學習者年級、學期、練習偏好、已啟用科目與書籍版本；學校與 private asset 不放進練習用的公開 DTO。`/practice` 以這份 DTO 為準，不保留瀏覽器學習者快照。題庫 API 單頁最多讀取 500 題，知識點來自正式 revision 關聯
- `/system-settings` 以 PostgreSQL 讀寫帳號身分與學習者關係。`accountRole` 表示帳號主要身分，`activeRole` 表示目前 session 能使用的能力；只要仍有有效的 parent／tutor 授權，包含 `accountRole=learner` 的帳號，切到相應 `activeRole` 後都可建立、選取及管理學習者。切入受管學習者的 learner 模式後不再顯示此頁，相關帳號層 API 也回傳 `403`；只具 self learner 身分的帳號可查看自己的帳號設定，但不能新增受管學習者。`/settings` 獨立保留，供目前學習者查看或依 `can_manage_settings` 修改自己的資料
- 歷程只顯示建立練習時固定的題目版本。舊 revision 沒有可安全顯示的快照時，畫面只保留結果與時間並說明題目內容無法安全顯示，不以目前題目冒充；恢復中的 session 若發現 revision 不符，會把舊 session 標記為 `abandoned` 並要求重新建立練習。從任意題直接作答時會尋找下一道尚未送出的題目，因此直接作答最後一題也不會誤把仍有未作答題目的 session 標成完成
- 本輪也會把成果內容合併到總覽，移除獨立成果導覽；舊 `/results` 完成後只負責轉到總覽。這項導覽調整尚待實作驗證
- `localStorage` 只保存非識別性的練習 UI 設定，以及尚未切換 PostgreSQL 的計畫、排程與收藏。清除瀏覽器資料會失去這些項目，但不會刪除伺服器上的帳號、學習者、題目、練習或作答

已匯入資料不是 fixture，不得以 seed、reset、測試 cleanup 或還原初始 JSON 覆蓋。`data/fixtures` 只供隔離的合成測試；帳號、角色、學習者與已送出作答也適用持久資料保護。

## 執行
需 Node.js 20+。

```bash
npm install
npm run dev
```

開啟 http://localhost:3500。

本機 Ollama 使用與 ERP 相同的環境變數。先用合成筆跡做真實模型驗證，再由受控程序處理已排入 PostgreSQL 的工作：

```bash
npm run handwriting:smoke -- --execute
npm run handwriting:worker -- --continuous --execute
```

兩個命令若沒有 `--execute` 都只會檢查契約，不會執行模型推論或領取工作。worker 不會下載或替換模型，也不會直接改寫作答結果。

資料庫 migration 的本機隔離驗證：

```bash
npm run db:test
npm run test:import-ownership
npm run test:local-practice
npm run test:account-recovery
node --test tests/practice-catalog-integration.test.mjs
```

前三項各有獨立的 existing-local-server 模式；未明確提供該 runner 要求的四個環境變數時，會在 `/tmp` 建立一次性 PostgreSQL 環境，使用隔離合成資料，不會連線或清理 `local-data` 的持久資料庫。三組環境變數與安全限制見 `database/README.md`。`test:account-recovery` 不啟動資料庫或寄送真實郵件，檢查輸入規則、token、郵件 adapter、密碼／PIN 雜湊與 repository／route 契約。最後一項檢查既有 `/practice` 的題庫轉換、最多 500 題的分頁讀取、正式知識點關聯、session／attempt 串接、三種檢核方式及 learner-keyed 瀏覽器設定邊界。

正式本機前台依賴 repository 管理、使用 port `55432` 的 PostgreSQL。執行 migration、practice 或 import 隔離測試時，優先讓各 runner 透過自己的 explicit existing-local-server 模式借用這個 server；runner 只可建立帶本次 ownership token 的隨機測試資料庫，結束後只刪除自己建立的資料庫，不得停止前台共用的 server。

macOS 出現 `could not create shared memory segment` 時，先盤點仍在執行的 PostgreSQL cluster 及其依賴，不得為了騰出 shared-memory slot 而靜默停止其他專案服務。如果曾手動暫停 Homebrew 管理、使用 port `5432` 的 PostgreSQL，這只是一項可逆的暫時措施；恢復前要確認仍有可用 slot，並確認依賴 `5432` 的服務可安全連回。專案腳本不會自動處理其他 cluster 的停止或恢復。

要啟動可保留資料的本機 PostgreSQL：

```bash
npm run db:local:ensure
npm run dev
```

先開啟 http://localhost:3500/account 完成登入，再前往 http://localhost:3500/practice，選擇國語、國一、翰林版、第一冊與第四課。驗證帳號請使用 `.invalid` 合成信箱。資料存在不進版控的 `local-data`，停止或重開 Next.js 與 PostgreSQL 後仍會保留。

同一個 tailnet 可經 Tailscale Serve 提供的私有 HTTPS 網址進入。實際網址與轉送狀態以當機 `tailscale serve status` 為準，不要把舊 IP 或 `3500` port 直接改寫成 HTTPS。這個入口不是 production HTTPS；`/local-practice` 僅供內部診斷與相容。

正式匯入範圍只有 `05_第四課_論語選（一）子游問孝（二）譬如為山（三）三省吾身.doc`。parser v2 confirmed 批次 `2d1ff794-f6f4-5e59-baaa-8d1c767438be` 已保存 279 題，全部目前版本為 revision 2；279 筆教材單元關聯均為 `native/document`，舊的 `manual_classification/user` 為 0。來源 SHA-256 為 `c2b09d04ef9e0a32a2fbe71a8f8e930d2061fb87e78bb6bc60f694df6be8cfb2`。其餘 14 份文件尚未匯入，須先確認各自分類。

## 文件
- [產品規格](docs/PRODUCT_SPEC.md)
- [開發路線圖](docs/ROADMAP.md)
- [資料庫設計與資料字典](docs/question-database-design.md)
- [資料庫完成對照與正式切換邊界](docs/database-completion-matrix.md)
- [Migration 與回滾說明](database/README.md)
- [本機 PostgreSQL 操作與診斷](docs/local-practice-pilot.md)
- [翰林題庫匯入與排錯](docs/hanlin-import-runbook.md)

## 下一階段
先整合並驗證 `0012`，完成同題型推薦、private 手寫 PNG、帳號復原 identity binding 與題庫補全 sidecar 的資料庫 E2E。其後再補學習者就學狀態、學校與代表圖片的正式設定 API，練習偏好、考試、計畫、排程與收藏等剩餘資料域的 PostgreSQL 切換，以及相近題候選審核、正式關聯、圖片／PDF OCR、AI 類題生成與雲端報表。

公開／production HTTPS、公開登入的 rate limit、OAuth、production 資料庫角色、完整授權及剩餘瀏覽器資料域的 PostgreSQL 切換尚未完成；請勿以真實學生個資做驗證。信箱驗證已串接；密碼重設與角色 PIN 設定／重設的程式及不連網測試已完成，但 `0012` identity binding 與 DB E2E 尚未完成。SMTP outbox／等時回應、Lerniqa 憑證、handshake 與真實投遞另列為上線阻擋，不在 `0012`。開發預設只在本機驗證，當次明確要求部署到 Vercel 時才可部署。
