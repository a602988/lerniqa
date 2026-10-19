# 教學小助教與教材來源閱讀器架構

狀態：架構已確認，施工中；學生教材頁面仍受授權 gate 阻擋

## 範圍與交付邊界

第一階段只解析 `115上[翰林]國中新無敵國文自修(1).pdf` 的第四課〈論語選〉。教材印刷頁碼為第 93 至 114 頁，對應 PDF 第 95 至 116 頁，共 22 頁。來源名稱保留「國文」；正式目錄對應 115 學年度、國一、系統科目「國語」（來源別名「國文」）、翰林版、上學期、第一冊、第四課。

本階段建立可重跑的解析流程、受保護頁面影像、OCR 區塊及校對資料，不改寫 279 題正式題目、題目版本、既有解析或作答紀錄，也不部署至 Vercel。學生閱讀流程的目標是從題目解析直接跳到被引用的教材頁，不提供整本 PDF、跨課瀏覽或重新編排的網頁教材。

教材頁面正式開放給學生前，仍須確認教材局部頁面的線上顯示授權。授權未確認不阻擋本機解析及內部校對，但學生 API 必須維持關閉。

## 現有系統基準

- 第四課已有 279 題已發布題目，全部固定在 revision 2。195 題有文字解析，84 題沒有解析，尚無解析圖片。
- 正式匯入來源是 `05_第四課_論語選（一）子游問孝（二）譬如為山（三）三省吾身.doc`。這份自修 PDF 是補充教學證據，不能取代既有 `question_revision_sources` 的主要匯入出處。
- `assets`、`source_documents`、`question_revision_sources` 與受權媒體端點已存在；現有媒體端點上限為 20 MiB，適合頁面影像，不適合傳送約 200 MB 的原始 PDF。
- `/api/v1/local-practice/questions/{questionId}/reference-answer` 已用目前學習者、題庫關聯及題目版本保護參考答案；`score` 模式刻意不揭露逐題答案及解析。
- 本機 `system_admin` session、管理 API、管理介面、同交易稽核與題目審核流程已存在，可以作為教材校對功能的授權基礎。預設系統管理員、MFA、Secret Manager、production RLS／GRANT 與公開部署證據尚未完成，因此本機能力不能直接視為 production 授權已就緒。

## 系統責任

### 來源保存

原始 PDF 保存為 private `source_document` asset，`source_documents.original_file_name` 必須完整保存原檔名。原始檔只供解析程序及具權限的校對流程讀取，不經學生 API 傳送。

每個指定頁面渲染為獨立 private 頁面影像。頁面影像使用新的 `source_page` asset purpose，避免把完整頁面誤標成既有的 `page_crop`。檔案放在未進版控的 `local-data/assets/source-pages/<source-document-id>/`；資料庫只保存相對 `storage_key`、checksum、大小及尺寸。

### 解析與校對

OCR 保存原始辨識文字、頁面座標、引擎版本、模型版本及信心值。人工校正文字獨立保存，不覆寫原始結果。每個區塊必須經核准後才能成為題目解析的依據。

第一階段的解析程序只處理 PDF 第 95 至 116 頁，並以固定對照 `printed_page = pdf_page - 2` 驗證印刷頁碼 93 至 114。這個對照是本次來源文件的匯入設定，不寫成全系統規則。

### 題目關聯

新增補充教材證據關聯，不修改 `question_revision_sources`。關聯固定指向 `question_revision_id`，避免題目日後換版後仍沿用舊證據。每筆關聯說明證據用途、頁面、區塊及審核狀態；沒有足夠依據時不建立關聯。

### 學生閱讀

題目結果已解鎖且存在核准證據時，參考答案回應可附帶來源摘要。前端顯示：

> 解析來源：115上[翰林]國中新無敵國文自修(1).pdf，第 97 頁

點擊後以題目、固定版本及頁面識別碼請求來源頁。後端重新驗證目前學習者、題庫存取、作答揭露狀態與核准關聯，再回傳頁面影像。閱讀器直接開啟指定印刷頁，依區塊座標畫出標示；不回傳本機路徑、`storage_key`、Google Drive 網址或整份 PDF。

## 資料模型

### 延用的資料表

- `assets`：保存原始 PDF 與逐頁影像的檔案中繼資料。
- `source_documents`：保存原始檔名、來源 asset、輸入類型及處理狀態。
- `question_revisions`：所有教材證據固定連到實際使用的題目版本。
- `question_revision_sources`：維持原始題目匯入出處，不承擔補充教材證據。

### 新增的資料表

