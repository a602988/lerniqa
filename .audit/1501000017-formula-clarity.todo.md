# 題號 1501000017 公式清晰度修正

> pstack bug-fix playbook 要求委派調查與修正，但本次系統規則禁止在使用者未明確要求時啟動子代理，因此由主代理完成並保留同等驗證證據。

- [x] 1. Reproduce it yourself on the matching surface via the driver skill (Non-negotiables), even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
- [x] 2. Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with `how` over the affected subsystem and the **why** skill for regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Drive a long or stubborn hunt with Claude Code's `loop` skill. Confirm the surviving *mechanism* with runtime evidence before the step-3 architect/interrogate fan-out.
- [x] 3. Plan the fix. If it crosses a function boundary, `architect` first. Delegate implementation to a subagent using your configured bug-fix model (default in poteto-mode's Models section) with a specific scope.
- [x] 4. Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
- [x] 5. Stage the commits so the failing repro lands before the fix in git history. See the **tdd** skill for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear. This is the canonical **sequence-verifiable-units** principle skill, the failing test first and the fix on top.
- [x] 6. Run **Opening a PR**.

本次先取得 3 pass、1 fail 的紅燈證據，再套用修正並取得 4 pass。共用 worktree 已有大量使用者與其他工作中的變更，且使用者未要求 commit 或 PR，因此沒有自行 stage、commit 或開 PR。

## 已確認證據

- 原網址在 Chrome 可重現。
- 公式資產自然尺寸是 `59×38`，資料庫內容類型是 `image`。
- 來源檔是 `2-1　因數與倍數.doc`，原始 SHA-256 是 `05af8ac3292610edfc99a9fc9216b80f4f5ed6bcf8de6564d8bd75ba9db0dcab`。
- 題號是 `1501000017`，公式圖片 checksum 是 `036444dba226e502061b12624abcc6fa970fbf44bfb2a10eb827175140aa4b75`。
- 來源解析與解答共同確認公式為 `\\frac{2 \\times A + 1}{5}`。

## 修正範圍

- 先以精確來源契約加入失敗測試。
- 將核准公式寫入公式 registry。
- 用可重跑的 correction import 建立新的正式修訂，不覆寫既有修訂。
- 更新匯入文件。
- 以測試、資料庫查詢、build、Chrome 桌面與手機寬度驗收。
