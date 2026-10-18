# Learning-book access-role bug

- [x] Reproduce the exact forbidden path and identify the authorization predicate.
- [x] Compare the learning-book access rule with the authenticated learner-access contract.
- [x] Add a regression test proving access does not require the active role to equal the relationship role.
- [x] Run the regression test and record the pre-fix failure.
- [x] Remove the incorrect role-equality predicate while preserving accepted/revoked and create-plan permission checks.
- [x] Run focused tests, PostgreSQL integration, build, and browser verification on the learning-book page.
- [x] Commit only the intended fix to the current main branch.
