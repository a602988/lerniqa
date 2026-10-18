# 題目練習進入速度診斷

量測日期為 2026-10-18。測試使用已登入的 Tim 學習者、既有本機 Next.js 服務與 Chrome 分頁。全程未開始練習、未提交答案，也未新增持久資料。

## 量測結果

成功載入樣本中，`GET /api/v1/local-practice/questions` 花費 3,069.2 ms，`encodedBodySize` 為 7,652,855 bytes。畫面顯示完整 11,005 題。切換到「安排複習計畫」後沒有新增 questions API 請求，因此主要等待不在導覽切換本身。

本次重載時機器為 10 核，load average 為 36.94、67.62、71.13。三次重載在 11 秒觀察點都尚未完成。最後一次 questions 請求在 16,485.9 ms 後只回傳 100 bytes 錯誤內容，畫面顯示「本機試題服務目前無法完成要求」。程式的 PostgreSQL `statement_timeout` 為 15,000 ms，因此這次失敗與查詢逾時時間吻合。這是推論，伺服器沒有把底層錯誤碼顯示在瀏覽器回應中。

因量測環境嚴重繁忙，而且重載包含錯誤，本次不能產生可比較的一般狀態中位數。依 benchmark checklist，此部分結論為 inconclusive。成功樣本仍足以確認完整題庫請求的資料量與三秒級等待。

## 程式路徑

`app/page.tsx` 的 `loadBootstrap` 在所有主要工作區啟動時呼叫 `loadPersistedPractice`。`app/lib/practice-client.ts` 先讀取 `auth/me`，再並行讀取完整 questions 與 history。questions route 在沒有篩選參數時選用 `accessible` 查詢，`app/lib/local-practice-store.ts` 讀取所有可用 revision，再以 revision ID 集合補齊小題、選項、內容、metadata 與知識點。前端收到完整陣列後，建立 map、轉換全部題目，並反覆從同一批資料計算各頁篩選與選項。

## 分類

這是已知的架構與交付階段問題。現行程式符合目前「單次完整可用題庫」契約，所以不是某一個事件處理器寫壞造成的新 bug。正式文件也已設定停止條件。完整載入若仍超過三秒，就要改為路由範圍摘要、題目總覽分頁與題目詳情按需載入，不得再用提高併發或持久快取掩蓋。

文件中的歷史基準未同步。`docs/plan.md` 記錄五次中位數 8,633 ms，`docs/database-completion-matrix.md` 記錄合併與 gzip 後中位數 4,857 ms。兩者都證明未達三秒門檻。後續施工前應先把較新的量測寫成唯一權威基準，再依既定停止條件展開第三階段。
