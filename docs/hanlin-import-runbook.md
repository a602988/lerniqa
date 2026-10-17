# 翰林題庫匯入與排錯

這份文件保存已驗證的匯入故障、修正方式與重跑順序。它只適用於 repository 內的本機 PostgreSQL 與翰林國文匯入器，不是 production 操作手冊。來源文件留在本機，不要把真實學生資料、密碼、token 或本機完整路徑寫進紀錄。

## 每次正式匯入前後怎麼做

### 來源欄位的保存、tag 與篩選契約

來源文件每題若提供「認知向度」或「知識向度」，匯入器必須把兩者分開保存，不得遺漏、互相覆蓋或只留在匯入預覽／`import_items.draft_payload`。非空值必須同時寫入目前題目 revision 的 `question_revision_filter_values`，保留來源文件的原始標籤與原始值，並透過題庫 API 回傳，讓題目詳情顯示 tag、題目總覽與練習設定產生可用篩選選項。沒有該欄位的題目不得捏造預設值。

新增其他來源欄位時也遵守同一契約：先定義穩定的欄位 key、名稱、值型別與適用範圍，再保存每題的來源值並完成 API、tag、篩選與回歸測試。畫面出現文字不代表資料已可篩選；驗收必須同時確認 current revision 的欄位值、API metadata、題目 tag 與實際篩選結果。parser 若改變來源欄位內容，必須升版並建立新 revision，舊 revision 保留為 `superseded`，不得就地修改已發布版本。

正式匯入前，先確認 PostgreSQL 是 repository 管理的私有 Unix socket，再建立備份。不要用 `DATABASE_URL` 指向其他資料庫來省略本機檢查。

```bash
npm run db:local:ensure
npm run db:local:status
npm run db:local:backup
```

正式寫入請從 npm 指令進入。`predb:import:hanlin` 會先執行 `test:import-preflight`，檢查第四至第六課及語文常識（二）各自的寫入範圍、核准原檔 SHA-256、目標單元、預期題數與發布狀態、Word 控制碼清理、PostgreSQL 參數型別、分類候選識別、答案完整性契約、交易回滾與原始分類證據。先做 dry-run，確認摘要只有一個來源檔，且解析、可發布、待檢視與失敗數量完全符合該檔白名單，再移除 `--dry-run` 正式寫入。語文常識（二）因題號 `05011838` 的來源圖片本身已是破圖，占位題必須保持待檢視；其餘核准檔目前要求待檢視為 0。舊版 Word 的圖片／OLE 選項只能在原檔 SHA-256、題號、答案鍵與每張圖片 checksum 全部固定時加入 `approvedChoiceRepairs`，不得只憑畫面相似或人工猜測發布。

| 課次 | 核准檔名 | 預期題數 | 原檔 SHA-256 |
| --- | --- | ---: | --- |
| 第四課 | `05_第四課_論語選（一）子游問孝（二）譬如為山（三）三省吾身.doc` | 279 | `c2b09d04ef9e0a32a2fbe71a8f8e930d2061fb87e78bb6bc60f694df6be8cfb2` |
| 第五課 | `06_第五課_背影.doc` | 280 | `0b03109efbcb0b5d540dad97fb0865c560970c0d239df94ad0b9b894c9c6122c` |
| 第六課 | `07_第六課_心囚.doc` | 258 | `0ef11f041367d443b2507c6878d576aadf0e783cf0471c9ff78c021497090c2c` |
| 語文常識（二） | `08_語文常識（二）閱讀導航－－策略運用與資訊檢索.doc` | 76（發布 75、待檢視 1） | `bb39eab9e7c2d37c97dcc81f8703922fe377032d1d64e246c8c4d22318ac0cbd` |
| 素養題第四課 | `04_第四課_論語選（一）子游問孝（二）譬如為山（三）三省吾身.doc` | 24（發布 24） | `8ef8951a7995b7252cd8de151495f12fd4e4c72f3e26a17d27b9b57b94004a77` |
| 語文基礎段考卷 | `02_語文常識（二）閱讀導航－－策略運用與資訊檢索.doc` | 40（發布 40） | `8d0789f35174cda2124609f08909bc79d1a79a7d62c64d405db6b056309c3ec8` |

