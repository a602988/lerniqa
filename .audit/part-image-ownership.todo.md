- [x] 1. Reproduce it yourself on the matching surface via the driver skill (Non-negotiables), even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
- [x] 2. Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with `how` over the affected subsystem and the **why** skill for regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Drive a long or stubborn hunt with Claude Code's `loop` skill. Confirm the surviving *mechanism* with runtime evidence before the step-3 architect/interrogate fan-out.
- [x] 3. Plan the fix. If it crosses a function boundary, `architect` first. Delegate implementation to a subagent using your configured bug-fix model (default in poteto-mode's Models section) with a specific scope.
- [x] 4. Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
- [x] 5. Stage the commits so the failing repro lands before the fix in git history. See the **tdd** skill for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear. skip: this delegated patch is in a shared dirty worktree and the parent owns integration history.
- [x] 6. Run **Opening a PR**. skip: the parent requested a local implementation only and owns delivery.

Throughput checkpoint. One source-scoped mapping owns each image at either the root or one exact structured part. The import boundary validates that ownership, the fingerprint records it, and the writer persists it.

- [x] Add exact source mappings for question `05012407`.
- [x] Reject missing, unknown, duplicate, or checksum-mismatched part ownership.
- [x] Persist part-owned images under `question_part_id` with local positions.
- [x] Avoid duplicating numbered root labels when verified images own all numbered parts.
- [x] Run focused behavior tests without importing or writing the database.
