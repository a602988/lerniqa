# Lerniqa 管理後台架構

狀態：部分可執行。管理後台的產品範圍、權限邊界、頁面與報表定義已確認；正式資料庫施工必須等前台 `0008` 至 `0011` migration 形成可引用的 commit，再從該 commit 重新核對 schema 並取得下一個 migration 編號。

這份文件定義 Lerniqa 同一網站下的 `/admin` 管理後台。後台沿用既有帳號、學習者、題庫、題目版本、作答與統計模型，不建立另一套會員或題庫系統。它也不是一般使用者的學習者設定頁；管理導覽、資料範圍與敏感操作都由伺服器端管理員授權保護。

## 基準與隔離環境

| 項目 | 固定值 |
| --- | --- |
| 原始 repository | `/Users/jean/Documents/GitHub/lerniqa`，施工期間保持唯讀 |
| 獨立 worktree | `/Users/jean/Documents/Codex/2026-10-16/task/lerniqa-admin` |
| 專用分支 | `codex/lerniqa-admin-20261016` |
| 基準 commit | `6ef62eb139d35693e31ed78ee966f2d1f37a61f9`，`feat: complete persistent local practice data flow` |
| 管理後台 web | `http://127.0.0.1:3617` |
| Next.js dev／preview 目錄 | `.next-admin` |
| Next.js production build 目錄 | `.next-admin-build` |
| PostgreSQL socket port | `55439` |
| PostgreSQL database | `lerniqa_admin_e2e` |
| PostgreSQL data 目錄 | `local-data/admin-e2e/postgres` |
| PostgreSQL socket 目錄 | `local-data/admin-e2e/socket` |

管理後台不得使用使用者服務的 `3500`、HTTPS `8443`、既有 PostgreSQL `55432` 或 `local-data/postgres`。測試 runner 若改用 `/tmp` 內每次建立的一次性 cluster，驗收報告要記錄實際 data、socket、port、database 與清理結果，且仍不得連接上述保留資源。任何指令都要明確傳入 host、port、database 與 user，不讀取未經核准的 `DATABASE_URL` 或共用 PostgreSQL 環境變數。

## 前台 schema 整合 gate

目前 worktree 只含已提交的 `0001` 至 `0007`。前台任務正在完成下列契約：

- `0008_auth_and_import_integrity`
- `0009_automatic_answer_completeness`
- `0010_account_role_and_self_learner`
- `0011_score_session_aggregates`

`0011` 會在 `practice_sessions` 增加 `score_total_count`、`score_answered_count`、`score_correct_count`、`score_wrong_count` 與 `score_pending_count`，並新增不保存答案內容的 `practice_score_receipts`。升級會移除舊的 score 模式答案明細，但保留非 score 歷史。

後台施工前必須取得前台的單一本機 commit，確認 migration manifest 是完整前綴，再以 cherry-pick 或經核准的整合方式帶入。不得複製前台未提交檔案，不得自行重建同名 migration，也不得先占用 `0011` 或猜測下一個 migration 編號。若正式 commit 的表名、欄位或限制與本文件不同，以 migration SQL 為資料庫權威來源，先更新本文件及施工文件，再開始寫入功能。

最新整合約定沿用 `users`、`user_roles`、`learners` 與 `learner_access`。`accountRole`、`activeRole` 是應用程式契約名稱，不得因此建立平行資料表或第二份角色狀態；它們必須映射到有效角色授權及 session 的目前角色。

## KEEL 來源與重用邊界

Lerniqa 已直接依賴 KEEL 的 GitHub Packages 發布套件，版本鎖定在 `package-lock.json`。可唯讀核對的本機原始碼位於 `/Users/jean/Documents/GitHub/keel-design`；本次盤點時 HEAD 為 `f53704350e7756492ea0a8399877c457570dc3ca`，`@keel-design/ui@0.4.0-test.25` 對應發布 commit 為 `bd03988eafc4d5fa7be9b6f35a435f7b7dfd7173`。Lerniqa 使用發佈套件，不改成本機 workspace link：