```bash
npm run db:import:hanlin -- \
  "/題庫路徑/05_第四課_論語選（一）子游問孝（二）譬如為山（三）三省吾身.doc" \
  --dry-run

npm run db:import:hanlin -- \
  "/題庫路徑/05_第四課_論語選（一）子游問孝（二）譬如為山（三）三省吾身.doc"
```

第五、六課與語文常識（二）使用相同命令格式替換檔名。目錄只可搭配 `--dry-run` 盤點；沒有產品分類決定前，不可把其他來源正式寫入已核准單元。寫入後要跑資料庫與 API 驗證，再建立一份新備份。

```bash
npm run test:import-ownership
npm run test:local-practice
npm run db:local:backup
```

若改過 migration、writer 或完整性限制，還要先跑 `npm run db:test`。這個指令使用一次性隔離資料庫驗證前進、限制、回滾與 schema parity，不可改接既有或 production 資料庫。

## 已驗證的故障與修正

### 匯入批次狀態的 PostgreSQL 參數型別衝突

- 現象：第一次正式寫入在完成批次狀態時失敗，PostgreSQL 回報 SQLSTATE `42P08` 的參數型別推斷衝突。
- 已驗證根因：同一個 `$2` 同時寫入 `varchar(20)` 欄位，又在 `CASE` 中與字串常值比較。PostgreSQL 對兩個使用位置推斷出不相容的型別。
- 修正位置：`scripts/lib/hanlin-postgres-writer.mjs`。`SET status` 與 `CASE WHEN` 都明確使用 `$2::varchar(20)`。
- 驗證結果：加上 cast 後，parser v1 的 279 題正式寫入成功。`tests/hanlin-import-guardrails.test.mjs` 會防止兩個 cast 被移除。
- 預防檢查：正式匯入使用 `npm run db:import:hanlin -- ...`，讓 `test:import-preflight` 先執行；修改狀態 SQL 後再跑一次實際交易驗證。
- 適用版本：所有使用目前 PostgreSQL writer 的匯入；parser v1 發現，parser v2 仍保留修正。

### 選擇題答案鍵不屬於該小題的選項

- 現象：資料模型原本可能保存畫面上不存在的答案鍵，造成學生無法選到標準答案，判分也會失真。
- 已驗證根因：`question_answers.answer_key` 與 `question_options.option_key` 跨資料表，原本的欄位限制不能保證兩者屬於同一個 `question_part_id`。
- 修正位置：`database/migrations/0007_practice_answer_integrity.up.sql` 加入可延後的 constraint trigger；`scripts/lib/hanlin-postgres-writer.mjs` 也在發布前確認單選答案存在於同一小題的選項。
- 驗證結果：`database/tests/0007_practice_answer_integrity.sql` 已覆蓋不存在的答案鍵、刪除或改名仍被引用的選項，以及把答案或選項移到另一小題的情況；合法的同交易改名仍可通過。
- 預防檢查：修改題目、選項、答案 schema 或 writer 後執行 `npm run db:test`；不要在正式環境停用或繞過延後限制。
- 適用版本：schema `0007` 之後。

### 盤點目錄被誤當成第四課正式匯入範圍

- 現象：15 份來源文件曾一起 dry-run 盤點，容易被誤解為都可以歸入第四課。這次沒有把其他 14 份文件寫入資料庫，也沒有產生錯誤分類的正式題目。
- 已驗證根因：檔案可被解析，只代表格式可讀；它不代表產品已核准年級、冊別與課次分類。目錄盤點和正式寫入是兩種不同權限的操作。
- 修正位置：`scripts/import-hanlin-chinese-postgres.mjs` 只允許正式寫入白名單中的第四至第六課與語文常識（二）來源；每份來源都要求固定檔名、原檔 SHA-256、目標單元與預期狀態。匯入器會用單一檔案描述元讀入來源，先把這組 bytes 寫進私有暫存快照，後續轉檔與隔離備份都只使用這份快照，避免驗雜湊後的來源替換競態。目錄、其他檔名，或同名但內容不同的檔案都不可正式寫入。
- 驗證結果：第四至第六課的 parser v5 confirmed 批次各只含一個來源文件，題數為 279、280、258；語文常識（二）的 parser v6 review 批次解析 76 題、發布 75 題，兩張有效統計圖以固定 checksum 對應題號 `05011868`、`05011869`，來源已破圖的 `05011838` 保留待檢視。2026-10-17 再從固定來源還原並發布三題：`05013285` 的四個統計圖選項與答案 B、`05013836` 的四列文字選項與答案 D、`05013843` 的四張對話圖選項與答案 B；圖片選項各自連到 A–D，不得合併成題幹附圖。目前資料庫共有 1,095 個國語 current published revision，1 個來源題號待檢視。前置測試會確認非授權檔名在讀檔前就被拒絕，也會拒絕改成授權檔名的其他內容。
- 預防檢查：每一個新課次都要先有自己的核准分類、固定檔名與預期題數，才能擴充正式寫入白名單；不可只改命令列路徑。
- 適用版本：目前核准第四至第六課與語文常識（二）的本機持久資料匯入。

