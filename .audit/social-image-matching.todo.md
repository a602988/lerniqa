# Social image matching bug fix

- [x] Reproduce it yourself on the matching surface via the driver skill.
- [ ] Binary-search the cause.
- [ ] Plan the fix. If it crosses a function boundary, `architect` first.
- [ ] Verify on the same surface.
- [ ] Stage the commits so the failing repro lands before the fix in git history.
  - skip: The user did not request commits, and the shared worktree contains unrelated changes.
- [ ] Run Opening a PR.
  - skip: The user did not request a pull request.
- [ ] Identify every current effective `multi-part-parse-failed` social record and classify its source structure.
- [ ] Add behavior tests before changing parser logic.
- [ ] Implement the smallest source-verifiable parser rule.
- [ ] Run targeted and full social dry-runs.
- [ ] Back up local persistent data and formally import only verified sources.
- [ ] Verify database records and update formal documentation.

Throughput checkpoint: finish source classification and a failing behavior test before implementation; finish parser tests and targeted dry-run before any database write; finish database and browser checks before reporting completion.
