# 選單與練習載入交接

這份文件供另一台電腦接續 2026-10-18 的本機工作。交接範圍只有兩項。第一項是題目篩選複選選單的版面修正。第二項是練習工作區的啟動效能。

## 先保留目前工作區

目前分支是 `main`，目前 `HEAD` 是 `ba5d48e`。工作區含大量尚未提交的既有修改。選單修正與效能診斷也尚未提交，因此另一台電腦只拉取 `main` 不會取得這些內容。

移動工作前先保存目前未提交檔案。不要執行 `git reset --hard`、`git checkout -- .`、`git clean`，或 `git add -A`。這些命令可能刪除或混入其他工作。若要建立交接提交，只加入本文件與已確認屬於本次工作的檔案。

本機 PostgreSQL 內的正式題目、帳號、學習者、session、作答與歷程不是測試資料。不要執行 seed、reset、fixture cleanup，或用隔離測試資料覆蓋 `local-data`。若另一台電腦需要相同資料，先使用既有備份流程搬移並核對資料庫身分與筆數。

## 複選選單修正已完成但尚未提交

使用者回報兩個問題。複選選單的圓形勾選框會被壓扁，選單靠近視窗底部時也會被頁面裁掉。

本機已修改以下檔案：

- `app/components/question-filter-panel.tsx`
- `app/globals.css`
- `.audit/question-filter-dropdown.todo.md`

`MultiSelectFilter` 現在會依觸發按鈕上下方的可用空間決定選單方向。選單內容會限制在可見視窗內，空間不足時改向上展開。捲動或調整視窗大小時會重新計算。勾選框固定為 `1rem × 1rem`，不再因選項文字或容器寬度而縮放。

本機已在共用的 `QuestionFilterPanel` 實際檢查桌面與手機寬度。原本的勾選框變形與底部裁切沒有再出現。型別檢查與 production build 也已完成。接手後仍要在新電腦重跑驗證，因為瀏覽器、字型與視窗高度可能不同。

驗證順序如下：

1. 執行 `npm run db:local:ensure`。這個命令只能確認既有資料庫可用，不得改用 seed 或 reset。
2. 執行 `npm run dev`。
3. 開啟 `/questions` 與 `/practice`。
4. 分別打開「來源」與「單元」複選選單。
5. 確認每個未選與已選圓框保持正圓。
6. 將按鈕移到視窗底部附近，確認選單向上展開或在視窗內捲動。
7. 以桌面寬度與手機寬度各檢查一次。
8. 執行 `npm run lint` 與 `npm run build`。

不要重新設計篩選器。這次只修正共用選單的指示框尺寸與視窗邊界。

## 練習載入慢是未完成的架構工作

本次診斷沒有修改效能程式。證據保存在以下檔案：

- `.audit/practice-entry-performance.md`
- `.audit/practice-entry-performance.todo.md`
- `.audit/learning-data-performance-design.md`
- `.audit/learning-data-performance.todo.md`

目前工作區啟動會經過以下路徑：

1. `app/page.tsx` 的 `loadBootstrap` 呼叫 `loadPersistedPractice`。
2. `app/lib/practice-client.ts` 先讀取 `/api/v1/auth/me`。
3. 客戶端並行讀取完整 `/api/v1/local-practice/questions` 與 history。
4. `app/lib/local-practice-store.ts` 取得目前學習者可用的所有題目 revision，再批次補齊小題、選項、內容、metadata 與知識點。
5. 前端解析完整題庫，轉換全部題目，建立 map，並從同一批資料計算題目總覽與練習篩選。

目前登入情境有 11,005 題。成功樣本的 questions API 花費 3,069.2 ms，壓縮傳輸量為 7,652,855 bytes。先前五次正式量測在 gzip 後的可見載入中位數為 4,857 ms，仍高於三秒門檻。本次機器負載很高，另一次 questions 請求在 16,485.9 ms 後失敗。這次失敗時間與 PostgreSQL 的 15 秒 `statement_timeout` 相符，但瀏覽器只收到通用錯誤，因此只能把 timeout 判定視為有證據支持的推論。

