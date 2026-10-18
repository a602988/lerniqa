# Math answer slot repair

- [x] Reproduce it yourself on the matching surface via the driver skill (Non-negotiables), even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
- [x] Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with `how` over the affected subsystem and the **why** skill for regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Drive a long or stubborn hunt with Claude Code's `loop` skill. Confirm the surviving *mechanism* with runtime evidence before the step-3 architect/interrogate fan-out.
- [x] Plan the fix. The design keeps one independently graded part, stores a revisioned `answer_field_count`, and serializes ordered slots without exposing accepted answers.
- [x] Verify on the same surface. The public question route now shows `2／3／2／2` fields on desktop and 390px mobile, hides repeated prompt/guidance text, and has no horizontal overflow.
- [x] Stage the commits — skipped intentionally because the shared worktree contains unrelated user changes and no commit was requested; the behavior test and fix remain together in the working tree.
- [x] Run **Opening a PR** — skipped because the user requested a local fix and explicitly did not authorize deployment or PR creation.

## Architect phases

- [x] Ground
- [x] Sketch
- [x] Agree
- [x] Implement
- [x] Scrap — rejected runtime inference from answer punctuation and splitting one source part into multiple graded parts.

## Throughput checkpoint

Completed proof: the slot codec test passes; the database contains exactly 11 multi-field parts across the four approved questions; source question `1501004796` renders 9 fields in `2／3／2／2` order on the same public route at desktop and 390px mobile widths; the mobile document width is 390px with no horizontal overflow; repeated part prompts and manual-review notices are not visible.
