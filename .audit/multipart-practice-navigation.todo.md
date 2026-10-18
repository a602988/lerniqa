# Multi-part practice navigation

## Feature playbook

1. [complete] `how` over the affected subsystem.
2. [complete] `architect` for parallel design exploration.
3. [complete] Write the throughput checkpoint as four todo items.
4. [complete] Delegate code-writing to a subagent using the configured feature model with a specific scope.
5. [complete] Verify on the matching surface.
6. [skip] Rebase into small, ordered commits. The user did not request commits and this shared worktree has unrelated edits.
7. [skip] If the design is contested, `interrogate` before shipping. The agreed domain model and existing answer contract were not contested.
8. [skip] Run Opening a PR. The user requested a local adjustment and did not request a pull request.

## Architect phases

1. [complete] Ground
2. [complete] Sketch
3. [complete] Agree
4. [complete] Implement
5. [complete] Scrap

## Throughput checkpoint

1. [complete] Blocking first steps. Inspected the current field renderer, session state, answer persistence, and the exact desktop and mobile layouts.
2. [complete] Independent workstreams. The visual input-border fix was specified independently, while shared component and CSS writes stayed with one implementation owner.
3. [complete] Shared mutable state. One owner updated the practice navigation state and its renderer so answer state, current part, and submit behavior cannot diverge.
4. [complete] Smallest safe decomposition. One implementation owner handled the behavior and CSS where they meet in the persisted question component and practice page.

## Verification evidence

- `node --no-warnings --experimental-strip-types --test tests/persisted-question-fields.test.ts` passed 5 tests.
- `git diff --check` passed.
- `npm run build` completed successfully. Existing optional document-preview dependency warnings remain unchanged.
- Exact question `200754247869782` showed one visible part at a time, preserved a temporary answer across next/previous navigation, and kept final submission disabled while incomplete.
- The answer input computed to a 1px border, 14px radius, white card background, and 44px minimum height.
- At 390px viewport width the document scroll width remained 390px with no horizontal overflow.