| 套件 | 精確版本 | registry 來源 |
| --- | --- | --- |
| `@keel-design/ui` | `0.4.0-test.25` | `https://npm.pkg.github.com/download/@keel-design/ui/0.4.0-test.25/f80e583398e2089e412c79c3e29a88f2c7f5ff67` |
| `@keel-design/icons` | `0.0.4-test.4` | `https://npm.pkg.github.com/download/@keel-design/icons/0.0.4-test.4/90ff7caf042316d8b8f94f4fd4696102c2e20ab1` |
| `@keel-design/tailwind-config` | `0.0.5-test.3` | `https://npm.pkg.github.com/download/@keel-design/tailwind-config/0.0.5-test.3/149d13290c679e99f64665f36444575d1355b694` |
| `@keel-design/themes` | `0.2.0-test.6` | `https://npm.pkg.github.com/download/@keel-design/themes/0.2.0-test.6/cbbff60fbc578fc11f71569daab262509b53d1db` |
| `@keel-design/tokens` | `0.3.0-test.11` | `https://npm.pkg.github.com/download/@keel-design/tokens/0.3.0-test.11/f66df52ab3ada23e640a7ff9e6a2bddd28bc6bf6` |

全域樣式已從 `@keel-design/tokens/styles.css`、`@keel-design/tailwind-config/preset.css` 與 `@keel-design/themes/styles.css` 載入，並掃描 `@keel-design/ui/dist`。後台外層直接使用 KEEL `AppShell`，清單直接使用 `DataTable` 與 `Pagination`，其餘優先使用 Button、Badge、表單控制、Dialog、Drawer、Alert、Skeleton、Spinner 與 Toast。外層密度與 ERP 風格可參考 `/Users/jean/Documents/GitHub/erp_2026` 的頁面組合，但 ERP 保持唯讀；不得搬客戶資料、環境變數、憑證、權限常數、Paces／Preline 外層或為 ERP 特化的業務狀態。KEEL package 只從公開 package root 匯入，不使用未公開的 `dist/*` deep import。

只有 KEEL 沒有提供且 Lerniqa 其他頁面也沒有可重用實作時，才建立 Lerniqa 共用元件。新元件名稱不得假冒 KEEL 套件元件，也不能複製一份功能相同但行為不同的 Button、Dialog、Table 或表單控制。

## 系統邊界

- `/admin` 與普通使用者頁面位於同一個 Next.js 專案及網站，使用同一組 PostgreSQL schema、repository 與交易服務。
- 管理後台只接受伺服器建立的可信登入 context。前端送來的角色、管理員旗標、帳號所有者或題目 origin 都不是授權依據。
- 未登入回傳 `401`；已登入但不是有效 `system_admin` 回傳 `403`；在授權範圍內找不到資源回傳 `404`；樂觀鎖定衝突回傳 `409`；欄位或狀態轉換無效回傳 `422`。
- 每個 `/api/v1/admin/*` 回應只包含該畫面需要的欄位。不得回傳密碼雜湊、session token 或 token hash、MFA 資料、Secret、完整 server error 或未授權答案內容。
- 含帳號、學習者、作答或管理資料的回應使用 `Cache-Control: private, no-store`。
- 查詢先在伺服器套用授權與資料範圍，再排序、篩選及分頁。不得把全帳號或全題庫下載到瀏覽器後再過濾。
- 敏感寫入使用冪等鍵；使用者重複送出、網路重試或按鈕連點不能產生第二次角色異動、revision、審核或方案版本。

## 帳號與角色契約

### 可讀資料

帳號清單以 `users` 為根，詳情依需要連接 `account_identities`、有效及歷史 `user_roles`、`learner_access` 與 `learners`。不在 `users` 的 bootstrap 管理主體不得出現在帳號清單、管理員清單或報表；持有有效 `user_roles.system_admin` 的一般帳號仍是帳號資料的一部分，但介面不得允許本輪異動其高權限。

帳號清單至少支援關鍵字、狀態、有效角色、身份驗證狀態與註冊日期篩選；支援白名單排序與伺服器分頁。清單不顯示完整敏感身份資料；完整身份資訊只在通過相同管理員授權的詳情請求中取得。

### 可寫資料

`users.status` 的資料值為 `active`、`suspended`、`closed`。既有文件尚未定義每一條狀態轉換、session 撤銷與帳號關閉後的保存行為，因此 production 狀態異動在產品與安全契約補齊前保持關閉。隔離合成資料可用來驗證表單、確認 dialog、失敗回復與稽核流程，但不得把測試結果套到真實帳號。

角色異動只能新增 `user_roles` 授權或填寫既有授權的撤銷欄位，不刪除或改寫歷史。授予或移除 `system_admin` 時，後端要重新驗證操作者、目標與目前有效權限，在同一交易寫入 `user_roles` 與 `admin_audit_logs`。介面不得提供人工填寫 `verified_at` 的入口，也不得建立假的身份驗證、預設管理員或付費身份。

預設禁止管理員移除自己的最後一份 `system_admin` 權限。若日後允許，必須先有另一位有效管理員、重新驗證及復原程序，並更新本文件。

## 題庫與題目版本契約

