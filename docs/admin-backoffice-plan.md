# Lerniqa 管理後台施工與交付計畫

狀態：原始碼功能已完成一輪，`0012` 的 migration 測試已由主線整合任務通過。後台合成資料 E2E、瀏覽器與截圖仍待專用 `55439`／`3617` 維護時段驗收。

本計畫以 `docs/admin-backoffice-architecture.md` 為產品與技術契約，以 `docs/reviews/admin-backoffice/` 下各領域紀錄為驗收證據。執行時仍要核對 repository 的 `AGENTS.md`、相關 `.agents/skills`、migration manifest 與 package lock。

## 固定隔離設定

| 資源 | 固定值 |
| --- | --- |
| worktree | `/Users/jean/Documents/Codex/2026-10-16/task/lerniqa-admin` |
| 分支 | `codex/lerniqa-admin-20261016` |
| 建立 worktree 的基準 | `6ef62eb139d35693e31ed78ee966f2d1f37a61f9` |
| web | `127.0.0.1:3617` |
| dev／preview dist | `.next-admin` |
| production build dist | `.next-admin-build` |
| PostgreSQL port | `55439` |
| database | `lerniqa_admin_e2e` |
| data | `local-data/admin-e2e/postgres` |
| socket | `local-data/admin-e2e/socket` |

不得使用或停止 `3500`、`8443`、`5432`、`55432`，不得使用 `local-data/postgres`、原始 checkout 的 runtime 或任何真實資料庫。沒有使用者明確批准時，也不得清理 System V shared-memory segments。

## 目前進度

| 階段 | 狀態 | 完成或停止條件 |
| --- | --- | --- |
| 前台 schema 整合 | 原始碼完成 | 正式 commit `b21b9d4d74678f79a4146e850f9f75d22380dd50` 已整合為 `a52ee0b17be13c538e1ac5d62144026c3f85baa1`；`0008` 至 `0011` 已進本分支 |
| 後台外層與授權 | 原始碼完成 | `/admin`、共同 KEEL layout、伺服器管理員授權、唯讀 snapshot、管理 API 回應與安全 header 已建立 |
| 帳號 | 原始碼完成，維持唯讀 | 清單、詳情、狀態／角色／驗證／日期篩選及學習者關係已建立；真實帳號異動保持關閉 |
| 題庫 | 原始碼完成 | 全題庫、版本歷史、草稿、不同人審核、發布、待審佇列與耐久冪等已建立；帳號題目唯讀 |
| 訂閱方案目錄 | 原始碼完成 | 方案、價格、功能與限制的 catalog 已建立；支付、訂閱者、發票與收入不在範圍內 |
| 報表 | 原始碼完成 | 註冊、帳號、年級、活動、完成、作答與題庫品質已建立；score 依 `0011` 的 aggregate 與 receipt |
| 安全與介面審查 | source-level 完成一輪 | P1 修正已納入；仍需資料庫與瀏覽器回驗 |
| `0012` | migration 已驗證 | 主線整合任務在 `55432` 建立 disposable database，前進、限制測試、逐層回滾、再次前進與 schema parity 均通過；本分支仍未使用 `55439` |
| 無資料庫回歸 | 目前通過 | admin 161、runtime 31、其他既有 no-DB scripts、lint、隔離 build 與 diff check 通過 |
| 資料庫 E2E | migration 完成，後台情境待驗收 | 主線已在獲准的 `55432` 完成 migration 驗證並清除 disposable database；管理 API、報表手算與併發情境仍需專用環境驗收 |
| 瀏覽器與截圖 | 阻擋 | 必須在資料庫 E2E 通過後啟動 `3617`；目前沒有 preview 或截圖 |
| 本機交付 commit | 待 `0012` 封版 | 所有原始碼、測試與文件凍結後建立；不推送、不合併 |

## `0012` 封版

`0012_admin_catalog_and_question_enrichment` 是這個分支唯一可用的下一個 migration。不得另開平行 migration，也不得把尚未提交的前台檔案複製進來。封版需涵蓋下列契約，精確表名與欄位以最終 SQL 為準：

- 未連接支付的方案、價格、功能定義與功能限制，以及管理寫入的耐久收據。
- 錯題後先找完整同題型集合，只有集合為空才可使用已確認相似群組的追溯欄位與來源限制。Migration 只保存並驗證追溯，不能宣稱已實作動態 selector 優先順序。
- 固定題目版本的 knowledge、type、solution method 與 embedding 建議及人工審核狀態，不修改 frozen revision。
- 手寫分析的 durable queue、每次嘗試紀錄、模型版本、輸入 checksum、證據與人工採用鏈結。模型不得冒充 reviewer，也不得直接改正式判定、錯題 queue 或統計。
- 帳號復原 challenge 綁定建立當下的 active identity；舊資料不能唯一判定時要失效，不能猜測信箱。
- 練習推薦開始請求的耐久識別、canonical request hash、來源 queue／result 對應與 session learner／creator／check mode 一致性。
- 同題型與推薦來源不適用 score；session 改成 score 時，只要已有 origin 就拒絕。
- 每個新契約的唯一性、狀態、append-only、稽核、索引、up/down 與 fail-closed 行為。

帳號復原的 identity 綁定不包含 SMTP durable outbox。本輪不把既有郵件 service 或 mail unit test 說成具有耐久排程、重試與送達保證。

