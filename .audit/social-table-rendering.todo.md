# Social table rendering bug

- [x] Reproduce it yourself on the matching surface via the driver skill.
- [x] Binary-search the cause and confirm the mechanism with runtime evidence.
- [x] Plan the fix across the shared question renderers.
- [x] Add a failing behavior test for native table markup.
- [x] Implement one shared semantic table renderer.
- [x] Verify a current published native-table question on the authenticated desktop surface.
- [x] Run focused tests and typecheck.
- [ ] Re-run the production build without the dev server competing for Next compilation resources.

Verification note: the user-supplied route `24292428848681` currently resolves to non-table question `05014044`. The stable table regression sample `266114747969587` resolves to `05010356` and rendered one semantic table with 3 rows and 15 cells. A temporary 390px viewport override was not honored by the claimed Chrome tab, so the mobile result is covered by the overflow CSS contract and automated assertion but is not claimed as a live 390px pass in this run.

Root cause confirmed: stored `contentType: "table"` blocks are rendered as `<pre>` in both learner question surfaces, so tab/newline data is visible but cannot produce rows, cells, borders, or responsive table behavior.

Design sketch:

- `parseQuestionTable(text): string[][]` normalizes CRLF and tab-separated cells while preserving intentional empty cells.
- `QuestionTable({ text })` owns semantic `<table>/<tbody>/<tr>/<td>` output and the missing-content fallback.
- Both `PersistedQuestionPromptContent` and local-practice `ContentBlocks` call the same renderer.
- Shared global classes own borders, spacing, and horizontal overflow so the same stored block looks identical on question detail and practice routes.