題庫清單沿用 `question_banks`、`question_bank_items` 與題目正式分類。題目清單沿用 `questions` 的穩定身份，顯示目前 `question_revisions`、題型、來源、狀態、origin、擁有者、最近修改時間及審核狀態。篩選使用正式關聯及來源專屬欄位，不以顯示字串猜測科目、年級、出版社、單元或題號。

後台可檢視所有有權管理的題庫與題目。既有授權規則尚未允許系統管理員修改其他帳號擁有的 `origin=account` 題目，因此安全預設如下：

- `origin=system`：有效系統管理員可建立新 revision。
- `origin=account`：後台可檢視，但編輯控制保持停用並說明「帳號題目只能由擁有者修改」。
- 只有產品規則明確核准跨帳號內容管理，且後端、稽核與通知契約一起完成後，才可放寬這項限制。

任何題目修改都建立新 `question_revisions`，不原地修改目前版本。系統題目第二版起必須填寫 `change_note`。新版本先保持 `draft`，由建立者以外的有效管理員建立 `question_revision_reviews` 後，才能發布或取代目前版本。退回與要求修改保留原因及舊紀錄。封存題目只停止後續選題，不能刪除既有版本、來源、練習項目或作答。

第四課 279 題必須從題庫、來源文件、匯入項目與 revision 關聯動態查得，不能在後台寫死筆數。管理操作不得覆蓋或刪除這批題目；隔離測試若需要編修，只能在複製出的合成資料庫建立新 draft revision，並驗證舊 revision 與歷史作答仍可追溯。

## 訂閱方案目錄

本階段只建立未連接支付的方案目錄，稱為 catalog-only。它用來設定未來方案、價格與功能限制，不能建立付費用戶、扣款或收入。

前台 `0008` 至 `0011` 正式整合後，下一個可用 migration 才能加入以下模型：

| 資料表 | 用途與必要欄位 |
| --- | --- |
| `subscription_plans` | 穩定 `code`、名稱、說明、`draft/active/retired`、建立與更新時間 |
| `subscription_plan_prices` | 方案、ISO 4217 幣別、minor unit 金額、週期單位、週期倍數、`draft/active/retired`、生效區間 |
| `subscription_feature_definitions` | 穩定功能鍵、顯示名稱、值型別、單位、狀態 |
| `subscription_plan_feature_limits` | 方案、功能、是否包含、限制值或 unlimited；同一方案與功能唯一 |

已生效價格不原地修改。改價建立新 price，讓日後訂閱與稽核能辨認當時採用的金額。金額使用整數 minor unit，不用浮點數。週期與幣別由管理員選擇，但 repository 不預先建立假金額、假方案或假功能限制。

方案的 `active` 只代表目錄可供未來選用，不代表支付可用。後台固定顯示「支付尚未串接」。本階段不建立 account subscription、provider customer、checkout、payment method、invoice、payment、refund、webhook、稅務、proration、entitlement enforcement 或 revenue 報表，也不提供任何會發起扣款的 API。

## 管理導覽與操作矩陣

| 導覽 | 路由 | 主要內容 | 允許操作 |
| --- | --- | --- | --- |
| 總覽 | `/admin` | 帳號、學習者、練習、題庫摘要及資料狀態 | 切換期間、前往明細 |
| 帳號 | `/admin/accounts` | 可搜尋、排序、篩選、分頁的帳號表格 | 開啟詳情；隔離資料可演練狀態與角色流程 |
| 帳號詳情 | `/admin/accounts/[accountId]`，可用 Drawer 呈現 | 身份、狀態、角色沿革、學習者存取關係 | 依契約提出狀態或角色異動；不得人工驗證身份 |
| 題庫 | `/admin/questions` | 全題庫、來源、分類、狀態與目前版本 | 篩選、排序、分頁、開啟題目詳情 |
| 題目詳情 | `/admin/questions/[questionId]`，可用 Drawer 呈現 | 完整題目、答案、來源、分類、revision timeline | 系統題目建立新 draft；帳號題目唯讀 |
| 題目審核 | `/admin/question-reviews` | 待審、退回及已完成審核 | 非建立者可核准、退回或要求修改 |
| 訂閱方案 | `/admin/subscription-plans` | 方案、價格、幣別、週期、功能限制、狀態 | 管理 catalog；不能付款或指派付費用戶 |
| 報表 | `/admin/reports` | 註冊、年級、活動、完成與題庫品質 | 日期、粒度及維度篩選 |
| 稽核 | `/admin/audit` | 管理員 actor、action、target、request 與時間 | 唯讀搜尋、排序、分頁 |