`source_document_catalog_profiles` 保存整份來源文件的正式教材範圍：

| 欄位 | 用途 |
| --- | --- |
| `source_document_id` | 來源文件，一份文件只有一個目前有效的教材範圍 |
| `academic_year` | 學年度，例如 115；不得從檔名於查詢時臨時推測 |
| `grade_id` | 年級 |
| `subject_id` | 科目 |
| `semester_id` | 上、下學期 |
| `book_version_id` | 出版社版本 |
| `volume_unit_id` | 冊次在教材樹中的正式節點 |
| `review_status` | `pending`、`approved` 或 `rejected` |
| `reviewed_by_user_id`、`reviewed_at` | 審核者與時間 |

`source_document_catalog_profiles` 必須檢查年級、科目、版本與冊次屬於同一條正式教材目錄。來源檔名保留作為證據，但不能代替這些外鍵。頁面所屬課次由頁面資料另行保存，因此整本來源可以涵蓋多課，不會被錯誤綁成單一課。

`source_document_processing_runs` 保存每次解析的來源 checksum、設定 checksum、parser version、OCR 引擎與模型。批次從 `pending` 單向進入 `processing`，最後成為 `completed` 或 `failed`；完成或失敗後不可覆寫。相同來源、設定與 parser version 只能建立一筆，供重跑時辨識既有結果。

`source_document_pages` 保存來源文件內可閱讀的頁面：

| 欄位 | 用途 |
| --- | --- |
| `id` | 頁面識別碼 |
| `source_document_id` | 所屬來源文件 |
| `pdf_page_number` | PDF 實際頁序，從 1 起算 |
| `printed_page_number` | 學生看見的印刷頁碼 |
| `curriculum_unit_id` | 這一頁所屬課次；跨課頁面保持空值並等待人工確認 |
| `asset_id` | private `source_page` 頁面影像 |
| `width`、`height` | 標示區域換算及影像核對 |
| `render_version` | 渲染工具與設定版本 |
| `created_at` | 建立時間 |

同一來源文件的 PDF 頁序不可重複；本次來源的印刷頁碼也不可重複。若未來遇到跨段重複頁碼，需另增頁碼區段，不放寬成模糊對照。

`source_document_blocks` 保存 OCR 與人工校正結果：

| 欄位 | 用途 |
| --- | --- |
| `id` | 區塊識別碼 |
| `source_document_page_id` | 所屬頁面 |
| `block_type` | 標題、正文、注釋、翻譯、圖表、練習、解答解析或其他 |
| `bounds_left`、`bounds_top`、`bounds_width`、`bounds_height` | 0 至 1 的正規化矩形座標 |
| `raw_text` | 不可覆寫的 OCR 原始文字 |
| `corrected_text` | 人工校正文字 |
| `ocr_engine`、`ocr_version` | OCR 可追溯資訊 |
| `confidence` | OCR 信心值 |
| `review_status` | `pending`、`approved` 或 `rejected` |
| `reviewed_by_user_id`、`reviewed_at` | 審核者與時間 |
| `revoked_by_user_id`、`revoked_at` | 已核准區塊後續撤回的管理員與時間；不覆蓋原審核紀錄 |

`question_revision_source_evidence` 保存補充教材證據：

| 欄位 | 用途 |
| --- | --- |
| `id` | 關聯識別碼 |
| `question_revision_id` | 固定題目版本 |
| `source_document_block_id` | 核准的教材區塊 |
| `evidence_role` | 概念、課文、注釋、翻譯、選項判斷、解答理由或圖片 |
| `position` | 同一題的來源顯示順序 |
| `review_status` | `pending`、`approved` 或 `rejected` |
| `linked_by_user_id`、`reviewed_by_user_id`、`reviewed_at` | 建立與審核證據 |
| `revoked_by_user_id`、`revoked_at` | 已核准證據後續撤回的管理員與時間 |

只允許有效且已核准的目錄範圍與區塊被核准為正式證據。同一題目版本、區塊及證據用途不可重複。已核准資料不可原地改寫；需要停用時另記撤回者與時間。第一階段不新增 AI 生成解析表；先證明教材解析及題目證據能正確追溯，之後才以獨立 migration 加入模型輸出、prompt 版本與審核狀態。

## 目錄與元件邊界

```text
local-data/assets/source-documents/<document-id>/original.pdf
local-data/assets/source-pages/<document-id>/<pdf-page>.webp
local-data/source-ingestion/<document-id>/manifest.json
scripts/import-teaching-source.mjs
scripts/lib/teaching-source-parser.mjs
app/lib/teaching-source-store.ts
app/api/v1/local-practice/questions/[questionId]/source-pages/[pageId]/route.ts
```

