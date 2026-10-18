- [x] Reproduce it yourself on the matching surface via the driver skill (Non-negotiables), even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
- [x] Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with `how` over the affected subsystem and the **why** skill for regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Drive a long or stubborn hunt with Claude Code's `loop` skill. Confirm the surviving *mechanism* with runtime evidence before the step-3 architect/interrogate fan-out.
- [x] Plan the fix. If it crosses a function boundary, `architect` first. Delegate implementation to a subagent using your configured bug-fix model (default in poteto-mode's Models section) with a specific scope.
  - skip: Session instructions prohibit subagent delegation unless the user explicitly asks for it. The change remains inside the shared filter component and its existing stylesheet.
- [x] Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
- [x] Stage the commits so the failing repro lands before the fix in git history. See the **tdd** skill for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear.
  - skip: The user did not request a commit, and the existing working tree contains unrelated changes. The matching browser check is the direct regression proof.
  This is the canonical **sequence-verifiable-units** principle skill, the failing test first and the fix on top.
- [x] Run **Opening a PR**.
  - skip: The user requested a local interface fix, not a pull request.

- [x] Inspect the shared filter component, Keel MultiSelect DOM, and relevant overflow styles without disturbing the user's existing changes.
- [x] Reproduce the distorted selection indicator and viewport clipping at desktop and mobile widths.
- [x] Apply the smallest shared-component fix justified by the runtime evidence.
- [x] Run the relevant type check, build, and browser verification at desktop and mobile widths.
