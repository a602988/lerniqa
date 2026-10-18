# Feature

- [x] `how` over the affected subsystem. Existing extraction groups approved images by checksum, then chooses the first mapping for the associated question. This loses source occurrence identity when one checksum appears more than once.
- [x] `architect` for parallel design exploration. The parent supplied the accepted design. `sourceOccurrence` is a 1-based identity scoped to normalized question number and checksum. The current session forbids additional agent dispatch.
- [x] Write the throughput checkpoint as four todo items.
- [x] Delegate code-writing to a subagent using your configured feature model. `n/a`: this task is already a delegated implementation slice, and the current session forbids further delegation.
- [x] Verify on the matching surface. Seven focused guardrail tests pass. `git diff --check` passes. The full guardrail file has one unrelated pre-existing embedded-table contract failure.
- [x] Rebase into small, ordered commits. Stack follow-ups. `n/a`: the parent owns integration and commits.
- [x] If the design is contested, `interrogate` before shipping. `skip`: the parent supplied a verified architecture and exact contract.
- [x] Run **Opening a PR**. `n/a`: the parent owns integration and any pull request.

# Architect

- [x] Ground. The importer reads HTML image tags in source order, associates each tag with a normalized question number, and builds one image record per tag. Asset identity is checksum-based, while part placement is mapping-based.
- [x] Sketch. Validate the registry once. Group mappings by normalized question number and checksum. Count matching source encounters. Select an occurrence-aware mapping by its explicit ordinal.
- [x] Agree. The parent supplied the accepted contract and source evidence.
- [x] Implement. The registry validates occurrence identities before extraction. The extractor selects mappings from source encounter order and verifies the final count.
- [x] Scrap. Implementation matched the accepted design without structural deviation.

# Throughput checkpoint

- [x] **Blocking first steps.** The accepted mapping list and duplicate occurrence contract are fixed before edits.
- [x] **Independent workstreams.** Code, tests, and two documentation files are disjoint, but one delegated owner serializes them to keep the contract synchronized.
- [x] **Shared mutable state.** Only the four assigned files and this session-local audit file are writable. Existing edits from other agents stay intact.
- [x] **Smallest safe decomposition.** One owner is safest because registry validation, extraction selection, behavioral tests, and documentation describe one invariant.