`manifest.json` 是本機匯入檢查點，保存來源 checksum、頁面範圍、頁碼對照、渲染與 OCR 版本及每頁 checksum；正式可查詢資料仍以 PostgreSQL 為準。manifest 與教材檔案都不進 Git。

匯入腳本提供 `inspect` 與 `apply` 兩種模式。`inspect` 只產生核對報告；`apply` 在所有頁面已渲染、checksum 完整且頁碼對照通過後，才以單一交易寫入來源文件、頁面及 OCR 區塊。相同來源 checksum、頁面範圍及 parser version 重跑時必須重用同一批結果，不重複建立資料。

## API 與授權

來源摘要應併入現有參考答案揭露流程，而不是另開一條可繞過答案規則的查詢。資料層先沿用 `getLocalPracticeQuestionReferenceAnswers` 的題庫與版本檢查，再增加作答狀態限制：

- `instant`：該題已送出後可看。
- `complete`：整份練習完成後可看。
- `score`：不回傳來源摘要或頁面。
- 沒有練習作答脈絡的題庫預覽：沿用現有具結果查看權限的行為，但在施工計劃中需明確決定是否要求已提交紀錄；不得從前端旗標推定。

頁面影像端點使用 question ID、revision ID 與 page ID 作為查詢範圍。後端只在該固定版本有核准證據、目前學習者能存取題目且答案揭露允許時提供影像，並回傳 `Cache-Control: private, no-store`。知道 asset ID、page ID 或檔名都不能直接取得內容。

第一階段由受控匯入腳本產生 pending 紀錄，再擴充既有管理後台完成校對與核准。所有管理寫入沿用現有 `system_admin` session、same-origin 檢查、重新驗證與 append-only 稽核，不建立平行登入或只靠前端隱藏的入口。production 開放仍須補齊既有管理後台列出的部署與高權限身分條件。

## 本地 AI 邊界

本地模型是後續階段的解說產生器，不參與第一階段的真實資料寫入。未來模型輸入只包含固定題目版本、該次作答的必要錯誤資訊及已核准教材區塊；禁止把整本 PDF、未校正 OCR、其他學習者資料或 handwriting worker 的隔離輸入混在同一工作。

模型輸出必須保存模型名稱與 digest、prompt version、輸入 checksum、引用區塊及審核狀態。找不到足夠教材證據時回傳「尚無教材解析」，不得補造來源或把既有一般解析偽裝成教材內容。

## 失敗處理與回滾

- 原始 PDF checksum、頁數或指定頁面不符時，停止匯入且不寫資料庫。
- 任一頁渲染或 OCR 失敗時，保留本機工作檔與錯誤報告；不建立半套 ready 文件。
- `apply` 的資料庫寫入失敗時整筆交易回滾；已產生但未被資料列引用的頁面檔案由明確的 orphan 清單處理，不自動遞迴刪除目錄。
- 已核准的區塊與證據不原地覆寫。更正時建立新版本或使舊證據失效並保留歷史，避免學生看到的來源無法追查。
- 關閉學生來源頁端點即可回滾閱讀功能，不影響題目、練習及作答資料。

## 第一階段驗證

- 來源檔名、SHA-256、總頁數及第四課 PDF／印刷頁碼對照一致。
- 恰好建立 22 個頁面紀錄；每個頁面 asset 都是 private、clean、尺寸與 checksum 相符。
- OCR 原始結果與人工校正欄位分離；失敗重跑不新增重複頁面或區塊。
- 匯入前後的 279 題數量、目前 revision、既有解析數與作答資料不變。
- 核對報告能以檔名及印刷頁碼指出每個頁面，不含 Google Drive URL 或本機絕對路徑。
- 學生頁面端點在未授權、錯誤學習者、錯誤版本、`score` 模式及未核准證據時一律拒絕。

## 待確認決策

- 教材局部頁面是否有權提供給 Lerniqa 學生線上查看。未確認前只做本機解析與內部校對。
- 正式校對與核准角色採 `system_admin`；production 的預設管理員、MFA、Secret Manager 與資料庫權限仍是部署 gate。
- 題庫預覽頁是否可以在未作答時查看教材來源。建議第一版只從已解鎖的作答結果進入，降低答案與教材內容提前洩漏的風險。
- OCR 引擎需用代表性的直排古文、注音、表格及圖片頁做品質實驗後再選定；現有手寫辨識 worker 不直接重用。
