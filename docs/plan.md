# 多科目產品開發計畫

正式匯入的題目、帳號、角色、學習者、練習與作答紀錄屬持久資料，不得用 seed、reset、fixture 還原或測試 cleanup 覆蓋。合成 fixture 只用於明確隔離的測試資料庫；資料量少不會改變持久資料的性質。

信箱驗證、密碼重設與角色 PIN 設定／重設的 API、帳號介面與不連網測試已完成。ERP 現行 SMTP 的非機密 host、port 與 TLS 模式已核實，但 Lerniqa 尚未設定自己的憑證、outbox 與實際 SMTP handshake，不可讀取或複製 ERP secret 來當作完成。`0012` 已整合 challenge 固定綁定電子郵件 identity 的資料庫契約；SMTP outbox 不在 `0012`。目前同步寄信仍可能讓已知與未知帳號產生 timing enumeration，outbox／等時回應與真實寄送驗證是獨立的上線阻擋。成人角色切換仍使用帳號密碼重新確認，角色 PIN 尚不參與角色切換。OCR 與 AI 拆題仍未串接；本地 AI 手寫分析已接上 sidecar worker，但真實筆跡品質與人工審核介面仍待驗收。

狀態：施工中。Lerniqa 是持續開發中的多科目正式產品。`0001` 至 `0015` 共十五個 migration 已建立 PostgreSQL schema，合計 110 張業務資料表；帳號、角色、學習者基本資料，以及 `/practice` 的題庫、session、作答、歷程和錯題流程已接上本機 PostgreSQL。`/practice` 不保留瀏覽器學習者快照；瀏覽器只保存非識別性的練習 UI 設定，以及尚未切換資料庫的計畫、排程與收藏。舊 JSON API 已封閉。279 題正式題庫接入既有 `/practice` 的「國語 → 國一 → 翰林版 → 第一冊 → 第四課」；`/local-practice` 僅供內部診斷與相容，不取代首頁或多科目流程。production 帳號生命週期與完整授權仍未完成。介面改動需通過本機驗證，只有當次取得明確指示時才部署至 Vercel production。

### 本輪資料庫擴充狀態

- 階段性相關題目推薦、private 手寫 PNG、帳號復原與題庫補全的程式／針對性測試已完成。這些結果屬於靜態、單元或契約層，不表示完整產品規則與正式資料已交付。
- `0012` 已整合帳號復原 identity binding、題庫補全 pending suggestion 與手寫 AI sidecar；`0013` 建立十二年國教年級與上下學期正式目錄；`0014` 建立可審核的題目模板、可變值與正式關鍵字關聯；`0015` 補上 AI／規則關鍵字目錄的 pending 與審核證據。空庫、既有資料升級、down／up 與 schema parity 已通過。
- 推薦程式已依已確認模板、相似群組、共同正式關鍵字與共同主題逐層選題，保存方法版本與命中證據，不再把來源題型或同單元當成相同題。離線分析、pending 匯入與管理員核准／退回流程已接上；279 題尚未完成全量分析與人工核准，目前只有一題煙霧測試待審，confirmed 關聯仍為 0。`score` 禁止逐題推薦與手寫附件。
- `instant`／`complete` 的手寫圖儲存為 private PNG。缺文字答案時保持 pending／manual；已有完整答案時只作為計算過程附件，不改變判分。
- 題庫補全預設 dry-run，只能先建立 pending suggestion；279 題尚未 apply，必須先通過品質抽檢與人工核准。
- 本地 AI 手寫分析沿用 ERP 的 Ollama 環境設定，已核實固定模型 metadata、digest 與 vision capability，並完成六張合成品質圖、四張單字真實筆跡與一張註釋雙字筆跡的 inference。「寫出國字、注音」使用單一字元模式，「注釋」使用單行多字模式。作答交易只為手寫補足的文字答案建立 `0012` sidecar job；模型不得直接改判或更新錯題與統計。

## 目標與範圍

註冊與密碼重設的新密碼採至少 8 字元，不要求大小寫、數字或符號混用，並拒絕常見弱密碼、全空白及首尾空白。前後端共用新密碼驗證規則，登入保留既有密碼相容；不批次修改既有密碼。密碼重設的本機 challenge、API、介面與郵件流程已完成；重設不改動電子郵件的 `verified_at`，成功後撤銷該帳號的所有 session。

依 `docs/PRODUCT_SPEC.md` 維持可操作的多科目主應用，並把本機 PostgreSQL 能力接入既有學習者、科目與練習流程。`/account`、`/system-settings`、`/settings` 與 `/practice` 依登入 session 讀寫本機 PostgreSQL。尚未資料庫化的非識別性 UI 設定、計畫、排程與收藏才依學習者保存在瀏覽器；舊 `/api/v1/bootstrap`、`state`、`reset`、`questions`、`imports` 與 storage-key asset 路徑固定回 HTTP `410`。信箱驗證、密碼重設與角色 PIN 設定／重設使用本機 PostgreSQL challenge，實際郵件只能由設定完成的 SMTP 環境寄出；OAuth、分享權限、OCR、正式匯入、AI 手寫辨識與相近題生成不連接外部服務。介面必須清楚區分瀏覽器設定、本機 PostgreSQL 資料與未完成的外部服務，不得讓使用者誤認為已完成 production 帳號、權限或雲端保存。

主要導覽分為總覽、練習、題目、錯題、學習者設定與系統設定。`/system-settings` 集中處理登入帳號身分、有效一般角色與學習者關係；`/settings` 處理目前學習者的個人資料與學習設定。題目入口使用 `/questions`；舊 mock `/bank` 已從主導覽移除，直接開啟時轉址到 `/questions`。正式 PostgreSQL 匯入 API／介面尚未交付；成果內容合併到總覽，舊 `/results` 轉址到總覽。

## 施工就緒查核

- 需求來源：`docs/PRODUCT_SPEC.md`，介面範圍已確認採多科目產品介面。
- 既有基線：Next.js 前端、Keel 元件、多科目題庫介面、學習者切換及本機作答紀錄可用。文件保留過往 Vercel 驗收紀錄，但本輪未重新部署或驗證 production，不能據此判定目前正式網址狀態。
- 資料來源：正式主流程的帳號、角色、學習者、題庫、文件與 session 寫入 `local-data/postgres`。`instant`／`complete` 另保存已送出作答、錯題佇列與 outbox；`score` 只保存 session aggregate 與不含答案／判定的冪等收據。asset 寫入 `local-data/assets`。PostgreSQL auth DTO 提供年級、學期、預設檢核方式、已啟用科目與書籍版本；`/practice` 不保存瀏覽器學習者快照。練習畫面的非識別性 UI 設定、計畫、排程及收藏依學習者保存在瀏覽器。`data/fixtures` 與 `runtime-data` 只供隔離測試或歷史相容程式使用，不是正式主流程的備援資料來源。
- 外部依賴：PostgreSQL schema、migration、本機執行環境、電子郵件密碼 session、本機信箱驗證、密碼重設與角色 PIN challenge、本機練習 API，以及私有 tailnet HTTPS 已納入本輪；SMTP 真實投遞、公開／production HTTPS、公開登入 rate limit、OAuth、主應用後端／ORM、分享權限、託管式物件儲存、OCR、AI 與手寫辨識仍不在本輪 production 串接範圍。
- 部署條件：介面改動通過型別檢查、production build、桌面與手機操作驗證後保留在本機；只有使用者另行允許時才部署至 Vercel production。

## 架構契約

