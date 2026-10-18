- [x] Reproduce it yourself on the matching surface via the driver skill (Non-negotiables), even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
  - The live route currently reports that the local question service cannot complete the request. Continue with a locally started service and browser session.
- [x] Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with `how` over the affected subsystem and the **why** skill for regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Drive a long or stubborn hunt with Claude Code's `loop` skill. Confirm the surviving *mechanism* with runtime evidence before the step-3 architect/interrogate fan-out.
  - `beginSession` did not record the question-detail origin. All three exit paths derived their destination only from the session mode.
- [x] Plan the fix. If it crosses a function boundary, `architect` first. Delegate implementation to a subagent using your configured bug-fix model (default in poteto-mode's Models section) with a specific scope.
  - Model the origin as a named discriminated union and resolve all exit destinations through one pure function. The active session owns the value. Multi-agent delegation was skipped because the current session explicitly disables subagents.
- [x] Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
  - Desktop and 390 x 844 browser checks both returned to `/questions/41841564556775` after leaving the practice that started from that route.
- [x] Stage the commits so the failing repro lands before the fix in git history. See the **tdd** skill for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear.
  - Skipped. The worktree already contains unrelated user changes, and the user did not request a commit.
- [x] Run **Opening a PR**.
  - Skipped. The user requested a local fix and did not request a pull request.

Throughput checkpoint: record the originating question URL, the navigation state passed into practice, the exit action, and the final browser URL before declaring the fix complete.

- [x] Name the navigation data shape and choose its owner.
- [x] Add a behavior regression test for both closing and stopping practice.
- [x] Run the directly related checks and production build.
- [x] Verify desktop and mobile browser behavior from a question detail route.
