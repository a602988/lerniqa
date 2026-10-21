# 題目拍照與匯入交接

## 目前狀態

- Repository：`/Users/jean/Documents/GitHub/lerniqa`
- Branch：`main`
- 最後已推送 commit：`2c1715e`；本次未提交或推送
- Production code：多份來源上傳、圖片用途判定、多檔背景分析、人工確認答案建議與草稿來源檔排列已完成施工及最終驗收；未部署
- 介面按鈕：建立題目工作台的導覽、頁首、建立方式、題目切換、來源與內容工具已統一為緊湊尺寸；手機主要操作仍保留可觸控高度
- 編輯器內框：題目內容、內容區塊、提示與答案建議改為白底，淡紫色只保留在狀態與主要操作
- 注音排版：新增範本首次使用連續注音詞組；共用文字元件將兩個以上相鄰音節以題幹原字級橫排，單一音節維持既有直式呈現，題幹不補對應國字
- 產品與技術規格：`docs/plans/question-capture-and-import-plan.md`

工作樹仍包含帳號、首頁、管理介面與其他執行文件的未提交修改，不能視為本功能可獨立還原的範圍。題目匯入功能目前未提交的負責範圍包括 `app/api/v1/question-imports/`、`app/lib/question-import-contract.ts`、`app/lib/question-import-store.ts`、`app/lib/question-source-analysis.ts`、`app/lib/question-source-catalog.ts`、`app/lib/question-source-processing.ts`、`app/questions/new/`、對應的 `tests/question-*.test.ts`、`package.json`、`package-lock.json`，以及本文件列出的產品規格。不得為了整理本功能而覆寫其他未提交修改。

## 已完成

### 2026-10-21 注音候選交叉確認

- 國字注音題不再只檢查字元是否合法。模型輸出的注音必須在同頁 OCR 候選中找到完全相同的字串；沒有相同候選時，第二次辨識必須改用「待確認的注音原文」裁切，避免把字形合法但抄錯的注音寫入草稿。
- 既有 `clipboard-1.png` 草稿依使用者對原稿的確認，將第 2 至 5 題修正為 `學問「ㄩㄢ」博`、`溫文「ㄖㄨˊ」雅`、`「ㄅㄧㄢˋ」才無礙`、`「ㄉㄨㄣ」實謹慎`。更新限定批次、來源題號與舊文字全部相符時才執行，四筆各更新一列。
- `npm run test:question-import` 通過 73 項測試。新增回歸測試證明模型輸出的合法注音若缺少相同 OCR 候選，仍會被拒絕。

### 2026-10-21 多份來源與答案建議

- 同一份草稿可上傳 1 至 20 個 JPG、PNG、WebP 或 PDF。檔案依選取順序連到同一個 `import_batches`，每個檔案各自保存角色與原始私人資產，不會先合併成一份 PDF。
- 上傳前可把來源指定為題目、答案、解析或補充圖片，也可保留「由 AI 判斷」。AI 判定會保存角色、信心值與理由；草稿編輯器可重新指定用途，再用原始檔執行完整分析。
- worker 會逐份校正頁面、OCR 與建立影像版本，只從題目來源建立草稿題目。答案頁、解析頁及補充圖片仍保留為可追溯證據。
- 題目沒有答案時，固定本機模型會在拆題完成後另外提出答案建議。建議包含答案、簡短解析、信心值及答案來源文件／頁碼；沒有答案頁時可依題目推導，但證據留空且信心值應降低。建議只保存在背景工作結果，使用者按下「套用答案」後才進入草稿。
- 新增 `0029_question_source_document_roles` migration(資料庫遷移)，在 `import_batch_documents` 保存 `document_role`、`role_source`、`role_confidence` 與 `role_reason`，並以資料庫限制排除互相矛盾的狀態。
- 階段驗證通過：TypeScript 型別檢查與 65 項題目匯入測試。新增測試涵蓋答案頁用途判定、保留使用者指定用途，以及答案建議只能引用同批次已處理頁面。資料庫 migration、production build、瀏覽器桌面／手機驗證與最終四階段審查仍待完成。

### 2026-10-21 格式匯入依選取題型產生下載內容

- 格式匯入的共用範本選擇器支援多選，並提供全選與取消全選。預設選取現有全部八種題型，使用者可只保留需要的題型。
- 複製給 AI 的指令、複製 JSON 範本與下載格式檔都使用同一份選取結果。每種已選題型產生兩題有效範例，未選題型不會進入輸出。
- AI 指令列出允許使用的 `templateId`。同一份輸出可混合已選題型，但不能使用未選題型；交換格式解析仍會逐題核對 `templateId` 與實際作答結構。
- 全選實際產生 16 題，涵蓋 `single-choice`、`image-choice`、`multiple-choice`、`true-false`、`fill-blank`、`multi-field`、`short-answer` 與 `question-group`，並再次通過交換格式解析。
- 驗證通過：63 項題目匯入測試、31 項 runtime guardrail、TypeScript 型別檢查、production build 與 `git diff --check`。Build 只有 Keel 文件預覽既有的 optional dependency warning。本機與 Tailscale 8443 的 `/questions/new` 均回傳 HTTP 200；瀏覽器目前沒有登入狀態，因此登入後畫面的操作驗證待登入後補做。

### 2026-10-21 格式匯入 AI 指令限制

- 「複製給 AI 的指令」會要求 AI 依作答結構從使用者已選題型中選擇 `templateId`，並列出各題型與 `answerMode`、作答欄位及題組結構的判斷方式。適合題型不在允許清單時不得改寫題目或硬套其他題型。
- 題號、章節序號、題型名稱及配分文字不進入題幹。原稿題號與頁碼只放來源欄位；看不清楚的文字不得猜測。沒有來源答案或解析時改用人工檢視與空陣列，JSON 範例內容不得複製成正式輸出。
- `questionKey` 在整份 JSON 中唯一，`stableKey` 在同一題內唯一。每個 `image_ref` 或 `crop_ref` 的 `ref` 在整份 JSON 中唯一，避免同一參照指向不同圖片或裁切範圍。
- 73 項題目匯入測試、TypeScript 型別檢查及 `git diff --check` 通過。Chrome 實際點擊「複製給 AI 的指令」後顯示已複製 8 種題型；系統剪貼簿內容已核對包含題號清理、題型判斷與圖片參照唯一性規則。本輪沒有建立草稿、修改題目資料或部署。

### 2026-10-20 本地圖片分析長回應修正

- 已確認連續失敗不是 worker 或 Ollama 未啟動。同一圖片 3 輪共 6 次在模型持續生成時由 Node.js HTTP 傳輸中斷，資料庫因錯誤分類記錄為 `LOCAL_MODEL_UNAVAILABLE`；Ollama 日誌沒有崩潰或記憶體不足。
- Ollama 題目分析改用 NDJSON 串流。回應內容逐段組裝並維持一 MiB 上限，單次呼叫保留十分鐘整體上限；Undici 的 `UND_ERR_HEADERS_TIMEOUT` 與 `UND_ERR_BODY_TIMEOUT` 現在歸類為 `LOCAL_MODEL_TIMEOUT`。
- OCR 已產生獨立來源題號時，structured output(結構化輸出)的題目陣列會固定為相同筆數，避免模型只回傳 schema 允許的最少一題。「國字注音」與「解釋」章節固定使用文字作答及簡答範本，不允許模型虛構選項。
- 國字注音品質檢查同時接受「看注音寫國字」及「看國字寫注音」。題目必須含注音目標或引號內國字目標；空白、拉丁字母、日文假名及同一括號混合國字與注音仍會拒絕。
- 以原本失敗的 `clipboard-1.png` 原始私人資產進行只讀驗證。修正後於 309,644 ms 完成，建立 15 道獨立題目，來源題號完整為「一-1」至「一-10」及「二-1」至「二-5」，全部使用 `text` 作答。驗證沒有更新批次、草稿或題庫。
- 回歸測試先證明串流回應、Undici 逾時分類、固定題數、書寫題 schema 與雙向國字注音在舊程式上失敗，修正後通過。最終驗收的 57 項題目匯入測試、31 項 runtime guardrail、TypeScript 型別檢查、`npm audit --audit-level=moderate`、production build 與差異格式檢查全部通過。Build 只有 Keel 文件預覽既有的 optional dependency warning。背景 worker 已由 supervisor 重新啟動；Tailscale 8443 `/questions/new` 回傳 HTTP 200，Chrome 實際顯示「建立題目」與預設「檔案上傳」，沒有水平溢位或新的 Console error。

### 2026-10-20 可離開頁面的背景分析

- 圖片與 PDF 上傳完成後只建立 `question_source_analysis_jobs`，API 立即回傳 `202`；OCR、透視校正、去手寫與本機 vision model 拆題改由獨立 worker 執行。使用者可以離開或重新整理頁面，稍後從「我的草稿」查看等待、分析中、可編輯或失敗狀態。
- `question_source_analysis_runs` 保存每次嘗試；worker 使用資料庫租約、`FOR UPDATE SKIP LOCKED` 與每分鐘續租。worker 中斷後，逾時嘗試會標記 `WORKER_LEASE_EXPIRED`，工作依兩次上限重試，不會永遠停在分析中。
- 完成時在同一交易替換待確認題目、保存頁面與裁切資產、寫入目錄建議並完成工作。失敗時保留原始檔及既有候選。重新分析期間前端不載入舊候選，後端也拒絕儲存，避免背景結果覆寫同時發生的人工修改。
- `npm run dev` 與 `npm run start` 由本機 supervisor 同時管理 Next.js 與題目分析 worker；worker 異常退出時會重新啟動。`--once --dry-run` 只讀取是否有待處理工作，不會領取或修改工作。
- worker 啟動時會補登背景功能上線前已上傳完成、仍在等待且從未有分析工作的圖片或 PDF；不會自動重跑已失敗或可編輯的草稿。
- 本輪以既有圖片草稿驗證真正的背景生命週期：頁面離開後 worker 仍持續續租；固定本機模型兩次無法提供結果後，工作、執行紀錄、批次與來源文件在同一交易收斂為 `failed`。草稿清單顯示「分析失敗」，開啟後保留原始檔並提供「重新分析原始檔」，不再卡在「分析中」。
- 「我的草稿」清單已改成完整白底內容區。等待 worker 與 worker 執行中的草稿統一顯示「處理中」；完成與失敗維持「可編輯」及「分析失敗」。刪除改用 Keel Dialog，顯示草稿名稱與不可復原後果，取消或 Escape 後焦點返回原刪除按鈕。

### 2026-10-20 圖片解析與練習式編輯