- 學習者是所有練習計畫、作答紀錄、錯題與成果的資料邊界；切換學習者後只讀取該學習者的本機資料。
- `/system-settings` 直接從 PostgreSQL 管理帳號身分、有效一般角色與可存取學習者。`accountRole` 是主要身分，`activeRole` 是目前能力；只要仍有有效的 parent／tutor 授權，即使 `accountRole=learner`，切到相應 `activeRole` 後也可建立、選取及管理學習者。切入受管 learner mode 後，帳號身分、建立、帳號層更新與選取端點回 `403`。只有 self learner 能力的帳號仍可查看自己的系統設定，但不能新增受管學習者。
- `/settings` 獨立管理 session 目前選取的學習者。成人切入受管 learner mode 後仍可進入；寫入只允許目前 learner 且有效、已接受、未撤銷的 `learner_access.can_manage_settings=true`。目前正式寫入涵蓋顯示名稱、年級、學期與各科書籍版本；就學狀態、學校、代表圖片、練習偏好與考試仍待補齊。`learner_access` 是這項關係的唯一正式資料表名稱，不另建平行表。
- 一般帳號的 `accountRole` 只表示主要身分，不會覆蓋帳號另外持有的有效一般角色；session 的 `activeRole` 與 `activeLearner` 是可切換的操作情境，能力由 `activeRole` 及其有效授權決定，`system_admin` 則是分開的管理授權。快速切換只改目前 session；本人身分設定只允許三種一般產品身分，不能建立或修改 `system_admin` 授權。
- 每個帳號只有一位名稱與帳號顯示名稱同步的 self learner；`0010` 以每帳號唯一的未撤銷 learner 關係、名稱同步與 `can_manage_settings=true` 限制交易最終狀態。
- 書籍版本依科目保存在學習者設定中。切換學習者時，題目總覽與練習從新學習者的學期及各科已保存版本重建基準篩選；未設定或不可用的版本不自動猜測，也不沿用上一位學習者的選擇。同一學習者的背景重新載入不覆寫使用者當下手動選擇。每輪預設題數屬於學習者偏好，可輸入任意正整數。複習計畫可另存本輪題數且不覆寫預設值；題庫不足時以全部可用題目建立練習。
- 考試設定可保存多筆考試名稱、日期，以及各科目的開始與結束範圍；練習題目由目前套用的考試條件篩選結果產生。
- 題目總覽、錯題英雄榜與開始練習共用同一個可展開的題目篩選元件。單元、來源、題型與難易度都可複選；同欄多值為 OR，跨欄為 AND，空陣列表示該欄不限定。開始練習不另設「篩選方式」選擇器，只額外提供本輪題數及難易度比例；啟用比例後，一般難易度條件停用，比例合計需為 100%。
- 練習方式包含「全部作答後檢核」、「逐題檢核」與「只顯示成績」。`instant` 送出後可看逐題結果；`complete` 在整份完成前遮住結果、完成後才顯示明細；`score` 進行中只確認送出，完成後保存並只顯示總題數、答對、答錯、待檢視與正確率，重載後仍可讀回整體統計。`score` 只另存不含答案／判定的冪等收據，不保存逐題作答、附件、審核、錯題／相近題佇列、來源追溯或 outbox。歷程與錯題佇列不得繞過這些揭露規則。
- 練習流程使用不含工作區側欄與摘要的專注版面；每一題皆顯示大型手寫板，桌面為左右配置，窄螢幕改為上下排列。
- 需要逐題明細的 `instant`／`complete` 會分開保存原始手寫內容與輸入答案，不提供鍵盤計算筆記；`score` 不保存逐題附件。手寫板支援畫筆、橡皮擦與清除；手寫補足文字答案時送出本地 AI sidecar，介面不產生模擬辨識結果。
- 主應用題目匯入接受圖片、PDF 與貼上文字，須完整保留 AI 拆分後的題目順序並逐題校正；科目、版本、單元、主題、難易度與來源採選填設計。單元保存教材位置，主題保存可跨版本共用的學習內容；版本、單元、主題與來源可從選單底部新增。空值由 AI 提出建議，圖片可替換、移除或移到其他題目，全部確認後才可寫入。
- 本機 PostgreSQL 整合另支援授權的舊版 Word 題庫。原始 `.doc` 含 VBA，只能隔離並標記為 `rejected`；只有在本機關閉巨集轉換並通過 VBA、Macro 與 ActiveX 檢查的 DOCX 衍生檔可作為 `clean` 來源。本輪只允許第四課原檔寫入國語／國一／翰林版／第一冊／第四課，其他 14 份文件尚未匯入。
- 舊 `/api/v1/bootstrap`、`state`、`reset`、`questions`、`imports` 與 storage-key asset 路徑固定回 HTTP `410`。正式頁面不以 fixture 或 runtime JSON 補上登入帳號、學習者、題目或答案；正式 PostgreSQL 匯入 API／介面尚未交付，Hanlin CLI 與隔離匯入測試不算產品匯入入口。
- `/practice` 從 `/api/v1/local-practice/*` 讀寫本機 PostgreSQL，`/local-practice` 只保留內部診斷與相容。題目 API 單頁最多回傳 500 題，知識點讀自正式 revision 關聯，且不回傳答案；三種答案檢核方式都建立持久 session，作答送出後由伺服器使用完整標準答案判分，需要人工／AI 輔助確認時保持待核對。`instant` 與 `complete` 以交易保存需要的作答、錯題佇列與 outbox；`score` 只保存 session aggregate 與不含答案／判定的冪等收據。
- 歷程只使用建立 session 時固定的 revision。缺少可安全顯示的舊 revision 快照時，只顯示結果、時間與題目內容無法安全顯示的提示，不拿目前題目代替。resume 發現 revision mismatch 時，把舊 session 標記為 `abandoned` 並要求建立新練習。從任意題直接作答時會尋找下一道尚未送出的題目，只有全部 item 都完成才結束 session。
- 未登入、cookie 無效或 session 到期時，當頁清除帳號範圍狀態並導回 `/account`。登出或到期時，其他已開分頁同步清除工作區；角色或目前學習者改變時，其他分頁重新載入操作情境。頁面重新取得焦點或恢復可見時也會重新驗證 `auth/me`。
- 題目內容使用有序區塊保存，題幹與答案均可包含圖片。每題同時保存版本、章節或課次、單元、主題、難易度、來源與原始題號，供未來資料庫沿用同一份 API 契約。
- 題目不得為了符合既有介面而改寫。來源文件的題型名稱另存於 `typeLabel`；書寫題不建立選項，配合題、選詞測驗與題組使用 `parts` 保存各小題與答案。
- 練習可暫時關閉，也可結束本輪；瀏覽器只保存伺服器 session UUID。重新整理後從資料庫恢復可安全恢復的進度並先暫停；revision 不一致時把舊 session 標記為 `abandoned` 並要求建立新練習。尚未送出的文字答案與手寫內容不保存。
- 從題目總覽的單題詳情開始練習時，前端 session 保存該題的返回目標。暫時關閉、尚未作答即結束，或從結果離開時回到原本的 `/questions/{questionId}`。其他入口仍依 session 來源返回練習設定或錯題清單。
- 錯題保存原題關聯與相近題統計。只有已確認的正式相近題關聯可供立即練習或加入後續練習；隔離測試中的固定關係不能當成已交付的正式關聯。
- 所有可操作控制以 Keel 元件為基底。手寫畫布由瀏覽器 Canvas 提供，畫筆、橡皮擦、清除與保存操作仍使用 Keel Button；多行文字輸入沿用 Keel token（設計變數）與表單外觀。
- 總覽、練習設定、題目總覽、錯題、系統設定，以及登入、註冊、登出確認、忘記密碼、快速註冊與帳號綁定各自使用固定路徑；題目總覽使用 `/questions`，舊 `/bank` 轉址到此頁。正式匯入功能交付時需另行定義受權限路徑。成果內容由總覽承接，舊 `/results` 轉址到總覽；瀏覽器重新整理與上一頁／下一頁需維持路徑對應的畫面。

## 本輪未部署調整（2026-10-14）

- 練習偏好可用逗號設定常用題數，並從清單選擇預設值；練習頁沿用同一份清單，也保留單次輸入其他正整數的能力。
- 練習企劃可依章節或考試選擇題目，題目條件與題目總覽、錯題英雄榜共用一套查詢邏輯。收藏清單、一般難易度及來源專屬欄位會直接影響可用題目；啟用難易度比例時，系統依基礎、中等、進階的比例產生本輪題目。
- 新增只顯示成績模式，結果頁不揭露個別答案與解析。
- 手寫板新增橡皮擦並縮減說明區；結果有手寫內容時改為題目與手寫左右排列。
- 題目匯入新增文字貼上，以及圖片與題目的預覽、替換、移除及重新指派。
- 當時新增六個帳號流程網址與前端操作介面；目前 `/login` 與 `/register` 的主要動作已導向 `/account`，由本機 PostgreSQL 實際處理電子郵件密碼註冊與登入。本機信箱驗證、忘記密碼與角色 PIN 設定／重設的 challenge、寄送／確認 API 與介面已完成，SMTP 真實投遞仍待設定；OAuth 及其餘帳號綁定流程尚未串接。
- 本機驗證：`npm run lint`、`npm run build`、`git diff --check` 均通過；build 只有 Keel 文件預覽器既有的選用套件警告。
- 瀏覽器驗證：六個帳號網址可直接開啟；已完成題數控制、只顯示成績、多題文字匯入、圖片配對、手寫橡皮擦及結果右側手寫操作。登入頁與題庫頁在 390 × 844 無水平溢出，Console 沒有應用程式錯誤。
- 練習設定驗證：`/practice` 重新整理後會回到練習頁；進行中的持久 session 則恢復已送出進度並暫停，不恢復尚未送出的文字與手寫。預設與進階設定分層正常，來源篩選會同步更新可用題數，390 × 844 沒有水平溢出，Console 沒有應用程式錯誤。
- 題目匯入驗證：科目選為數學後會帶入學習者的康軒版本；版本、單元、主題與來源選單的最後一項可切換到新增模式，新增的單元與主題會保留在該題校正資料中。390 × 844 沒有水平溢出，Console 沒有應用程式錯誤。
- 狀態：本機調整及驗證完成；依使用者指示暫不上傳 Vercel，等待另行授權。

## JSON API 歷史實作（2026-10-14，已封閉）

