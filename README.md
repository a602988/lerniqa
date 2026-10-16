# Lerniqa｜學習卡

給國小／國中學生的智慧題目練習與錯題複習平台。

## 目前已建立
- Next.js 15 + React 19 + TypeScript + Tailwind CSS 專案
- 以 Keel 元件建立的響應式操作介面
- 多學習者切換，以及獨立的學習者設定頁
- 稱呼、年級、學期、學校、各科書籍版本與可自行輸入的每輪預設題數
- 練習企劃、依章節／依考試範圍、三種練習方式，以及預設收合的進階篩選；進階設定可調整難易度占比、來源、題型、知識點、建立者與本輪題數
- 專注練習版面、每題大型手寫板、畫筆／橡皮擦，以及暫時關閉／結束練習流程
- 每個主要頁面有固定網址，重新整理後維持原頁面
- 國字 AI 辨識預留介面（目前只顯示未連接，不產生模擬結果）
- 錯題複習、固定相近題、成果統計與檢視設定（示範，不保存人工判定）
- 圖片／PDF／貼上文字匯入及多題校正表單示範，支援題目附圖重新配對；OCR／AI 拆題仍是模擬結果，使用者確認後的題目與圖片會寫入本機 runtime JSON／assets
- `/account` 已接上本機 PostgreSQL，支援電子郵件密碼註冊、登入、登出與目前帳號查詢；密碼與 session token 都只保存雜湊。忘記密碼、社群登入與帳號綁定仍未開放
- 前端透過 `/api/v1` 讀寫本機 JSON；初始資料放在 `data/fixtures`，執行期資料寫入不進版控的 `runtime-data`
- 題目可保存版本、章節、單元、主題、難易度、來源，以及題幹與答案中的圖片區塊
- PostgreSQL 欄位、關聯與限制已由 `0001` 至 `0007` 原生 SQL migration 建立並通過本機隔離驗證
- `/local-practice` 是獨立的本機 PostgreSQL 試行流程，會依登入 session、學習者存取權與題庫成員關係隔離資料，可選題、作答、判分並持久保存練習、錯題與 outbox；目前只允許合成資料，不代表 production 權限切換已完成

## 執行
需 Node.js 20+。

```bash
npm install
npm run dev
```

開啟 http://localhost:3500。

資料庫 migration 的本機隔離驗證：

```bash
npm run db:test
```

要啟動可保留資料的本機 PostgreSQL 試行流程：

```bash
npm run db:local:ensure
npm run dev
```

先開啟 http://localhost:3500/account，以 `.invalid` 合成信箱建立本機帳號，再前往 http://localhost:3500/local-practice。資料存在不進版控的 `local-data`，停止或重開 Next.js 與 PostgreSQL 後仍會保留。

本機試行的正式匯入範圍只有 `05_第四課_論語選（一）子游問孝（二）譬如為山（三）三省吾身.doc`；本機 PostgreSQL 已確認匯入 279 題，parser v2 的修正版是全部題目的目前版本。其餘 14 份題庫文件尚未匯入，也不會被自動歸到第四課；完整匯入命令與安全限制見下方的本機試行文件。

## 文件
- [產品規格](docs/PRODUCT_SPEC.md)
- [開發路線圖](docs/ROADMAP.md)
- [資料庫設計與資料字典](docs/question-database-design.md)
- [資料庫完成對照與正式切換邊界](docs/database-completion-matrix.md)
- [Migration 與回滾說明](database/README.md)
- [本機 PostgreSQL 練習試行](docs/local-practice-pilot.md)
- [翰林題庫匯入與排錯](docs/hanlin-import-runbook.md)

## 下一階段
正式學生／家長帳號與權限、主應用的 PostgreSQL 單一資料來源切換、圖片／PDF OCR、手寫辨識、AI 相近題生成與雲端報表。

> 主應用仍是 JSON 模擬流程；`/account` 與 `/local-practice` 只完成 localhost 試行。電子郵件驗證信、遠端 HTTPS、登入 rate limit、production 資料庫角色與主應用資料切換仍未完成。請勿輸入真實學生個資，也不要把 `local-data` 當成 production 資料庫或部署到 Vercel。
