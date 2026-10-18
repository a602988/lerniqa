# English question image repair

1. [done] Reproduce the bug on the real question surface.
   - Confirm the two route IDs, database revisions, and stored assets.
   - Confirm the malformed pixels exist in the stored files, not only in CSS rendering.
2. [done] Binary-search the cause with source and import evidence.
   - Resolve each revision back to its authoritative Word document and source position.
   - Inspect the original embedded image and the importer conversion path.
3. [done] Plan and implement the smallest traceable root-cause fix.
   - Repair only mappings/assets supported by unique source evidence.
   - Add a regression check for effectively blank or severely clipped transparent images.
4. [done] Verify the persisted assets and the full related scope.
   - Re-run the targeted import/audit checks.
   - Audited all 318 current published Hanlin English questions and 592 image blocks.
   - Confirmed seven repaired questions no longer reference the broken GIFs and directly inspected representative PNG output.
   - One clock image is a confirmed complete-image false positive; two source-backed repairs remain blocked by `LEGACY_DIALOGUE_SPEAKER_MISMATCH` and were not bypassed.
5. Stage commits.
   - Skip: the user requested a local correction, not commits.
6. Run Opening a PR.
   - Skip: no PR or deployment was requested.

Throughput checkpoint: source mapping, importer behavior, persisted repair, audit, and browser verification are separate verifiable units.
