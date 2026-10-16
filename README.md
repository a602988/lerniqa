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
- 登入、註冊、登出確認、忘記密碼、快速註冊與帳號綁定獨立頁面（介面示範，不會送出帳號資料）
- 前端透過 `/api/v1` 讀寫本機 JSON；初始資料放在 `data/fixtures`，執行期資料寫入不進版控的 `runtime-data`
- 題目可保存版本、章節、單元、主題、難易度、來源，以及題幹與答案中的圖片區塊
- 正式 PostgreSQL 欄位、關聯與限制已由 `0001` 至 `0005` 原生 SQL migration 建立並通過本機隔離驗證；目前網站尚未連接 PostgreSQL

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

## 文件
- [產品規格](docs/PRODUCT_SPEC.md)
- [開發路線圖](docs/ROADMAP.md)
- [資料庫設計與資料字典](docs/question-database-design.md)
- [資料庫完成對照與正式切換邊界](docs/database-completion-matrix.md)
- [Migration 與回滾說明](database/README.md)

## 下一階段
正式學生／家長帳號與權限、PostgreSQL repository／交易 API 與 JSON 搬移、圖片／PDF OCR、手寫辨識、AI 相近題生成與雲端報表。

> 目前是前端示範版。已送出的部分操作會保存在這台機器的 runtime JSON，但不包含正式帳號、AI、OCR 或 PostgreSQL runtime。請勿輸入真實學生個資。
