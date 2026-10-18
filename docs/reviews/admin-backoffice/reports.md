# 管理報表契約核對

狀態：0009／0011 source 與 unit test 已整合；PostgreSQL E2E 尚未執行。2026-10-16 依隔離要求未啟動資料庫或網站服務。

## 統計邊界

- 原始時間是 `timestamptz`，期間由臺北當地日期換算；查詢包含開始時間、不包含結束日期次日零時。
- 趨勢固定補齊期間內的日、週或月 bucket，沒有事件的 bucket 顯示真實 `0`。
- 跨帳號學習者統計先套用 `admin_platform_reporting` 隱私政策。每個 correct、wrong、pending 結果 bucket 都用該 bucket 的不同學習者數判斷，不借用整體 cohort 人數。三個結果中任一 bucket 需抑制時，`total` 與 `answered` 也同步抑制，避免用 `total=correct+wrong+pending` 反推小樣本。
- 沒有資料、合法零值、零分母、未蒐集、未設定政策與未達顯示門檻維持不同狀態。

## 0011 score 報表

Score 的期間活動與結果採兩個不能混用的時間定義：

| 指標 | 正式來源 | 期間欄位 |
| --- | --- | --- |
| 活躍學習者、送出題數 | `practice_score_receipts` 的不同 `learner_id` 與收據數 | `submitted_at` |
| 完成練習與題數結果 | completed `practice_sessions` 的五個 `score_*_count` 欄位 | `completed_at` |

結果查詢只接受 `check_mode='score' AND status='completed'` 的 session。Repository 另檢查 `answered=total`、`correct+wrong<=answered` 及 `correct+wrong+pending=total`；不符合時回傳內部錯誤，不展示可能誤導的數字。

`practice_score_receipts` 不含答案與逐題判定，因此不能用來算答對或答錯。Score 結果也不連接 `answer_attempts`、`answer_part_results` 或附件；既有 score 明細經 0011 清除後，報表仍只依保留的 aggregate 與 answer-free receipt 運作。

0011 目前沒有 `practice_score_receipts(submitted_at)` 索引。正確性已用靜態查詢與 unit test 覆蓋，但大資料量的 `EXPLAIN` 與索引評估仍是後續 P2；本次不回改已定案的 0011 migration。

## 0009 自動答案完整性

分母只包含 `published`／`superseded` revision 中 `grading_policy='automatic'` 的小題。每題依正式函式 `lerniqa_automatic_part_has_complete_answer(part.id, part.answer_mode)` 分為 complete 或 incomplete；draft／rejected 可以合法尚未完整，不列入分母。

畫面顯示總數、完整數、不完整數及完整率。分母為零時三個筆數皆為真實 `0`，完整率顯示無資料；不會把零分母顯示成 `0%` 或 `100%`。

## Unit fixture 手算

代表 fixture 的 score receipt 期間有 4 名學習者、8 筆送出；期間完成 3 個 score session，彙總為 12 題、12 題已送出、8 題正確、1 題錯誤、3 題待判定。隱私門檻是 3 人：correct 與 pending 各涉及 3 人可顯示，只有 wrong 涉及 1 人須抑制；因此 total 與 answered 也作互補抑制。

題庫 fixture 有 337 個 eligible automatic parts 且全部完整，所以完整率是 100%。另以 2 完整、1 不完整的 mapping fixture 驗證報表不會隱藏異常，並以零分母 fixture 驗證完整率為無資料。

已執行且通過：

```text
node --no-warnings --experimental-strip-types --test tests/admin-report-repository.test.ts tests/admin-report-view.test.ts
13 tests passed
```

尚未執行 PostgreSQL fixture 或瀏覽器驗收；在獨立資料庫可安全啟動前，不把 unit fixture 稱為實際資料或已上線統計。
