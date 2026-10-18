# Start practice target validation repair

## Bug fix playbook

1. [complete] Reproduce it yourself on the matching surface via the driver skill (Non-negotiables), even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
2. [complete] Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with `how` over the affected subsystem and the **why** skill for regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Drive a long or stubborn hunt with Claude Code's `loop` skill. Confirm the surviving *mechanism* with runtime evidence before the step-3 architect/interrogate fan-out.
3. [complete] Plan the fix. If it crosses a function boundary, `architect` first. Delegate implementation to a subagent using your configured bug-fix model (default in poteto-mode's Models section) with a specific scope.
4. [complete] Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
5. [skip] Stage the commits so the failing repro lands before the fix in git history. See the **tdd** skill for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear.
   - skip: The user did not request commits, and the shared worktree contains unrelated changes.
6. [skip] Run **Opening a PR**.
   - skip: The user requested a local adjustment and did not request a pull request.

## Architect phases

1. [complete] Ground
2. [complete] Sketch
3. [complete] Agree
4. [complete] Implement
5. [complete] Scrap

Throughput checkpoint: encode the requested targets as the session-creation contract, retain learner question-bank authorization, add a failing cross-subject session test, expose the API error on the detail page, then verify the exact English question in the browser.

Verification: focused session/UI contracts passed 2/2; the exact question entered a one-question practice in Chrome with four enabled answer fields. The full isolated runner stopped before the new assertions because the concurrently modified Hanlin writer rejected the synthetic fixture with `INVALID_IMPORT_PLAN` / source asset stable identity mismatch.
