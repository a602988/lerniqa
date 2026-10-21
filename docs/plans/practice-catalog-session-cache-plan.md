# 題庫工作階段快取計畫

## 問題與基準

`loadPersistedPractice()` 在首頁 React tree 每次重新掛載時都讀取 `/api/v1/auth/me`，再下載完整 `/api/v1/local-practice/questions`。既有量測顯示登入情境有 11,005 題，questions API 約 3,069 ms，gzip 傳輸量約 7,652,855 bytes；離開再返回時目前會重做同一筆大型請求。

使用者已核准加入快取。這次只處理同一瀏覽器分頁、同一登入工作階段內的重複題庫下載，不改成 `localStorage`、IndexedDB、HTTP public cache 或 Service Worker。

## 設計比較

| 方案 | 優點 | 風險 | 決定 |
| --- | --- | --- | --- |
| 快取整份 bootstrap | 返回最快 | `/auth/me` 也被略過，帳號、角色及學習者切換可能沿用舊身分 | 不採用 |
| 每次重驗 `/auth/me`，只快取大型題庫 | 身分仍由伺服器確認；相同 context 不再下載完整題庫 | 需定義 context key 與明確失效入口 | 採用 |
| 持久瀏覽器快取 | 重新整理後仍可沿用 | 題目版本與權限容易過期，且保存大量帳號範圍資料 | 不採用 |

## 快取契約

- 快取資料形狀：一筆 `{ contextKey, questions }`，只存在 `practice-client` 模組記憶體。
- `contextKey` 由目前 session 到期時間、帳號 email、active role、目前 learner ID、年級及科目設定穩定序列組成。
- 每次 `loadPersistedPractice()` 都重新讀 `/api/v1/auth/me`。只有 context key 相同時重用題庫。
- 相同 context 的並行載入共用同一個 Promise，避免同時發出兩筆大型請求。
- 題庫請求失敗不得寫入快取，下一次可以重試。
- 題目正式發布或管理端題目 mutation 成功後主動失效。
- 登出、session 失效、角色／學習者／年級／科目設定變更會因 context key 改變或明確清除而重新載入。

## 工作與驗證清單

- **Principles**：套用 Fix Root Causes、Type System Discipline、Prove It Works 與 Unslop。
- **Baseline**：以 fetch 計數測試重現連續兩次 bootstrap 產生兩筆 questions 請求。
- **Ground**：已追到 `app/lib/practice-client.ts`、`app/page.tsx`、題目匯入及管理端 mutation 呼叫端。
- **Architect**：比較整份 bootstrap 快取與僅題庫快取，採後者。
- **Delegation**：依目前執行規則不允許 subagent，由同一執行者完成並直接審閱差異。
- **Implementation**：建立單一模組快取、失效 API，接入正式題目異動入口。
- **Verification**：測量修正後兩次 bootstrap 的 auth/questions 請求數、執行題庫整合測試、型別檢查、production build，最後用 `npm start` 實際操作。
- **PR**：使用者未要求 commit、push 或 PR，本次不執行。

## 執行結果

- 同一題庫 context 連續執行兩次 bootstrap：`/api/v1/auth/me` 2 次，`/api/v1/local-practice/questions` 1 次。
- 明確失效或切換 learner context 後會重新載入題庫。
- `node --test tests/practice-catalog-integration.test.mjs`：31 項通過。
- `npm run lint`：通過。
- `npm run build`：通過；既有 `@keel-design/ui` 文件預覽 optional dependency 警告仍存在，不影響 build exit code。

## 回退方式

移除 `practice-client` 的模組快取與失效呼叫，`loadPersistedPractice()` 即恢復每次下載題庫。沒有持久資料、資料庫或瀏覽器儲存需要清除。
