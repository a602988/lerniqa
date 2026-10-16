# Lerniqa 管理後台施工計畫

狀態：部分可執行。文件、UI 架構、隔離環境與合成資料測試可以開始；依賴前台 `0008` 至 `0011` 的資料庫施工、訂閱目錄 migration、production 帳號寫入與任何正式部署保持阻擋。

本計畫的架構依據是 `docs/admin-backoffice-architecture.md`。執行者應先讀該文件，再核對 repository 內的 `AGENTS.md`、相關 `.agents/skills`、實際 migration manifest 及 package lock。對話內容、未提交前台檔案與 fixture 顯示值都不是正式契約。

## 施工就緒查核

### 已由 repository 查證

- 獨立 worktree 是 `/Users/jean/Documents/Codex/2026-10-16/task/lerniqa-admin`，分支是 `codex/lerniqa-admin-20261016`。
- 基準 commit 是 `6ef62eb139d35693e31ed78ee966f2d1f37a61f9`。
- 基準 schema 到 `0007_practice_answer_integrity`；帳號、角色、學習者、題目版本、練習、作答、統計及稽核資料模型已存在。
- Lerniqa 直接使用 `@keel-design/ui@0.4.0-test.25` 及同一 lockfile 中的 KEEL icons、tokens、themes 與 Tailwind preset。
- 第四課匯入流程有 279 題的既有驗收契約。原始資料及原 checkout 不在本分支的寫入範圍。

### 尚待前台 commit 的依賴

| 依賴 | 所需證據 | 責任角色 | 未完成時的停止行為 |
| --- | --- | --- | --- |
| `0008` 至 `0011` 正式 commit | commit hash、乾淨 diff、migration manifest、前台測試摘要 | 前台工程師、整合工程師 | 不建立新 migration，不實作依賴新增欄位的寫入或報表 |
| `learner_access` 與 accountRole／activeRole mapping | migration SQL、型別及 auth API 測試 | 後端工程師 | 不建立平行表，不以 UI state 代替授權 |
| `0011` score 統計語意 | 升級測試、receipt 與 session aggregate 驗證 | 後端工程師 | score 報表顯示未完成，不回頭讀已清除的答案明細 |
| 下一個 migration 編號 | 整合後 manifest 的完整前綴 | 整合工程師 | 訂閱 catalog 僅保留 UI／service 契約，不寫 schema |

### 需要產品或安全決策

| 決策 | 目前安全預設 | 未確認時的停止行為 |
| --- | --- | --- |
| 管理員是否能修改其他帳號的題目 | `origin=account` 全部唯讀 | 不顯示可送出的編輯控制 |
| 帳號狀態轉換、session 撤銷與關閉後保存 | production 寫入關閉 | 只用合成資料演練介面與交易 |
| 社群或跨帳號報表門檻 | 關閉 | 只顯示不涉及跨帳號識別的管理總量，敏感聚合保持阻擋 |
| 地區蒐集 | 不蒐集、不推測 | 地區報表顯示無資料 |
| 正式方案、金額與功能限制 | 不預設 | catalog 保持空狀態，不建立假商業資料 |

### 需要正式環境證據

production 後端、登入服務、Secret Manager、MFA、資料庫受限角色、RLS／GRANT、物件儲存、資料保存政策、支付供應商及公開部署都沒有正式證據。本計畫不執行這些工作，也不能用本機 adapter 或合成 fixture 代替。

## 固定隔離設定

所有開發與驗收只使用下列資源：

- web：`127.0.0.1:3617`
- dev／preview dist：`.next-admin`
- production build dist：`.next-admin-build`
- PostgreSQL socket port：`55439`
- database：`lerniqa_admin_e2e`
- data：`local-data/admin-e2e/postgres`
- socket：`local-data/admin-e2e/socket`

禁止使用 `3500`、`8443`、`55432`、`local-data/postgres`、原 checkout 的 runtime 或任何真實資料庫。測試 runner 改用 `/tmp` cluster 時，要在驗收報告記錄替代值及清理證據。

## 實作順序

### 1. 接收前台 schema