資料完成載入後，從題目總覽切換到「安排複習計畫」沒有重新呼叫 questions API。主要等待不是導覽按鈕或練習頁單次切換。主要成本是啟動時產生、壓縮、傳輸、解析、轉換並保留完整題庫。

## 效能工作的下一步

下一階段必須停止完整題庫啟動模式，改為路由範圍摘要、題目清單分頁，以及題目詳情按需載入。不要再提高併發、延長 timeout、提前關閉載入畫面，或加入持久瀏覽器快取。這些作法會隱藏等待或增加資料過期風險，無法移除完整題庫的重複工作。

開始寫程式前先完成以下文件工作：

1. 統一效能基準。`docs/plan.md` 仍記錄第二階段的 8,633 ms，`docs/database-completion-matrix.md` 記錄 gzip 後的 4,857 ms。將 4,857 ms 與五次範圍設為較新的權威基準，並明確標示前一個數字已被取代。
2. 定義每個路由需要的資料。`/overview`、`/questions`、`/practice` 與 `/mistakes` 不應共用一份完整題目陣列作為啟動條件。
3. 定義伺服器篩選與 facet 契約。科目、學期、版本、來源、單元、題型及 metadata 選項必須由可追溯的資料庫查詢產生，不得搬成前端常數。
4. 定義分頁與詳情契約。題目總覽只讀取目前頁面的摘要。預覽或建立 session 時，再依固定 revision 取得所需內容。
5. 定義收藏、全選篩選結果、學習本計畫與 session 建立時的穩定題目集合。未決定這些語意前，不要以寬鬆 fallback 猜測題目 ID。
6. 同步更新 `docs/PRODUCT_SPEC.md`、`docs/question-database-design.md`、`docs/local-practice-pilot.md`、`docs/database-completion-matrix.md`、`docs/plan.md` 與相關測試說明。

完成契約後再分段施工：

1. 新增路由範圍摘要與 facet 查詢，讓登入後不必讀取題目內容。
2. 將題目總覽改為伺服器分頁，每頁只回傳清單需要的欄位。
3. 將題目預覽改為依 question ID 與 revision ID 讀取詳細內容。
4. 將練習選題改為由伺服器依已核准的篩選契約固定目標，再建立持久 session。
5. 移除 `app/page.tsx` 對完整 `questions` 陣列的啟動依賴。保留進行中 session 的固定 revision 恢復規則。
6. 每完成一段就跑同一組正確性檢查與五次瀏覽器效能量測。不要等全部改完才找資料契約錯誤。

## 不可破壞的行為

- 題庫清單、摘要與 facet 都必須先依目前帳號和學習者授權。
- 題庫啟動與列表回應不得包含答案或解析。
- 空題庫必須保持正式空集合，不得套用 mock、fixture 或預設題目。
- session 必須固定建立當下的 question revision 與順序。
- session 恢復必須沿用 `practice_session_items.question_revision_id`。
- 練習完成後只更新 history 與 wrong-review，不得重新下載完整題庫。
- 正式題目、學習者、session、作答與歷程不得由測試 cleanup 修改。
- 所有修改只在本機 build 與驗證。除非使用者在當次要求明確指定，不得部署到 Vercel。

## 效能驗收

使用同一個登入帳號、同一個本機 route 與相同資料量測五次。每次記錄以下資料：

- 載入畫面消失時間
- questions、summary、facet 與 history 的 API 數量
- 每個 API 的 duration、encoded bytes 與 HTTP 狀態
- 總傳輸量
- 失敗數
- 前端長任務與 JSON 解析時間
- PostgreSQL 查詢時間、rows 與 buffers

五次結果回報中位數與範圍。任何請求失敗都不能算通過。驗收目標是可見載入中位數低於三秒且零失敗。若新電腦當時的 load average 高於核心數，先停止其他高 CPU 工作再量測，或把結果標記為無法比較。

## 接手完成條件

選單工作在新電腦完成重驗後即可結案。效能工作只有在正式文件、資料契約、程式、測試及真實瀏覽器量測全部一致，而且五次量測達到三秒門檻與零失敗時才算完成。若仍未達標，保留程式與量測證據，回到 trace 找下一個 limiter，不得只提高 timeout。