- 歷史實作建立隔離測試用的合成 fixture 與可寫入 runtime JSON。正式 `/practice` 的題庫與作答，以及帳號、角色與學習者基本資料，現在以 PostgreSQL 為權威來源；頁面不保留學習者快照。只有非識別性 UI 設定、計畫、排程及收藏以 learner ID 分區保存在瀏覽器。
- 歷史實作曾提供啟動資料、狀態寫入、題庫查詢、題目匯入、圖片讀取與資料重設 API。這些 `/bootstrap`、`state`、`questions`、`imports`、storage-key asset 與 `reset` 路徑現在固定回 HTTP `410`，不得作用於持久題庫、帳號、角色、學習者與練習紀錄。
- 題目加入版本、章節、單元、主題、來源明細及有序內容區塊。題幹與答案圖片分開保存，畫面依所在區域顯示。
- 歷史匯入曾新增 runtime JSON 題目與匯入批次；正式 UI 現已停用，不再提供這條寫入路徑。OCR、AI 拆題與 PostgreSQL 正式匯入仍待完成。
- 階段驗證：`npm run lint`、`git diff --check` 通過；API 已驗證狀態寫入、題目寫入、條件查詢、圖片回傳與重設。瀏覽器已完成貼上文字、產生四題校正資料與寫入 JSON 的流程。
- 歷史狀態：此 JSON 功能曾部署至 Vercel，暫存 JSON 不具跨執行個體持久性，不代表目前 production 持久服務已完成。

## 本機 PostgreSQL 操作與診斷（2026-10-16）

- `npm run db:local:ensure` 在 `local-data/postgres` 維護可保留資料的 cluster，只開啟權限為 `0700` 的私有 Unix socket，不監聽 TCP，也不建立新密碼或長期憑證。migration 只向前執行，版本記錄不是 repository manifest 的完整前綴時會停止。
- `0006_source_documents_word` 讓 `source_documents.input_type` 接受 `document`。含 VBA 的原始 `.doc` 保留為隔離且拒絕的 asset，不被 `source_documents` 引用；只有在本機關閉巨集轉換、並通過 VBA、Macro 與 ActiveX 檢查的 DOCX 衍生檔可標記為 `clean`。
- `0007_practice_answer_integrity` 在交易結束前檢查選擇類題目的答案鍵值與同一小題選項一致，並要求 ready 的 document 來源只引用 private、clean、未刪除且 MIME 為 DOCX 的 asset。
- `0008_auth_and_import_integrity` 要求有效 session 指定的學習者保持啟用，封存學習者時需在同一交易撤銷相關 session，並依帳號後學習者的順序取得 transaction advisory lock。這個 migration 也只把指定 confirmed Hanlin 批次的教材關聯修正為 `native/document`，不改寫其他批次或人工分類。
- `0009_automatic_answer_completeness` 要求 published／superseded 的自動判分小題有可用參考答案：選擇類題目需有同一小題的有效答案鍵，文字題需有非空白可接受答案；人工與 AI 輔助檢視可無答案。升級前發現既有缺漏會停止，不補造資料，down 只移除新限制。
- `0010_account_role_and_self_learner` 加入 `users.account_role`，限制有效登入身份必須有相符的一般角色授權，並要求 learner 帳號具有有效 self learner。`learner_access` 原有 `(learner_id, user_id, access_role)` 未撤銷關係唯一性之外，另加每帳號唯一未撤銷 self learner 索引，並強制名稱同步與 `can_manage_settings=true`。既有 self 名稱與建立者持有的設定權限修正只向前；down 不猜測舊值。
- `0011_score_session_aggregates` 為 `practice_sessions` 加入五個計分彙總欄位，並新增 `practice_score_receipts` 與 `asset_object_cleanup_jobs`。升級會由既有 `score` 明細回填 aggregate 與收據，再清除該模式的 attempt、part result、附件關聯、審核、錯題／相近題佇列、來源追溯與 outbox；五張統計表只從剩餘 `instant` 與已完成 `complete` 明細重建。只由舊 `score` 作答引用的 private 手寫／一般答案 asset 會標記刪除並排入 pending 工作，共用 asset 保留。down 只移除 `0011` schema，不能重建逐題資料，也不反向取消 asset 的邏輯刪除；實際 storage 物件尚待受控 worker 確認刪除。
- 本輪只允許匯入 `05_第四課_論語選（一）子游問孝（二）譬如為山（三）三省吾身.doc`，使用「國語／國一／翰林版／第一冊／第四課（舊來源科目別名：國文）」作為正式教材分類，並保留原始檔名、雜湊、原始課次／單元與來源 metadata。parser v2 confirmed 批次 `2d1ff794-f6f4-5e59-baaa-8d1c767438be` 已正式寫入並發布 279 題，失敗與待核對均為 0；279 題的目前版本均為 revision 2，相同輸入重跑會重用既有批次。其餘 14 份文件尚未匯入。
- `/account` 以電子郵件與密碼建立或登入合成帳號。密碼使用 scrypt 雜湊；瀏覽器持有 HttpOnly session cookie，資料庫只保存不透明 token 的 SHA-256 雜湊。auth 公開 DTO 提供練習所需的年級、學期、偏好、已啟用科目與版本，不包含學校或 private asset。`/practice` 從 session 取得學習者，先檢查 `learner_access` 與 `question_bank_learners`；`questions` API 只回傳題幹、小題、選項與正式知識點，`sessions` 固定題目版本，`attempts` 由伺服器判分。`instant`／`complete` 以單一交易保存作答明細、允許的錯題佇列與 `analytics_outbox`；`score` 只保存 aggregate 與不含答案／判定的冪等收據。
- `/system-settings` 已把帳號身分與學習者關係接上 PostgreSQL，`/settings` 則獨立管理目前學習者。角色 PIN 設定／重設要求單一有效且已驗證的電子郵件與仍有效的目標角色，成功後只撤銷該目標角色的 session。角色 API 僅切換目前 session 至已授予角色，不是 `system_admin` 授權 API；成人角色切換仍以帳號密碼重新確認，角色 PIN 尚不參與切換。
- 只有判分政策為自動判分，且標準答案完整的小題可以判為對或錯。未作答、缺少標準答案或需要人工／AI 輔助確認的小題保持 `pending`，不產生模擬答案。
- 未驗證電子郵件可在 localhost 或同一 tailnet 的私有 HTTPS 入口使用，驗證帳號與自動化測試只使用隔離合成資料，不得因此清除已保存的資料。本機信箱驗證、密碼重設及角色 PIN 設定／重設的 challenge、API 與介面已完成；SMTP 真實投遞、公開／production HTTPS、公開登入 rate limit、OAuth、跨帳號分享、RLS、production GRANT、正式角色授權、託管式物件儲存與真實兒童資料保存政策尚未完成。本輪不連接 production 資料庫、不執行 production migration、不部署到 Vercel。
- 完整啟動、匯入與重啟後持久性驗收步驟見 `docs/local-practice-pilot.md`。
- `npm run db:test`、`npm run test:import-ownership` 與 `npm run test:local-practice` 預設在 `/tmp` 建立短命 cluster，也各自提供明確 opt-in 的 existing-local-server 模式。這些模式會核對本機 Unix socket、port、實際 data directory、目前作業系統使用者及 non-recovery 狀態，只建立具隨機名稱與本次 ownership comment 的隔離資料庫，清理前再次核對後只刪除該資料庫，不停止共用 server。兩種模式都不碰 `local-data`，也不得指向 production。

## 國文原始題型 fixture（2026-10-14）

- `01_第一課_夏夜.doc` 取八種原始題型各一題：寫出國字、注音、改錯題、填充題、配合題、單一選擇題、選詞測驗與題組。
- 題幹、選項、答案、解析、原始題號、難易度、來源、版本、章節與單元均寫入 fixture。書寫題沒有選項；配合題、選詞測驗與題組逐小題保存及作答。
- `npm test`、`npm run lint`、`git diff --check` 與 `npm run build` 通過。當時部署中的 mock API 回傳八種題型，書寫題的選項數為 0；mock 介面已驗證第 1 題書寫流程及第 5 題五小題配合題，桌面與 390 × 844 手機寬度均可操作。
- 當時紀錄曾以 Vercel deployment `dpl_EzyuewPNWD9TixjZYusD6MvwYuCM` 驗證 mock 介面；本輪未重新驗證，這筆歷史紀錄不代表目前 production 狀態。
- Vercel 的模擬狀態寫入暫存目錄後不再回報唯讀錯誤，但不同 serverless 執行個體不共享暫存資料，重新整理可能讀回 fixture。正式持久保存仍需資料庫。

## 任務

### 規劃正式題目資料庫

- 角色：架構師。
- 輸入：`docs/PRODUCT_SPEC.md`、`docs/system-admin-plan.md`、歷史 JSON 契約與目前 PostgreSQL API。
- 產出：`docs/question-database-design.md`，涵蓋題目身份與版本、標準題型、內容、答案、分類、來源、題庫、相近題群組、逐次作答、日期彙總、錯題排行、搬移規則及施工順序；`docs/database-completion-matrix.md` 對照需求、資料表、正式 API／表單、完成狀態與安全切換邊界。
- 完成條件：目前八種題型、音訊與動態欄位都有單一搬移來源；題目可跨版本歸入多個教材單元，正式課綱代碼與平台知識點分開保存；歷史作答固定引用題目版本且每次送出不可覆寫；每題作答及答錯次數可依學習者與日期查詢；相近題群組與相同題型分開建模；統計及排行榜可由明細重建；未來多帳號共享、家教題庫、OCR、AI 類題與手寫答案不需另建平行題目模型。排序、拖曳配對、圖片熱區、繪圖、錄音作答及通用版面系統不列入首版，需在產品確認後另以 migration 擴充。
- 驗證：對照目前 TypeScript 型別、匯入 API、題庫查詢及管理員權限規劃；執行 `git diff --check`。
- 實作結果：`0001` 至 `0015` 已以原生 SQL 完成，合計 110 張業務資料表。日後選定 ORM 或查詢層時，必須映射既有 schema，不得另建一套平行資料模型。
- 回滾點：刪除本規劃與本任務段落，不修改既有 JSON、API 或介面。
- 狀態：已確認；十五個 migration 已依本文件施工。`/practice` 的題庫、session、作答、歷程與錯題流程已接上本機 PostgreSQL；計畫、排程與收藏尚未切換