- 角色：整合工程師、架構師。
- 輸入：前台提供的單一本機 commit、migration manifest、auth 與 score 測試摘要。
- 產出：本分支的整合 commit、更新後 schema 對照、文件同步檢查。
- 完成條件：`0001` 至 `0011` 形成完整且無重複的前綴；`learner_access`、accountRole／activeRole、答案完整性及 score receipt 的實際契約已逐項核對；未複製任何未提交檔案。
- 驗證：隔離空庫前進、既有合成資料升級、完整性拒絕案例、migration manifest 檢查，以及前台指定測試。
- 證據：`docs/reviews/admin-backoffice/schema-integration.md`，記錄 commit hash、命令、exit code 與契約差異。
- 依賴：前台 commit；未收到時此任務阻擋，其餘不依賴新 schema 的 UI 骨架工作可並行。
- 確認節點：若 migration SQL 與架構文件不一致，停止施工並請架構師確認，不自行選一套。
- 回滾點：回到本 worktree 基準 commit，不修改原 checkout，也不 stash 或 reset 其他任務的變更。

### 2. 建立管理後台外層與伺服器授權

- 角色：後端工程師、前端工程師。
- 輸入：既有 auth context、有效 `system_admin` 契約、KEEL 依賴與架構路由矩陣。
- 產出：`/admin` layout、導覽、route guard、管理 API 共用授權函式、共用錯誤與分頁契約。
- 完成條件：所有 `/admin` 頁面及 `/api/v1/admin/*` 在伺服器檢查管理員；未登入與無權者分別得到 `401`、`403`；前端不能以偽造角色打開資料；普通使用者設定與 admin layout 狀態互不混用。
- 驗證：route integration tests、直接 API 呼叫、偽造 cookie／body 角色、session 撤銷、desktop／tablet／mobile 導覽及鍵盤焦點。
- 證據：`docs/reviews/admin-backoffice/foundation.md` 與三種寬度截圖。
- 依賴：不需要訂閱 migration；auth schema 整合完成後才能標記完整通過。
- 確認節點：route guard 與 API 授權測試通過後才能加入管理寫入端點。
- 回滾點：移除 `/admin` route group 與管理 API router，不改普通使用者頁面及共用 auth 資料。

### 3. 帳號清單與詳情

- 角色：後端工程師、前端工程師。
- 輸入：`users`、`account_identities`、`user_roles`、`learner_access`、`learners` 及 server-side admin guard。
- 產出：帳號 repository、分頁搜尋 API、帳號表格、詳情 Drawer、合成資料的狀態與角色操作流程。
- 完成條件：搜尋、狀態、角色、驗證狀態、日期、白名單排序與分頁由伺服器執行；bootstrap admin 不在結果；回應不含密碼、token、session 或 MFA；重複查詢與分頁順序穩定。
- 驗證：零筆、單筆、跨頁、重複顯示名稱、多身份、多角色、已撤銷角色、closed 帳號、無權存取、查詢失敗及手機摘要版。
- 證據：`docs/reviews/admin-backoffice/accounts.md`。
- 依賴：任務 2；角色寫入測試另依賴任務 1。
- 確認節點：production 帳號狀態寫入保持關閉；只有產品與安全規則補齊後另行確認。
- 回滾點：保留 read-only repository，關閉狀態與角色動作入口。

### 4. 題庫瀏覽、版本編修與審核

- 角色：後端工程師、前端工程師。
- 輸入：既有題庫、題目、revision、來源、答案、審核及稽核模型。
- 產出：全題庫清單、完整篩選與分頁、題目詳情、revision timeline、系統題目新 draft 表單及審核佇列。
- 完成條件：題目修改建立新 revision；舊 revision、來源及作答不變；系統題目第二版起要求修改原因；建立者不能審核自己建立的版本；account-origin 題目固定唯讀；第四課 279 題沒有被覆寫或刪除。
- 驗證：各 origin／狀態、答案缺漏、複合小題、來源文件、draft／approved／rejected／changes requested、同人審核拒絕、重複提交、交易失敗回滾及 revision 歷史一致性。
- 證據：`docs/reviews/admin-backoffice/questions.md`，另保存修改前後題目與 revision 數量核對。
- 依賴：任務 1、2。
- 確認節點：任何跨帳號題目編修需求都停止，等待產品規則改版。
- 回滾點：停用編修與審核 API，保留只讀題庫及已建立的耐久 revision；不執行破壞性 down migration。

### 5. 訂閱方案目錄

- 角色：架構師、後端工程師、前端工程師。
- 輸入：整合後 migration manifest、四張 catalog 表契約、既有管理稽核模型。
- 產出：下一個可用編號的 forward migration、catalog repository／API、方案表格與表單、支付未串接狀態。
- 完成條件：方案、價格、ISO 幣別、minor-unit 金額、週期、功能限制與狀態可在隔離資料庫管理；已生效價格不可原地修改；沒有 account subscription、checkout、付款、發票、webhook 或收入資料；空資料庫不自動產生方案。
- 驗證：金額與幣別格式、週期倍數、狀態轉換、重複 code、重複功能、樂觀鎖定、重複提交、失敗回滾、價格換版及 API 中不存在付款入口。
- 證據：`docs/reviews/admin-backoffice/subscription-catalog.md`。
- 依賴：任務 1 的 schema gate。gate 未完成時只能做不寫資料的 UI 原型，不能建立 migration。
- 確認節點：migration 名稱與編號、正式方案值及任何支付整合都需另行確認。
- 回滾點：關閉 catalog route 與寫入 API。已承載資料後使用新的 forward fix，不執行破壞性 down migration。

