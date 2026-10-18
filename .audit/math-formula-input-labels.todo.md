# Math formula readability and answer labels

2026-10-18 使用者在 Chrome 實際畫面退回首次驗收：21.6px 的公式與 16px 的輸入列編號仍不足以清楚辨識。本清單重新開啟，驗收門檻改為公式至少 24px、列編號至少 18px，並以同一題的 Chrome 桌面與 390px 手機畫面為準。

2026-10-18 第二次驗收確認題幹中的空白分數線是原題的作答空格，不是破圖。本清單再次開啟，改修解析文字的共用行內分數基線。Chrome 量測顯示舊的 `vertical-align: -0.42em` 讓分數線中心比同列等號低約 14px。

## Bug fix playbook

- [x] Reproduce it yourself on the matching surface via the driver skill (Non-negotiables), even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
- [x] Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with `how` over the affected subsystem and the **why** skill for regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Drive a long or stubborn hunt with Claude Code's `loop` skill. Confirm the surviving *mechanism* with runtime evidence before the step-3 architect/interrogate fan-out.
- [x] Plan the fix. If it crosses a function boundary, `architect` first. Delegate implementation to a subagent using your configured bug-fix model (default in poteto-mode's Models section) with a specific scope.
  - Blocked: this session's system instructions prohibit new subagent delegation. The primary agent owns the implementation and records the missing independent review gate.
- [x] Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
- [x] Stage the commits so the failing repro lands before the fix in git history. See the **tdd** skill for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear.
  - Skip commit staging: the shared worktree already contains unrelated user changes, so this task will add a failing behavior test before the fix without creating commits.
- [x] Run **Opening a PR**.
  - Skip: the user requested a local fix and did not request a PR or deployment.

## Architect phases

- [x] Ground
- [x] Sketch
- [x] Agree
- [x] Implement
- [x] Scrap

## Throughput checkpoint

- [x] Blocking first steps. Reproduce the input-label and formula-size failures, then identify the documented contract.
- [x] Independent workstreams. Keep the behavior test, renderer styling, answer-field layout, and documentation changes separate until their contracts are known.
- [x] Shared mutable state. Preserve the existing `QuestionPart.answerFieldCount` model and make the rendered row label derive from the same part order.
- [x] Smallest safe decomposition. Use the existing persisted question renderer and shared formula class. Do not add a second answer-form implementation.

## Verification evidence

- Targeted behavior tests: 9 passed.
- Related question rendering, media, filter, and formula tests: 19 passed.
- TypeScript check and production build: passed; build retains the existing optional document-preview dependency warnings.
- Superseded evidence: the first Chrome pass measured 21.6px formulas and 16px row labels, but the user rejected that visual size as still unreadable.
- Revised Chrome acceptance passed on live question `1501004796`: question preview formulas are 25.6px and formal-practice formulas are 28px; visible row labels are 18px on both surfaces.
- Desktop and 390px formal-practice views show `(1)`, `(2)`, `(3)`, `(4)` paired with 2, 3, 2, 2 answer fields. At 390px the application has no overflowing element and `scrollWidth === clientWidth === 390`.
- The question-preview 390px run exposed a separate Chrome Translate injection (`#gtx-trans`) extending to 403px. The app elements themselves had zero overflowers; formal practice, without that injected overlay affecting width, measured exactly 390px.
- Final targeted tests, TypeScript check, runtime guardrails, and production build passed. Build retains only the existing optional document-preview dependency warnings.

## Explanation alignment follow-up

- [x] Reproduce on the exact Chrome question route and measure the text and fraction boxes.
- [x] Confirm that the prompt's blank fractions are intentional `\\phantom` answer spaces and preserve them.
- [x] Add a regression check for the shared inline-fraction baseline.
- [x] Replace the legacy downward offset with a baseline rule that aligns the fraction bar with adjacent operators.
- [x] Verify the question preview in Chrome at desktop and 390px widths. The same global `BopomofoText` fraction rule also drives formal-practice answer and explanation text.
- [x] Run the targeted tests, lint, and production build.
- [x] Update the import and product documents with the intentional-blank and alignment rules.

### Follow-up verification evidence

- Before the fix, the first explanation fraction used `12.96px` text and `vertical-align: -5.4432px`; its fraction bar was about `14px` below the adjacent equals-sign center.
- After the fix, the explanation text and fraction both measure `16px`; `vertical-align: middle` reduces the measured center difference to `2.3828125px`.
- The exact Chrome route keeps 13 prompt formulas and nine intentional `\\phantom` blanks. No stored question content changed.
- At 390px, `scrollWidth === clientWidth === 390`; the explanation baseline measurement remains `2.3828125px` and no horizontal overflow appears.
- Targeted rendering tests passed `20/20`; TypeScript lint, 30 runtime guardrails, and the production build passed. The build retains only the existing optional document-preview dependency warnings.

## Multi-line formula prompt spacing follow-up

- [x] Reproduce the stacked numerator and denominator rows on the exact Chrome question route.
- [x] Name the data shape: only a formula-bearing prompt rendered as a heading receives the added row spacing.
- [x] Add a regression check that formula-bearing headings use a dedicated row height.
- [x] Increase the row height without changing ordinary Chinese prompt typography.
- [x] Verify desktop and 390px Chrome rendering, including horizontal overflow.
- [x] Run the targeted tests, lint, and production build.

### Formula row-spacing verification evidence

- Before the fix, adjacent formula rows started `51.3828125px` apart, exactly matching the formula box height. The visible gap was `0px`.
- After the fix, the formula-bearing heading uses a `64px` line height. Adjacent formula rows remain `51.3828125px` high and have a measured `12.6171875px` gap.
- The desktop and 390px Chrome runs both show four separate rows, `25.6px` formula text, and no horizontal overflow. At 390px, `scrollWidth === clientWidth === 390`.
- The selector is `.question-inline-formula-flow[role="heading"]`. It does not change ordinary Chinese prompts, options, answers, or explanations.
- Targeted rendering tests passed `11/11`; TypeScript lint, 30 runtime guardrails, and the production build passed. The build retains only the existing optional document-preview dependency warnings.
