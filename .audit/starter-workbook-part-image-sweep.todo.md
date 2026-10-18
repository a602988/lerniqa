# Starter workbook part image sweep

## Bug fix playbook

1. [complete] Reproduce it yourself on the matching surface via the driver skill (Non-negotiables), even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
2. [complete] Binary-search the cause. The previous sweep was limited by question type, and the importer stored approved images at root unless an exact part mapping existed. Repeated identical source images also collapsed to one checksum mapping.
3. [complete] Plan the fix. Architecture chose `questionNumber + checksum + sourceOccurrence` for duplicate source images, with fail-closed contiguous occurrence validation. Implementation was delegated with four-file ownership.
4. [complete] Verify on the same surface. The reported route now shows one part image at a time and switches from part 1 to part 2. Related routes `254629461084689`, `113853472553847`, and duplicate-image route `58063639457019` also show the correct root-versus-part ownership. The reported route has no horizontal overflow at 390px.
5. [skip] Stage the commits so the failing repro lands before the fix in git history. See the **tdd** skill for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear. The user did not request commits and the shared worktree contains unrelated changes.
6. [skip] Run **Opening a PR**. The user requested a local correction and did not request a pull request.

## Throughput checkpoint

1. [complete] Reproduce question `181999540059126` and read its persisted block ownership.
2. [complete] Inspect every remaining multi-part image candidate in the same Starter Unit Word source.
3. [complete] Add checksum-bound root versus part ownership mappings and guardrail tests.
4. [complete] Reimport the source without replacing unrelated persisted data. The second run reused the same batch and reclassified zero records.
5. [complete] Audit persisted ownership and verify the changed learner routes. Database counts are 0/4, 1/4, 0/6, 0/4, and 1/2 root/part images for `05012406` through `05012410`. The same source has no remaining multi-part record with multiple root images and zero part images.