- 已推翻「OCR 字數足夠就只傳文字」的舊判斷。圖片分析現在每次都把校正頁、OCR 全文、OCR 行座標與信心值交給固定 vision model；圖片是抄錄依據，OCR 只供定位。
- 送入模型的低解析度副本會在 2,400 × 3,200 範圍內以 Lanczos 放大並銳化。原稿、校正頁與私人資產不會被覆寫。
- 國字注音題新增內容品質檢查。沒有注音、替代字元、空白括號、拉丁字母、日文假名，以及同一括號混合國字與注音都會觸發一次重新對圖辨識；第二次仍不可靠時回傳 `LOCAL_MODEL_LOW_CONFIDENCE`，保留既有草稿。
- 國字注音題的檢查改為保留原稿作答位置。模型把 `個性魯「ㄇㄤˇ」`補成完整詞語或整詞注音時會被拒絕；看不清楚的注音可用緊密 `crop_ref` 留在原位置，草稿不必因單一注音失敗而丟棄整題。國字注音頁會另外送入依 OCR 座標建立的放大文字行圖，原始資產不變。
- 章節分類與題目內容已分開。像「一、國字注音：每字1分，共10分」只決定題型及作答方式，不再建立大題或寫入題幹；其下編號各自建立為獨立題目。模型若把沒有選項的書寫題標成選擇題，第二次重試會收到正式契約的具體錯誤並改用文字作答結構。
- 題目工作台左側收斂成「建立題目」與「我的草稿」；檔案上傳、格式匯入與手動編輯改在右側分頁切換，預設進入檔案上傳。首次進入不再自動彈出手動題目範本。
- 手動編輯與匯入校對改為單題工作區；一次只顯示目前題目，使用題號進度、上一題、下一題及新增下一題切換，避免多題表單同時展開。
- 拍照、圖片或 PDF 完成上傳後會立即進入草稿編輯畫面。OCR 與本機模型分析在同一畫面繼續執行，完成後填入可編輯題目；分析失敗時保留原始檔與錯誤訊息，不以空白題目冒充草稿內容。
- 實際以 543 × 539 px 的 `clipboard-1.png` 驗證。較早一次分析因小字注音仍含可疑字形而拒絕新結果；套用獨立題目規則後再分析則超過 4 分鐘上限。兩次都未覆寫既有 2 題草稿，也沒有加入題庫。先前把這份圖片列為成功解析的驗收結論已失效，不能再作為準確率證據。
- 題目編輯區改成依練習順序排列的題目卡。一般題目顯示題目內容、作答方式、答案、提示與解析；單題底部使用「建立題組」，只有真正的題組才顯示大題說明、小題內容與「新增小題」。批改方式與父子題關係收進「更多設定」。
- 草稿名稱旁保留可開啟完整原始檔的縮圖。題目卡不再重複顯示原稿或影像版本選單；題目內已建立的裁切圖片仍保留。
- 先前把來源解析為 2 題、15 小題的瀏覽器結果已確認不符合產品規則，不再作為驗收證據。正確結果應是 15 道獨立題目；章節標題只供解析題型，不進入題幹。
- 最終驗收通過：`npm run lint`、52 項題目匯入測試、108 題題庫檢查、8 項答案揭露、38 項學習本、37 項題目呈現整合、31 項 runtime guardrail、26 組資料庫 migration、`npm audit --audit-level=moderate`、production build、`git diff --check` 與 8443 `/questions/new` HTTP 200。Build 只有 Keel 文件預覽既有的 optional dependency warning。

- 左側主導覽恢復「新增題目」，入口為 `/questions/new`。
- 新增題目頁首已改為與學習工作區一致的白色圓角主視覺卡片，加入文件、拍照與 AI 輔助圖形，並保留頁首操作的原有權限與停用狀態。
- 新增登入帳號專屬的「我的草稿」清單。草稿不要求題庫或分類，不建立正式題目，也不進入練習與統計。
- 草稿支援建立、開啟、覆存、取消，以及以冪等鍵安全重送；讀寫與圖片資產都依建立帳號檢查。
- 編輯器提供「預覽練習」，直接重用正式練習的題幹與作答元件；預覽輸入不建立作答紀錄。
- 「儲存草稿」與「加入題庫」已分離。只有加入題庫時顯示並驗證學習者與正式分類，成功後才建立 `questions`、revision、小題、內容、答案與來源追溯。
- 新增題目工作台支援手動建立、照片／圖片／PDF、題目圖片與 JSON v2 格式匯入；舊 v1 會安全升級。
- 帳號可在加入題庫流程建立自訂科目，以及該科目的單選／複選分類欄位與選項。科目是唯一必填分類，年級、學期、版本、難易度與來源都可留空。
- 每題可保存不同分類。本機 AI 只從目前科目的既有選項提出含理由與信心值的建議，使用者確認後才套用；AI 不可用時不阻擋手動分類。
- 新增題目目錄已限制為系統資料或目前帳號資料，修正其他帳號自訂科目、版本與來源可能被列出的隔離缺口。
- 新增題目目錄的科目排序改用 `subjects.normalized_name`；不再引用只存在於 `grade_subjects` 的 `sort_order`，避免目錄載入失敗並停用儲存與加入題庫操作。
- 匯入契約支援小題樹、文字、公式、表格、圖片、頁面裁切、選項、答案與解析。
- 手動編輯器已改用共用內容編輯器；題目、小題、每個選項、每組作答前提示及解答與解析都可依序加入文字、圖片、公式與表格，草稿往返不再把非文字內容壓平或捨棄。
- 手動新增題目會先開啟範本選擇，提供單選題、圖片選擇題、複選題、是非題、填空題、多格填答題、簡答題，以及題組與子題。每張範本都以正式練習元件呈現題幹、作答區、提示與範本答案，再建立可修改草稿。
- 每題顯示依既有作答結構推導的範本名稱。更換範本會保留題目內容、分類與匯入追溯資料，並重建小題、作答方式、選項、答案、提示與解析。
- 手動編輯器不再顯示來源題號與來源頁碼；掃描頁碼由系統保存，影像版本選單直接顯示所屬頁面。格式匯入仍可提供選填來源資料。
- 內部 `stableKey` 不再顯示於一般表單；一般單題使用「題目內容」與「作答設定」，多小題才顯示「大題說明」、「小題內容」及進階的「設為子題」。
- `0026_question_hints` 在既有 `question_content_blocks` 加入 `hint` 與 `hint_index`；提示預設收合並逐組展開，不參與判分。
- 正式練習與題目預覽可呈現圖片／表格選項；解析以有序內容區塊回傳，解析圖片只在 session 揭露條件成立或具有結果檢視權限時授權。
- 四種作答方式與三種判分政策接入既有題目 schema。
- 匯入使用帳號／學習者授權、額度、分類、資產擁有權、checksum、冪等與單一交易驗證。
- 掃描 worker 已輸出透視校正、光線校正、彩色／灰階／黑白、彩色手寫遮罩／去除預覽與 PaddleOCR 結果。
- 掃描完成後會把校正頁與 OCR 文字送入固定本機 Ollama `qwen3.8:27b`。每次分析前會共用手寫辨識的模型身分驗證，核對固定名稱、digest、Ollama 版本與 `vision` 能力。模型可將同一頁拆成多題與小題，建立文字、表格、公式、選項、作答方式及圖片裁切候選；結果必須先通過 AI 交換格式與 v2 草稿契約，才可存入個人草稿。
- 每頁都把校正圖片、OCR 全文、OCR 行座標與信心值傳給同一個固定本機模型；不得再以 OCR 字數或圖表關鍵字省略圖片。
- 章節標題只提供題型、作答方式與計分線索，不寫入題幹。標題下直接排列的阿拉伯數字項目各自建立為獨立題目，並以「章節序號-題號」檢查完整性。只有不可缺少的共用文章、圖片或表格後面接著多個相依問題時才建立題組。誤建題組、漏題或把分類標題寫入題幹時自動重跑一次，第二次仍不正確就拒絕保存。
- 已保存的圖片草稿提供「重新分析圖片」。新結果完成驗證後才以單一交易替換待確認題目；失敗時保留原草稿。
- 已保存的圖片與 PDF 草稿會在編輯畫面顯示來源檔入口。圖片縮圖可點擊開啟完整原圖；PDF 可在對話框查看或另開。預覽沿用既有私人資產端點與帳號擁有權檢查，前端不接收儲存路徑。
- 來源文字完整對上唯一教材單元時，系統會預填該單元所屬的科目、年級、學期與版本。同名單元以來源文字中的科目、年級、學期及版本判斷，仍無法唯一判定就維持未設定。使用者在「加入題庫」確認後，單元關聯才寫入正式題目版本。
- 本機模型不得把手寫、圈選、批改符號或自行解題結果當成答案。來源沒有清楚印出的答案時，草稿保留空答案及 `manual_review`，交由使用者校正。
- private asset API 只允許建立者讀取 clean 且未刪除的來源或題目資產。
- 手動新增與格式匯入共用同一個題目範本選擇器；格式頁可多選題型並使用全選或取消全選。複製 AI 指令、複製多題 JSON 與下載格式檔都只包含已選題型，匯入後仍進入同一套草稿、預覽與發布流程。
- 八種題目範本使用自行編寫、可實際作答的完整示例；只有題組與子題示範結構化表格，其他範本使用一般文字題。圖片選擇題在選擇範本時顯示四張版本管理內的示例圖，套用後仍要求使用者上傳自己的圖片。所有範本都包含對應提示、答案與解析，不引用既有正式題庫內容。
- 語文類常用範本已補上「看注音寫國字」與「依中文意思填英文單字」的完整示例，分別使用單格自動比對與多格填答結構。
- AI 交換格式 v1 支援多題與混合題型，逐題核對 `templateId` 與既有作答結構。格式不接受內部 `assetId`、Base64 或遠端圖片 URL；一般圖片以 `image_ref` 配對，原稿區域以 `crop_ref`、頁碼與比例座標配對。
- `crop_ref` 原稿會先走既有透視校正、影像模式與去手寫流程。介面同時顯示原頁裁切框及裁切結果，可調整座標、切換去手寫／彩色／灰階／黑白來源後重新裁切；後端重新驗證來源擁有權、checksum 與輸出內容。
- 拍照／PDF、JSON 格式檔、格式圖片、題目內容圖片與原稿都使用共用檔案來源元件。系統檔案選擇器不再附加 `capture`，因此平板可使用裝置本身提供的 Google Drive、iCloud Drive 或其他文件來源；拍照是獨立後鏡頭入口。
- 共用檔案來源元件支援「貼上」按鈕與 `Ctrl+V`／`⌘V`。截圖、複製圖片及作業系統提供的複製檔案會依各入口的 `accept` 契約驗證，再交給既有上傳回呼；只有文字的剪貼簿內容不會觸發上傳。瀏覽器拒絕直接讀取剪貼簿時改在元件內顯示中性操作指引，不再觸發頁面頂端的紅色上傳錯誤。
- 修正掃描完成後儲存草稿的來源文件契約：文字來源才更新 `pasted_text`；圖片與 PDF 來源維持 private asset 關聯及 `pasted_text = NULL`，避免資料庫 `source_documents_input_check` 拒絕儲存。
- 拍照／圖片／PDF 空狀態已明確設定圖示、標題、說明與來源按鈕的垂直間距；按鈕群組在可用寬度內置中，窄螢幕換行時不產生水平溢位。
- Google Picker 網頁入口只在伺服器確認 OAuth client ID、Picker API key 與 Cloud project number 完整時顯示。未設定或設定查詢失敗時直接隱藏，保留系統檔案選擇器，不再讓使用者按下必然失敗的 Google Drive 按鈕。
- 圖片上傳錯誤訊息已明列支援 JPG、PNG、WebP；HEIC／HEIF 在目前解碼環境下要求先轉成 JPG，避免只靠副檔名誤判成功。
- 修正範本預覽的 hydration mismatch。範本原本在伺服器與瀏覽器各自產生隨機題目及小題 ID，造成作答欄位的 `name` 不一致；題目範本與格式範本預覽現在使用依範本推導的穩定 ID，真正建立草稿時仍使用隨機 UUID。
- 平板寬度下的新增題目導覽列改用明確的兩列 Grid 配置，上方列只保留內容高度，不再分配頁面剩餘高度。返回控制改為指向 `/questions` 的站內連結，避免觸控導航只依賴按鈕事件。
- Google OAuth client secret 檔名已加入 `.gitignore`，避免本機憑證誤提交；正式環境只需要可公開到瀏覽器、且已限制來源與 API 的 Picker API key，以及 OAuth client ID 和 Cloud project number。

