# 教學小助教與教材來源解析交接

更新日期：2026-10-19

## Repository 狀態

- Repository：`/Users/jean/Documents/GitHub/lerniqa`
- Branch：`main`
- 目前 HEAD：`daa188f`，與 `origin/main` 一致
- 最後已推送 commit：`daa188f`
- 本次尚未 commit，也未部署；`0020` 尚未套用持久本機資料庫。
- 合併前建立的 stash `codex-pre-remote-merge-2026-10-19` 仍保留為安全備份；工作樹已完整套回這批變更。

## 目前範圍

第一階段只解析 `115上[翰林]國中新無敵國文自修(1).pdf` 第四課〈論語選〉，印刷頁碼 93 至 114，對應 PDF 第 95 至 116 頁。資料與執行文件放在本專案；學生端的目標是從題目解析自動跳到正確教材頁，不建立整本教材閱讀網站。

## 已完成

- 確認來源 PDF 為 364 頁掃描檔，約 200 MB，沒有可直接使用的文字層。
- 確認第四課正確範圍為 PDF 第 95 至 116 頁；先前測試的第 86 至 92 頁不是第四課。
- 盤點第四課 279 題：195 題有文字解析、84 題沒有解析、0 題有解析媒體。
- 確認正式題目匯入來源是另一份 Word 文件，自修 PDF 只能作為補充教材證據，不得覆蓋主要出處。
- 完成 `docs/concept.md` 與 `docs/vision.md` 的構想及架構提案。
- 已從指定 Google Drive 檔案取得 `115上[翰林]國中新無敵國文自修(1).pdf`。檔案共 364 頁、200,002,550 bytes，SHA-256 為 `f17aa066713cf1476a7b50ab11150eea2c0395609b1b854092886c35c6db7aad`。
- 已用 PaddleOCR 3.7.0、`PP-OCRv5_mobile_det` 與 `PP-OCRv6_medium_rec` 抽樣 PDF 第 95、97、109、116 頁，共辨識 283 個區塊。各頁平均信心值介於 0.901960 至 0.965903；直排座標可用，彩色注釋、小字、標點與插圖仍需人工校正。
- 已新增 `0020_teaching_source_evidence`，建立教材目錄範圍、處理批次、頁面、OCR 區塊及題目版本證據，並新增 private `source_page` asset purpose。
- 遠端 `0016` 至 `0019` 與順延後的 `0020` 已在隔離 PostgreSQL 完成二十組 migration 的首次前進、限制測試、逐階段 down、第二次前進及 schema parity；正式 `lerniqa_local` 未被修改。
- 已建立受版本管理的來源設定及 `teaching-source:import -- inspect`。完整解析 PDF 第 95 至 116 頁，共 22 頁、1,441 個 pending OCR 區塊；22 張 lossless WebP 的檔案大小與 SHA-256 均已核對。
- 相同輸入第二次 `inspect` 約 1.8 秒完成，沒有重新載入 OCR 模型；manifest checksum 穩定為 `b48005ce17a3b849c53e773a05d6f9e5bcde5f77e27a2936e1d993d61b9af7da`，且不含本機絕對路徑或 Google Drive URL。
- 已建立寫入前備份：`local-data/backups/lerniqa-local-20261017T150348Z`。`apply` 目前固定拒絕，尚未寫入持久資料庫。

## 未提交檔案與責任範圍

本次 T2 建立或修改：

- `docs/concept.md`
- `docs/PRODUCT_SPEC.md`
- `docs/ROADMAP.md`
- `docs/database-completion-matrix.md`
- `docs/plan.md`
- `docs/question-database-design.md`
- `docs/vision.md`
- `docs/execution/teaching-assistant.md`
- `database/README.md`
- `database/migrations/0020_teaching_source_evidence.up.sql`
- `database/migrations/0020_teaching_source_evidence.down.sql`
- `database/tests/0020_teaching_source_evidence.sql`
- `data/teaching-sources/hanlin-115-junior-high-1-chinese-volume-1-lesson-4.json`
- `scripts/import-teaching-source.mjs`
- `scripts/lib/teaching-source-parser.mjs`
- `scripts/smoke-teaching-source-ocr.py`
- `tests/teaching-source-import.test.mjs`
- `package.json`
- `README.md`

執行期間曾有其他工作階段更新手寫辨識及交接並推進 `main`；本任務沒有回退或覆寫該批提交。提交前仍須重新檢查最新工作樹，避免把其他工作階段的新變更混入。

## 驗證與證據

- 持久資料庫只做唯讀盤點，未執行 migration、seed、reset 或正式資料寫入。
- 原始 PDF 與 OCR 報告位於不進版控的 `local-data/source-ingestion/`；診斷用 `tmp/pdfs/teaching-source-smoke` 已移至系統垃圾桶。
- OCR 報告：`local-data/source-ingestion/f17aa066713cf1476a7b50ab11150eea2c0395609b1b854092886c35c6db7aad/reports/ocr-smoke.json`。
- 完整 manifest：`local-data/source-ingestion/f17aa066713cf1476a7b50ab11150eea2c0395609b1b854092886c35c6db7aad/manifest.json`。
- 完整 OCR checkpoint：`local-data/source-ingestion/f17aa066713cf1476a7b50ab11150eea2c0395609b1b854092886c35c6db7aad/runs/68346444363215c58cbf0afd3ddb86ddd224f77b865089acb8617698adfc9e9c/ocr-smoke.json`。
- Migration 驗證：`npm run db:test`，exit code 0；20 組 migration 的首次前進、限制測試、逐階段回滾、再次前進與 schema parity 均通過。
- 匯入設定測試：`node --test tests/teaching-source-import.test.mjs`，4 項通過。
- 架構依據：`docs/question-database-design.md`、`docs/hanlin-import-runbook.md`、`docs/system-admin-plan.md`、現有 local-practice 參考答案與 asset 授權實作。
- 文件完成後執行 `git diff --check`，exit code 0，沒有空白或 patch 格式錯誤。

## 阻擋與待決策

- 尚未確認教材局部頁面可供學生線上顯示的授權範圍。這不阻擋本機解析，但阻擋學生端開放頁面影像。
- 本機 `system_admin` session 與可信管理 API 已存在；production 的預設管理員、MFA、Secret Manager、受限資料庫角色與部署證據尚未完成，因此教材管理功能目前只能作本機施工與驗證。
- 架構與施工已由使用者確認。正式本機資料庫第一次套用 `0020` 前，依計劃仍需先建立備份並核對變更摘要。

## 下一個可直接執行的動作

取得使用者對持久資料庫寫入的確認後，先補齊 `apply` 的單一交易與隔離整合測試，再向前套用 `0020` 並匯入 23 筆 asset、1 份來源文件、1 筆教材範圍、1 筆處理批次、22 頁及 1,441 個 pending 區塊，共 1,489 筆。不得建立題目證據，也不得修改既有題目、revision、解析、作答或 `question_revision_sources`。

## 不得回退或覆寫

- 279 題既有正式題目、revision 2、解析與作答紀錄。
- `question_revision_sources` 內的正式 Word 匯入出處。
- 工作樹中既存的手寫辨識及介面修改。
- 未確認教材顯示授權前，不得啟用學生頁面影像 API。
