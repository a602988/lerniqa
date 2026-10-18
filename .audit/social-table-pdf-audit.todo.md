# 社會科表格題 PDF 全量稽核

- [x] Read the Principles section of the poteto-mode skill.
- [x] Phase A: Frame the falsifiable completion predicate, quantified scope, blockers, and rigor level.
- [x] Phase B: Build a repeatable inventory that maps every source Word table or embedded table object to its source document and candidate question.
- [x] Phase B: Capture the pre-change database baseline for published table blocks and unresolved table candidates.
- [x] Phase C: Process one source document at a time. Convert only that document to PDF, inspect every candidate page, close the document, then continue.
  - Microsoft Word exported 62 PDFs sequentially. LibreOffice evidence was rejected after a rendered-page control showed missing source text.
- [x] Phase C: For every mismatch, add a checksum-bound table contract, add a behavioral test, dry-run the one document, write the import, and query the new current revision.
- [x] Phase C: Re-render the corrected question and compare it with the source PDF page.
- [x] Phase D: Append every keep, repair, rejection, and verification result to `.audit/social-table-pdf-audit.tsv` and the JSON evidence registries.
- [x] Phase E: Re-run the full inventory and require zero unclassified table candidates and zero source-versus-current mismatches.
  - Final database verification: 164/164 semantic tables passed across 163 questions; zero missing blocks, row mismatches, or flattened-table duplication.
- [x] Phase E: Run focused guardrails, type checking, build, and browser verification without deploying.
- [ ] Opening a PR.
  - skip: the user requested local correction and did not request a commit, push, or PR.
- [x] Shared mutable state.
  - Work is serialized in the current checkout because subagent delegation is disabled and each Word source must be handled one at a time.

## Completion predicate

Every current social-source question whose Word source contains a native or embedded table has a classified audit row with PDF evidence. Each published question has a current `table` content block matching the PDF row and column structure. Unrecoverable sources remain pending with an explicit reason. The final inventory has zero unclassified candidates and zero incorrect published table mappings.

## Initial scope

- 242 source Word files on disk.
- 225 distinct imported sanitized source documents in PostgreSQL history.
- 3 published current table blocks before this run.
- 14 previously confirmed unresolved social questions, including 4 table-related sources.

## Rigor

High. The task changes persistent published question data. Detection may be automated, but every mapping and write requires a fixed source SHA-256, question number, PDF page, embedded-object checksum when present, and an idempotent re-import.