### 建立身份與目錄 migration

- 角色：後端工程師、架構師。
- 輸入：`docs/question-database-design.md` 的身份與目錄欄位、限制、索引及施工順序。
- 產出：`0001_identity_and_catalog` 前進與回滾 migration，以及不接觸既有資料庫的本機驗證腳本。
- 完成條件：帳號、身份、角色、學習者、分享權限、檔案及基礎目錄具有已核准欄位、外鍵、值域、唯一限制與必要索引；跨階段欄位不建立無效外鍵。
- 驗證：在獨立暫存 PostgreSQL 資料庫執行前進、限制案例、回滾及再次前進；執行 `git diff --check`。
- 依賴：本機 PostgreSQL；後端與 ORM 尚未選定，不影響原生 SQL migration。
- 確認節點：進入題目核心 migration 前，核對第一階段 schema 與後端技術選型。
- 回滾點：`0001_identity_and_catalog.down.sql` 僅供一次性的空白或合成資料庫驗證。正式資料庫一旦承載耐久資料，不執行 down；改以新的 forward migration 修正 schema，並依已演練的營運復原程序處理失敗。fixture、JSON API 與介面不受此 migration 影響。
- 狀態：已驗證；`npm run db:test` 已通過前進、限制案例、回滾與再次前進

### 建立題目核心 migration

- 角色：後端工程師、架構師。
- 輸入：已驗證的身份與目錄 schema，以及題目身份、版本、小題、內容、答案、分類和來源專屬欄位設計。
- 產出：`0002_question_core` 前進與回滾 migration，以及題目核心資料完整性測試。
- 完成條件：題目目前版本必須屬於同一題且已發布；題目科目只能使用末層科目；教材版本與科目、考試級別與來源體系、選項與小題、來源欄位與選項都不能交叉誤連；首版作答方式與判分政策使用核准值域。
- 驗證：在獨立暫存 PostgreSQL 資料庫依序執行 `0001`、`0002`、限制案例、反向回滾及再次前進；執行 `git diff --check`。
- 依賴：`0001_identity_and_catalog`；文件內題號等來源文件建立後再補齊，不保留無外鍵欄位。
- 確認節點：進入匯入與收藏 migration 前，核對來源文件、匯入批次及現有 fixture 搬移邊界。
- 回滾點：`0002_question_core.down.sql` 僅供一次性的空白或合成資料庫驗證，執行後保留身份與目錄 schema。正式資料庫一旦承載耐久資料，不執行 down；改以新的 forward migration 修正 schema，並依已演練的營運復原程序處理失敗。fixture、JSON API 與介面不受此 migration 影響。
- 狀態：已驗證；`npm run db:test` 已通過兩階段 migration 往返與題目核心限制案例

### 建立匯入與收藏 migration

- 角色：後端工程師、架構師。
- 輸入：前三階段 schema 規劃、目前 JSON 匯入批次契約與收藏資料契約。
- 產出：`0003_import_and_collections` 前進與回滾 migration，以及匯入、來源追溯和收藏資料完整性測試。
- 完成條件：來源文件輸入型別與檔案用途一致；分類候選每列最多一個正式對照且無對照時不能核准；匯入冪等鍵、文件順序和題目順序不重複；匯入項目只能引用同批次文件；正式來源追溯可回到相同文件與題目版本；文件題號與有效收藏名稱不重複。
- 驗證：在獨立暫存 PostgreSQL 資料庫依序執行 `0001` 至 `0003`、限制案例、反向回滾及再次前進；執行 `git diff --check`。
- 依賴：`0001_identity_and_catalog`、`0002_question_core`；正式物件儲存尚未串接，測試只驗證檔案中繼資料與引用用途。
- 確認節點：進入練習與作答 migration 前，核對考試、計畫、排程、作答及手寫附件的交易邊界。
- 回滾點：`0003_import_and_collections.down.sql` 僅供一次性的空白或合成資料庫驗證，執行後刪除本階段來源、匯入、文件題號及收藏 schema，並保留身份、目錄與題目核心 schema。正式資料庫一旦承載耐久資料，不執行 down；改以新的 forward migration 修正 schema，並依已演練的營運復原程序處理失敗。
- 狀態：已驗證；`npm run db:test` 已通過三階段 migration 往返與匯入、來源、收藏限制案例

### 建立練習與作答 migration

- 角色：後端工程師、架構師。
- 輸入：已驗證的身份、目錄、題目、匯入與收藏 schema，以及考試、計畫、排程、作答、手寫與錯題追溯設計。
- 產出：`0004_practice_and_attempts` 前進與回滾 migration，以及練習與作答資料完整性測試。
- 完成條件：考試、計畫與排程依學習者隔離；考試起訖單元屬於相同科目、版本與教材樹；固定題目保留題目版本與小題；排程只建立一個練習工作階段；逐次作答不可覆寫且使用統一判分來源值域；手寫檔案、錯題來源及後續練習不可跨學習者誤連。
- 驗證：在獨立暫存 PostgreSQL 資料庫依序執行 `0001` 至 `0004`、限制案例、反向回滾及再次前進；執行 `git diff --check`。
- 依賴：`0001_identity_and_catalog` 至 `0003_import_and_collections`；相近題群組外鍵延至群組資料表建立時加入，不保留無外鍵欄位。
- 確認節點：進入相近題與統計 migration 前，核對候選、正式群組、錯題統計、日期彙總及隱私政策的重建邊界。
- 回滾點：`0004_practice_and_attempts.down.sql` 僅供一次性的空白或合成資料庫驗證，執行後刪除本階段練習與作答 schema，並保留身份、目錄、題目、匯入與收藏 schema。正式資料庫一旦承載耐久資料，不執行 down；改以新的 forward migration 修正 schema，並依已演練的營運復原程序處理失敗。
- 狀態：已驗證；`npm run db:test` 已通過四階段 migration 往返與練習、作答、手寫及錯題追溯限制案例

### 建立相近題、統計、稽核與刪除 migration

- 角色：後端工程師、架構師、安全審查員。
- 輸入：前四階段 schema、相近題核准流程、作答明細、統計重建規則、隱私政策與資料刪除邊界。
- 產出：`0005_similarity_analytics_and_audit` 前進與回滾 migration、14 張業務資料表、相近題來源補強、目錄所有權修補與資料完整性測試。
- 完成條件：相似分數只建立候選，人工核准後才成為正式群組；後續練習與 session 來源可指向已確認群組；學習者、題目及每日統計可從作答明細重建；社群榜沒有有效隱私政策時保持關閉；管理員異動與資料刪除要求可追溯。`curriculum_units` 與 `source_categories` 能區分系統及帳號自訂資料；一般作答附件使用 `assets.purpose=answer_attachment`，且所有作答附件都必須為 private、掃描通過並未刪除。auth session 與權限異動共用每位使用者的 transaction advisory lock；`system_admin` 角色沿革與管理員稽核不可覆寫，授予或撤銷角色時須在同一交易留下相符稽核。種子版本依受限狀態流程推進，已套用及已取代的證據不可改寫。已有作答的練習來源不可改換，作答引用的檔案證據欄位不可覆寫。資料刪除要求須遵守目標身份、狀態推進與完成稽核限制；系統題目版本狀態異動須在同一交易留下審查與管理員稽核，兩者的操作者與前後狀態必須相符。
- 驗證：在一次性的本機 PostgreSQL cluster 依序執行 `0001` 至 `0005`、各階段限制案例、逐階段反向回滾、再次前進及 schema parity；執行 `git diff --check`。
- 依賴：`0001_identity_and_catalog` 至 `0004_practice_and_attempts`；統計 worker、正式登入與資料保存政策不屬於 migration 本身。
- 回滾點：只有 `0005` 尚未承載正式相近題審核、政策、稽核、刪除要求或其他耐久資料時，才能執行 down migration 還原前四階段 schema；腳本遇到這些資料會拒絕破壞性回滾。正式使用後應停用新功能並只清除可重建彙總，保留原始作答與耐久紀錄。
- 狀態：已驗證；`npm run db:test` 已通過五階段兩次前進與限制測試、逐階段反向回滾、migration 紀錄／資料表／schema 回復及最終 schema parity 比對

### 支援 Word 來源文件 migration