### parser 升級後的分類候選識別衝突

- 現象：parser v2 第一次正式寫入失敗，錯誤為 `DATABASE_IDENTITY_CONFLICT`，欄位是 `source_document_classification_candidates.parser_version`。
- 已驗證根因：v1 的分類候選固定識別沒有包含 parser 版本。v2 重用相同 ID 時，writer 發現同一筆 ID 的 `parser_version` 不同，因此拒絕覆寫歷史。
- 修正位置：`scripts/lib/hanlin-postgres-writer.mjs`。原始 unit 候選與七個正式分類候選的 deterministic ID 都包含 `plan.parserVersion`；每個分類維度只保留目前版本的一筆 `approved`，舊版本改為 `rejected`，原始待核對候選仍保留。
- 驗證結果：v2 批次 `2d1ff794-f6f4-5e59-baaa-8d1c767438be` 成功解析並發布 279 題、失敗 0 筆、重新分類 279 題。相同輸入再跑時 `reusedBatch=true`、重新分類 0 題，仍是 279 題。v1 的七筆正式分類已改為 `rejected`，v2 七個維度各只有一筆 `approved`，違反唯一正式分類的查詢為 0 筆。
- 預防檢查：任何會改變解析或分類結果的 parser 升級都要改版本；固定識別中必須保留 parser 版本，並測一次舊版資料升級與新版相同輸入重跑。
- 適用版本：parser v2 之後。

### 舊版 Word 的 `\S\do` 序號控制碼進入題幹

- 現象：parser v1 寫入後，279 個 current revision、282 個 current content block 含有 `\S\do` 前綴，正常練習畫面會直接顯示 Word 版面控制字串。
- 已驗證根因：LibreOffice 轉換舊版 `.doc` 時，把部分 Word sequence field 保存成可見文字；這些字串是題號版面指令，不是題目內容。
- 修正位置：`scripts/lib/hanlin-chinese-import.mjs` 的 `stripLegacyWordSequenceFieldPrefixes`，在解析題目之前移除已知前綴。它只處理行首的既知結構，不會刪除一般數字開頭，例如「2026 年」。
- 驗證結果：parser v2 寫回後，資料庫 279 題的 current revision 全部是 revision 2；current content 中含 `\S\do` 的題目與內容區塊都是 0。單元測試覆蓋兩種實際控制碼與一般數字開頭。
- 預防檢查：新增 Word 來源格式時先 dry-run，抽查題幹並搜尋 `\S\do`；若出現不同控制碼，只新增能重現該格式的窄規則，不用廣泛刪除反斜線或數字。
- 適用版本：parser `hanlin-zh-doc-v2`。

### 失敗交易留下半套資料或資產

- 現象：批次狀態型別衝突與第一次 v2 分類候選衝突都發生在正式寫入流程；若資料庫與資產各自提交，失敗可能留下沒有完整題目的批次或沒有資料庫引用的資產。
- 已驗證根因：資料庫交易與本機檔案系統不能共用同一個原子提交，因此 writer 必須在資料庫提交前驗證資產，並在資料庫失敗時執行補償回滾。
- 修正位置：`writeHanlinPostgresImport` 從 `BEGIN` 到 `COMMIT` 包住整批資料，錯誤時執行 `ROLLBACK`；資產先進 staging，`beforeCommit` 成功後才提升，提交失敗時移除本次新增的資產。提交結果不明時則保留資產並停止，避免刪掉其實已被提交的資料。
- 驗證結果：兩次已知寫入失敗都完整回滾，沒有留下部分批次或題目；修正後才一次寫入完整 279 題。正式匯入前後的備份另由 `npm run db:local:backup` 驗證 dump 與資產 checksum。
- 預防檢查：不要把單筆 writer 呼叫移出交易，也不要在 `COMMIT` 前直接覆寫正式資產；故意注入錯誤時要比較失敗前後批次、題目與資產筆數。
- 適用版本：目前 PostgreSQL writer 的所有版本。

