# English blank rendering bug fix

- [x] 1. Reproduce it yourself on the matching surface via the driver skill (Non-negotiables), even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
- [x] 2. Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with `how` over the affected subsystem and the **why** skill for regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Drive a long or stubborn hunt with Claude Code's `loop` skill. Confirm the surviving *mechanism* with runtime evidence before the step-3 architect/interrogate fan-out.
- [x] 3. Plan the fix. If it crosses a function boundary, `architect` first. Delegate implementation to a subagent using your configured bug-fix model (default in poteto-mode's Models section) with a specific scope.
- [x] 4. Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
- [x] 5. Stage the commits so the failing repro lands before the fix in git history. See the **tdd** skill for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear.
- [x] 6. Run **Opening a PR**.

Notes:

- Step 5 commit staging is skipped because the user did not request commits and the shared worktree already contains unrelated uncommitted work. A behavior regression test will still be added before the fix when practical.
- Step 6 is skipped because the user requested a local adjustment, not a pull request.
- Root cause: LibreOffice removed legacy Word EQ overstrike speaker operands and retained only each colon; the prompt blank tokenizer also required right-side full-width padding, so a numbered blank at line end was not rendered as a complete underline.
- Architecture review kept source reconstruction inside the import boundary and presentation-only underline handling inside `question-presentation.ts`.
- Same-route accessibility verification after refresh showed `George:` and `Susan:` with no orphan leading point/colon. The exact approved Word dry-run produced 159 published, 0 pending, 0 failed after the stricter evidence comparison.
- Regression verification: 31 focused tests passed, TypeScript passed, and the production build completed. The build retains pre-existing optional document-preview dependency warnings.
