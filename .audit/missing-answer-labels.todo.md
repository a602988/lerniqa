# 多欄答案缺少編號修正

> pstack bug-fix playbook 要求委派調查與修正，但本次系統規則禁止在使用者未明確要求時啟動子代理，因此由主代理完成並保存查詢與瀏覽器證據。

- [x] 1. Reproduce it yourself on the matching surface via the driver skill (Non-negotiables), even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
- [x] 2. Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with `how` over the affected subsystem and the **why** skill for regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Drive a long or stubborn hunt with Claude Code's `loop` skill. Confirm the surviving *mechanism* with runtime evidence before the step-3 architect/interrogate fan-out.
- [x] 3. Plan the fix. If it crosses a function boundary, `architect` first. Delegate implementation to a subagent using your configured bug-fix model (default in poteto-mode's Models section) with a specific scope.
- [x] 4. Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
- [x] 5. Stage the commits so the failing repro lands before the fix in git history. See the **tdd** skill for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear. This is the canonical **sequence-verifiable-units** principle skill, the failing test first and the fix on top.（已先建立失敗測試再修正；共用工作目錄已有大量未提交異動，因此沒有代替使用者建立或重排 commit。）
- [x] 6. Run **Opening a PR**.（本次規則只允許本機修改與驗證，且使用者未要求 PR，因此略過。）

## 額外驗收

- [x] 用資料庫查詢定義「類似題」的資料形狀與總數：249 題、687 個原本缺少可見編號的作答列。
- [x] 所有類似題都能從題幹來源位置得到可見編號。
- [x] 輸入列只顯示編號與欄位，不重複題幹或提示文字。
- [x] Chrome 原網址的桌面與 390px 手機寬度都通過。
- [x] 更新正式匯入文件與回歸測試。