### 目標分類覆蓋原始課次證據

- 現象：所有核准題目都要進第四課，但來源文件內仍有「今之孝者」「譬如為山」「吾日三省吾身」等原始 unit。若只保存正式 target，之後無法追查來源怎麼分段。
- 已驗證根因：來源解析值與產品核准分類用途不同，不能共用一個欄位互相覆蓋。
- 修正位置：writer 在 draft payload 保存 `originalTitle`、`originalUnit` 與 `originalLabels`；分類候選另存一筆沒有 target ID 的 pending 原始 unit，再把第四課保存成獨立的 approved target。
- 驗證結果：279 題的原始 unit 分布為「今之孝者」67 題、「今之孝者／譬如為山／吾日三省吾身」1 題、「吾日三省吾身」92 題、「譬如為山」110 題、「譬如為山／吾日三省吾身／今之孝者」9 題。`scripts/verify-local-practice.mjs` 會拒絕缺少原始 unit 候選、含私人絕對路徑或缺少第四課正式分類的資料。
- 預防檢查：新增解析欄位時先分清楚它是來源證據還是正式分類；正式分類可以更新，來源檔名、雜湊、原始標籤與解析結果不可被 target 值取代。
- 適用版本：目前所有翰林 Word 匯入。

### build、重啟與 3500 port

- 現象：已有開發伺服器監聽 3500 時再次啟動會回報 `EADDRINUSE`。Next.js 開發程序與 build 同時操作 `.next` 也不能當成可靠驗證。
- 已驗證根因：同一個 port 只能有一個監聽者；更重要的是，dev 與另一個 dev/build 同時共用 `.next` 會改寫瀏覽器正在使用的 chunk。200 回應仍可能伴隨 `ChunkLoadError`，畫面會卡在「正在確認登入狀態」。
- 修正位置：`next.config.ts` 接受 `LERNIQA_NEXT_DIST_DIR`；`npm run dev` 固定使用 `.next-dev`，`npm run build` 與 `npm start` 使用 `.next-build`。不要另開第二個 3500 dev 程序，但分離後的 build 不會再破壞正在服務的 dev chunks。
- 驗證結果：受控重啟後 `http://127.0.0.1:3500/`、`http://127.0.0.1:3500/account` 與 `http://127.0.0.1:3500/local-practice` 都回傳 HTTP 200；瀏覽器還必須完成 hydration，不可只看 HTTP 狀態。
- 預防檢查：每次 build 後都檢查三個入口與瀏覽器 console，不只看終端顯示「ready」。可用 `curl --fail --silent --show-error`；畫面或 API 有改動時仍要做瀏覽器操作驗證。
- 適用版本：目前 Next.js 15 本機流程。

## 仍未定論的觀察

同一來源在不同 CLI 摘要中曾分別顯示 47、59 與 61 頁。目前沒有足夠證據確認原因，因此不能把任何推測寫成修正，也不能只用頁數判斷匯入成功。若要處理，先保存相同來源 checksum、轉換工具版本與各次可重現輸出，再定位差異；題數、來源範圍、current revision、內容控制碼、分類唯一性與批次重跑仍是現在的驗收條件。

## 新增故障紀錄時要留下什麼

只記錄能讓下一個人重現與驗證的內容：錯誤碼或可觀察現象、最小重現命令、來源 checksum 與 parser/schema 版本、已證實的根因、修改檔案、同一重現步驟的修後結果，以及新增的回歸測試。根因還沒證實時直接標為「待調查」，不要把猜測寫成結論；紀錄內不放密碼、token、email、本機完整路徑或真實兒童資料。
