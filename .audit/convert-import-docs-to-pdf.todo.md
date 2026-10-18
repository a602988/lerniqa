### Feature

1. [x] `how` over the affected subsystem.
   - skip: The import audit report already defines the authoritative source root and exact 11-document range.
2. [x] `architect` for parallel design exploration.
   - skip: This is a deterministic format conversion with no product or code architecture choice.
3. [x] Write the throughput checkpoint as four todo items. A dimension that genuinely does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped:
   - [x] **Blocking first steps.** Confirm the 11 source files and bundled LibreOffice path before writing.
   - [x] **Independent workstreams.** Each DOC-to-PDF conversion is independent, but one batch invocation keeps the LibreOffice profile and outputs consistent.
   - [x] **Shared mutable state.** Each result has a distinct PDF path beside its DOC source.
   - [x] **Smallest safe decomposition.** One deterministic batch is safest because all sources use the same conversion contract.
4. [x] Delegate code-writing to a subagent using your configured feature model (default in poteto-mode's Models section) with a specific scope (file paths, named data shape and its organizing structure per **principle-model-the-domain**, a state machine over scattered booleans, a table/registry over branching, a typed model over repeated shape assumptions, chosen before the delegate writes logic, and success criteria). Pick each subagent's reasoning level for the job, per the Subagents section. When the implementation admits multiple valid shapes (error handling, abstraction layer, test structure), delegate via the **arena** skill instead so the runners surface the alternatives and the cross-judge guards the pick. Mandatory: no skip-with-reason escape, and Laziness Protocol does not override it (the gain is review separation, not lines saved). A subagent forbidden to spawn satisfies this by owning the diff directly with the same review separation. No "standing by" reply that waits on a nested agent. **Give every file-writing delegate its own worktree** (spawn it with `isolation: "worktree"`, or hand it an exclusive branch), and do not write files or run a suite in a worktree a delegate still holds. On Claude Code, `isolation: "worktree"` branches from the remote default branch unless the `worktree.baseRef` setting is `"head"`. When the delegate builds on commits the default branch lacks, commit them, create its worktree with `git worktree add <path> -b <delegate-branch> HEAD`, and name that base commit in the brief. Fencing a file in the brief's prose is not a lock (**principle-separate-before-serializing-shared-state**). Comments per **Comments**. Surgical edits, re-ground against the source for upstream-derived files. Port shared-primitive improvements to all consumers and verify each. Commit liberally.
   - skip: No code is being written, and current instructions disable subagent spawning.
5. [x] Verify on the matching surface. "Inconclusive" or wrong-surface is not a pass. Flag it.
   - evidence: All 11 PDFs opened successfully, and all 131 rendered pages were visually inspected from contact sheets. Formulas, source images, Chinese text, answer text, and explanation text remain visible without missing or clipped pages.
6. [x] Rebase into small, ordered commits. Stack follow-ups.
   Use the **sequence-verifiable-units** principle skill, building, verifying, and committing each small unit before the next.
   - skip: The requested artifacts live beside external source documents and are not repository commits.
7. [x] If the design is contested, `interrogate` before shipping.
   - skip: No contested design exists.
8. [x] Run **Opening a PR**.
   - skip: The user requested local PDF copies, not repository changes or a pull request.

- [x] Convert every DOC listed in `reports/kangxuan-math-v9-audit-2026-10-18.json` to a same-directory PDF.
- [x] Confirm every PDF is non-empty, readable, and has at least one page.
- [x] Render and inspect every PDF page for conversion defects.
