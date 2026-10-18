# 考試模擬功能規劃

## Feature playbook

- [x] 1. `how` over the affected subsystem.
- [x] 2. `architect` for parallel design exploration.
- [x] 3. Write the throughput checkpoint as four todo items. A dimension that genuinely does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped:
  - [x] **Blocking first steps.** Gates run before fan-out.
  - [x] **Independent workstreams.** Disjoint files, services, or layers parallelize. Shared writes serialize.
  - [x] **Shared mutable state.** Default to splitting the target (the **separate-before-serializing-shared-state** principle skill). Serialize only for real invariants.
  - [x] **Smallest safe decomposition.** If one worker is best, name why.
- [x] 4. Delegate code-writing to a subagent using your configured feature model with a specific scope, named data shape, organizing structure, and success criteria.
  - skip: 本輪交付是正式規劃文件，不實作程式碼。
- [x] 5. Verify on the matching surface. "Inconclusive" or wrong-surface is not a pass. Flag it.
  - 本輪以現有 schema、程式契約及文件交叉核對規格，不進行尚未實作功能的瀏覽器驗收。
- [ ] 6. Rebase into small, ordered commits. Stack follow-ups.
  - skip: 使用者未要求提交，且工作區已有大量其他未提交修改。
- [x] 7. If the design is contested, `interrogate` before shipping.
  - skip: 兩份獨立候選與交叉評審已收斂於專用不可變藍圖、固定試卷及全卷約束求解，沒有未解的架構爭議；產品選項保留於正式文件待確認。
- [ ] 8. Run **Opening a PR**.
  - skip: 使用者未要求建立 PR。

## Throughput checkpoint

- [x] **Blocking first steps.** 先確認現有題庫分類、學習者作答統計、相近題關係、學習本與 session 契約。
- [x] **Independent workstreams.** 題庫與篩選契約、作答歷程與相近題契約已平行盤點；兩份架構候選及交叉評審完成後，由主代理串行整合文件。
- [x] **Shared mutable state.** 本輪只新增一份規劃文件，不修改 schema、正式資料或既有產品文件中的已定案規則。
- [x] **Smallest safe decomposition.** 以一份權威規劃文件定義領域模型、規則優先序、操作流程、資料缺口與分階段驗收。

## Deliverable

- [x] 建立 `docs/plans/exam-simulation-plan.md`。
- [x] 明確定義來源、題型、難度、作答歷史、相近題、計分及總分調整規則。
- [x] 區分已可沿用的資料與需要新增或確認的資料。
- [x] 列出產品待決策與實作階段，不把提案描述成已完成。