## 驗證證據

- `npm run lint`：exit 0。
- `npm run test:import-preflight`：44/44 通過。
- `npm run test:question-import`：45/45 通過；除原有範本、交換格式、資產、草稿與圖片分析契約外，新增圖片草稿重新分析、中文大題與阿拉伯數字小題、孤立父節點修正、純文字 OCR 分析，以及單元唯一比對、同名單元不預填、年級判別與全形文字正規化測試。
- Ollama 實際推論：`0.34.4` 的 `qwen3.8:27b` 已回傳有效結果。無版權合成圖片含兩道印刷題；第一輪漏掉第 2 題後被完整性檢查拒絕，第二輪建立題號 1、2 共兩題。兩題都沒有印刷答案，因此保留空答案與 `manual_review`。此項只證明接線、格式驗證與漏題重試可運作，不代表真實教材準確率或市場級效果已驗收。
- 最終凍結版本實際核對本機模型：Ollama `0.34.4`、`qwen3.8:27b`、digest `d1613d2593b522569bd104ae217d392613e40220e2b4461129810d04752999c0` 與 `vision` 能力均符合固定契約。
- `npm run test:answer-disclosure`：8/8 通過；包含 session 固定版本、解析內容區塊與解析圖片授權。
- `npm run test:learning-books`：38/38 通過；包含分享小題的提示內容與 session asset 授權。
- `node --test tests/persisted-question-fields.test.ts tests/question-media-layout.test.mjs tests/practice-catalog-integration.test.mjs`：37/37 通過。
- 本機持久資料庫實際執行新增題目科目目錄查詢：exit 0，成功依 `origin`、`normalized_name` 與 `id` 回傳資料。
- `node --test tests/practice-catalog-integration.test.mjs`：29/29 通過。
- `npm run test:runtime-guardrails`：31/31 通過，並由最終 `npm run build` 再次執行。
- `npm run db:test`：26 組 migration 前進、限制、逐步回滾、再次前進與 schema parity 全部通過。
- `npm run build`：exit 0；Keel 文件預覽的 optional dependency 仍有既有 warning。
- 背景工作最終凍結版本：`npm run lint`、54 項題目匯入測試、108 題題庫檢查、8 項答案揭露、38 項學習本、39 項持久欄位／媒體／練習整合、31 項 runtime guardrail、27 組資料庫 migration、`npm audit --audit-level=moderate`、production build 與 `git diff --check` 全部通過。Build 仍只有 Keel 文件預覽既有的 optional dependency warning。
- 背景工作瀏覽器驗收：Chrome 中先離開分析中的草稿，再由「我的草稿」重新開啟。模型兩次回傳 `LOCAL_MODEL_UNAVAILABLE` 後，清單顯示「分析失敗 · 0 題」；狀態頁顯示原始檔仍保留及「重新分析原始檔」。資料庫中的 batch、source、job 與兩筆 run 均已結束，沒有殘留 `running` 狀態。
- 草稿清單介面調整的回歸測試在修改前因缺少「處理中」、白底內容區與 Keel 確認視窗而 53/55；修正後 55/55 通過。Chrome 實測清單背景為 `rgb(255, 255, 255)`、圓角 20 px，桌面及 390 × 844 viewport 的 `scrollWidth` 均等於 viewport。390 px 寬度下確認視窗位於 28 至 362 px，不超出可視區。視窗的標題、後果、草稿名稱、取消、確認及關閉操作均可由 accessibility tree 取得；按 Escape 後焦點回到原刪除按鈕，驗收過程未確認刪除任何草稿。
- 草稿清單 production code 凍結後完成四階段驗收。Ai Slop Cleaner 沒有新增註解、抑制指令或廢棄分支，刪除數 0；Code Review 與 Security Review 沒有發現本輪阻擋問題；UltraQA 的 `npm run lint`、55 項題目匯入測試、108 題題庫檢查、8 項答案揭露、38 項學習本、37 項題目呈現整合、31 項 runtime guardrail、27 組資料庫 migration、`npm audit --audit-level=moderate`、production build 與 `git diff --check` 全部通過。Build 仍只有 Keel 文件預覽既有的 optional dependency warning。
- 沒有題目時，草稿名稱與下方題目區在處理中、分析失敗及尚未選擇範本狀態都合併為單一大型白色內容區，移除原本的分離卡片與虛線外框；處理區顯示頁面校正、文字辨識與題目分析，但不推測百分比進度。Chrome 實測分析失敗狀態的兩區邊界完全相接，白底為 `rgb(255, 255, 255)`，桌面與 390 px 寬度皆無水平溢位。最終凍結版本的 55 項題目匯入、108 題題庫檢查、8 項答案揭露、38 項學習本、37 項題目呈現整合、31 項 runtime guardrail、27 組資料庫 migration、`npm audit --audit-level=moderate`、production build 與 `git diff --check` 全部通過；build 只有 Keel 文件預覽既有的 optional dependency warning。
- 本機圖片拆題完成後重新執行最終驗收：`npm run lint`、38 項題目匯入測試、108 題題庫檢查、8 項答案揭露、38 項學習本、39 項持久欄位／媒體／練習整合、31 項 runtime guardrail、26 組資料庫 migration、`npm audit --audit-level=moderate` 與 production build 全部通過；`/questions/new` 回傳 HTTP 200。
- `node --test tests/question-placeholder-boxes.test.ts`：2/2 通過；回歸測試先以「連續注音必須橫排」重現舊版把音節拆成直欄的失敗，再由共用元件修正為通過。
- `xmllint --noout public/question-template/*.svg`：exit 0；四張圖片選擇題示例圖均為有效 SVG。斜坡圖另轉為 320 × 180 PNG 實際檢查，圖形與替代文字相符。
- 注音詞組瀏覽器驗證：以實際 `BopomofoText` 在 700 px 寬度呈現「ㄘㄞˇ ㄏㄨㄥˊ」。詞組使用 24 px 字級與 40.8 px 行高，整組橫排且不在音節間換行；空間不足時整組移到下一行，右側 `」。` 與詞組保持同一行。單一注音仍使用既有直式元件。暫時驗證路由已移除。
- `npm audit --audit-level=moderate`：0 項漏洞。以 npm `overrides` 將 Next.js 15.5.27 的巢狀 PostCSS 統一到 8.5.31，沒有執行跨主版本的 `npm audit fix --force`。
- `git diff --check`：exit 0；本機 OAuth client secret 檔案符合 `.gitignore`，未列入工作樹變更。
- `curl http://127.0.0.1:3500/questions/new`：HTTP 200；本機服務仍在執行。
- 本機 Google Picker 設定檢查：OAuth client ID、Picker API key 與 Cloud project number 未完整設定；介面已改為不顯示網頁 Google Drive 按鈕，系統檔案選擇器仍保留裝置端 Drive／iCloud 文件來源。
- 瀏覽器 hydration 回歸：修正前 `/questions/new` 可重現 React hydration mismatch，伺服器與瀏覽器產生的單選欄位 `name` 不同；修正後以同一路徑重新載入，新的 console 紀錄不再包含 hydration mismatch。
- 瀏覽器：本機 `/questions/new` 實際渲染八種範本、radio group(單選群組)、正式題幹、作答控制、提示入口、範本答案入口與套用按鈕；1280 px 桌面寬度的 `scrollWidth` 等於 viewport。登入工作階段在 API 檢查後失效並返回 `/account`，因此未以瀏覽器寫入持久草稿，也未完成登入後手機互動驗收。
- 瀏覽器：1280 × 720 桌面與 527 × 892 窄螢幕均實際渲染新版頁首；桌面 `scrollWidth` 等於 viewport 1280 px，窄螢幕的標題、圖形與三個操作按鈕無裁切。
- 本機持久資料庫已只向前套用 `0025_account_question_taxonomy`，既有資料未重設或清除。
- 本機持久資料庫已只向前套用 `0026_question_hints`，既有資料未重設或清除。
- 瀏覽器：1920px 桌面與 527px 手機寬度的新增題目工作台均無水平溢位；未登入直接開啟 `/questions/new` 會導回 `/account`，不再停在失效工作台。
- Python 真實圖片 smoke test：exit 0；輸出五種影像、OCR 與 manifest，處理時間 1,201 ms。
- 瀏覽器：1920px 桌面與 527px 窄螢幕均實際開啟新版工作台，兩者 `scrollWidth` 等於 viewport；草稿空狀態與正式練習預覽對話框均已操作。測試瀏覽器沒有有效登入狀態，因此未對持久資料執行草稿建立與正式發布。
- 瀏覽器：本輪在本機 `127.0.0.1:3500/questions/new` 實際渲染白色圓角頁首、統一左側選單、題目內容編輯器、作答設定、提示與解答區；過期 session 隨後正確返回登入頁。因沒有可用的隔離登入帳號，本輪未新增或發布持久題目，也未重新執行登入後手機互動。
- 瀏覽器：800 × 1280 平板 viewport(檢視區)下，上方導覽列高度約 216 px，主內容緊接在導覽列後，兩者間距為 0，頁面 `scrollWidth` 為 800 px。返回控制渲染為 `href="/questions"` 的連結；未登入測試工作階段觸發導航後由帳號守衛轉至 `/account`。
- 瀏覽器：本輪重新開啟 `127.0.0.1:3500/questions/new` 後，帳號守衛依預期導回 `/account`；沒有可用的隔離登入帳號，因此沒有以瀏覽器宣稱圖片範本已完成登入後互動驗收，也沒有寫入持久資料。
- 瀏覽器：拍照／圖片／PDF 空狀態在 1280 × 720 與 390 × 844 viewport 實際渲染；圖示至標題 12 px、標題至說明約 7.2 px、說明至按鈕 16 px，390 px 寬度沒有水平溢位。臨時驗證路由已移除。
- 瀏覽器：共用檔案來源元件以實際 Clipboard API(剪貼簿 API)依序讀取 PNG、PDF 與 JSON，分別建立 `clipboard-1.png`、`clipboard-1.pdf` 與 `clipboard-1.json` 並送入既有 `onFiles`；純文字顯示可恢復的格式提示，沒有覆寫上一筆檔案結果。390 px viewport 沒有水平溢位，臨時驗證路由已移除。
- 瀏覽器：以不提供 Clipboard API 的非安全本機來源重現直接讀取失敗；修正後「貼上」按鈕維持可用並以 `role="status"` 顯示 `Ctrl+V`／`⌘V` 與裝置選檔指引，頁面沒有紅色錯誤。以實際 PNG 剪貼簿內容按 `⌘V` 可送出 `clipboard.png:image/png`；390 × 844 viewport 的 `scrollWidth` 等於 390 px。臨時驗證路由與剪貼簿內容已清理。
- 剪貼簿降級修正完成後重新凍結 production code，並重跑 `npm run lint`、31 項題目匯入測試、完整題庫檢查、8 項答案揭露、38 項學習本、2 項注音與方框、37 項持久欄位／媒體／練習整合、31 項 runtime guardrail、26 組資料庫 migration、`npm audit --audit-level=moderate` 與 production build，全部通過。Build 仍只有 Keel 文件預覽既有的 optional dependency warning；`/questions/new` 回傳 HTTP 200。
- 掃描草稿儲存回歸先以最近一筆 `review / image / ready` 批次重現 `source_documents_input_check` 拒絕，新增測試在修正前為 31/32、修正後為 32/32。修正後於原 Chrome 工作階段重試同一批次，頁面顯示「草稿已儲存到你的題目清單」，並在「我的草稿」列出 1 題；原始圖片與已處理資產未被覆寫。
- 掃描草稿修正後重新凍結 production code；`npm run lint`、完整題庫檢查、8 項答案揭露、38 項學習本、2 項注音與方框、37 項持久欄位／媒體／練習整合、31 項 runtime guardrail、26 組資料庫 migration、`npm audit --audit-level=moderate` 與 production build 全部通過。實際批次維持 `review / image`、`pasted_text IS NULL`、1 筆含 `draftKey` 的候選題目；`/questions/new` 回傳 HTTP 200。
- 實際圖片草稿批次 `86eaed68-5b88-48b0-8fbc-92da73e20b40` 曾被解析為 2 個題組與 15 個小題。這項結果已判定錯誤；現行契約要求建立 15 道獨立題目，且不保存「一、國字注音」與「二、解釋」等章節標題。既有草稿在新分析成功前保持不變，避免以未通過品質檢查的結果覆寫。
- 2026-10-20 以同一實際圖片重跑後，固定本機 `qwen3.8:27b` vision model(圖片理解模型)超過 4 分鐘上限，API 回傳 `LOCAL_MODEL_TIMEOUT`，未產生可驗收的新候選。批次與來源文件已分別回到 `failed / failed`，原本 2 筆候選仍保留，沒有被逾時結果部分覆寫。15 道獨立題目的正規化已由契約測試覆蓋，但本次實際圖片不能列為端到端成功證據。
- 同一草稿的來源文字完整對上既有「第四課」，系統在「加入題庫」確認畫面預填「國語／國一／上學期／翰林版／第四課」。確認發布按鈕未執行，因此沒有建立正式題目，也沒有改動既有題庫。
- 本輪最終驗收：Ai Slop Cleaner 完成重複文案與無效分支檢查；Code Review 核對重新分析交易、題組層級、目錄唯一比對與發布單元關聯；Security Review 核對帳號資產擁有權、參數化查詢、模型輸入不可信邊界及未確認不得發布；UltraQA 完成 `npm run lint`、45 項題目匯入測試、108 題題庫檢查、8 項答案揭露、38 項學習本、39 項題目呈現整合、31 項 runtime guardrail、26 組資料庫 migration、`npm audit --audit-level=moderate`、production build、`git diff --check` 與 `/questions/new` HTTP 200。沒有已知阻擋問題；build 只有 Keel 文件預覽既有的 optional dependency warning。
- 章節分類拆題修正完成後重新凍結 production code。`npm run lint`、52 項題目匯入測試、108 題題庫檢查、8 項答案揭露、38 項學習本、37 項題目呈現整合、31 項 runtime guardrail、26 組資料庫 migration、`npm audit --audit-level=moderate`、production build、`git diff --check` 與 `/questions/new` HTTP 200 全部通過。Build 仍只有 Keel 文件預覽既有的 optional dependency warning。
- 上傳後立即開啟草稿編輯畫面的回歸測試在修正前因找不到獨立上傳步驟而失敗，修正後通過。`npm run lint`、53 項題目匯入測試、31 項 runtime guardrail、production build、`git diff --check` 與 `/questions/new` HTTP 200 均通過；登入後工作台已在 Chrome 實際顯示拍照、裝置／雲端選檔及貼上入口。未使用現有帳號上傳測試檔，避免在持久資料建立測試批次。
- 題目工作台導覽層級完成調整。Chrome 實際顯示左側「建立題目／我的草稿」與右側「檔案上傳／格式匯入／手動編輯」；分頁可切換，選取項使用 `rgb(98, 94, 209)` 主色。「我的草稿」顯示對應頁首與草稿清單，不顯示建立方式分頁。390 × 844 viewport 下三個分頁等寬排列，頁面 `scrollWidth` 等於 390 px；重新載入後沒有新增 Console error。
- 單題編輯流程完成後，53 項題目匯入測試、TypeScript 型別檢查、31 項 runtime guardrail、production build 與 `git diff --check` 通過。Chrome 實際從範本建立兩題，新增後自動切到「第 2 題，共 2 題」，畫面只有一個 `[data-authoring-layout="practice"]`；桌面與 390 × 844 手機版皆可操作，手機版 `scrollWidth` 等於 390 px。測試只改動瀏覽器記憶體，未儲存草稿或發布題目。
- 注音辨識規則新增專案技能 `.agents/skills/zhuyin-question-recognition/`、正式規格 `docs/bopomofo-question-recognition.md` 與執行期檢查。模型不得把作答位置改寫成答案；無法逐字確認時只能保留緊密的來源裁切。送入模型的圖片除校正全頁外，另包含放大的 OCR 行證據圖。
- 注音回歸測試先重現「個性魯莽：ㄌㄨˇ ㄇㄤˇ」被錯誤接受，以及待確認裁切被拒絕；修正後 `npm run test:question-import` 為 58/58、`npm run lint` 為 exit 0。專案技能以 OpenAI `skill-creator` 的 `quick_validate.py` 驗證通過；驗證器的 PyYAML 由一次性 `uv` 環境提供，未加入專案依賴。
- 2026-10-20 對使用者提供的實際圖片執行只讀驗證。PaddleOCR 可辨認題目國字，但把注音目標辨識成「尢」、「u马」、「日x」與「分メ」等混合字形，證實一般 OCR 文字不可作為注音權威來源。整頁分析在第二輪仍漏掉「二-5」；只裁切第一大題後仍漏掉「一-10」。兩次都回傳 `LOCAL_MODEL_INCOMPLETE_QUESTIONS`，沒有寫入資料庫，也沒有把不完整結果覆寫至草稿。這項實測代表防錯契約生效，不代表目前本地模型已具備可靠的注音自動辨識能力。
- 注音辨識 production code 凍結後，`npm run build` 為 exit 0，並包含 31/31 runtime guardrail、TypeScript 型別檢查與 29 個靜態頁面產生；build 仍只有 Keel 文件預覽既有的 optional dependency warning。`npm audit --audit-level=moderate` 回報 0 項漏洞。
- 草稿編輯器已從既有草稿清單回應取得原始上傳檔的最小資訊。圖片草稿顯示可點選縮圖並以對話框查看完整原圖；PDF 草稿可在同一對話框預覽或另開原檔。檔案內容仍由既有私有資產端點提供，端點會檢查登入帳號、資產擁有者、用途、掃描狀態、大小與雜湊，不回傳儲存路徑或公開網址。
- 原始檔預覽 production code 凍結後，`npm run lint`、59/59 題目匯入測試、31/31 runtime guardrail、28 組資料庫 migration 前進／回滾／再次前進與 schema parity、`npm audit --omit=dev`、production build 及 `git diff --check` 全部通過。Build 仍只有 Keel 文件預覽既有的 optional dependency warning；測試瀏覽器沒有可用的隔離登入帳號，因此本輪未以持久帳號建立草稿或宣稱完成登入後點擊驗收。
- 注音人工校對階段已接入既有豐富內容編輯器。標示為「待確認的注音原文」的私人裁切圖可放大查看；使用者輸入注音、聲調與可選的成對引號或括號後，才能把該裁切原位替換成文字。國字、拉丁字母、不成對外框與空白輸入無法確認；裁切仍待確認時，內容工具列不允許直接移除證據圖。
- 注音人工校對 production code 凍結後，Ai Slop Cleaner 刪除數 0，沒有新增抑制指令、廢棄分支或重複資料格式；Code Review 與 Security Review 沒有發現阻擋問題。UltraQA 完成 `npm run lint`、61/61 題目匯入測試、31/31 runtime guardrail、28 組資料庫 migration 前進／回滾／再次前進與 schema parity、`npm audit --omit=dev`、production build 及 `git diff --check`，全部通過。Build 仍只有 Keel 文件預覽既有的 optional dependency warning。現有登入工作階段只有一份分析失敗、0 題且沒有待確認裁切的草稿；為避免建立持久測試資料，本輪沒有宣稱完成注音校對的瀏覽器端到端驗收。
- 圖片草稿只在草稿名稱旁顯示一個可點開的原始檔縮圖。題目卡內不再重複顯示大型原稿、影像版本選單或第二個原稿入口。題目內為保留作答內容而建立的裁切圖片不受影響。
- 題數完整性規則接受題號黏著國字與題號獨立成行，也會忽略章節前方的空白括號等版面雜訊。章節明載配分時，系統可以用配分補足 OCR 遺漏的題號；「每字」章節至少要先辨識出兩個不同題號。實際 `clipboard-1.png` 的 OCR 已包含第一部分 1 至 10 與第二部分 1 至 5，舊規則卻把預期題數算成 0，造成單題輸出通過。回歸測試現在要求 15 題，單題輸出會被拒絕並重試。
- 2026-10-21 最終驗收通過：62/62 題目匯入測試、108 題題庫檢查、8/8 答案揭露、38/38 學習本、41/41 題目呈現整合、31/31 runtime guardrail、28 組資料庫 migration 前進／回滾／再次前進與 schema parity、TypeScript 型別檢查、`npm audit --omit=dev`、production build 及 `git diff --check`。Build 仍只有 Keel 文件預覽既有的 optional dependency warning。Chrome 已讀取新版工作台；該瀏覽器帳號只有一份分析失敗、0 題的草稿，與平板截圖中的 1 題草稿不是同一份可存取資料，因此沒有宣稱完成該草稿的登入後視覺操作。
- 2026-10-21 作答設定版面改為依可用寬度排列。文字作答在桌面與平板把「作答方式／正確答案／作答格數」置於同一列，390 px 手機改為單欄；題目卡、作答區與提示區的內距及區塊間距同步縮減，圖片、表格與解析編輯器仍保留完整寬度。Chrome 以 800 × 1280 viewport 驗證三欄的實際寬度為 176／351／104 px，`scrollWidth` 等於 800 px；390 × 844 viewport 為單欄，`scrollWidth` 等於 390 px。驗收用範本只存在瀏覽器記憶體，完成後已重新載入，沒有儲存草稿或發布題目。`npm run test:question-import` 63/63、`npm run lint`、production build 與 `git diff --check` 均通過；build 只有 Keel 文件預覽既有的 optional dependency warning。

