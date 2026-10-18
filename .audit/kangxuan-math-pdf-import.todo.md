# 康軒數學 PDF 複核後正式匯入

## Bug Fix Playbook

- [x] Phase 1: Investigate
- [x] Phase 2: Classify
- [ ] Phase 3: Fix
- [ ] Phase 4: Verify
- [ ] Phase 5: Prevent Regression

## Architecture

- [x] Model the Domain: PDF 證據以來源 DOC SHA-256、PDF SHA-256、題號、PDF 頁碼與公式圖片 checksum 組成，不以 Word 頁碼推測 PDF 頁碼。
- [x] Boundary Discipline: 題幹與解析可保留原始公式圖片；標準答案必須先轉成可批改文字，不能把圖片替代文字當答案。
- [x] Make Operations Idempotent: 修正批次使用固定版本與內容雜湊，同一輸入重跑不得新增 revision。
- [x] Sequence Verifiable Units: 先產生證據與 dry-run，再備份、正式寫入、資料庫驗證與網站驗證。
- [x] Build the Lever: 建立可重跑的 PDF 複核登錄與測試，不把 153 題散落硬寫在匯入流程。

## Implementation

- [ ] 產生 153 題的 PDF 題號頁定位及 PDF SHA-256。
- [ ] 對 122 題的 157 種答案公式圖片建立固定文字對照。
- [ ] 修復 27 題乘號誤判、3 題選項解析與 2 題上下標格式。
- [ ] 新增來源鎖定、證據完整性與重跑冪等測試。
- [ ] 更新正式匯入規範與完成狀態。

## Verification

- [ ] dry-run 為 1,020 題可發布、0 題待檢、0 題失敗。
- [ ] 正式寫入前建立本機資料庫與資產備份。
- [ ] 正式寫入後核對批次、current revision、答案、圖片與分類。
- [ ] 跑相關測試、型別檢查與 build。
- [ ] 在本機網站抽查桌面與手機題目、答案及解析。
- [ ] 正式寫入後再建立一份備份。

throughput checkpoint: 153 題依來源文件分批驗證，共用證據登錄，單一正式寫入交易。
