# 本機 PostgreSQL 練習試行

`/local-practice` 是用來驗證真實題目匯入、選題、作答、判分與錯題保存的本機入口。它使用持久的 PostgreSQL，不讀寫主應用的 `runtime-data/database.json`。主應用仍保留 JSON 模擬流程；這個試行入口不是 production 切換。

## 啟動與停止

需要 Node.js 20+ 與可從 `PATH` 執行的 PostgreSQL 工具：`initdb`、`pg_ctl`、`pg_isready`、`createdb` 與 `psql`。

```bash
npm install
npm run db:local:ensure
npm run dev
```

開啟 http://localhost:3500/account，以合成的 `.invalid` 電子郵件完成註冊或登入，再前往 http://localhost:3500/local-practice。需要查看或停止資料庫時：

```bash
npm run db:local:status
npm run db:local:stop
```

`db:local:ensure` 會在必要時初始化 cluster、啟動 PostgreSQL，再依序套用尚未執行的 migration。它只接受 repository 內 migration 的完整前綴，遇到未知版本、跳號或名稱不符時會停止，不會自動執行 down migration。

持久資料放在不進版控的 `local-data`：

- `local-data/postgres` 保存 PostgreSQL cluster。
- `local-data/postgres-socket` 是權限 `0700` 的私有 Unix socket 目錄。
- `local-data/assets` 保存本機匯入產生的來源與題目檔案。

這個 cluster 不監聽 TCP，並且使用目前的本機作業系統使用者，不另建帳號、密碼或長期憑證。`55432` 只用來區分這個本機伺服器，連線仍必須經過指定的 Unix socket。若本機路徑不同，可參照 `.env.example` 設定 `LOCAL_PG_SOCKET`、`LOCAL_PG_PORT`、`LOCAL_PG_DATABASE` 與 `LOCAL_PG_USER`；不需要 `DATABASE_URL`。

## 舊版 Word 題庫匯入

本機匯入器的入口是 npm 指令；它會先執行匯入前置回歸測試：

```bash
npm run db:import:hanlin -- \
  "/題庫路徑/05_第四課_論語選（一）子游問孝（二）譬如為山（三）三省吾身.doc" \
  --asset-root ./local-data/assets
```

加上 `--dry-run` 可只做解析與驗證，不寫入資料庫。`--dry-run` 可以接受單一 `.doc` 或題庫資料夾；資料夾模式只盤點其頂層 `.doc`。沒有 `--dry-run` 時，命令必須明確指定上述第四課單一檔案，傳入資料夾或其他檔案都會停止，不會寫入。

本機試行只將 `05_第四課_論語選（一）子游問孝（二）譬如為山（三）三省吾身.doc` 歸入「國中一年級／國文／翰林版／第一冊／第四課」。parser v2 的 confirmed 批次已寫入 279 題，279 題均可核准，沒有待核對或拒絕的匯入項目；同一輸入重跑會重用原批次，不增加題目。匯入器仍保留原檔檔名、內容雜湊、原始課次／單元及文件內來源欄位。

其餘 14 份題庫文件尚未匯入。它們只能先用 `--dry-run` 盤點；在各自的正確教材分類確認前，不會寫入第四課或其他正式分類。

已遇過的匯入錯誤、修正方式、重跑順序與驗證條件記在 [翰林題庫匯入與排錯](hanlin-import-runbook.md)。

第四課原始 `.doc` 含 VBA，不會直接成為可發布的來源。匯入器將原檔保存在 `local-data/assets/quarantine/source-documents`，標記為 `rejected`，且 `source_documents` 不引用這份原檔。接著使用全新的 LibreOffice profile、關閉巨集執行並以 headless 模式產生 DOCX 衍生檔。這份 DOCX 必須通過格式、VBA、Macro 與 ActiveX 內容檢查，才會以 `clean` 狀態保存在 `local-data/assets/sanitized-source-documents` 並作為 `source_documents.input_type=document` 的來源。PDF 與 HTML 衍生物只用於本機的頁碼、圖片配對與安全檢查。任一個步驟失敗時，該文件保持待核對或失敗，不會發布其題目。

匯入流程只在本機處理文件，不把題庫或個人路徑送到外部服務。資料庫只保留相對的 asset storage key，不儲存 Google Drive 帳號、本機絕對路徑或 Office 作者個資。

## 練習 API 與判分

| 端點 | 用途 |
| --- | --- |
| `POST /api/v1/auth/register` | 建立本機電子郵件密碼帳號、國一學習者、`learner_access`、練習偏好、科目設定與第四課題庫成員關係。 |
| `POST /api/v1/auth/login` | 驗證 scrypt 密碼並建立不透明 session；資料庫只保存 token 的 SHA-256 雜湊。 |
| `POST /api/v1/auth/logout`、`GET /api/v1/auth/me` | 撤銷目前 session，或從 HttpOnly cookie 讀取目前帳號與學習者。 |
| `GET /api/v1/local-practice/questions` | 只回傳目前分類中已發布題目的題幹、小題與選項，不回傳參考答案或解析。 |
| `POST /api/v1/local-practice/sessions` | 以登入 session 可存取的學習者建立練習，並固定當時的題目版本與順序。 |
| `POST /api/v1/local-practice/attempts` | 由伺服器讀取標準答案並判分，在單一交易內寫入作答、逐小題結果、錯題佇列與 `analytics_outbox`。重送同一 idempotency key 不會重複建立作答。 |
| `GET /api/v1/local-practice/history` | 回傳持久的練習、作答結果與待複習錯題摘要，不回傳學習者的作答 payload 或標準答案。 |
| `GET /api/v1/local-practice/assets/:assetId` | 只讀取已通過檢查、未刪除，且被目前已發布題目引用的本機圖片。 |

伺服器只會對「判分政策為自動判分，且標準答案完整」的小題判定對錯。沒有作答、缺少標準答案、要求人工檢視或要求 AI 輔助後確認的小題，都保持 `pending`。本機試行不生成虛構答案，也不把未核對的內容當成標準答案。只有已判定為錯誤的小題才會加入 `wrong_review` 佇列。

## 身分、資料與 production 邊界

本機試行會實際建立電子郵件密碼帳號與 session。密碼以 scrypt 雜湊保存；session cookie 使用 HttpOnly 與 SameSite=Lax，HTTPS 時再加上 Secure，資料庫只保存 token 雜湊。練習 API 不接受前端自報使用者或學習者，而是從 session 取得帳號，再檢查有效的 `learner_access` 與 `question_bank_learners`；練習、作答、歷程及題目 asset 都依這個學習者範圍隔離。

這仍是 localhost 試行，不是 production 帳號系統。未驗證電子郵件只允許在 localhost 登入；寄送驗證信、遠端 HTTPS、登入 rate limit、密碼重設、OAuth、跨帳號分享、RLS、production GRANT、正式角色授權、托管式物件儲存與真實兒童資料的保存／刪除政策尚未完成。因此：

- 只能放合成的使用者與作答資料，不輸入真實學生個資。
- 不連接 production 資料庫，不對 production 執行 migration。
- 不把 `local-data` 上傳到 Vercel，也不把本機驗收當成正式帳號與權限驗收。
- 本機資料庫只在這個 repository 管理的私有 socket 上使用，不改用共用 Homebrew PostgreSQL cluster。

要確認持久性，先完成一次練習，記下畫面顯示的歷程與錯題摘要，再執行 `npm run db:local:stop` 與 `npm run db:local:ensure`。重開 `/local-practice` 後，同一筆歷程與錯題摘要應仍可讀取。