- 角色：後端工程師、安全審查員。
- 輸入：既有 `source_documents` 契約、授權的舊版 Word 題庫與本機檔案安全邊界。
- 產出：`0006_source_documents_word` 前進與回滾 migration，以及 Word 來源文件限制測試。
- 完成條件：`source_documents.input_type=document` 必須引用 asset 且不可同時儲存貼上文字；已有 document 資料時 down migration 必須拒絕刪除支援。含 VBA 的原檔不可標記為 `clean`，只有通過本機轉換與安全檢查的 DOCX 衍生檔可作為來源。
- 驗證：在一次性本機 PostgreSQL cluster 中依序套用 `0001` 至 `0006`，執行限制案例、逐階段回滾、再次前進與 schema parity 比對。
- 回滾點：只有資料庫內沒有 `document` 來源時才能回復舊值域；持久資料庫使用新的向前 migration 修正，不直接執行 down。
- 狀態：已驗證；`npm run db:test` 已通過 `0001` 至 `0006` 的兩次前進、限制測試、逐階段反向回滾與最終 schema parity 比對

### 補強答案與 ready 文件完整性

- 角色：後端工程師、安全審查員。
- 輸入：`0001` 至 `0006` schema、本機練習 grader 與匯入後的 DOCX 安全邊界。
- 產出：`0007_practice_answer_integrity` 前進與回滾 migration、完整性測試，以及 grader 的 option allowlist 防線。
- 完成條件：單選、複選與是非題的答案鍵值只能引用同一小題現存選項；同一交易可先寫答案再寫選項，但交易結束時不能留下無法選取的標準答案。ready 的 document 來源只能引用 private、clean、未刪除且 MIME 為 DOCX 的 asset；被引用後也不能把 asset 改成不相容狀態。若資料庫仍出現不完整選擇題答案，grader 必須回傳 `pending`，不可誤判成錯題。
- 驗證：在一次性本機 PostgreSQL cluster 中依序套用 `0001` 至 `0007`，執行既有資料升級拒絕、交易內建立順序、反向回滾、再次前進與 schema parity 比對；另執行型別檢查和 grader 針對性案例。
- 回滾點：down migration 只移除 `0007` 新增的 final-state trigger 與函式，不修改題目、答案、選項、來源文件或 asset 資料。正式資料庫仍以新的向前 migration 修正，不直接執行 down。
- 狀態：已驗證；`npm run db:test` 已通過七組 migration 的兩次前進、限制測試、逐階段反向回滾與 schema parity，`npm run lint` 與本機練習 verifier 語法檢查也已通過

### 補強 session 與匯入所有權完整性

- 角色：後端工程師、安全審查員。
- 輸入：`0001` 至 `0007` schema、本機 session 查詢及 Hanlin confirmed 批次。
- 產出：`0008_auth_and_import_integrity` 前進與回滾 migration、限制測試、匯入 ownership 隔離測試及本機練習隔離驗收。
- 完成條件：有效 session 指定的學習者必須保持啟用；封存學習者時須在同一交易撤銷相關有效 session；應用角色與 `learner_access.access_role` 不做錯誤的字面相等判斷；帳號及學習者異動依固定順序取得鎖。指定 confirmed Hanlin 批次的教材單元關聯改為 `native/document`，其他批次與人工分類不受影響；匯入器不得建立固定合成帳號、角色、學習者或偏好。
- 驗證：`npm run db:test` 驗證 migration 前進、限制、回滾與再次前進；`npm run test:import-ownership` 與 `npm run test:local-practice` 在 `/tmp` 私有 PostgreSQL cluster 使用合成資料，不接觸 `local-data`。
- 回滾點：持久資料庫不執行 down；若 session 前置檢查失敗，先找出並撤銷指向封存學習者的有效 session，再重新執行向前 migration。`0008` down 只移除 schema 物件，不把 `native/document` 反向改回舊分類。
- 狀態：已驗證；八組 migration 往返、import ownership 與 279 題隔離練習／重啟驗證均已通過。

### 補強自動判分答案完整性

- 角色：後端工程師、安全審查員。
- 輸入：`0001` 至 `0008` schema，以及 published／superseded 題目版本的既有小題、選項與參考答案。
- 產出：`0009_automatic_answer_completeness` 前進與回滾 migration，以及答案完整性限制測試。
- 完成條件：published／superseded 的 `automatic` 選擇類小題至少有一個同小題有效選項鍵，`automatic` 文字題至少有一個非空白 `accepted_value`；`manual_review` 與 `ai_assisted_review` 可無參考答案。既有資料不合規時，升級直接停止，不猜測或補造答案。
- 驗證：在一次性 PostgreSQL cluster 驗證既有資料 preflight、可延後的交易最終狀態、選項／答案刪改拒絕、manual／AI 例外、down 只移除新增物件，以及 `0001` 至 `0009` 再次前進與 schema parity。
- 回滾點：down 只移除 `0009` 的 trigger、函式與 migration 紀錄，不修改題目、選項或答案資料；持久資料庫仍以向前修正為原則。
- 狀態：已驗證；完整 `db:test` 已涵蓋 `0009` preflight、子資料異動併發、逐層 down、第二次 up 與 schema parity。

### 補強帳號本人角色與 self learner 完整性

- 角色：後端工程師、安全審查員。
- 輸入：`0001` 至 `0009` schema、目前 auth session 與學習者設定契約。
- 產出：`0010_account_role_and_self_learner` 前進與回滾 migration，以及帳號角色、self learner 與併發完整性測試。
- 完成條件：有效登入身份必須有 `parent`、`tutor` 或 `learner` 本人角色與相符有效授權；learner 本人角色必須具有一位已接受、未撤銷且啟用中的 self learner。每個帳號至多一筆未撤銷的 self learner 關係，名稱與帳號同步且可管理自己的設定。舊資料無法確定時停止，不猜測身分。
- 驗證：完整 `db:test` 已涵蓋 deterministic backfill、learner-role-only preflight、archived learner race、`account_role` 與 grant 撤銷的雙連線競爭、self access 與 learner rename 的雙連線競爭、逐層 down、第二次 up 與 schema parity。
- 回滾點：down 移除 `0010` 的欄位、索引、trigger、函式與 migration 紀錄；名稱與權限修正無法與後續合法修改區分，因此保持只向前，不反向猜測舊值。
- 狀態：已驗證。

### 補強計分模式資料隱私

- 角色：後端工程師、安全審查員。
- 輸入：`0001` 至 `0010` schema、三種檢核模式的既有作答、統計與附件引用。
- 產出：`0011_score_session_aggregates` 前進與回滾 migration、`practice_score_receipts`、`asset_object_cleanup_jobs`、session 計分彙總欄位及完整性測試。
- 完成條件：`score` 只留下 session aggregate 與不含答案／逐題判定的冪等收據；舊明細、衍生佇列與 outbox 清除。五張統計表從合格的非 `score` 明細重建。只屬於舊 `score` 的 private 作答 asset 解除引用、標記刪除並排入 pending 工作，共用 asset 保留；外部物件未經實際確認不得標記完成。
- 驗證：完整 `db:test` 涵蓋舊資料回填與隱私清理、統計確定性重建、exclusive／shared asset 分流、清理工作狀態、aggregate／receipt 完整性、逐層 down、第二次 up 與 schema parity。
- 回滾點：down 移除 `0011` schema 與 migration 產生的資產清理稽核，但不虛構已刪除的 `score` 明細，也不取消已排程資產的邏輯刪除。這只供可丟棄的隔離資料庫做 schema 往返；有 pending 物件工作的環境必須先完成或受控移交工作、另留操作稽核，不得用 DDL down 當營運回滾。
- 狀態：資料庫隱私清理與排程已驗證；真實 storage 物件沒有在 migration 中刪除，受控清理 worker 仍待交付。

### 串接正式後端與安全切換 PostgreSQL

- 角色：後端工程師、安全審查員、驗收員。
- 輸入：`0001` 至 `0015` PostgreSQL schema、已封閉的歷史 JSON 契約、本機 session 與資料隔離驗證結果、production 登入與權限政策、物件儲存及資料保存期限。
- 產出：正式 repository 與交易服務、依資源拆分的 `/api/v1`、可重跑的 JSON 搬移工具，以及 PostgreSQL 單一寫入來源的切換程序。
- 完成條件：伺服器從可信 session 決定帳號、角色與學習者權限；題目查詢、匯入、考試、計畫、作答、審核、附件與統計均讀寫 PostgreSQL；搬移工具輸出舊 ID 對新 UUID、筆數、雜湊、衝突與隔離報告；JSON 與 PostgreSQL 不同時接受寫入。
- 驗證：空庫與既有資料升級、正式 API 授權和表單讀寫、跨帳號拒絕、併發衝突、附件權限、作答不可變性、型別檢查、lint、build 及桌面／手機核心流程。
- 依賴：production 後端與 PostgreSQL、ORM／查詢層、驗證信服務、遠端 HTTPS 與 rate limit、物件儲存、Secret Manager 與資料保存／刪除政策都須先決定；保存政策未核准前不得搬入真實兒童資料。
- 回滾點：依功能維持目前單一權威來源，已匯入題庫與持久練習以 PostgreSQL 為準；切換窗口失敗時停止新寫入並依已演練程序回到前一個單一來源，不啟用無一致性保證的雙寫。
- 狀態：部分完成。`/account`、`/system-settings`、`/settings` 與 `/practice` 已完成本機 session、一般角色、學習者及作答隔離；登入失效不回退 fixture，舊 JSON HTTP 端點固定回 `410`。目前學習者已完成顯示名稱、年級、學期與各科書籍版本的正式寫入；其他學習者欄位、偏好、考試、計畫、排程、收藏、正式匯入、`practice_session_item_origins` 完整來源及相近題審核／查詢仍待施工

