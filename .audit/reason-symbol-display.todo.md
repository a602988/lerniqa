# 因為與所以前端顯示規則

- [x] `how` over the affected subsystem.
- [x] `architect` for parallel design exploration.
  - skip: 系統規則禁止這個任務啟動子代理；改以共用文字呈現邊界的單一路徑完成設計檢查。
- [x] Write the throughput checkpoint as four todo items. A dimension that genuinely does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped:
  - [x] **Blocking first steps.** 先確認原始資料不變，並找出共用前端文字呈現入口。
  - [x] **Independent workstreams.** n/a: 程式、測試與文件都依同一個顯示契約串行修改，避免共用工作區衝突。
  - [x] **Shared mutable state.** 只修改既有共用正規化函式及其契約文件，不碰資料庫內容。
  - [x] **Smallest safe decomposition.** 使用一份字元對照表，讓題幹、選項、解答與解析沿既有元件一起套用。
- [x] Delegate code-writing to a subagent using your configured feature model (default in poteto-mode's Models section) with a specific scope (file paths, named data shape and its organizing structure per **principle-model-the-domain**, a state machine over scattered booleans, a table/registry over branching, a typed model over repeated shape assumptions, chosen before the delegate writes logic, and success criteria). Pick each subagent's reasoning level for the job, per the Subagents section. When the implementation admits multiple valid shapes (error handling, abstraction layer, test structure), delegate via the **arena** skill instead so the runners surface the alternatives and the cross-judge guards the pick. Mandatory: no skip-with-reason escape, and Laziness Protocol does not override it (the gain is review separation, not lines saved). A subagent forbidden to spawn satisfies this by owning the diff directly with the same review separation. No "standing by" reply that waits on a nested agent. **Give every file-writing delegate its own worktree** (spawn it with `isolation: "worktree"`, or hand it an exclusive branch), and do not write files or run a suite in a worktree a delegate still holds. On Claude Code, `isolation: "worktree"` branches from the remote default branch unless the `worktree.baseRef` setting is `"head"`. When the delegate builds on commits the default branch lacks, commit them, create its worktree with `git worktree add <path> -b <delegate-branch> HEAD`, and name that base commit in the brief. Fencing a file in the brief's prose is not a lock (**principle-separate-before-serializing-shared-state**). Comments per **Comments**. Surgical edits, re-ground against the source for upstream-derived files. Port shared-primitive improvements to all consumers and verify each. Commit liberally.
  - skip: 系統規則禁止啟動子代理；主代理直接擁有這個小型共用顯示規則的變更與驗收。
- [x] Verify on the matching surface. "Inconclusive" or wrong-surface is not a pass. Flag it.
- [ ] Rebase into small, ordered commits. Stack follow-ups.
  - skip: 使用者沒有要求建立提交，且工作區含有其他未提交工作。
- [x] If the design is contested, `interrogate` before shipping.
  - skip: 使用者已明確指定字元與顯示文字，沒有待決設計。
- [ ] Run **Opening a PR**.
  - skip: 使用者沒有要求建立 PR。

資料形狀：輸入是題庫保存的純文字字串，輸出是畫面顯示字串。以唯讀字元對照表集中保存 `\uF0DE → ⇒`、`∵ → 因為`、`∴ → 所以`，不修改資料庫內容與搜尋文字。

- [x] 新增可觀察顯示行為測試。
- [x] 實作共用顯示轉換。
- [x] 補正式產品文件。
- [x] 執行相關測試、型別檢查與 build。
  - build 未通過：第一次卡在既有 `.next-build/types` 缺檔；隔離輸出重跑時 Next.js webpack 的 `WasmHash` 在 Node 24 發生例外。兩次都在這次程式型別檢查之後，非本次顯示規則的 TypeScript 錯誤。
- [x] 在 Chrome 的實際題目頁驗收桌面與手機版。
