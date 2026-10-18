# Hanlin English EMF image quality repair

## Figure-it-out playbook

- [complete] Read the Principles section of `pstack:poteto-mode`.
- [complete] Phase A. Define done, scope, and rigor.
- [complete] Phase B. Design the workflow and build the baseline checker before mutation.
- [complete] Phase C. Run each repair as a verified unit.
- [complete] Phase D. Keep the decision trail in `.audit/hanlin-english-emf-quality.tsv`.
- [complete] Phase E. Verify the full result on stored data and the real learner UI.

## Definition of done

- Every published current Hanlin English question whose stored GIF is a low-resolution derivative of a source EMF has an explicit source-SHA, raw-EMF checksum, question-number, and replaced-checksum contract.
- Re-import creates new revisions and preserves history. A repeated run converges without duplicate revisions or assets.
- The full Word-source audit reports exact source and database image parity with no unresolved EMF-quality candidates.
- Desktop and 390px mobile checks show readable images without horizontal overflow on representative single-image and multi-image questions.
- Import guardrail tests, local-practice tests, type checking, and the production build pass.
- The import runbook documents detection, approval, conversion, writeback, and verification.

## Workflow

- [complete] Inventory all approved English source documents and pair document-order EMF objects with their HTML derivatives.
- [complete] Cross-check proposed pairs against question association, current database assets, and existing approved mappings.
- [complete] Render approved EMFs to trimmed PNG and record before and after dimensions and checksums.
- [complete] Add explicit contracts and behavior tests. Increase the affected parser versions.
- [complete] Run targeted dry-runs, then write only verified source documents.
- [complete] Run the full corpus audit and database integrity checks.
- [complete] Verify representative pages in the browser at desktop and 390px width.
- [complete] Update the import runbook with the final counts and commands.

## Throughput checkpoint

- [complete] Blocking first steps. Root cause and one exact EMF-to-GIF case are proven before changing data.
- [n/a] Independent workstreams. The source contracts, parser, writeback, and audit touch shared importer and database state, so this run remains serialized.
- [complete] Shared mutable state. Only this run writes the new audit artifacts and any approved database revisions.
- [complete] Smallest safe decomposition. One deterministic inventory and repair path handles all matching questions; no hand-edited database rows.