### 建立資料契約與主要導覽

- 角色：架構師、前端工程師
- 輸入：產品規格與既有首頁。
- 產出：五個主要工作區、考試設定／練習方式資料模型，以及可由舊版本機資料安全載入的新狀態格式。
- 完成條件：切換學習者與工作區不混入其他學習者資料；導覽在桌面與手機可操作。
- 驗證：型別檢查、學習者切換及各工作區空白／有資料狀態。
- 回滾點：保留現有首頁與 `v2` 本機資料格式。
- 狀態：已驗證

### 完成考試設定與三種練習方式

- 角色：前端工程師
- 輸入：新的資料契約與隔離合成題庫。
- 產出：可新增多筆的考試設定、全部作答後檢核、逐題檢核、只顯示成績、完成結果及相近題入口。
- 完成條件：三種方式產生符合文件的回饋與答案揭露時機；只顯示成績不揭露或保存個別答案內容，只保存 session aggregate 與不含答案／判定的冪等收據，重載後仍可讀回範圍、題數與摘要。
- 驗證：三種方式各完成一輪練習，核對作答順序、回饋、答案揭露、結果與錯題。
- 回滾點：只撤回新檢核模式，保留原有逐題練習。
- 狀態：已驗證

### 完成手寫與答案檢視介面，停用舊匯入寫入

- 角色：前端工程師
- 輸入：題目資料與作答流程。
- 產出：數學／書寫題手寫板、停用狀態的題目校正入口、檢視者身份與答案比對顯示設定。
- 完成條件：`instant`／`complete` 的手寫內容跟隨作答保存並可在成果中重現，`score` 不保存逐題附件；舊 JSON 匯入不再可提交，正式匯入 API、OCR 與 AI 拆題完成前維持停用；成果頁不聲稱能保存人工判定。
- 驗證：手寫、清除、儲存、切換檢視者、顯示／隱藏參考答案與檔案限制。
- 回滾點：撤回手寫與校正區塊，不修改既有題目及作答紀錄。
- 狀態：已驗證

### 完成錯題、相近題與學習成果

- 角色：前端工程師
- 輸入：作答紀錄與隔離測試中的固定相近關係。
- 產出：錯題勾選、相近題累計結果、立即練習／加入後續練習，以及考前總覽與成果頁。
- 完成條件：資料依學習者隔離；相近題可追溯原始錯題；總覽顯示考試倒數、弱點、科目頁籤、所選科目的各單元題庫作答進度與最近練習。桌面版的「目前弱點」與「最近練習」置於右側摘要欄，手機版置於可展開的「練習摘要」面板。單元進度使用目前學習者可用題庫及每題最新一次作答，沒有可用題目時顯示空白狀態。
- 驗證：建立錯題、加入相近題、切換學習者及科目頁籤、檢查各科單元題庫進度與成果統計，並確認桌面與手機寬度的頁籤、進度列和空白狀態。
- 回滾點：撤回新工作區，保留一般練習紀錄。
- 狀態：推薦查詢、來源證據、pending 關係分析與管理員審核介面已交付；279 題仍待全量分析與人工核准，目前 confirmed 關聯為 0

### 審查、優化、安全與驗收

- 角色：審查員、優化師、安全審查員、驗收員
- 輸入：凍結後的 production code 與本計畫。
- 產出：介面品質檢查、資料隔離與檔案輸入安全檢查及核心流程驗收證據；只有使用者在當次明確要求時才執行 Vercel production 部署。
- 完成條件：沒有已知阻擋問題；桌面與手機均能完成核心流程。若當次要求部署，正式網址還需回傳成功狀態。
- 驗證：型別檢查、production build、`git diff --check` 及瀏覽器操作；只有當次要求部署時才驗證 HTTP 狀態與 production 實際畫面。
- 回滾點：撤回本輪多科目產品介面變更，回到既有首頁。
- 狀態：已驗證

## 歷史介面驗收紀錄（2026-10-14）

以下內容只保存當時介面調整的驗收脈絡，不是本輪分支的部署證據。這些紀錄中的 Vercel 狀態未在本輪重驗；目前改動仍只在本機，除非使用者當次明確要求，否則不得據此部署或宣稱 production 已更新。

- `npm run lint`：通過。
- `npm run build`：通過；Keel 文件預覽器的選用套件缺少警告不影響本頁功能。
- `git diff --check`：通過。
- 當時的正式環境紀錄：桌面與 390 × 844 手機寬度均完成操作驗證。
- 當時核心流程：學習者切換、年級自動帶入、考試設定、三種練習方式、逐題回饋、手寫板、錯題、隔離測試中的固定相近關係、舊 mock 匯入校正及成果檢視設定均可操作。這筆歷史驗收不代表目前已有正式匯入 API／介面。
- 當時紀錄的 Vercel production 回應為 HTTP 200；本輪未重驗。

### 青少年視覺調整（2026-10-14）

- 按鈕依工作區使用藍、紫、珊瑚橘與金色，保留 Keel 元件的焦點、停用與操作狀態。
- 卡片維持淡灰白底，只在圖示、卡片上緣與小型幾何圖形使用低飽和色彩，避免大面積色塊與幼兒化角色。
- `npm run lint`、`npm run build`、`git diff --check` 均通過。
- 當時紀錄顯示 Vercel production 已更新，並完成桌面與 390 × 844 手機寬度的視覺與響應式檢查；本輪未重驗。

### 冷紫色票調整（2026-10-14）

- 版面、元件尺寸與互動維持不變；全站背景改為淡薰衣草紫，主操作改為靛紫色。
- 粉紅、天藍與暖黃只用於功能識別及小面積裝飾，卡片保留白色與淡灰底。
- 深色互動色與白字的對比至少為 4.5:1，焦點狀態沿用 Keel 元件與全站語意色票。
- `npm run lint`、`npm run build`、`git diff --check` 均通過；桌面與手機寬度皆完成操作及溢出檢查，瀏覽器 Console 無錯誤。
- 當時紀錄顯示 Vercel production 回傳 HTTP 200；本輪未重驗。

### 三欄卡片版面調整（2026-10-14）

- 保留既有學習者、練習、題庫、錯題、成果與本機資料功能，只調整外層版面。
- 桌面改為左側導覽、中間工作區、右側摘要三欄獨立卡片；移除包住全頁的大型白色外框。
- 首頁「嗨，學習者」區塊保留原有文字、圖形、間距與背景，只把主要按鈕改為靛紫色。
- 手機版維持單欄排列，390 像素寬度無水平溢出；五個工作區均可切換。
- 作答時間改用確定性的台北時間字串，避免伺服器與瀏覽器格式差異造成 hydration error（水合錯誤）。
- 當時的 `npm run lint`、`npm run build`、`git diff --check` 均通過；當時正式環境 Console 無錯誤、Vercel production 回傳 HTTP 200。本輪未重驗該部署。

### 側欄視覺調整（2026-10-14）

- 左側導覽改為品牌區、學習者卡片、主要練習入口、次要功能列與每日提示卡，主工作區與右側摘要不變。
- 保留總覽、練習、題庫、錯題、成果、學習者切換及學習者設定功能；介面控制元件持續使用 Keel。
- 390 像素手機寬度無水平溢出；已驗證切換學習者、題庫導覽與設定視窗，瀏覽器 Console 無錯誤。
- 當時的 `npm run lint`、`npm run build`、`git diff --check` 均通過，並記錄 Vercel production 已更新；本輪未重驗該部署。

### 學習者設定頁與練習偏好（2026-10-14）

- 學習者設定由彈跳視窗改為獨立工作區，集中管理基本資料、各科書籍版本、每輪預設題數與隔離合成測試資料重設（不對持久資料開放）。
- 書籍版本改為數學、國語、英文各自保存；舊版單一版本資料會安全轉換到三個科目。
- 複習計畫保留「本輪題數」設定，可針對單次計畫臨時調整，不覆寫學習者預設題數。
- 設定頁與側欄入口沿用 Keel 元件及既有三欄視覺系統。
- `npm run lint`、`npm run build`、`git diff --check` 均通過；build 只有 Keel 文件預覽器既有的選用套件警告。
- 當時正式環境已驗證設定頁導覽、舊資料轉換、各科版本欄位、預設題數與單次計畫互不覆寫；390 × 844 手機寬度無水平溢出，Console 無錯誤。
- 當時紀錄顯示 Vercel production 回傳 HTTP 200；本輪未重驗。

### 中等寬度資訊密度修正（2026-10-14）

- 1024–1399 像素改為側欄與主內容兩欄；練習摘要及成果指標移到主內容下方，避免三欄同時壓縮。
- 1400 像素以上才使用完整三欄，成果頁的摘要、檢視設定與最近作答改為垂直內容流，不再把統計數字擠成窄直欄。
- 已驗證 1280、1440 與 390 像素寬度；沒有水平溢出，成果摘要最窄統計格仍有 152 像素，Console 無錯誤。
- 當時的 `npm run lint`、`npm run build`、`git diff --check` 均通過，並記錄 Vercel production 已更新；本輪未重驗該部署。

### 學習總覽摘要欄分工（2026-10-18）

