# Math formula correction for 1501004805

## Bug fix playbook

- [x] Reproduce it yourself on the matching surface via the driver skill (Non-negotiables), even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
- [x] Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with `how` over the affected subsystem and the **why** skill for regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Drive a long or stubborn hunt with Claude Code's `loop` skill. Confirm the surviving *mechanism* with runtime evidence before the step-3 architect/interrogate fan-out.
- [x] Plan the fix. If it crosses a function boundary, `architect` first. Delegate implementation to a subagent using your configured bug-fix model (default in poteto-mode's Models section) with a specific scope.
  - Blocked: this session's system instructions prohibit subagent delegation. The primary agent owns the implementation. Independent review remains unavailable.
- [x] Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
- [x] Stage the commits so the failing repro lands before the fix in git history. See the **tdd** skill for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear.
  - Skip commit staging: the shared worktree contains unrelated user changes. Add and run the failing behavior test before the fix without creating commits.
- [x] Run **Opening a PR**.
  - Skip: the user requested a local correction and did not request a PR or deployment.

## Architect phases

- [x] Ground
- [x] Sketch
- [x] Agree
- [x] Implement
- [x] Scrap

## Throughput checkpoint

- [x] Blocking first step. Compare the exact Chrome route, current database blocks, stored assets, and approved source snapshot.
- [x] Data shape. Use an exact-source, exact-question, exact-image-checksum formula registry. Unknown formulas remain images.
- [x] Verifiable unit 1. Add a failing registry test for the prompt and explanation formulas.
- [x] Verifiable unit 2. Add a dry-run and idempotent single-question correction command.
- [x] Verifiable unit 3. Back up PostgreSQL, write the new revision, and verify its stored blocks.
- [x] Verifiable unit 4. Reopen the exact Chrome route at desktop and 390px width.
- [x] Verifiable unit 5. Update the import rules and run the related checks and production build.

## Root-cause evidence

- The current prompt stores checksum `84d354946b2b0ed4869f38ccf4c0c9a2a19d2c3696a088354a72be8de22c2070` as a 54 by 38 GIF. The file loads in Chrome but its pixels are a blank magenta conversion artifact.
- The explanation stores fraction GIFs, but the reference-answer query flattens image blocks to the alt text `來源數學公式`. The UI therefore shows that phrase instead of the fractions.
- The source screenshot and the current record agree on question number `1501004805`, the surrounding text, all eight fraction values, and answer `(D)`.
