# Learning Book visual parity

- [x] Establish the baseline first, before any migration: a visual regression harness that screenshots the current component across its states, plus the target when matching two implementations. No baseline, no parity claim. A blocking prerequisite, not a follow-up.
  - baseline: the two user-provided screenshots capture the current Learning Book and target Question Overview at the same desktop surface.
- [x] Anti-shortcut clauses, stated and held: no harness modifications, no baseline tampering, no component restructuring to make a diff pass. If the baseline looks wrong, stop and ask, don't edit it.
- [x] Migrate one component at a time. Parallelize across worktrees, one owner per component (the **separate-before-serializing-shared-state** principle skill). Shared primitives migrate first as a blocking phase.
  - one owner: this task changes only the Learning Book workspace markup and its scoped stylesheet.
- [x] Verify each component against its baseline via image diff on the matching surface via the driver skill. A nonzero diff is a fail. Investigate the pixel delta. `/loop` per component until the diff is zero.
  - verified: desktop and 390 x 844 mobile screenshots now match the established shell, filter, table, and empty-state design. Both viewports report zero horizontal overflow.
- [x] Run **Opening a PR** per component or per safe batch.
  - skip: the user previously requested committing directly to the current local main branch.

## Throughput checkpoint

- [x] Blocking first step. Confirm the mismatch against the supplied screenshots and map Question Overview CSS tokens and empty-state structure.
- [x] Independent workstreams. A read-only `how` pass checks the component ownership while the main agent inspects the exact styles.
- [x] Shared mutable state. No parallel writers. The main agent owns both scoped Learning Book files.
- [x] Smallest safe decomposition. Correct the scoped token names and only restructure the empty state where the reference differs.

## Task checks

- [x] Align the filter panel border, background, spacing, and equal-width controls.
- [x] Align the list toolbar, table shell, header fill, row borders, and empty state.
- [x] Remove Learning Book-only forced viewport whitespace while preserving the shared outer white card.
- [x] Verify focused tests and production build.
- [x] Verify desktop and mobile screenshots on the matching live surface.
- [x] Review and commit the focused change to current `main`.