- 1400 像素以上的學習總覽把「目前弱點」與「最近練習」放在外層右側摘要欄，主內容保留題庫作答進度、成果摘要與練習紀錄。
- 手機與未顯示獨立右欄的寬度仍可透過「練習摘要」面板查看這兩個區塊，不得為了移動桌面位置而隱藏資料。
- 維持既有錯題與作答紀錄衍生邏輯，只調整呈現位置，不建立第二份狀態或資料來源。
- 本機已驗證桌面版右欄順序與 390 × 844 手機版展開內容；未執行 Vercel 部署。

### 錯題科目切換（2026-10-14）

- 錯題頁新增「全部、數學、國語、英文」科目切換，選項同步顯示各科錯題數量。
- 錯題列表、已選錯題複習與後續相近題佇列都依目前科目篩選；切換科目時會清除跨科勾選。
- 沒有錯題的科目顯示專屬空狀態，可返回全部錯題；所有控制沿用 Keel 元件。
- 已驗證數學錯題、國語空狀態、跨科勾選清除，以及 1280 與 390 像素寬度；Console 無錯誤。
- 當時的 `npm run lint`、`npm run build`、`git diff --check` 均通過，並記錄 Vercel production 已更新；本輪未重驗該部署。

### 題庫頁精簡（2026-10-14，歷史紀錄）

- 當時的題庫頁移除「目前題庫」展示卡，只保留考卷匯入與校正流程，匯入介面改用完整主內容寬度。這個 mock 入口現已移除，不是目前可操作功能。
- 當時的隔離合成題目仍供練習、錯題與成果介面驗證，這次只移除重複的題庫列表介面。
- 已驗證 1280 與 390 像素寬度，沒有水平溢出，Console 無錯誤。
- 當時的 `npm run lint`、`npm run build`、`git diff --check` 均通過，並記錄 Vercel production 已更新；本輪未重驗該部署。

### 多題匯入校正與分類（2026-10-14，歷史紀錄）

- 匯入圖片或 PDF 後，校正區依原始順序列出全部辨識題目與參考答案；當時以四題隔離合成資料驗證，不再只顯示單題。
- 每題可分別選擇科目、章節／第幾課／主題、難易度與來源；章節、課次、主題及來源支援自行新增，所有選填欄位留白時標示由 AI 分析。
- 全部題目確認後才顯示準備寫入結果；目前介面階段不執行 OCR、AI 分析或正式保存。
- 當時曾修正 production rewrite 在直接開啟工作區網址時造成的 hydration mismatch（水合不一致）；該版 `/bank` 重新整理後維持題庫頁，Console 無錯誤。現在 `/bank` 會轉址到 `/questions`，不能再用這筆舊驗證表示匯入介面可用。
- 當時的 `npm run lint`、`npm run build`、`git diff --check` 均通過，桌面與 390 × 844 手機寬度已驗證；本輪未重驗正式網址。
- 當時紀錄顯示 Vercel production 的 `/bank` 已更新；這只是歷史紀錄，本輪未部署或重驗。

驗證失敗時先固定重現步驟、找出根因再修正；同一方案連續失敗兩次後停止重試並重新評估。

## 相同／相近題優先練習（2026-10-17）

- 目標：學習者可在出題設定勾選優先練習相同／相近題。相同題先於相近題，相近題再依關聯強度由高到低推薦。
- 相同題判定：題幹的文字骨架與解題邏輯相同，只替換數字、人物、名稱、目標字或其他已標記的可變值。相同單元或相同來源題型名稱只能縮小候選範圍，不能單獨證明文字骨架相同。
- 相近題判定：使用資料庫中已確認的相似群組，以及經核准並寫入正式關聯的關鍵字、人物、作品、篇章、主題或知識點。兩題共同關鍵字與正式關聯越多，代表關聯越近，排序越前；不得以未保存、未核准的即時 AI 猜測直接推薦。
- 遞補規則：每一個相近程度內先選尚未作答的候選，排除最近已答對的題目，再保留仍答錯或待檢視的題目。只有較相近層級沒有符合條件的候選時，才往共同關鍵字較少的層級遞補；所有關聯候選都完成時回傳明確完成說明，前端才接續一般篩選題目。
- 資料要求：文字骨架、可變值、正式關鍵字與題目關聯必須保存在資料庫或受版本管理且可追溯的來源檔案。缺少這些資料時只能標示功能未完成，不得以題型名稱、同科目、同單元或程式中的固定字串假裝已完成關聯判定。
- 來源追溯：每個新推薦 session item 以 `same_template`、`confirmed_group`、`shared_keyword` 或 `same_topic` 保存正式來源、規則版本、共同關聯數量與必要證據；`same_question_type` 只供既有歷史 session 相容。相同 session id 只允許重播完全相同的請求。
- 介面：練習篩選新增「優先練習相同／相近題」，設定保存在瀏覽器練習偏好；錯題頁持續顯示推薦層級、候選數與選入原因。
- 驗證：15 組 migration 的前進、限制測試、逐階段回滾、再次前進與 schema parity 已通過；推薦契約、關係分析、既有 enrichment 與管理後台測試、TypeScript 型別檢查均通過。1 題本機模型分析與 pending 匯入已完成，沒有自動核准。隔離 local-practice E2E 的相同模板預覽、session、來源證據及冪等重播先前已通過，整套流程之後被既有手寫辨識案例維持 `manual_review` 擋住，不能宣告完整 E2E 通過。
- 尚待正式資料內容：`question_templates`、`question_template_memberships`、`relation_keywords`、`question_revision_keywords`、`question_revision_topics` 與確認相似群組目前都沒有正式內容。人物、作品、篇章、目標字等關聯必須先完成分析、人工審核與寫入，才能參與推薦；分析結果只能先進 pending，不能直接改寫正式關聯。

## 教學小助教與教材來源閱讀器（2026-10-17）

狀態：部分可執行。架構已確認，本機來源取得、OCR 實驗、資料模型、匯入工具、管理後台校對與隔離測試可以施工。教材局部頁面的線上顯示授權尚未確認，學生頁面影像端點及正式介面不得啟用或部署。

### 施工就緒查核

- Repository 可查證：第四課有 279 題已發布題目，全部目前使用 revision 2；195 題有文字解析，84 題沒有解析。正式題目來源是 Word 文件，自修 PDF 只能建立補充教材證據，不得改寫 `question_revision_sources` 的主要出處。
- Repository 可查證：本機 `system_admin` session、管理 API、題目審核、資產讀取與同交易稽核已接線。教材校對沿用這套授權，不建立第二套管理身分。
- 正式來源：Google Drive 檔案 `115上[翰林]國中新無敵國文自修(1).pdf`，Drive ID 為 `1i4c-4T1_NAIhHVOkKUPDqtbJtoUsI0aE`。下載後必須驗證 MIME type、檔名、檔案大小、頁數與 SHA-256；教材內容不得依 Google Drive 網址作為執行期依賴。
- 已確認產品決策：教材範圍為 115 學年度、國一、國文、翰林版、上學期、第一冊、第四課〈論語選〉；印刷頁碼 93 至 114 對應 PDF 第 95 至 116 頁。來源顯示只使用檔名與印刷頁碼。
- 需要具名權利責任人核准：這份教材局部頁面可否提供學生線上查看。未完成時，所有真實頁面影像只限本機匯入與管理員校對；學生流程固定拒絕。
- 需要 production 證據：預設管理員、MFA、Secret Manager、受限資料庫角色、物件儲存與正式部署環境。這些條件不阻擋本機施工，但阻擋 production 驗收。

### 固定資料契約

- 原始 PDF 與頁面影像保存在 `local-data` 或日後的 private object storage；PostgreSQL 只保存相對 storage key、checksum、尺寸、頁碼、座標、OCR 內容及審核證據。
- `source_documents.original_file_name` 完整保存來源檔名。`source_document_catalog_profiles` 保存學年度、年級、科目、學期、版本與冊次的正式關聯；`source_document_pages.curriculum_unit_id` 保存頁面所屬課次。
- `question_revision_sources` 繼續表示題目原始匯入出處。補充教材使用獨立的 `question_revision_source_evidence`，且固定連到 `question_revision_id`。
- OCR 原始文字不可覆寫。人工校正文字、審核狀態、審核者與時間另存；只有核准區塊及核准題目關聯可以進入學生查詢。
- 相同來源 checksum、頁面範圍與 parser version 重跑不得產生重複文件、頁面或區塊。任一頁失敗時不得把文件標成 ready。
- `score` 模式永遠不回傳逐題教材來源。`instant` 只在該題送出後揭露；`complete` 只在整份完成後揭露。
- 學生引用格式固定為「解析來源：檔案名稱，第 N 頁」。對外資料不得包含本機絕對路徑、storage key 或 Google Drive URL。

### T1：取得來源並完成 OCR 抽樣