SQL 靜態審查只能找出可由 source 判斷的問題。正式封版仍需在 PostgreSQL 驗證前進、回滾、重新前進、schema parity、升級前置檢查、constraint trigger、併發與 down 拒絕。

## 功能完成條件

### 帳號

- 查詢、狀態、角色、驗證狀態、註冊日期、白名單排序與分頁在伺服器執行。
- bootstrap admin 不在資料集；API 不回傳密碼、token、session、MFA 或 provider credential。
- `users.account_role` 與有效 `user_roles` 分開呈現；帳號與學習者只使用 `learner_access`。
- 多個有效 email identity 停止回傳，不用 `LIMIT 1` 任選。
- production 帳號停權、關閉、角色授予、角色撤銷與人工驗證保持關閉。

### 題庫與版本

- 全題庫清單、正式分類、來源、狀態、審核與歷史分頁由伺服器查詢。
- 修改系統題目時建立新 revision；舊 revision、來源與歷史作答保持不變。
- 建立者不能審核自己的草稿；發布前檢查自動答案完整性與目前版本衝突。
- `origin=account` 題目唯讀。第四課 279 題不得覆寫或刪除。
- 同一 mutation 的重試可回放；不同內容或不同目標不能誤用同一冪等鍵。

### 訂閱方案目錄

- 方案、價格、ISO 4217 幣別、minor-unit 金額、週期、功能限制與狀態有前後端驗證。
- 啟用價格不能原地改金額、幣別、週期或起日；改價建立新價格。
- boolean 與 integer 功能使用不同有效欄位，跨表狀態不能留下無法維護的限制。
- 空資料庫不建立假方案或假金額。畫面固定標示支付尚未串接。
- 不建立 account subscription、checkout、payment、invoice、refund、webhook 或 revenue。

### 報表

- 時間以 UTC 保存，管理報表依 `Asia/Taipei` 分組，查詢包含起點、不包含結束日期次日零時。
- `未填`、`無資料`、真實 `0`、零分母、未蒐集與未達顯示門檻分開呈現。
- 地區沒有正式欄位時顯示尚未蒐集，不從學校名稱推測。
- Score 送出量讀 `practice_score_receipts`，score 結果讀 completed session aggregate，不連接已清除的逐題答案。
- 小樣本結果被抑制時，能用加減法反推它的總數也要抑制。

### 共用介面與安全

- 頁面與 GET API 在同一 read-only transaction 重新授權與查詢；寫入在交易內取得 auth lock 後再次授權。
- Origin、CSRF、body size、欄位 allowlist、冪等鍵、稽核與錯誤遮罩使用共同實作。
- 桌面表格、平板與手機摘要保留相同核心任務；loading、empty、no-results、error、conflict 與 success 各自可辨認。
- 共同介面優先使用 KEEL。只有 KEEL 沒有輸出且專案沒有等價元件時，才建立 Lerniqa wrapper。
- ERP 只作唯讀參考，不搬資料、Secret、環境設定、憑證或權限值。

## 維護時段的驗收順序

本分支只有在使用者明確通知可用時段後，才能進行下列工作：

1. 重新確認 `55439` 未占用，System V 有可用 slot，且 `3500`、`8443`、`5432`、`55432` 狀態未受影響。
2. 使用專用 data、socket、port 與 database 啟動 PostgreSQL。任何設定不符立即停止。
3. 在空庫及可控升級 fixture 執行 `0001` 至 `0012` 的 up/down/up、schema parity 與 SQL tests。
4. 以隔離合成資料驗證權限拒絕、資料範圍、輸入、分頁、排序、篩選、題目版本、報表手算、重複提交、併發與交易失敗回滾。
5. 核對第四課 279 題、337 parts、答案鏈與歷史作答引用沒有被改寫或刪除。
6. 啟動 `127.0.0.1:3617`，驗證 390、768、1024、1440 px、鍵盤、焦點、200% zoom、長文字、Drawer／Dialog、錯誤恢復與 session 失效。
7. 保存 desktop、tablet、mobile 與焦點狀態截圖，更新驗收紀錄，再停止專用服務。

主線整合任務可依它取得的授權，在既有 `55432` 建立 disposable test database 執行 `0012` 與 E2E。收到結果時要記錄執行者、命令、database 名稱、通過／失敗與清理證據；不能把這些結果寫成本分支在 `55439` 執行。主線的資料庫證據也不取代本分支的 `3617` 瀏覽器與截圖驗收。

## 無資料庫驗證與交付

每次凍結原始碼後，至少重新執行：

```text
npm run lint
npm run test:admin
npm run test:runtime-guardrails
npm run test:auth
npm run test:mail
npm run test:email-verification
npm run test:answer-disclosure
npm run test:local-backup
npm test
git diff --check
```

Production build 使用 `.next-admin-build` 與專用資料庫環境值直接執行 `next build`，不能啟動或探測保留服務。KEEL 文件預覽器的選用套件 warning 要記錄，但不能把成功 build 說成 runtime 已驗收。

最終交付是獨立分支上的本機 commit、測試摘要、審查報告、資料庫與瀏覽器證據，以及可用時的 `127.0.0.1:3617` 預覽。若維護時段沒有提供，則交付內容必須清楚標示沒有資料庫、預覽、瀏覽器或截圖。不得推送、合併、修改原 checkout、部署公開環境、建立 production 憑證、接上真實支付或變更任何真實帳號。
