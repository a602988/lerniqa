- [x] Confirm the authoritative import scope from versioned import contracts and the local import database.
- [x] Exclude English and preserve the approved per-subject source boundaries.
- [x] Build a rerunnable Word-native export and PDF verification tool.
- [x] Dry-run the complete source manifest and reconcile every missing or duplicate path.
- [x] Export or verify every in-scope document one file at a time.
- [x] Validate every PDF opens, has pages, and reports the Word-native Quartz producer.
- [x] Render representative formula and image pages for each subject.
- [x] Report exact per-subject totals and any exceptions.

Final result: 270/270 passed (國文 20、數學 11、自然 40、社會 199；英文排除). 215 PDFs were newly exported and 55 existing Word-native PDFs were independently revalidated. No exceptions remained.

Throughput checkpoint: establish the complete manifest first; then each document is an independent unit whose PDF must validate before the next opens; the manifest is the only shared state and is rewritten after every unit; the smallest safe decomposition is one Word document followed by one direct PDF check.