## 2026-10-21 多來源檔案與答案建議交接

- Repository：`/Users/jean/Documents/GitHub/lerniqa`；branch：`main`；最後已推送 commit：`2c1715ecd8370d0efb055d7c873c562a9c8ef3bb`。本輪未 commit、未 push、未部署；工作樹原本已有大量其他未提交變更，本輪沒有清理或覆寫。
- 一次掃描批次現在可接收 1 至 20 個 JPG、PNG、WebP 或 PDF，每個檔案上限 20 MB。每份來源都有 `auto / question / answer / explanation / supplement` 用途；自動判斷會保存模型信心與理由，使用者指定用途則為權威值。
- 背景工作只從 `question` 來源建立題目，`answer` 與 `explanation` 來源用於產生答案與解析建議。未提供答案頁時可依題目推導低信心建議；建議只顯示於草稿，按「套用答案」後仍須儲存，系統不會直接寫入或發布。已有答案不再顯示過期建議，多格文字題維持人工批改。
- `0029_question_source_document_roles` 已只向前套用本機持久資料庫，未 reset 或 seed。多檔批次建立加入帳號與 idempotency key 的交易鎖，避免同一上傳同時重送時互相移除物件檔案。
- 最終驗收：Ai Slop Cleaner 未發現廢棄分支、重複來源格式或可刪除的 production code；Code Review 核對多來源位置、題目來源歸屬、舊單檔草稿相容、建議不自動套用與重送交易；Security Review 核對登入帳號、來源資產擁有權、檔案內容嗅探、檔案數量／大小、參數化 SQL、模型輸入白名單與答案確認邊界，沒有已知阻擋問題。
- UltraQA：`npm run lint`、65/65 題目匯入測試、108 題題庫檢查、8/8 答案揭露、38/38 學習本、39/39 題目呈現整合、31/31 runtime guardrail、29 組 migration 前進／限制／逐階段回滾／再次前進與 schema parity、`npm audit --audit-level=moderate`、production build、`git diff --check` 與 `/questions/new` HTTP 200 全部通過。Build 只有 Keel 文件預覽既有的 optional dependency warning。
- 本機服務與背景 worker 均在執行，Ollama `0.34.4` 已安裝固定 digest 的 `qwen3.8:27b`，並回報 `vision` 能力。登入後 Chrome 已實際重新載入草稿 API，桌面、768 × 1024 平板及 390 × 844 手機版均顯示多檔用途說明與建立題目分頁，沒有再次出現「無法讀取題目草稿」。
- Chrome 擴充目前未開啟本機檔案 URL 權限，因此無法以自動化選檔器選入兩個合成檔案；本輪沒有為驗收修改瀏覽器權限，也沒有向持久帳號新增測試草稿。多檔選取、角色欄位與上傳契約由 65 項題目匯入測試及 DOM 設定驗證，完整登入後多檔端到端仍須使用隔離合成帳號執行。

