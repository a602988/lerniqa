# Learning data performance decision

## Evidence

- Five authenticated reloads took 10,534–17,900 ms, median 11,022 ms.
- Each reload issued 78–79 API requests, transferred about 39.5 MB, and had 0 failed requests.
- Startup enumerates 73 client-maintained catalog targets and blocks the workspace until 11,004 published questions plus history are loaded.
- The measured English Unit 1 base query returned 423 rows in 474.8 ms with 218,990 shared-buffer hits. Its preferred-identifier lateral lookup performed 423 sequential scans of 25,853 `question_identifiers` rows because no index starts with `question_id`.

## Decision

Use staged, measured units.

1. Add migration `0019` for the exact preferred-identifier lookup and verify the query plan plus the same five-reload browser benchmark.
2. If the visible-loader median is not below 3 seconds, replace the 73 catalog requests with one authorized, database-driven accessible-catalog operation and remove the client target registry. Also replace the post-session full reload with a narrow history/wrong-review refresh.
3. If the remaining limiter is the 39.5 MB response, JSON parsing, or client adaptation, stop tuning the full-catalog path and move to route-scoped summary and lazy question loading.

## Invariants

- Catalog responses remain answer-free.
- Session restore continues to use the revision IDs pinned to session items.
- Learner access, enabled subjects, question-bank membership, and revision visibility remain server-side authorization rules.
- Empty data is not replaced by a hardcoded fallback.
- Persistent question, learner, session, answer, and history data are never reset to roll back a performance change.

## Rejected first steps

- Increasing request concurrency does not remove repeated work and would contend on the five-connection database pool.
- Ending the loading screen early would hide work while leaving network, Node, and PostgreSQL saturated.
- A broad lazy-loading rewrite is the likely long-term shape, but its current candidate invents unresolved collection migration and facet semantics and overlaps heavily with unrelated work in the dirty worktree.
- A giant bootstrap route is not accepted as a final scale solution. It is only the bounded second stage if the index alone is insufficient, with a three-second stop gate.

## Verification contract

- Re-run the exact `EXPLAIN (ANALYZE, BUFFERS)` and confirm the identifier lookup uses the new index without repeated full-table scans.
- Run five authenticated reloads on the same local route and report median, range, API count, transferred bytes, and failures.
- Stop at the earliest stage that meets the visible-loader target without correctness regressions.
- Run migration forward, rollback, reapply, focused tests, build, and real desktop/mobile browser checks.

## Stage 1 result

- The persistent local database was backed up before migration at `local-data/backups/lerniqa-local-20261018T090707Z`.
- `0019` was applied after its isolated migration suite passed forward, rollback, reapply, and schema parity for all 19 migrations.
- The exact 423-row query changed from 474.757 ms and 218,990 shared-buffer hits to 64.509 ms and 28,214 hits.
- The identifier node now uses `question_identifiers_preferred_lookup_index` for all 423 lookups. Its former sequential scans and 192,045 identifier buffer hits are gone.
- Five browser reloads took 8,298–20,754 ms, median 8,633 ms. Each still issued 79 API requests, transferred 39,497,576 bytes, and had 0 failures.
- The query fix is material but does not meet the three-second visible-loader gate. Stage 2 is required.

## Stage 2 result

- The client-maintained 73-target catalog registry was removed. Startup now reads the authenticated learner's accessible catalog through one database-driven request whose scope is enforced by learner access, enabled subjects, selected book versions, active banks, and current published revisions.
- The catalog remains answer-free, and session restoration still hydrates the revision IDs pinned to session items.
- Completing a session now refreshes only history and wrong-review data instead of downloading the full catalog again.
- Five authenticated reloads took 5,352–10,458 ms, median 6,614 ms. They issued 6–7 API requests, transferred 39,456,807–39,457,357 bytes, and had 0 failures.
- Request fan-out fell by about 91%, but the single questions response was still 39,429,315 bytes uncompressed and took about 3,047 ms in the measured trace. Stage 3 transport compression was therefore warranted before a larger lazy-loading cutover.

## Stage 3 result

- The large accessible-catalog response now negotiates gzip, respects `gzip;q=0`, returns `Vary: Accept-Encoding`, and preserves `private, no-store` plus the exact JSON envelope. Filtered catalog and error responses keep their existing response path.
- The measured questions response fell from 39,429,315 transferred bytes to 7,654,125 bytes while decoding to the same 39,429,315-byte JSON body.
- Five authenticated reloads took 4,537–5,533 ms, median 4,857 ms. They issued 7 API requests, transferred 7,681,867 bytes, and had 0 failures.
- Against the original baseline, visible-loader median improved by 55.9%, request count fell by about 91%, and transfer volume fell by 80.6%.
- The three-second stretch gate was not met. The remaining cost is dominated by generating, parsing, adapting, and retaining the full 11,004-question catalog. The next scale step remains route-scoped summary data plus paginated/lazy question hydration; it is intentionally not hidden behind an early-dismissed loading screen.