桌面版使用表格加右側 Drawer；平板版維持表格主要欄位，詳情用全高 Drawer；手機版將每列改成可點選的摘要，不要求使用者橫向閱讀完整表格。Dialog 用於單一步驟確認，包含多欄位或可深連結的工作使用獨立頁面。所有尺寸都要保留鍵盤焦點、表單標籤、錯誤摘要、載入、無資料、無符合結果、權限失效與重試狀態。

## 報表定義

所有原始時間以 `timestamptz` 保存 UTC。日、週與月報表統一依 `Asia/Taipei` 分組。日期區間以臺北當地日的開始時間為包含下界，結束日期次日的開始時間為不包含上界。畫面要顯示時區及資料最後更新時間。

| 指標 | 定義 |
| --- | --- |
| 註冊帳號數與趨勢 | 依 `users.created_at` 計算帳號建立事件；closed 帳號仍保留在歷史趨勢。這是帳號數，不是唯一自然人數 |
| 目前帳號狀態 | 依 `users.status` 計算查詢當下快照，與註冊趨勢分開 |
| 有效角色分布 | 只計 `user_roles.revoked_at IS NULL`；同一帳號有多角色時會進入多個類別，合計可以大於帳號數 |
| 年級分布 | 預設計算 `learners.status=active`；在學者依 `grades`，不在學者獨立顯示「不在學」 |
| 地區分布 | 現有 schema 沒有地區欄位，`school_name` 不能用來猜測縣市。畫面顯示「無資料（尚未蒐集）」 |
| 活躍學習者 | 期間內有已提交 `answer_attempts` 的 distinct `learner_id`；共享同一學習者的帳號不重複增加人數 |
| 完成練習數 | `practice_sessions.status=completed` 且 `completed_at` 落在查詢期間 |
| 啟動 cohort 完成率 | 期間內 `started_at` 的 sessions 中，目前狀態為 completed 的比例；分母為零時顯示無資料 |
| 作答結果 | 非 score 流程由不可覆寫作答與有效審核結果聚合；score 流程使用 `0011` 的 session aggregates 與 `practice_score_receipts`，不要求已清除的答案明細 |
| 題庫品質 | 題目 origin／狀態、目前版本、待審／退回 revision、匯入批次狀態、來源文件狀態及必要答案完整性；所有筆數從真實資料計算 |

缺值顯示固定如下：

- 有資料列但欄位為 null：`未填`
- 查詢成功但沒有資料列：`無資料`
- 合法結果確實為零：`0`
- 比率分母為零：`無資料`，不能顯示 `0%`
- 隱私門檻未達：`未達顯示門檻`，不能顯示實際樣本數或把它當成零
- 尚未串接的外部資料：清楚寫出未串接原因，不產生示意值

統計彙總是可重建資料。原始作答、審核、session aggregates 與 score receipt 是依據；彙總更新失敗時不得修改或補造原始資料。跨帳號聚合只有在有效隱私政策與顯示門檻生效後才開放。

## 稽核與寫入一致性

下列操作必須以單一交易完成業務資料與 `admin_audit_logs`，失敗時全部回滾：

- 授予或撤銷 `system_admin`
- 建立、審核、發布、取代或封存系統題目 revision
- 啟用或停用統計隱私政策
- 日後正式啟用的帳號狀態異動
- 訂閱方案、已生效價格與功能限制的狀態異動

稽核資料不保存密碼、token、完整答案影像或 Secret。方案 catalog 使用既有稽核模型，target type 使用穩定資源名稱；不另建一套商業稽核表。

## 明確非目標

- 不連接、搬移或修改 production 資料。
- 不對真實帳號升權、撤權、停權、關閉或人工驗證。
- 不建立真實子女資料；權限與報表測試只使用隔離合成資料。
- 不覆寫或刪除第四課 279 題及其 revision、來源、答案或歷史作答。
- 不做真實 OCR、AI 拆題、手寫辨識、AI 判分或相近題生成。
- 不啟用 checkout、扣款、付款資料、訂閱指派或收入報表。
- 不新增 production 憑證、Secret、MFA 設定、RLS／GRANT 或部署權限。
- 不推送、合併或部署公開環境。
- 不把 fixture、本機 PostgreSQL 或成功的本機驗收稱為已上線串接。

## 交付界線

管理後台交付只包含本機分支 commit、隔離資料庫驗收、測試報告、桌面／平板／手機截圖及 `127.0.0.1:3617` 預覽。任何 production 帳號變更、資料搬移、migration 執行、公開部署、支付串接或正式憑證設定，都需要另一次明確授權及對應環境證據。