## 2026-10-21 草稿名稱與來源檔排列

- 草稿編輯器改為固定呈現「草稿名稱 → 原始檔案 → 狀態與操作」。名稱使用獨立完整列，來源檔案緊接在名稱下方，不再與重新分析按鈕擠在同一列。
- 原始檔案區顯示檔案總數，並以 responsive grid(響應式網格)陳列同一草稿的所有來源圖片或 PDF。每個檔案保留原有預覽、用途選擇、AI 信心與理由；單一檔案與多檔案共用同一份元件與資料來源。
- Chrome 使用既有 15 題圖片草稿完成只讀操作驗證。桌面版確認資訊順序正確；768 × 1024 平板與 390 × 844 手機的來源區都位於名稱欄下方 16 px，兩種 viewport(視窗尺寸)的 `scrollWidth` 均等於 `innerWidth`，沒有水平溢位。既有帳號只有一份來源檔，因此多檔換欄由 65 項題目匯入測試與響應式網格契約驗證；本輪沒有儲存、重新分析或發布。
- Production code 凍結後，Ai Slop Cleaner、Code Review 與 Security Review 均沒有已知阻擋問題。UltraQA 通過 `npm run lint`、65/65 題目匯入測試、108 題題庫檢查、8/8 答案揭露、38/38 學習本、39/39 題目呈現整合、31/31 runtime guardrail、29 組 migration 前進／限制／逐階段回滾／再次前進與 schema parity、`npm audit --audit-level=moderate`、production build、`git diff --check` 與 Tailscale `/questions/new` HTTP 200。Build 只有 Keel 文件預覽既有的 optional dependency warning。

## 2026-10-21 既有草稿追加原始檔案

- 圖片或 PDF 草稿的「原始檔案」區新增共用檔案來源元件，可從裝置、系統雲端檔案選擇器、相機、剪貼簿或已設定的 Google Picker 一次加入多張圖片或 PDF。新增入口不建立另一份草稿。
- 前端先保存既有來源用途，再把新檔追加到同一個批次。後端共用首次上傳的內容嗅探、20 MB 單檔限制與格式規則，以帳號和操作識別碼產生私人資產，並在草稿批次鎖內檢查擁有權、工作狀態、重送與 20 份總上限。資料與整份重新分析工作在同一交易建立；檔案資料庫寫入失敗時移除本次新建的物件檔。
- 分析進行中或已達 20 份時保留入口但停用，並在原位置說明原因。新增成功後編輯器清除舊的暫存分析結果，背景工作完成時再載入同一草稿的新結果；使用者可離開頁面。
- 登入後 Chrome 已確認桌面版新增入口位於原始檔案標題區，390 × 844 手機版排列為兩欄操作及滿版貼上，`scrollWidth` 等於 390 px。本輪只讀驗證現有 15 題草稿，沒有選檔、重新分析、儲存或發布。
- Production code 凍結後，Ai Slop Cleaner 未發現平行上傳流程、廢棄分支或可刪除的 production code；Code Review 核對同批次追加、先保存用途、成功重送先於工作衝突、總數上限與整份重新分析；Security Review 核對登入帳號、批次擁有權、內容嗅探、檔案大小、私人資產、交易鎖與失敗物件清理，沒有已知阻擋問題。UltraQA 通過 `npm run lint`、68/68 題目匯入測試、108 題題庫檢查、8/8 答案揭露、38/38 學習本、39/39 題目呈現整合、31/31 runtime guardrail、29 組 migration 前進／限制／逐階段回滾／再次前進與 schema parity、`npm audit --audit-level=moderate`、production build 及 `git diff --check`。Build 只有 Keel 文件預覽既有的 optional dependency warning。

## 2026-10-21 建立題目操作按鈕尺寸

- 工作台導覽、頁首操作、建立方式、題目切換、來源操作及內容工具按鈕統一縮減高度、內距、字級與圖示。桌面的一般操作高度為 37.6 px，頁首操作為 35.2 px，建立方式為 37.6 px；「新增提示」及文字、公式、表格、圖片、拍照、貼上等密集編輯工具為 28 px，純圖示操作為 32 px。
- 原始檔案區的「新增圖片或 PDF／拍照新增／貼上」維持同寬網格，桌面與手機高度都改為 32 px。來源按鈕明確使用橫向 `inline-flex`，不受草稿欄位的通用 `label { display: grid }` 規則影響。
- 390 × 844 手機版的主要文字按鈕仍保留 44 px 高，純圖示操作為 40 px。原始檔案操作為 32 px，「新增提示」及內容類型工具依使用者指定維持 28 px 的最小尺寸。
- 原始檔案卡片改為上方縮圖、下方用途選單。圖片縮圖不顯示眼睛圖示或查看文字，點擊後仍開啟既有原始檔預覽對話框；用途選單改用共用 `AppSelect`，高度為 32 px。多份來源使用 160 至 192 px 的自動填欄網格，單一來源不再橫向撐滿整列。
- Ai Slop Cleaner 未發現新增註解、廢棄分支或平行按鈕實作。Code Review 確認最小尺寸集中在既有內容工具、提示操作與原始檔案來源樣式；三個來源入口仍共用等寬網格與檔案選擇元件。Security Review 確認本輪只修改呈現層與樣式契約，沒有變更上傳、權限、資產或資料邊界。
- UltraQA 通過 `npm run lint`、68/68 題目匯入測試、108 題題庫檢查、8/8 答案揭露、38/38 學習本、41/41 題目呈現整合、31/31 runtime guardrail、29 組 migration 前進／限制／逐階段回滾／再次前進與 schema parity、`npm audit --audit-level=moderate`、production build、`git diff --check`、桌面／390 × 844 手機瀏覽器驗證及 Tailscale `/questions/new` HTTP 200。Build 仍只有 Keel 文件預覽既有的 optional dependency warning。
- 完整驗證 log 位於 `local-data/verification/question-authoring-minimal-source-buttons-2026-10-21/`。本輪未 commit、未 push、未部署，也未修改草稿或題庫資料。
- 原始檔卡片的最終版改為直向排列：圖片縮圖在上，32 px 的共用 `AppSelect` 用途選單緊接在下；圖片縮圖內不顯示眼睛圖示或查看文字，檔名只保留於無障礙名稱與預覽對話框。桌面實測卡片寬 192 px、縮圖高 112 px；390 × 844 手機版卡片寬 324 px，縮圖高 112 px、選單高 32 px，`scrollWidth` 等於 390 px。點擊縮圖已實際開啟「上傳的原始檔」對話框，沒有儲存或重新分析草稿。
- 最終版重新完成 Ai Slop Cleaner、Code Review、Security Review 與 UltraQA，沒有已知阻擋問題。驗證通過 `npm run lint`、68/68 題目匯入測試、108 題題庫檢查、8/8 答案揭露、38/38 學習本、41/41 題目呈現整合、31/31 runtime guardrail、29 組 migration、套件弱點掃描、production build、`git diff --check` 及 Tailscale `/questions/new` HTTP 200；完整 log 位於 `local-data/verification/question-authoring-vertical-source-card-2026-10-21/`。Build 仍只有 Keel 文件預覽既有的 optional dependency warning。本輪未 commit、未 push、未部署，也未修改草稿或題庫資料。
- 原始檔案區的「可一次新增多張圖片或 PDF」與草稿狀態改為同一份說明群組。桌面版共同位於三個新增來源按鈕左側；390 × 844 手機版依閱讀順序位於按鈕上方，不再於來源清單下方重複顯示草稿狀態。Chrome 實測桌面為橫向排列、手機為直向排列，兩段文字順序正確，兩種 viewport 均無水平溢位。
- 本次排列調整完成 Ai Slop Cleaner、Code Review、Security Review 與 UltraQA，未新增平行狀態來源或改變上傳、重新分析及權限邊界。驗證通過 `npm run lint`、68/68 題目匯入測試、108 題題庫檢查、8/8 答案揭露、38/38 學習本、41/41 題目呈現整合、31/31 runtime guardrail、29 組 migration、套件弱點掃描、production build、`git diff --check` 及 Tailscale `/questions/new` HTTP 200；完整 log 位於 `local-data/verification/question-authoring-source-copy-layout-2026-10-21/`。Build 與開發頁面仍只有 Keel 文件預覽既有的 optional dependency warning；CSS hot reload 曾留下 Next.js 開發期 `removeChild` 警告，production build 不受影響。本輪未 commit、未 push、未部署，也未儲存或重新分析草稿。
- 「儲存用途並重新分析」已從原始檔案清單下方移到草稿名稱欄位右側。桌面實測按鈕位於輸入框右側，兩者底部對齊；390 × 844 手機版按鈕移到輸入框下方並與欄位同寬，`scrollWidth` 等於 390 px。按鈕顯示條件、停用狀態與重新分析處理函式均未改變。
- 本次位置調整完成 Ai Slop Cleaner、Code Review、Security Review 與 UltraQA，沒有已知阻擋問題。驗證通過 `npm run lint`、68/68 題目匯入測試、108 題題庫檢查、8/8 答案揭露、38/38 學習本、41/41 題目呈現整合、31/31 runtime guardrail、29 組 migration、套件弱點掃描、production build、`git diff --check` 及 Tailscale `/questions/new` HTTP 200；完整 log 位於 `local-data/verification/question-authoring-reanalyze-title-row-2026-10-21/`。Build 仍只有 Keel 文件預覽既有的 optional dependency warning。本輪未 commit、未 push、未部署，也未儲存或重新分析草稿。