### 6. 管理報表

- 角色：資料工程師、後端工程師、前端工程師。
- 輸入：架構文件的報表定義、`users`、`learners`、作答、session、`0011` score aggregate／receipt、題目及匯入資料。
- 產出：統一日期解析、報表 queries／API、註冊、年級、活動、完成及題庫品質頁面。
- 完成條件：所有日期以 UTC 保存、Asia/Taipei 分組；區間使用包含下界與不包含上界；未填、無資料、真實零、分母為零與隱私門檻分開顯示；地區不從學校名稱推測；score 報表不讀已清除的答案內容。
- 驗證：臺北午夜、跨日、跨月、夏令時間無關性、空資料、null、零值、分母為零、多角色重複、共享 learner 去重、score／非 score 分流及已知 fixture 手算對照。
- 證據：`docs/reviews/admin-backoffice/reports.md`，附 SQL／測試 fixture 定義與手算表。
- 依賴：任務 1、2；score 結果依賴 `0011`。
- 確認節點：跨帳號敏感聚合與地區蒐集保持阻擋，不能用 UI 文案掩蓋缺少政策。
- 回滾點：停用個別報表區塊，保留原始資料及其他已驗證報表。

### 7. 共用介面收斂與響應式驗收

- 角色：前端工程師、審查員。
- 輸入：任務 2 至 6 的畫面、KEEL 套件、ERP 唯讀參考。
- 產出：一致的 admin layout、Table／filter／pagination／form／Drawer／Dialog 用法，以及 loading、empty、no-results、error、conflict 與 success 狀態。
- 完成條件：沒有功能相同的平行元件；桌面表格、平板 Drawer 與手機摘要可完成相同任務；鍵盤、焦點、標籤、錯誤摘要及觸控尺寸通過檢查；普通使用者工作區不受 admin CSS 與 layout 影響。
- 驗證：390、768、1024、1440 像素寬度，鍵盤導覽、螢幕閱讀器名稱、縮放、長文字、空表、慢速載入、API 失敗及 session 逾時。
- 證據：`docs/reviews/admin-backoffice/interface.md` 與每個主要頁面的四種寬度截圖。
- 依賴：任務 2 至 6 可分批進入，每批完成後做該批審查。
- 確認節點：無額外產品決策時可持續收斂；若需要新共用元件，先確認 KEEL 沒有等價能力。
- 回滾點：逐頁退回最近一個已通過響應式驗收的狀態，不改 KEEL 套件來源。

### 8. 程式審查與效能收尾

- 角色：審查員、優化師。
- 輸入：已完成的 production code、測試及任務 1 至 7 的證據。
- 產出：依嚴重度排序的問題、重複實作檢查、查詢計畫與效能修正。
- 完成條件：授權與資料範圍沒有分散成互相矛盾的版本；列表沒有 N+1；分頁、排序與篩選使用適合的索引；報表不在瀏覽器聚合大量資料；優化前後行為測試一致。
- 驗證：完整相關測試、代表性 `EXPLAIN`、大資料合成 fixture 的頁面回應、bundle 與 hydration 檢查。
- 證據：`docs/reviews/admin-backoffice/code-review.md` 與 `performance.md`。
- 依賴：任務 2 至 7 完成。
- 確認節點：效能修正若改變外部契約，停止並回到架構確認。
- 回滾點：退回個別優化，保留已通過的功能實作與測試。

### 9. 安全審查

- 角色：安全審查員。
- 輸入：凍結後的後台程式、migration、API、測試與稽核證據。
- 產出：authn／authz、敏感資料、輸入、注入、CSRF、session、冪等、稽核與依賴風險報告。
- 完成條件：一般帳號不能開啟後台或直接呼叫管理 API；管理員不能偽造 owner、actor 或 origin；bootstrap admin 不在資料庫；敏感回應 no-store；沒有 Secret、客戶資料或支付憑證進版控；高權限寫入有重新驗證、交易與稽核。
- 驗證：權限拒絕、IDOR、SQL 注入字串、XSS 內容、CSRF、重放、重複提交、session 撤銷、錯誤資料洩漏與依賴掃描。
- 證據：`docs/reviews/admin-backoffice/security.md`。
- 依賴：production code 凍結及任務 8 完成。
- 確認節點：發現可升權、跨帳號讀寫或 Secret 外洩時停止交付，不以 UI 隱藏代替修正。
- 回滾點：停用全部 `/admin` route 與管理 API，保留資料及稽核證據。

