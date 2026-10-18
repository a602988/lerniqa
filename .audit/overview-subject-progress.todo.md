# Feature

- [x] `how` over the affected subsystem.
- [x] `architect` for parallel design exploration.
- [x] Write the throughput checkpoint as four todo items. A dimension that genuinely does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped:
  - [x] **Blocking first steps.** Confirm the authoritative question subject and latest-attempt data shapes before editing.
  - [x] **Independent workstreams.** Documentation, implementation, and behavior tests are distinct artifacts, but shared behavior decisions serialize behind grounding.
  - [x] **Shared mutable state.** Preserve the user's existing dirty worktree; one isolated delegate owns the code diff and the lead integrates only the reviewed patch.
  - [x] **Smallest safe decomposition.** One implementation owner is best because the change is one code-coupled overview behavior with its test and specification.
- [x] Delegate code-writing to a subagent using your configured feature model (default in poteto-mode's Models section) with a specific scope (file paths, named data shape and its organizing structure per **principle-model-the-domain**, a state machine over scattered booleans, a table/registry over branching, a typed model over repeated shape assumptions, chosen before the delegate writes logic, and success criteria). Pick each subagent's reasoning level for the job, per the Subagents section. When the implementation admits multiple valid shapes (error handling, abstraction layer, test structure), delegate via the **arena** skill instead so the runners surface the alternatives and the cross-judge guards the pick. Mandatory: no skip-with-reason escape, and Laziness Protocol does not override it (the gain is review separation, not lines saved). A subagent forbidden to spawn satisfies this by owning the diff directly with the same review separation. No "standing by" reply that waits on a nested agent. **Give every file-writing delegate its own worktree** (spawn it with `isolation: "worktree"`, or hand it an exclusive branch), and do not write files or run a suite in a worktree a delegate still holds. On Claude Code, `isolation: "worktree"` branches from the remote default branch unless the `worktree.baseRef` setting is `"head"`. When the delegate builds on commits the default branch lacks, commit them, create its worktree with `git worktree add <path> -b <delegate-branch> HEAD`, and name that base commit in the brief. Fencing a file in the brief's prose is not a lock (**principle-separate-before-serializing-shared-state**). Comments per **Comments**. Surgical edits, re-ground against the source for upstream-derived files. Port shared-primitive improvements to all consumers and verify each. Commit liberally.
- [ ] Verify on the matching surface. "Inconclusive" or wrong-surface is not a pass. Flag it. BLOCKED: the local authenticated overview remained on the loading state because its data API did not complete.
- [x] Rebase into small, ordered commits. Stack follow-ups. n/a: no commit or PR was requested; the scoped diff remains local among existing user changes.
- [x] If the design is contested, `interrogate` before shipping. n/a: both independent designs selected the same subject-keyed projection.
- [ ] Run **Opening a PR**. skip: the user requested a local change and did not request a PR.

# Architect

- [x] Ground
- [x] Sketch
- [x] Agree
- [x] Implement
- [x] Scrap. n/a: implementation matched the accepted sketch without structural deviation.