## 2026-10-21 題目編輯器內框白底

- 題目內容、單一內容區塊、圖片選項內的內容編輯器、每筆作答前提示與答案建議使用白色背景；細邊框仍用來區分可編輯範圍。包住整份編輯內容的最外層框已移除，避免同一題出現多重套框。頁面外層背景、進度、選取狀態與主要操作維持既有品牌色。
- 作答前提示進一步收斂為「區段分隔線、單筆提示邊界、實際輸入框」三層資訊結構；移除提示區外框，以及單筆提示內內容編輯器與文字區塊的重複邊框和內距。多筆提示仍各自保留清楚邊界與刪除操作。
- Chrome 實際開啟既有 15 題圖片草稿完成只讀驗證。711 px 寬度與 390 × 844 手機 viewport 下，題目內容、內容區塊與提示區的 computed style(計算後樣式)均為 `rgb(255, 255, 255)`；390 px 寬度的 `scrollWidth` 等於 viewport，沒有水平溢位。本輪沒有儲存、重新分析或發布。
- Ai Slop Cleaner 未發現新增註解、廢棄分支或平行樣式實作。Code Review 確認變更只作用於題目編輯器內框，不會移除狀態、進度或主要操作的辨識色。Security Review 確認本輪未修改登入、上傳、資產、模型或資料邊界。
- UltraQA 通過 `npm run lint`、68/68 題目匯入測試、108 題題庫檢查、8/8 答案揭露、38/38 學習本、41/41 題目呈現整合、31/31 runtime guardrail、29 組 migration 前進／限制／逐階段回滾／再次前進與 schema parity、`npm audit --audit-level=moderate`、production build、`git diff --check`、桌面／手機瀏覽器驗證及 Tailscale `/questions/new` HTTP 200。Build 仍只有 Keel 文件預覽既有的 optional dependency warning。
- 完整驗證 log 位於 `local-data/verification/question-authoring-white-inner-frames-2026-10-21/`。本輪未 commit、未 push、未部署，也未修改草稿或題庫資料。
- 使用者確認不需要包住整份編輯內容的最外層框後，`.authoringCanvas` 只保留寬度約束；桌面與 390 × 844 手機 viewport 的 computed style 均為 0 px 邊框、0 px 內距及透明背景。題目內容與作答區本身的白底細框保留。
- 移除最外層框後重新執行 Ai Slop Cleaner、Code Review、Security Review 與 UltraQA，沒有已知阻擋問題。完整驗證再次通過 68/68 題目匯入測試、108 題題庫檢查、8/8 答案揭露、38/38 學習本、41/41 題目呈現整合、31/31 runtime guardrail、29 組 migration、套件弱點掃描與 production build；log 位於 `local-data/verification/question-authoring-no-outer-frame-2026-10-21/`。
- 題目編輯器的「作答方式」已改用全站共用 `AppSelect`。頁面原有的原生下拉樣式會排除 `data-slot="native-select"`，避免覆蓋 Keel Select 的尺寸、圓角、箭頭與焦點狀態。
- Chrome 實測「作答方式」輸出為 `data-slot="native-select"`，高度 36 px、圓角 16 px，鍵盤焦點顯示設計系統的紫色外框。390 × 844 手機 viewport 的 `scrollWidth` 等於 390 px。完整驗證通過 68/68 題目匯入測試、108 題題庫檢查、8/8 答案揭露、38/38 學習本、41/41 題目呈現整合、31/31 runtime guardrail、29 組 migration、套件弱點掃描與 production build；log 位於 `local-data/verification/question-authoring-app-select-2026-10-21/`。
- Chrome 以既有 15 題圖片草稿加入一筆未儲存的暫存提示，驗證簡化後結構。1920 px 桌面與 390 × 844 手機 viewport 下，提示區只有上方分隔線、每筆提示的一層白色邊界及實際輸入框；內容編輯器與內容區塊的邊框及內距均為 0。手機 `scrollWidth` 等於 390 px，未出現水平溢位；驗證後未儲存草稿。
- 本輪 Ai Slop Cleaner 未發現新增註解、廢棄分支或平行提示樣式。Code Review 確認樣式只收斂提示區，圖片選項與其他豐富內容編輯器不受影響。Security Review 確認未修改登入、上傳、資產、模型或資料邊界。UltraQA 通過 `npm run lint`、68/68 題目匯入測試、108 題題庫檢查、8/8 答案揭露、38/38 學習本、41/41 題目呈現整合、31/31 runtime guardrail、29 組 migration、套件弱點掃描、production build、`git diff --check` 及 Tailscale `/questions/new` HTTP 200；log 位於 `local-data/verification/question-authoring-hint-simplification-2026-10-21/`。本輪未 commit、未 push、未部署，也未修改草稿或題庫資料。
- 內容區塊本身不再顯示外框。桌面版使用「拖移把手、內容、刪除」單列排列；拖移把手支援滑鼠拖放，也可聚焦後使用上下方向鍵排序。680 px 以下才把內容移到第二列，排序把手與刪除仍留在第一列。
- Chrome 實測桌面版的排序把手、類型、內容欄與刪除按鈕位於同一列。390 × 844 手機 viewport 下，內容欄位於第二列，排序把手與刪除按鈕位於第一列；內容區塊邊框為 0，`scrollWidth` 等於 390 px，Console 沒有錯誤。
- Ai Slop Cleaner 未發現新增註解、廢棄排序分支或重複內容區塊樣式。Code Review 確認排序資料仍由既有 `blocks` 陣列驅動，拖放與鍵盤操作共用同一個重排函式。Security Review 確認變更只處理瀏覽器內的草稿排序，未修改上傳、資產、權限或持久化邊界。UltraQA 通過 `npm run lint`、68/68 題目匯入測試、108 題題庫檢查、8/8 答案揭露、38/38 學習本、41/41 題目呈現整合、31/31 runtime guardrail、29 組 migration、套件弱點掃描、production build、`git diff --check` 及 Tailscale `/questions/new` HTTP 200；log 位於 `local-data/verification/question-authoring-block-row-2026-10-21/`。本輪未 commit、未 push、未部署，也未儲存或發布草稿。
- 作答設定列的 `AppSelect`、正確答案輸入框與作答格數輸入框統一使用 1 rem 外框圓角。規則只作用於 `.answerSettings`，不更動題目文字區、分類欄位或其他頁面的共用輸入元件。
- Chrome 實測三個控制項的 computed style 圓角均為 16 px。390 × 844 手機 viewport 的三個圓角仍一致，`scrollWidth` 等於 390 px。Ai Slop Cleaner、Code Review 與 Security Review 未發現新增阻擋問題；本輪只修改局部樣式與契約測試，沒有變更資料、權限或元件公開 API。UltraQA 通過 `npm run lint`、68/68 題目匯入測試、108 題題庫檢查、8/8 答案揭露、38/38 學習本、41/41 題目呈現整合、31/31 runtime guardrail、29 組 migration、套件弱點掃描、production build、`git diff --check` 及 Tailscale `/questions/new` HTTP 200；log 位於 `local-data/verification/question-authoring-answer-radius-2026-10-21/`。本輪未 commit、未 push、未部署，也未修改草稿或題庫資料。

## 2026-10-21 原始檔案說明合併

- 原始檔案區的新增檔案說明、掃描處理說明與目前草稿狀態合併成一句，直接顯示在「原始檔案」與檔案數量下方。掃描結果存在時不再於原始檔案區下方顯示另一條掃描提示；處理中、失敗、完成與數量上限狀態仍由同一位置動態呈現。
- Chrome 以既有 15 題圖片草稿完成只讀驗證。桌面版與 390 × 844 手機版都只有一段合併文字，手機版文字位於新增按鈕上方；兩種 viewport 的原始檔案區 `scrollWidth` 均等於 `clientWidth`，沒有水平溢位。本輪沒有儲存、重新分析或發布草稿。
- Ai Slop Cleaner 未發現重複文案、廢棄樣式或平行狀態來源。Code Review 確認三段文字使用既有草稿與掃描狀態組合，沒有新增資料來源；Security Review 確認本輪只修改呈現與契約測試，未改變上傳、權限、模型或持久化邊界。
- UltraQA 通過 `npm run lint`、68/68 題目匯入測試、108 題題庫檢查、8/8 答案揭露、38/38 學習本、41/41 題目呈現整合、31/31 runtime guardrail、29 組 migration 前進／限制／逐階段回滾／再次前進與 schema parity、`npm audit --audit-level=moderate`、production build、`git diff --check` 及 Tailscale `/questions/new` HTTP 200。Build 仍只有 Keel 文件預覽既有的 optional dependency warning；完整 log 位於 `local-data/verification/question-authoring-source-summary-2026-10-21/`。本輪未 commit、未 push、未部署，也未修改草稿或題庫資料。