### 10. 最終驗收與交付

- 角色：驗收員。
- 輸入：凍結程式、全部測試、審查與安全報告。
- 產出：完整 QA 矩陣、本機 commit、預覽位置、截圖、已完成／未完成與整合依賴清單。
- 完成條件：帳號、題庫、版本、方案目錄與報表核心流程在合成資料通過；權限拒絕、資料範圍、輸入驗證、重複提交、失敗回復與響應式狀態都有證據；原 checkout、保留端口、真實資料與第四課原始歷史未被修改。
- 驗證：依序執行 Ai Slop Cleaner、Code Review、Security Review 與 UltraQA。後三項修正若改 production code，解除凍結並從 Ai Slop Cleaner 重跑；只改測試、文件或證據時重跑受影響項目。
- 證據：`docs/reviews/admin-backoffice/acceptance.md`、截圖目錄、完整命令摘要及最終 commit hash。
- 依賴：任務 1 至 9 全部完成；阻擋功能明確標為未完成，不能以 fixture 冒充。
- 確認節點：本機交付後停止。推送、合併、production migration、公開部署與真實安全變更需要另一次明確授權。
- 回滾點：保留可恢復的本機 commit，停止 `3617` 與 admin E2E database，不操作原 checkout 或其他任務程序。

## 驗收矩陣

| 範圍 | 必測案例 |
| --- | --- |
| 管理員權限 | 未登入 `401`、普通帳號 `403`、偽造 activeRole 拒絕、撤權 session 拒絕、bootstrap admin 不在清單 |
| 資料範圍 | 帳號與題庫全域管理讀取只在 admin context；一般 API 仍依 learner access 隔離；asset 不能以 ID 直接繞過引用授權 |
| 帳號 | 搜尋、狀態／角色篩選、排序、分頁、詳情、撤銷歷史、敏感欄位不回傳、production 寫入關閉 |
| 題目 | 全題庫篩選、account-origin 唯讀、新 revision、修改原因、不同人審核、歷史作答固定 revision、279 題完整性 |
| 訂閱目錄 | 空狀態、方案／價格／週期／幣別／功能驗證、換價不覆寫、沒有 checkout／付費用戶／收入 |
| 報表 | 臺北時區邊界、日期範圍、null／empty／zero／零分母、年級與不在學、地區無資料、活動去重、score receipts |
| 表格 | 伺服器排序、複合篩選、第一／中間／最後一頁、刪除或更新後頁數改變、穩定 tie-breaker |
| 表單 | 前後端驗證一致、未知欄位拒絕、409 conflict、422 validation、失敗保留輸入、成功才更新畫面 |
| 重複提交 | 同一 idempotency key 回相同結果、連點只產生一筆、逾時重試不產生半套角色／revision／price |
| 失敗狀態 | DB 不可用、查詢逾時、session 失效、部分資料空缺、稽核寫入失敗時整筆回滾 |
| 響應式與無障礙 | 390／768／1024／1440、鍵盤、焦點、標籤、錯誤摘要、Drawer／Dialog 關閉與焦點返回 |
| 隔離 | 只使用 `3617`、`.next-admin*`、`55439` 與 admin E2E 路徑；保留服務沒有新增連線、檔案或程序變動 |

## 文件同步與除錯規則

實作若改變欄位、索引、migration、狀態、權限、API、報表定義、路由、預設值或 UI 行為，完成條件包含同步更新 `docs/admin-backoffice-architecture.md` 與本計畫。兩份文件與實作不一致時，該任務不能進入下一階段。

任何驗證失敗時，先固定重現步驟，再定位根因、做最小修正並用同一步驟回驗。同一方案連續失敗兩次後停止重試，回到該任務的架構、依賴或回滾點重新評估。不得用關閉測試、放寬授權、改連共用資料庫或硬編示意數字使驗收變綠。

## 交付限制

交付內容是獨立分支上的本機 commit、測試摘要、審查報告、截圖與 `127.0.0.1:3617` 預覽。不得推送、合併、修改原 checkout、部署公開環境、建立 production 憑證、執行 production migration、接上真實支付或變更任何真實帳號。未完成的整合 gate、政策與外部服務要逐項列出；fixture 與本機 adapter 只能標為隔離驗收資料。
