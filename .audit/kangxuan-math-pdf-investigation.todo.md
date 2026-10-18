# 康軒數學 PDF 匯入檢核

- [x] Route through the **how** skill. For motivation questions, also route through the **why** skill.
  - `why` 不適用。這次要確認 PDF 能否解除既有保留原因，不是查設計動機。
- [x] Throughput checkpoint stays one line: `throughput checkpoint: n/a, read-only investigation`.
  - throughput checkpoint: n/a, read-only investigation
- [x] Produce the `how`-shaped output (Overview / Key Concepts / How It Works / Where Things Live / Gotchas), or a recommendation with a tradeoffs table if the request is a decision between alternatives.
- [x] Apply the **unslop** skill to the reply.

- [x] 確認本次 11 份 DOC 都有同名 PDF。
- [x] 以最新 v9 稽核報告取得 153 題保留題與來源頁。
- [x] 驗證 PDF 的頁數、文字層與頁面影像可讀性。
- [x] 逐原因判斷 PDF 能否提供唯一、可追溯的修正依據。
- [x] 產出可重跑的核對結果，不寫入正式題庫。

## 結果

- 153 題全部存在於 7 份相關 PDF，且題號都能在 PDF 中唯一定位。
- 153 題分布於 57 個 PDF 實際頁面，57 頁都可由 Poppler 成功轉成非空白影像。
- Word `sourcePage` 與 PDF 頁碼不可直接互換。實測偏移為 0 到 12 頁，必須以題號定位。
- PDF 視覺頁面可還原原本因公式圖、選項版面、乘號與上下標而保留的內容。
- `pdftotext` 仍會破壞雙欄閱讀順序及分數、根式、上下標位置。正式匯入不可只依文字層，需保留 PDF 頁面裁圖或以視覺定位重建公式。
