# Math formula rendering and search

## Feature playbook

1. `how` over the affected subsystem.
2. `architect` for parallel design exploration.
3. Write the throughput checkpoint as four todo items. A dimension that genuinely does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped:
   - **Blocking first steps.** Gates run before fan-out.
   - **Independent workstreams.** Disjoint files, services, or layers parallelize. Shared writes serialize.
   - **Shared mutable state.** Default to splitting the target (the **separate-before-serializing-shared-state** principle skill). Serialize only for real invariants.
   - **Smallest safe decomposition.** If one worker is best, name why.
4. Delegate code-writing to a subagent using your configured feature model (default in poteto-mode's Models section) with a specific scope (file paths, named data shape and its organizing structure per **principle-model-the-domain**, a state machine over scattered booleans, a table/registry over branching, a typed model over repeated shape assumptions, chosen before the delegate writes logic, and success criteria). Pick each subagent's reasoning level for the job, per the Subagents section. When the implementation admits multiple valid shapes (error handling, abstraction layer, test structure), delegate via the **arena** skill instead so the runners surface the alternatives and the cross-judge guards the pick. Mandatory: no skip-with-reason escape, and Laziness Protocol does not override it (the gain is review separation, not lines saved). A subagent forbidden to spawn satisfies this by owning the diff directly with the same review separation. No "standing by" reply that waits on a nested agent. **Give every file-writing delegate its own worktree** (spawn it with `isolation: "worktree"`, or hand it an exclusive branch), and do not write files or run a suite in a worktree a delegate still holds. On Claude Code, `isolation: "worktree"` branches from the remote default branch unless the `worktree.baseRef` setting is `"head"`. When the delegate builds on commits the default branch lacks, commit them, create its worktree with `git worktree add <path> -b <delegate-branch> HEAD`, and name that base commit in the brief. Fencing a file in the brief's prose is not a lock (**principle-separate-before-serializing-shared-state**). Comments per **Comments**. Surgical edits, re-ground against the source for upstream-derived files. Port shared-primitive improvements to all consumers and verify each. Commit liberally.
5. Verify on the matching surface. "Inconclusive" or wrong-surface is not a pass. Flag it.
6. Rebase into small, ordered commits. Stack follow-ups.
   Use the **sequence-verifiable-units** principle skill, building, verifying, and committing each small unit before the next.
7. If the design is contested, `interrogate` before shipping.
8. Run **Opening a PR**.

## Architect phases

- [x] Ground: traced schema, importer, writer, public renderers, learner/admin search, and the affected persisted question.
- [x] Sketch: compared client-only conversion with a domain `formula` block plus server-side search projection.
- [x] Agree: selected canonical TeX in `text_content`, KaTeX rendering, derived search aliases, and image fallback for unverified legacy assets.
- [x] Implement: add the shared renderer/search projection, importer contract, verified correction, and tests.
- [x] Scrap: n/a; implementation did not reveal a repeated contract deviation that warranted deletion or consolidation.

## Throughput checkpoint

- [x] **Blocking first steps.** Confirmed that legacy equations are GIF content blocks and that the database already supports canonical `formula` blocks.
- [x] **Independent workstreams.** Rendering, search, import conversion, data correction, and docs are separable reads, but writes stay sequential because this session forbids subagent delegation and the worktree already contains overlapping user changes.
- [x] **Shared mutable state.** Keep one canonical formula contract and one pure search-projection helper; renderers consume it and import/data writers serialize through existing revision creation.
- [x] **Smallest safe decomposition.** One owner is required here because the importer, live persisted revision, and shared UI files overlap existing uncommitted work; implementation proceeds as small verified units without resetting those changes.

## Delivery checklist

- [x] Shared safe KaTeX renderer with bundled web fonts.
- [x] All public formula-block renderers use the shared component.
- [x] Learner search matches canonical TeX and readable aliases such as `6/8`.
- [x] Importer preserves a verified formula mapping as `content_type=formula` and leaves unknown GIFs untouched.
- [x] Source-verified correction for question `1501004796` is idempotent and preserves published history.
- [x] Formal database/import/runbook documents state the formula and fallback rules.
- [x] Unit, import guardrail, typecheck, build, database correction, and desktop/mobile browser checks pass.
