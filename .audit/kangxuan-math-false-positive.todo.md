# Kangxuan math import false-positive follow-up

- [x] Reproduce it yourself on the matching surface via the driver skill (Non-negotiables), even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
- [x] Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with `how` over the affected subsystem and the **why** skill for regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Drive a long or stubborn hunt with Claude Code's `loop` skill. Confirm the surviving *mechanism* with runtime evidence before the step-3 architect/interrogate fan-out.
- [x] Plan the fix. If it crosses a function boundary, `architect` first. Delegate implementation to a subagent using your configured bug-fix model (default in poteto-mode's Models section) with a specific scope.
  - skip: Subagent dispatch is disabled by the current session instruction. The root agent grounded the parser boundary and kept the change inside the existing `structuredRecord` normalization contract.
- [x] Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
- [x] Stage the commits so the failing repro lands before the fix in git history. See the **tdd** skill for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear.
  - skip: The shared checkout contains unrelated user changes, and Xcode license acceptance currently blocks Git inspection. The focused regression test and fix remain unstaged.
- [ ] Run **Opening a PR**.
  - skip: The user requested a local import repair and did not request a commit, push, or pull request. The shared checkout also contains unrelated changes.
- [x] Define the data shape before the change.
  - An imported record carries `sourcePage`, `isLastRecord`, and the authorized parser style into `structuredRecord`. Only authorized metadata-first math records may remove a structurally isolated footer marker.
- [ ] BLOCKED: independent review.
  - Subagent dispatch is disabled by the current session instruction. Unit, corpus, database, build, and browser checks continue, but they do not count as independent review.
