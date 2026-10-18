# 題目練習進入速度調查

- [x] Capture a baseline trace via the matching driver skill. Vet the baseline, and each later number, with the **benchmark-checklist** skill.
- [x] `how` to ground hypotheses. Don't claim a perf ceiling without running it first.
  Try the performance mantras in order, cheapest first:
  1. Don't do it. Stop work whose result nothing uses rather than cheapening it.
  2. Do it, but don't do it again.
  3. Do it less.
  4. Do it later.
  5. Do it when they're not looking.
  6. Do it concurrently.
  7. Do it cheaper.

  When an earlier mantra meets the target, stop.
- [ ] Plan the fix from the trace. If it crosses a function boundary, `architect` first. Delegate implementation to a subagent using your configured perf-issue model (default in poteto-mode's Models section). Pick each subagent's reasoning level for the job, per the Subagents section. Review the diff. Capture a post-fix trace.
  Apply the **sequence-verifiable-units** principle skill, verifying each attempt before trying the next.
  - skip: 使用者本次要求診斷，未要求修改程式。
- [x] Parse and compare the artifacts (JSON to sqlite, diff). "Inconclusive" or wrong-surface is not a pass. Flag it.
- [ ] Cite the measurement in the PR.
  - skip: 本次不建立 PR。
- [ ] Run **Opening a PR**.
  - skip: 本次不建立 PR。

## 本次量測主張

- 判斷「從學習總覽切換到開始練習頁」的等待，主要來自網路請求、前端主執行緒渲染，或兩者皆非。
- 量測同一個已登入帳號、同一台機器、同一個開發伺服器，至少重複五次並回報中位數與範圍。
- 不開始或提交新的練習，不新增持久資料。

## 結論

- 分類：已知的架構／交付階段問題，不是新的單點 UI bug。
- 目前穩定中位數：無法由本次高負載環境得出；本次量測包含失敗，依 benchmark checklist 標記為 inconclusive。
- 可確認的瓶頸：啟動會讀取完整 11,005 題。成功樣本的 questions API 為 3,069.2 ms、7,652,855 encoded bytes。高負載重載樣本為 16,485.9 ms，回傳 100 bytes 錯誤並顯示正式錯誤狀態。
- 切換證據：資料完成載入後，從題目總覽切換到安排複習計畫沒有新增 questions API 請求。因此切換元件本身不是主要網路瓶頸。
- 系統負載：10 核機器量測前 load average 為 36.94、67.62、71.13，遠高於核心數；本次數字只用來定位，不用來宣告一般狀態的固定延遲。
- 文件狀態：`docs/plan.md` 記錄五次中位數 8,633 ms；`docs/database-completion-matrix.md` 記錄優化後中位數 4,857 ms。兩者皆未達 3 秒門檻，但基準數字未同步。