- 角色：工程師。
- 輸入與產出：下載並核對原始 PDF；渲染 PDF 第 95、97、109、116 頁；比較可在本機離線執行的文字偵測、繁體中文辨識與版面區塊方案；產出 `local-data/source-ingestion/<checksum>/reports/ocr-smoke.json` 與代表頁標示圖。
- 完成條件與驗證：四頁都能重複渲染；報告保存工具／模型版本、輸入 checksum、耗時、辨識文字、座標、失敗項與人工抽檢結論。直排古文、注音、表格、選擇題與插圖至少各有一項代表樣本；沒有座標或品質不足的方案不得選為正式 parser。
- 證據位置與輸出摘要：完整結果保存在不進版控的 `local-data/source-ingestion/`；交接文件只記 SHA-256、頁數、抽樣頁、成功數、失敗摘要與報告路徑。
- 依賴與確認節點：架構已確認，可立即執行。若所有本機方案都無法可靠處理直排版面，停下提出「增加人工框選」或「安裝文件版面模型」兩個選項，不自行下載未核准模型。
- 回滾點：移除本次抽樣輸出，不刪除原始下載檔，不寫 PostgreSQL。

### T2：建立教材來源資料模型

- 角色：工程師。
- 輸入與產出：新增下一號 migration、down migration、限制測試及資料字典，擴充 `assets.purpose=source_page`，建立來源教材範圍、頁面、OCR 區塊及題目版本證據資料表。
- 完成條件與驗證：外鍵能拒絕跨科目、跨版本與跨教材樹誤連；審核狀態不可跳過 pending；核准證據只能引用核准區塊；原始 OCR 與身分欄位不可覆寫。migration 在一次性資料庫完成前進、down、再次前進及 schema parity，既有 279 題不變。
- 證據位置與輸出摘要：SQL 測試放在 `database/tests/`，完整 log 放在 `local-data/verification/teaching-source-schema.log`；`docs/question-database-design.md`、`docs/database-completion-matrix.md` 與本計劃同步更新。
- 依賴與確認節點：依賴 T1 確認座標與 OCR 欄位能表達實際輸出。migration 套用正式本機資料庫前，先以隔離資料庫通過驗證並建立備份。
- 回滾點：隔離資料庫使用 down migration；持久資料庫若已寫入正式資料，只能向前修正或使用經核准備份，不直接 down。

### T3：建立可重跑的第四課匯入工具

- 角色：工程師。
- 輸入與產出：建立 parser 與 `inspect`／`apply` 命令。設定檔保存來源 checksum、115 學年度、正式目錄 ID、PDF 頁序、印刷頁碼、課次、parser version 與 OCR adapter；不把本次對照散落在程式分支。
- 完成條件與驗證：`inspect` 不寫資料庫；`apply` 先完成全部頁面檔案與 checksum，再以單一交易建立 pending 資料。相同輸入重跑重用既有結果；來源、設定或 parser version 不同時拒絕沿用 checkpoint。匯入前後題目、revision、解析與作答數量一致。
- 證據位置與輸出摘要：測試放在 `tests/teaching-source-import.test.mjs`；匯入 manifest 與 log 放在 `local-data/source-ingestion/<checksum>/`；README 只記操作方式與安全限制。
- 依賴與確認節點：依賴 T2。第一次 `apply` 到持久資料庫前停下核對 dry-run 摘要、備份位置、將新增的列數與不會修改的資料表。
- 回滾點：pending 資料以該匯入 run 的明確 ID 隔離；失敗交易整筆回滾，未引用頁面檔案列入 orphan manifest，不遞迴刪除寬泛目錄。

### T4：串接管理後台校對與核准

- 角色：前端工程師、工程師。
- 輸入與產出：在既有 `/admin` 增加教材來源清單、頁面與 OCR 對照、文字校正、區塊狀態及題目證據審核；擴充管理員資產端點只讀取正式關聯的 `source_page`。
- 完成條件與驗證：所有讀寫重新驗證 `system_admin`；寫入經 same-origin、重新驗證、idempotency 與 append-only 稽核；載入、空資料、錯誤、衝突及過期 session 都有可操作狀態。桌面與 390 像素寬度可完成代表頁校對，不洩漏 storage key 或原始 PDF。
- 證據位置與輸出摘要：管理測試沿用 `tests/admin-*.test.ts`，瀏覽器截圖及操作紀錄放在 `local-data/verification/teaching-source-admin/`。
- 依賴與確認節點：依賴 T3。管理員核准真實教材區塊前停下讓使用者檢視代表頁校對結果。
- 回滾點：隱藏教材校對導覽並停用寫入規格，保留 pending 資料及稽核證據。

### T5：串接學生來源跳頁

- 角色：工程師、前端工程師。
- 輸入與產出：把核准來源摘要接入現有參考答案揭露流程；建立以 question ID、revision ID 與 page ID 授權的 private 頁面端點；在既有解析區加入來源連結與單頁閱讀器。
- 完成條件與驗證：點擊來源直接開啟正確印刷頁並標示引用區域；`instant`、`complete` 與 `score` 行為符合固定契約；未登入、不同學習者、錯誤版本、未核准證據及直接猜 ID 都不能取得頁面。閱讀器不提供整本下載或跨課瀏覽。
- 證據位置與輸出摘要：API 測試、答案揭露測試及瀏覽器操作證據保存在對應 `tests/` 與 `local-data/verification/teaching-source-reader/`。
- 依賴與確認節點：依賴 T4，並需要教材線上顯示授權。授權未確認時可以使用隔離合成頁面完成程式與測試，但真實來源連結保持關閉。
- 回滾點：關閉來源摘要與頁面端點，不影響既有參考答案、題目或作答資料。

### T6：加入本地 AI 教學說明

- 角色：工程師。
- 輸入與產出：建立與 handwriting worker 分離的教學工作；輸入只包含固定題目版本、必要錯誤資訊及核准教材區塊，保存模型 digest、prompt version、輸入 checksum、引用與審核狀態。
- 完成條件與驗證：模型不能讀取整本 PDF、未校正 OCR、其他學習者資料或手寫 worker 的隔離輸入；每個教材主張都能回到核准區塊。沒有足夠證據時回傳尚無教材解析，不補造來源。
- 證據位置與輸出摘要：合成錯題與核准教材區塊的 eval、延遲與失敗報告放在 `local-data/verification/teaching-assistant-ai/`，測試放在 `tests/`。
- 依賴與確認節點：依賴 T4；模型與 prompt 的品質門檻需由代表題目實驗確定，未達門檻時不接學生流程。
- 回滾點：停用教學工作及生成內容讀取，保留既有固定解析與教材來源。

### 階段審查與優化

- T1 至 T3 完成後，由審查員檢查資料契約、重跑安全、來源追溯、檔案邊界及文件同步；優化師只處理確認的 OCR 批次效能、影像尺寸與資料庫查詢問題。相關驗證通過後才進 T4。
- T4 至 T6 每項完成後，各自執行差異相關的介面／API 審查及效能複查。任何驗證失敗都轉入除錯支線，固定重現、定位根因、修正並回驗；同一方案連續失敗兩次就回到該任務的回滾點。
- 每輪審查都要反查 source document、page、block、evidence、API、管理動作及學生入口是否都有 producer、consumer、授權與測試；只有資料表或只有介面不算完成。文件與實作不一致時不得進下一項。

### 學習資料啟動效能（2026-10-18）

- 狀態：第二階段施工中。第一階段 `0019` 已把 preferred question identifier 查詢由重複全表掃描改為索引查找，但五次登入重載中位數仍為 8,633 毫秒、79 筆 API、約 39.5 MB，未達三秒門檻。
- 第二階段：刪除前端 73 組年級／科目／版本／冊次／課次目標；在既有 questions resource 加入無分類的 accessible variant。伺服器以目前學習者有效題庫成員、年級、enabled 科目及選定書籍版本決定範圍，以一個 base selection 加上集合式內容與知識點查詢回傳既有 answer-free DTO。完整五欄篩選與分頁行為保持相容，部分欄位回 `400`。
- 完成條件：初次載入恰有一筆不帶分類的 questions 請求；空題庫不套預設；讀取失敗明確顯示；inactive／無權限／未啟用或版本不符資料不進結果；公開 payload 無答案；session 恢復沿用固定 revision；練習完成只更新 history／wrong-review。完成後以相同 route 再跑五次並記錄中位數、範圍、API、bytes 與失敗數。
- 停止條件：若合併後中位數仍未低於三秒，且 limiter 是完整題庫 payload、解析或前端轉換，不再以併發或快取修補；另立路由摘要、題目總覽分頁與 detail hydration 計畫。收藏搬移、學習本 API 與練習選題 SQL 不納入這次效能修改。

### 凍結、安全與最終驗收

- 全部 production code 完成後凍結版本，記錄 commit 與 QA 矩陣，不在 freeze gate 重跑完整集合。
- 依序執行 Ai Slop Cleaner、Code Review、Security Review 與 UltraQA。完整 migration、測試、build、資料庫核對、桌面與手機流程由 UltraQA 統一執行；後三項若修正 production code，解除凍結並從 Ai Slop Cleaner 重跑。
- 安全審查涵蓋路徑穿越、symlink、checksum、檔案大小與 MIME、PDF 內容、SQL 注入、越權讀取、答案提前揭露、模型 prompt injection、教材內容外洩與 log 敏感資訊。
- 驗收對照 `docs/concept.md`：學生能在已解鎖結果看到有教材依據的解析、來源只顯示檔名與頁碼、點擊後到正確頁、沒有整本教材重排、既有 279 題與作答資料不受影響。教材授權及 production 管理條件未完成時，整體狀態保持「部分可執行」，不得宣告 production 完成。