## 2026-10-21 作答設定欄位高度

- 題目編輯器同一列的作答方式、正確答案與作答格數統一使用 2.65 rem 高度，保留既有 1 rem 圓角與響應式排列。規則限定於 `.answerSettings`，不改變全站共用 `AppSelect` 或其他輸入元件。
- Chrome 實測桌面版與 390 × 844 手機版三個控制項的渲染高度均為 42.3984375 px；手機版 `scrollWidth` 與 390 px viewport 相同，沒有水平溢位。本輪沒有儲存、重新分析或發布草稿。
- Ai Slop Cleaner、Code Review 與 Security Review 沒有發現新增阻擋問題；變更只涉及局部樣式、契約測試與正式規格。UltraQA 通過 `npm run lint`、68/68 題目匯入測試、108 題題庫檢查、8/8 答案揭露、38/38 學習本、41/41 題目呈現整合、31/31 runtime guardrail、29 組 migration 前進／限制／逐階段回滾／再次前進與 schema parity、`npm audit --audit-level=moderate`、production build、`git diff --check` 及 Tailscale `/questions/new` HTTP 200。Build 仍只有 Keel 文件預覽既有的 optional dependency warning；完整 log 位於 `local-data/verification/question-authoring-answer-height-2026-10-21/`。本輪未 commit、未 push、未部署，也未修改草稿或題庫資料。

## 2026-10-21 解答預設文字欄位

- 「解答與解析」沒有內容時直接呈現空白文字欄位，適用於手動新增題目、小題及分析結果沒有解析的既有草稿；空白欄位只有開始輸入後才更新草稿。作答前提示標題下方的「學習者自行展開後才會看到，不會影響判分」已移除。
- Chrome 以既有解答為空的圖片草稿完成只讀驗證。桌面版與 390 × 844 手機版都直接顯示「解答與解析文字」欄位，不再顯示「加入內容」，指定提示文案不存在；手機 `scrollWidth` 等於 390 px。本輪沒有儲存、重新分析或發布草稿。
- Ai Slop Cleaner、Code Review 與 Security Review 沒有發現新增阻擋問題；既有非空解析、豐富內容與答案揭露規則不受影響。UltraQA 通過 `npm run lint`、68/68 題目匯入測試、108 題題庫檢查、8/8 答案揭露、38/38 學習本、41/41 題目呈現整合、31/31 runtime guardrail、29 組 migration 前進／限制／逐階段回滾／再次前進與 schema parity、`npm audit --audit-level=moderate`、production build、`git diff --check` 及 Tailscale `/questions/new` HTTP 200。Build 仍只有 Keel 文件預覽既有的 optional dependency warning；完整 log 位於 `local-data/verification/question-authoring-default-explanation-2026-10-21/`。本輪未 commit、未 push、未部署，也未修改草稿或題庫資料。

## 2026-10-21 批改方式共用下拉元件

- 題目編輯器「更多設定」中的「如何批改」改用全站共用 `AppSelect`，選項仍由 `ImportGradingPolicy` 的完整對照表產生，保留人工批改、AI 輔助批改與自動判分三種值及既有更新行為。
- Chrome 實測元件輸出為 `data-slot="native-select"`，目前值為人工批改，三個選項與資料值均正確；390 × 844 手機版選單寬度與欄位容器相同，`scrollWidth` 等於 390 px。本輪沒有變更或儲存草稿資料。
- Ai Slop Cleaner、Code Review 與 Security Review 沒有發現新增阻擋問題；本輪沿用既有 `AppSelect`，未增加平行下拉元件或改變資料邊界。UltraQA 通過 `npm run lint`、68/68 題目匯入測試、108 題題庫檢查、8/8 答案揭露、38/38 學習本、41/41 題目呈現整合、31/31 runtime guardrail、29 組 migration 前進／限制／逐階段回滾／再次前進與 schema parity、`npm audit --audit-level=moderate`、production build、`git diff --check` 及 Tailscale `/questions/new` HTTP 200。Build 仍只有 Keel 文件預覽既有的 optional dependency warning；完整 log 位於 `local-data/verification/question-authoring-grading-select-2026-10-21/`。本輪未 commit、未 push、未部署。

## 2026-10-21 題目工作台獨立路由

- 題目工作台不再使用獨立的 `tab` state 模擬頁面。檔案上傳、格式匯入、手動編輯、草稿清單與單一草稿分別使用 `/questions/new/upload`、`/questions/new/import`、`/questions/new/edit`、`/questions/drafts` 與 `/questions/drafts/[batchId]`；舊 `/questions/new` 以 HTTP 307 導向檔案上傳頁。
- `app/questions/layout.tsx` 持有共用 `QuestionImportWorkspace`，所以在建立方式之間切換、使用瀏覽器上一頁或返回既有草稿時，不會因子路由切換清除尚未送出的檔案與編輯內容。直接開啟或重新整理單一草稿網址時，工作區會從目前帳號可見的草稿清單比對 `batchId` 後載入；找不到時不直接呼叫任意草稿 API。
- Chrome 實測格式匯入、手動編輯、檔案上傳、草稿清單及既有草稿均顯示對應網址。格式匯入欄位的未送出文字在切換至檔案上傳再使用上一頁返回後仍保留；既有草稿直接重新整理後仍載入 15 題與原始圖片。草稿路由的左側選單正確標示「我的草稿」。本輪只讀既有草稿，沒有儲存、重新分析、刪除或發布。
- Ai Slop Cleaner 未發現殘留 `setTab`、廢棄分支、重複工作區或對話式註解。Code Review 確認 URL 是唯一畫面來源，路由切換沿用同一份工作區狀態，背景輪詢不會重載並覆寫已開啟草稿。Security Review 確認草稿網址只會從登入帳號已取得的草稿清單載入，原有 API 與資產擁有權檢查未放寬。
- UltraQA 通過 `npm run lint`、69/69 題目匯入測試、108 題題庫檢查、8/8 答案揭露、38/38 學習本、41/41 題目呈現整合、31/31 runtime guardrail、29 組 migration 前進／限制／逐階段回滾／再次前進與 schema parity、`npm audit --audit-level=moderate`、production build、`git diff --check` 及五個 Tailscale 路由回應檢查。Build 仍只有 Keel 文件預覽既有的 optional dependency warning；完整 log 位於 `local-data/verification/question-authoring-routes-2026-10-21/`。本輪未 commit、未 push、未部署，也未修改草稿或題庫資料。

## 2026-10-21 作答前提示調整

- 題目編輯器將「解答與解析」移到「作答前提示」之前。沒有提示時只顯示小型「新增提示」按鈕；新增後才顯示區段標題與提示編輯內容。
- 八種題目範本不再預先寫入示範提示。既有草稿中的提示不會被刪除，來源明確包含提示時仍可建立；這項規則只改變新建或更換範本時的預設資料。
- Chrome 以既有圖片草稿完成只讀驗證。桌面版與 390 × 844 手機版都先顯示「解答與解析」，再顯示 28 px 高的「新增提示」按鈕；空提示不顯示標題或編輯框，手機主內容 `scrollWidth` 等於 390 px。本輪沒有儲存、重新分析或發布草稿。
- 階段驗證通過 25/25 題目匯入契約測試、`npm run lint`、31/31 runtime guardrail、production build 與 `git diff --check`。Build 只有 Keel 文件預覽既有的 optional dependency warning。本輪未 commit、未 push、未部署。

## 2026-10-21 學習者作答區背景

- 學習者作答區的最外層框改用與原始檔案卡一致的 `#faf9fd` 淡紫色背景。內部題目內容、作答欄位、解答與解析及提示編輯欄維持白底，不增加新的套框層級。
- Chrome 實測外框與原始檔案卡的 computed background(計算後背景色)均為 `rgb(250, 249, 253)`，內部文字欄為白色。390 × 844 手機版主內容 `scrollWidth` 等於 390 px，沒有水平溢位；本輪沒有修改或儲存草稿。
- 階段驗證通過 25/25 題目匯入契約測試、`npm run lint`、31/31 runtime guardrail、production build 與 `git diff --check`。Build 只有 Keel 文件預覽既有的 optional dependency warning。本輪未 commit、未 push、未部署。

## 2026-10-21 草稿名稱列尺寸

- 草稿名稱輸入框與「儲存用途並重新分析」按鈕使用相同高度與圓角。桌面為 2.65 rem，680 px 以下為 2.75 rem；手機仍維持上下滿寬排列。
- Chrome 實測桌面兩者高度均為 42.3984375 px、圓角均為 10.4 px；390 × 844 手機版兩者均為 44 px 高、324 px 寬，主內容 `scrollWidth` 等於 390 px。本輪沒有修改或儲存草稿。
- 階段驗證通過 25/25 題目匯入契約測試、`npm run lint`、31/31 runtime guardrail、production build 與 `git diff --check`。Build 只有 Keel 文件預覽既有的 optional dependency warning。本輪未 commit、未 push、未部署。

## 2026-10-21 建立方式滿寬分頁

- 「檔案上傳／格式匯入／手動編輯」改為滿寬三欄分頁列，三個選項平均分配寬度。外框、選取狀態與既有路由行為不變。
- Chrome 實測 1920 px 桌面版的三個分頁各約 450.5 px；390 × 844 手機版各約 111.2 px，主內容 `scrollWidth` 等於 390 px，沒有水平溢位。本輪只讀取版面尺寸，沒有修改或儲存草稿。
- 階段驗證通過 25/25 題目匯入契約測試、`npm run lint`、31/31 runtime guardrail、production build 與 `git diff --check`。Build 只有 Keel 文件預覽既有的 optional dependency warning。本輪未 commit、未 push、未部署。

## 2026-10-21 標題列草稿狀態

- 草稿開啟、背景處理與儲存結果移到「建立題目／我的草稿」大標題旁，以緊湊狀態標籤呈現，不再於建立方式下方占用獨立提示列。窄螢幕維持同一標題列並允許自然換行。
- Chrome 實測桌面版的狀態標籤與「建立題目」位於同一父層並緊接標題右側，頁面下方沒有重複狀態列；390 × 844 手機版在同一標題列內換行，`scrollWidth` 等於 390 px。本輪沒有修改或儲存草稿。
- 階段驗證通過 25/25 題目匯入契約測試、`npm run lint`、31/31 runtime guardrail、production build 與 `git diff --check`。Build 只有 Keel 文件預覽既有的 optional dependency warning。本輪未 commit、未 push、未部署。

## 2026-10-21 手動產生答案與解析

