# 教學小助教與教材來源解析交接

更新日期：2026-10-17

## Repository 狀態

- Repository：`/Users/jean/Documents/GitHub/lerniqa`
- Branch：`main`
- 目前 HEAD：`5286102e2e5c483b77922fac6eeb1dfb6b337413`
- 本次尚未 commit，也未部署。

## 目前範圍

第一階段只解析 `115上[翰林]國中新無敵國文自修(1).pdf` 第四課〈論語選〉，印刷頁碼 93 至 114，對應 PDF 第 95 至 116 頁。資料與執行文件放在本專案；學生端的目標是從題目解析自動跳到正確教材頁，不建立整本教材閱讀網站。

## 已完成

- 確認來源 PDF 為 364 頁掃描檔，約 200 MB，沒有可直接使用的文字層。
- 確認第四課正確範圍為 PDF 第 95 至 116 頁；先前測試的第 86 至 92 頁不是第四課。
- 盤點第四課 279 題：195 題有文字解析、84 題沒有解析、0 題有解析媒體。
- 確認正式題目匯入來源是另一份 Word 文件，自修 PDF 只能作為補充教材證據，不得覆蓋主要出處。
- 完成 `docs/concept.md` 與 `docs/vision.md` 的構想及架構提案。

## 未提交檔案與責任範圍

本次建立或修改：

- `docs/concept.md`
- `docs/vision.md`
- `docs/execution/teaching-assistant.md`

工作樹另有既存的手寫辨識與介面修改，並非本任務產生，不得回退或覆寫：

- `app/api/v1/local-practice/handwriting/transcription/route.ts`
- `app/lib/handwriting-transcription.mjs`
- `app/lib/practice-client.ts`
- `app/page.tsx`
- `tests/handwriting-analysis-worker.test.mjs`
- `tests/handwriting-persistence.test.ts`

## 驗證與證據

- 資料庫只做唯讀盤點，未執行 migration、seed、reset 或正式資料寫入。
- 原始 PDF 及診斷用頁面沒有留在 repository；暫存檔已移至系統垃圾桶。
- 架構依據：`docs/question-database-design.md`、`docs/hanlin-import-runbook.md`、`docs/system-admin-plan.md`、現有 local-practice 參考答案與 asset 授權實作。
- 文件完成後執行 `git diff --check`，exit code 0，沒有空白或 patch 格式錯誤。

## 阻擋與待決策

- 尚未確認教材局部頁面可供學生線上顯示的授權範圍。這不阻擋本機解析，但阻擋學生端開放頁面影像。
- `system_admin` 正式登入與可信管理 API 尚未完成，第一階段不應建立可發布資料的臨時管理頁。
- 架構提案尚待使用者確認；依 dev-workflow，目前不得開始 migration、解析器或正式資料寫入。

## 下一個可直接執行的動作

使用者確認 `docs/vision.md` 後，撰寫施工計劃。計劃的第一個實作節點應是：建立隔離的 parser smoke test，從來源 PDF 第 95、97、109、116 頁抽樣，量測直排古文、注音、表格及解答頁的 OCR 品質，再決定 OCR adapter；此步仍不得寫入正式資料。

## 不得回退或覆寫

- 279 題既有正式題目、revision 2、解析與作答紀錄。
- `question_revision_sources` 內的正式 Word 匯入出處。
- 工作樹中既存的手寫辨識及介面修改。
- 未確認教材顯示授權前，不得啟用學生頁面影像 API。
