# linmacbook-pro 同步清單

- [x] Stop at a safe boundary. Finish the current atomic step or back out of it. Start nothing new, and cancel any nested subagents.
- [x] Take no irreversible action to pause. No PR and no push unless you already had one out.
- [ ] Make the work durable. Commit uncommitted edits as one clear `wip:` commit on the current branch so nothing is lost. If the tree is broken, say so in the commit body in one line.
  - skip: 本機 Git 工作樹目前乾淨，沒有需要建立 WIP commit 的變更。
- [ ] Write the resume note off-context. Capture intent, what you were doing, progress and what's verified, current state, next steps, key files, and gotchas. Use the canonical checkpoint directory from [Resume storage](../references/resume-storage.md), which defines the shared writer/reader locator for every runtime. It must survive the expected interruption. If a show-me-your-work trail exists, point at it instead of duplicating it.
  - skip: 已有專案交接文件，本次直接把 Git 與資料庫同步到目標電腦。
- [ ] Preserve artifacts the user explicitly requested for use after resume, such as questions, an acceptance checklist, or a procedure. Reuse the existing artifact when there is one; otherwise save the requested material beside the resume note and link it. Preserve exact wording, completeness, and order when requested. Publish the checkpoint through `resume.mjs`, which verifies links and files before atomically updating the project pointer. Then read it using only the project directory and check the requested contents before declaring the checkpoint ready. Ten requested questions means all ten are reachable from the note alone. This does not require archiving every aside or pausing an ongoing task.
  - skip: 本次以遠端 Git HEAD、資料庫與媒體的實際驗證作為交接完成依據。
- [ ] 確認 Tailscale 與 SSH 可達。
- [ ] 盤點遠端專案、分支、未提交變更與本機資料服務。
- [ ] 經 Git 同步程式碼。
- [ ] 傳送並驗證完整備份包。
- [ ] 在遠端安全還原 PostgreSQL 與媒體。
- [ ] 驗證遠端 Git HEAD、資料庫身分、資料量與媒體檔數。