- 尚未填寫答案的作答區新增「AI 分析答案與解析」。操作只分析目前小題並回傳答案、簡短解析及信心值，先顯示為待確認建議；使用者按下「套用答案與解析」後才寫入答案欄與解析編輯器。
- 手動分析不覆寫已有答案。圖片背景分析原本依答案頁、解析頁及題目來源產生建議的流程維持不變；編輯器內手動觸發則依目前題目內容推導，不宣稱讀取原始圖片。
- Chrome 實測既有辨識錯誤題幹時，本地模型回傳無可靠建議，畫面保持空答案且沒有修改草稿。以不寫入資料庫的「1 + 1」合成題執行同一函式時，本地模型回傳答案 `2`、解析「1 加 1 等於 2。」及 95% 信心值。390 × 844 手機版可看到分析按鈕，`scrollWidth` 等於 390 px。
- Ai Slop Cleaner 沒有發現新增廢棄分支或重複模型規則。Code Review 確認手動按鈕與背景分析共用同一個答案 schema、輸出驗證及人工確認流程。Security Review 確認新 API 要求登入、拒絕未知欄位、只接受通過草稿契約的單題，且不寫入資料庫。UltraQA 通過 70/70 題目匯入測試、`npm run lint`、31/31 runtime guardrail、production build 與 `git diff --check`。Build 只有 Keel 文件預覽既有的 optional dependency warning。本輪未 commit、未 push、未部署。

## 2026-10-21 答案分析操作回饋

- 手動答案分析是同步等待本地模型回傳的前景操作，不是可離開頁面的背景工作。先前處理結果只顯示在頁首狀態，使用者停留在作答區時看不到；按鈕文字又會在請求完成後立即復原，因此容易誤判為沒有執行。
- 作答區現在於按鈕旁顯示持續的局部狀態。分析中使用旋轉圖示與 `aria-busy`；成功、資訊不足與失敗訊息在請求結束後保留，讓使用者可就地確認或重新執行。套用或略過建議後才清除該狀態。
- Chrome 以既有圖片草稿實際觸發分析。本題資訊不足時，作答區保留「資訊不足，未產生答案或解析」，按鈕恢復可用且 `aria-busy="false"`。390 × 844 手機版仍顯示局部狀態，頁面 `scrollWidth` 等於 390 px。階段驗證通過 70/70 題目匯入測試、`npm run lint`、31/31 runtime guardrail、production build 與 `git diff --check`。Build 只有 Keel 文件預覽既有的 optional dependency warning。本輪未 commit、未 push、未部署，也未儲存草稿。

## 2026-10-21 注音題答案方向

- 本地模型原本把題幹「個性魯『ㄇㄤˇ』」誤解為替「魯」標注音，曾回傳錯誤答案「ㄇㄤˇ」。答案分析現在會從引號內的純注音辨識 `han_from_bopomofo` 作答方向，明確要求模型依前後文填入國字，並拒絕只重複原注音的輸出。
- 圖片辨識與手動解題仍維持不同邊界。圖片辨識只抄錄原稿，不得補答案；使用者按下「AI 分析答案與解析」後，解題流程才可依已校對題幹推導答案。
- 同一題直接呼叫固定本地模型後回傳答案「莽」、解析「組成詞語『魯莽』」與 95% 信心值。Chrome 在既有草稿頁重新觸發後顯示相同答案與解析建議；沒有按下「套用答案與解析」，因此未修改或儲存草稿。
- 驗證通過 72/72 題目匯入測試、`npm run lint`、31/31 runtime guardrail、production build 與 `git diff --check`。Build 只有 Keel 文件預覽既有的 optional dependency warning。本輪未 commit、未 push、未部署。

## 2026-10-21 答案分析按鈕主色

- 「AI 分析答案與解析」改用主色實心按鈕。按鈕尺寸、分析中旋轉圖示、停用狀態與局部結果訊息維持不變。

## 2026-10-21 格式匯入建立草稿

- 格式 JSON 通過契約檢查後會立即建立持久草稿，再切換到 `/questions/drafts/[batchId]`。原本流程只把題目載入前端編輯器，因此離開頁面後「我的草稿」沒有新紀錄。
- 不含圖片參照的 JSON 於按下「檢查並建立草稿」後建立；含圖片或原稿裁切參照的 JSON，會在所有參照完成配對並按下「建立草稿並校對」後建立。兩條路徑共用既有草稿 POST API，不另建平行資料寫入流程。
- Chrome 以一題合成簡答題完成實際驗證。頁面建立獨立草稿路由，顯示「已建立新草稿，共 1 題」，資料庫確認 `input_type = 'text'`、`status = 'review'`、題數為 1。驗證草稿之後已標記 `cancelled`，未留在使用者草稿清單。

## 2026-10-21 圖片分析裁切參照

- 圖片分析失敗的直接原因是本地模型讓不同裁切範圍共用同一個 `crop_ref.ref`，因此題目交換契約以 `LOCAL_MODEL_INVALID_QUESTIONS` 拒絕整頁結果；舊草稿內容未被覆寫。
- 本地模型輸出進入題目契約前，系統現在依題目、作答區與內容位置重新建立唯一且穩定的裁切參照。頁碼、來源、比例座標、替代文字及其他題目欄位仍照原契約驗證，外部 JSON 匯入也維持要求來源自行提供唯一參照。
- 回歸測試先以兩個不同裁切共用 `bopomofo-target` 重現相同契約錯誤，修正後得到 `q1-shared-2` 與 `q2-shared-2`。階段驗證通過 74/74 題目匯入測試、TypeScript 型別檢查與 `git diff --check`。本輪未重新分析或修改既有草稿，未部署。

## 未完成與阻擋

- 2026-10-21 以既有測試草稿 `97d0b292-9b0a-435f-8a62-fa6c23647cea` 執行重新分析。工作 `e12e287a-4a89-42a0-9289-5935c2fde612` 在第一次嘗試後以 `LOCAL_MODEL_INVALID_QUESTIONS` 結束；安全檢查沒有接受模型產生的錯誤注音，也沒有覆寫原草稿。資料庫核對確認一-2 至一-5 仍保留人工校正的「學問『ㄩㄢ』博」、「溫文『ㄖㄨˊ』雅」、「『ㄅㄧㄢˋ』才無礙」與「『ㄉㄨㄣ』實謹慎」。介面原先因同一個 PostgreSQL 參數同時被推導為 `text` 與 `varchar`，在儲存來源用途時回報 `inconsistent types deduced for parameter $3`；更新語句已將來源用途參數明確轉成 `varchar(20)`。同一個按鈕重新驗證後成功建立工作 `7224a954-e021-4e09-a019-b6b57fe6d991`，畫面進入背景分析中。
- 尚無取得授權的固定拍攝資料集，不能執行 Apple Notes、Google ML Kit 與 Lerniqa 的盲測，也不能宣稱已達市場專業 App 效果。
- 背景工作已解除瀏覽器請求的四分鐘限制；單次本機模型呼叫上限改為十分鐘，工作執行期間持續延長租約。這只改善可離開與可恢復性，不代表辨識品質已達標。跨頁共用題幹與跨頁題組仍不會自動合併；沒有明確題號的版面也沒有完整性數量保證，必須由使用者在草稿中校正。
- 固定 `qwen3.8:27b` 已以既有實際來源資產完成不寫入資料庫的分析成功案例，15 題在 309,644 ms 內通過模型輸出與內容契約。尚未以隔離合成帳號從上傳、背景 worker、草稿寫入一路完成端到端案例，因此不能把本次只讀分析視為整條持久流程驗收。
- 固定 `qwen3.8:27b` 對本輪注音試卷的整頁與第一大題裁切均漏題，且 PaddleOCR 無法可靠分辨小型注音。現階段只能將可靠抄錄或緊密來源裁切送入待確認草稿；要宣稱自動辨識可用，仍需建立具正確逐字標註的授權資料集，量測題目召回率、注音字元正確率與待確認率，並評估專門的文字偵測／字形辨識模型。
- UVDoc 固定模型尚未安裝；目前只保證平面透視校正，彎頁結果會標示未展平。
- 即時自動拍攝、失焦／反光提示、雙頁分割、前端拖曳四角與手寫遮罩筆刷尚未施工。
- 原 Chrome 工作階段目前可驗證既有圖片草稿的重新分析、目錄預填與發布前確認；本輪未另外驗證作業系統選檔器的新檔上傳，也未執行正式發布。後續完整端到端測試仍須使用隔離的合成帳號與資料，不得清理既有持久資料。
- 本機尚未設定 `GOOGLE_DRIVE_PICKER_API_KEY` 與 `GOOGLE_DRIVE_APP_ID`，因此 Google Picker 真實帳號選取、下載及過期 token 互動尚未完成；未設定時介面會要求改用裝置選檔，不會暴露缺少的環境變數名稱。
- Keel 文件預覽仍提示缺少 `exceljs`、`docx-preview`、`@aiden0z/pptx-renderer` 與 `markdown-it` 等 optional dependency；不影響本輪題目匯入路由與 build 成功結果。
- `npm run test:local-practice` 已越過合成題庫匯入、279 題建置與 Next.js 啟動，目前在 `FORWARDED_HTTPS_REGISTRATION_INVALID` 停止：驗證器仍預期註冊請求立即回傳已完成帳號，但目前電子郵件註冊會先建立 onboarding(註冊引導)並等待信箱驗證。這是既有 auth E2E(驗證端到端測試)尚未同步目前註冊契約，與本輪題目提示及豐富內容路徑無關。

## 下一個可直接執行的動作

用隔離登入帳號從作業系統選檔器上傳合成多題圖片，補完新檔上傳、裁切資產、草稿重載、練習預覽與正式發布的完整端到端測試。接著讓隔離註冊驗證器依目前 onboarding 與信箱驗證流程取得合成帳號，再重跑 `npm run test:local-practice`。之後建立經授權的合成／去識別拍攝測試集與 manifest，加入無題號、中文序號、表格、圖片選項及跨頁題組，量測拆題完整率、內容正確率與人工修正量。其餘 Google Picker、UVDoc、角點拖曳與遮罩筆刷依既有阻擋項目處理。

## 不得回退或覆寫

- 不得恢復舊 `/bank` mock 匯入流程。
- 不得用 fixture、seed 或 reset 覆蓋題目、帳號、學習者、練習與作答紀錄。
- 不得將 OCR 或手寫去除結果未經使用者確認直接發布。
- 不得讓草稿建立流程重新要求題庫、科目、年級或其他正式分類。
- 不得把帳號自訂科目或分類欄位暴露給其他帳號，也不得讓 AI 建立或未經確認套用分類。
- 不得讓未確認草稿進入正式題目查詢、練習、題目額度或學習統計。
- 不得把未跑過固定測試集與市場盲測的結果描述為市場級效果。
- 不得把作答前提示併回題目內容或解析，也不得在答案揭露條件成立前授權解析圖片。
- 不得把 Google access token、Drive URL、內部 `assetId`、Base64 圖片或 OAuth client secret 寫進 AI 交換格式、草稿內容或版本控制。
- 不得把連續注音詞組拆成各自決定高度的直欄，也不得在題幹注音旁補出對應國字答案。
- 不得把注音題的作答位置改寫成完整詞語或補入原稿未印出的整詞讀音；無法確認時必須保留來源裁切供人工校正。
