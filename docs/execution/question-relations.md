# 題型關係分析與審核交接

更新時間：2026-10-17（Asia/Taipei）

## 目前狀態

- Repository：`/Users/jean/Documents/GitHub/lerniqa`
- Branch：以目前工作樹為準；本階段未建立 commit，也未推送。
- 本階段 production code 尚未凍結，未執行 Vercel 部署。
- 工作樹同時含管理後台、手寫辨識與其他既有未提交修改；不得回退或覆寫不屬於題型關係範圍的檔案。

## 已完成

- `0014_question_relation_profiles` 建立文字模板、模板成員、正式關鍵字、題目版本關鍵字關聯與推薦來源證據。
- `0015_relation_keyword_review` 讓 AI／規則建立的關鍵字目錄先進 pending，並保存來源、方法版本、證據、審核者及審核時間。
- `questions:relations` 只讀目前已發布的系統題目，以固定本機模型分析文字骨架、解題邏輯、可變值與關鍵字；分析產檔與 pending 匯入分開執行。
- 全量分析遇到單題模型失敗時，checkpoint 會保存該題的安全錯誤摘要並繼續其他題目。只有全部題目成功、`failure_count` 為 0 且 `complete` 為 true 的檔案可以匯入 pending；重跑時保留成功結果，只重試失敗題。
- `/admin/questions/relations` 只允許 `system_admin` 讀取與審核；核准／退回使用既有同源防護、交易內權限重驗、冪等收據與管理員稽核。
- 推薦查詢只使用 confirmed 模板成員、confirmed 關鍵字關聯與 active 關鍵字。pending 資料不影響學生端。

## 持久資料

- 套用 `0015` 前的備份：`local-data/backups/lerniqa-local-20261017T061304Z`
- 本機持久資料庫已套用至 `0015`。
- 一題煙霧測試已匯入 1 個 pending 模板、1 個 pending 模板成員與 2 個 pending 關鍵字關聯。
- confirmed 題型關係仍為 0；未執行 279 題全量分析，也未自動核准任何模型結果。

## 驗證

- `npm run lint`：exit 0。
- `npm run test:question-enrichment`：27/27 通過。
- `npm run test:admin`：165/165 通過，包含 2 個題型關係審核測試。
- `npm run build`：exit 0；仍有 Keel 文件預覽器缺少四個選用套件的既有 warning。
- `npm run db:test`：第一次因 macOS shared-memory slot 不足而無法建立短命 cluster；改用受控 existing-local-server 模式後，15 組 migration 的前進、限制、逐層回滾、再次前進與 schema parity 全部通過。
- `npm run questions:relations -- --sample 1 --output local-data/question-relations-smoke-v2.json`：完成 1 題唯讀分析；同一路徑重跑直接讀取完整 checkpoint，沒有再次呼叫模型。
- `npm run questions:relations -- --persist --input local-data/question-relations-smoke-v2.json`：只建立 pending 資料，fingerprint 為 `eee3b9608772b86e4f9b948beb9ef23e1c4c3195fc95461c331b4b1277366dca`。
- 未登入存取 `/admin/questions/relations` 會回 HTTP 307 並導向 `/account?returnTo=/admin`，權限防線生效。瀏覽器控制逾時，且目前沒有可用的管理員登入狀態，因此尚未完成登入後桌面與手機實際操作驗證。

## 尚未完成與下一步

- 取得管理員登入狀態後，完成桌面與手機的後台清單、核准、退回及錯誤狀態操作驗證。
- 由管理員檢查煙霧測試的模板、可變值與兩個關鍵字，決定核准或退回；未經人工核准不得改成 confirmed。
- 煙霧測試品質通過後，才執行 279 題全量分析。全量結果仍只可匯入 pending，並需逐筆人工審核。
- 正式資料量增加後，後台待審清單目前以每類 50 筆分批處理；完成目前批次並重新整理即可取得下一批。
