# 學習本計畫、排程、分享與版本同步規劃

日期：2026-10-17  
狀態：建議方案，尚未實作

## 需求摘要

- 將使用者介面的「練習計劃」統一更名為「學習本計畫」。
- 學習本計畫可以獨立存在，不要求建立日期或排程。
- 一個學習本計畫可以建立零筆或多筆排程。
- 清單可依安排狀態、建立者、分享者篩選。
- 學習本計畫可用分享網址交付給另一個帳號，登入後由收件者選擇其有權管理的一位學習者領取。
- 原建立者發布新版後，共享項目同步到最新版；既有排程、已開始與已完成作答固定使用建立當時的版本。
- 收件者若要修改內容，需建立個人副本；副本與原項目解除同步。

## 建議定案

### 1. 名稱與產品邊界

- 正式名稱使用「學習本計畫」。資料庫內既有 `practice_plans` 可保留，不為顯示名稱重建資料表。
- 「學習本計畫」代表可重複使用的題目、篩選、題數、難度與檢核方式設定。
- 「排程」是學習本計畫的選填子項，負責日期、時間及當次固定題目版本。
- 介面主要動作使用「建立學習本計畫」、「安排練習」、「開始練習」、「建立個人副本」，避免再使用含義重疊的「加入練習計劃」。

理由：既有 schema 已把 `practice_plans` 與 `practice_schedules` 分開，而且 `practice_schedules.practice_plan_id` 可選填；排程本身則要求 `scheduled_for`（`database/migrations/0004_practice_and_attempts.up.sql:141-244`）。

### 2. 學習本狀態與安排狀態分離

學習本狀態：

- `draft`：只有建立者可見，尚未發布。
- `active`：已發布、可安排及分享。
- `archived`：不再新增排程或分享，但保留歷史。

安排狀態是計算欄位，不寫回學習本：

- `未安排`：沒有 `scheduled` 或 `available` 的排程。
- `已安排`：至少有一筆 `scheduled` 或 `available` 的排程。
- 已完成、已取消、已錯過屬排程歷史，不應讓學習本繼續被算作「已安排」。

一個學習本允許多筆排程。清單標籤顯示「未安排」或「已安排 2 次」，而非只保存一個日期。

### 3. 不直接改寫已發布內容，使用不可變版本

新增學習本版本層：

- `practice_plan_revisions`：版本號、狀態、名稱、設定快照、發布者、發布時間。
- `practice_plan_revision_items`：該版本固定的題目、題目 revision、題目 part、順序與原因。
- `practice_plans.current_published_revision_id` 指向目前正式版。

編輯流程：

1. 修改只進入草稿 revision。
2. 按下「發布更新」才建立新的不可變正式 revision。
3. 共享項目的目前版本指標更新到新版。
4. 已存在的排程繼續使用建立排程時固定的 revision 與題目清單。
5. session 建立後固定 `practice_plan_revision_id`；恢復作答不重新取最新版。

版本只新增、不覆寫。這能避免同步更新改變進行中的題目、答案及成績依據。

### 4. 分享採單次領取邀請

分享流程定案為：

1. 建立者對已發布的學習本按「分享」。
2. 系統產生一個 7 天有效、僅能成功領取一次的網址。
3. 網址不包含帳號、email、學習者 ID 或學習本 ID 等可辨識資料，只含高熵隨機 token。
4. 未登入者先登入，完成後安全返回分享確認頁。
5. 收件者從自己具有有效 `learner_access` 的學習者中選擇一位。
6. 確認後建立共享訂閱；重複送出需回傳同一結果，不得重複建立。
7. 分享者可以撤銷尚未領取的網址，亦可停止已領取訂閱的後續存取。

資料建議：

- `practice_plan_share_invites`：token hash、來源計畫、建立者、到期時間、領取者、領取時間、撤銷時間。
- `practice_plan_subscriptions`：來源計畫、直接分享者、收件 learner、目前可見 revision、同步模式、狀態、領取時間。
- token 原文只在建立成功時回傳一次，資料庫只保存 hash。

每個邀請只能綁定一位收件 learner；同一來源計畫分享給多人時產生不同邀請，方便個別撤銷與稽核。

### 5. 同步規則

- 訂閱預設 `auto`，建立者發布後共享清單自動顯示最新版。
- 尚未建立排程時，下一次安排直接使用最新版。
- 已建立排程固定舊版，清單顯示「來源已有新版」，但不自動改動排程。
- 使用者可取消舊排程，再以新版重新安排；不提供會偷偷換題的「更新既有排程」。
- 已開始、暫停、完成或放棄的 session 永遠固定原版本。
- 發布新版時移除的題目只影響新排程，不影響歷史排程與作答。
- 建立者封存來源後，既有完成紀錄保留；不得再建立新排程。
- 分享被撤銷後，收件者不能再開啟共享學習本或建立新排程；已完成紀錄保留，進行中 session 可完成，尚未開始的排程標示「分享已撤銷」並停用開始按鈕。

### 6. 收件者修改方式

- 共享學習本對收件者是唯讀的內容來源；收件者可安排、開始與查看自己的結果。
- 收件者按「編輯」時，介面改為「建立個人副本」。
- 個人副本複製當下 revision，建立者改為收件者，且沒有 subscription 關係，不再接收來源更新。
- 原共享項目仍保留，讓使用者清楚辨識「同步版本」與「我的副本」。

### 7. 權限與隱私

- 建立學習本、建立排程、建立個人副本：要求對該 learner 有有效且已接受的 `learner_access`，並且 `can_create_plans=true`。
- 發布、分享、撤銷：只有來源計畫的擁有者，或未來另行授予的管理者可以執行。
- 領取：只能選擇目前登入帳號有權存取且未撤銷的 learner。
- 分享學習本不等於分享作答結果。來源建立者不能因為分享而查看收件 learner 的排程、session、答案或成績。
- 建立者與分享者保存實際 user ID，畫面顯示當時可見的 display name；不可再以 `creatorRole` 代替人物身分。
- auth 公開 learner DTO 需補上建立計畫能力；目前僅輸出 `canManageSettings`（`app/lib/auth-service.ts:69-86`、`app/api/v1/auth/_shared.ts:75-89`），API 仍須在伺服器端重新驗證，不信任前端欄位。

### 8. 清單與篩選

預設顯示目前 learner 可用的「我的＋收到分享」學習本，支援：

- 安排狀態：全部、未安排、已安排。
- 來源：全部、我建立的、分享給我的。
- 建立者：多選、可搜尋。
- 分享者：多選、可搜尋；自己的項目顯示「—」。
- 同步狀態：已同步、有新版、已停止分享。
- 學習本狀態：使用中、封存。
- 關鍵字：搜尋學習本名稱；不與題庫的題目／編號搜尋混用。
- 排序：最近更新、最近建立、最近安排、名稱。

建立者定義為來源學習本的原始建立者；分享者定義為這次直接建立邀請的人。二者分欄，不因再次分享而覆蓋來源。

查詢與分頁應由 API 執行，不能先下載全部資料再由瀏覽器篩選。

### 9. 通知

第一版只做站內通知，不依賴尚未完成的 SMTP：

- 收到新的學習本分享。
- 共享學習本已發布新版。
- 分享已被撤銷。
- 排程即將到期可留待排程通知功能一起做，不阻擋本功能上線。

通知只帶安全的內部資源識別，不直接揭露其他 learner 的資料。

### 10. 舊 localStorage 資料搬移

目前計畫與排程仍由 learner ID 分區保存在 `localStorage`，尚未寫入既有 PostgreSQL 表（`docs/database-completion-matrix.md:38,80,178`）。採一次性、可復原的匯入：

1. 使用者進入學習本頁時偵測目前 learner 的舊資料。
2. 顯示預覽：學習本數、排程數、無法辨識項目。
3. 使用者確認後，以 client migration ID 呼叫冪等 API。
4. 伺服器先建立學習本及 revision，再建立固定版本的排程。
5. 回讀伺服器資料並比對數量／內容成功後，才標記該 learner 已完成搬移。
6. 舊 localStorage 先保留 30 天作為可復原備份，不在匯入成功當下刪除。
7. 無法安全對應的題目不猜測，列入待處理清單，不建立誤導資料。

### 11. 併發與可靠性

- 延用既有 `lock_version` 做 optimistic concurrency；發布、封存、排程更新衝突回 `409` 並要求重新載入。
- 分享領取、發布、建立副本與舊資料匯入都接受 idempotency key。
- 領取邀請使用單一 transaction 與 row lock，確保同一 token 只有一個成功收件者。
- 所有發布、分享建立、領取、撤銷、封存、建立副本均寫 audit event。
- 公開分享入口需 rate limit；登入 return path 必須使用允許路由或伺服器保存的短期狀態，禁止任意外部 redirect。

## 不採用的做法

- 不把學習本和排程合成同一筆：會讓未安排學習本無法存在，亦無法支援重複排程。
- 不讓共享內容直接可編輯：會造成來源與收件者內容衝突，也無法定義同步方向。
- 不直接覆寫已發布版本：會改變既有排程與成績依據。
- 不製作永久、多人共用的公開連結：難以撤銷、稽核及避免錯誤領取。
- 不因分享自動授予查看成績權限：分享教材與存取學習者隱私是不同權限。
- 不把 localStorage 靜默搬移後立即刪除：失敗時無法復原，也可能把錯誤對應寫入正式資料。

## 實作步驟

1. 新增 migration：版本、分享邀請、訂閱、audit／通知資料；調整 plan、schedule、session 的 revision 關聯及索引。保留既有正式資料，不使用 reset、seed 或 fixture 覆蓋。
2. 建立學習本 repository/service 與 authorization policy；把 `can_create_plans` 納入正式 server DTO 與伺服器檢查。既有權限來源為 `learner_access`（`database/migrations/0001_identity_and_catalog.up.sql:296-316`）。
3. 建立學習本清單、建立、草稿更新、發布、封存、建立副本 API；支援 server-side 搜尋、篩選、排序、游標分頁與 optimistic locking。
4. 建立排程 API；建立時從指定 plan revision 固定 `practice_schedule_items`，並將 session 與實際 revision 關聯。既有 schema 已有固定題目與 session 關係（`database/migrations/0004_practice_and_attempts.up.sql:200-290`）。
5. 建立分享邀請、登入返回、領取、撤銷及 subscription 同步 API；補 rate limit、token hash、交易鎖與 audit。
6. 將前端 browser-only `PracticePlan`／`ScheduledPractice` 狀態改接 API；目前型別與資料只保存角色、日期及 question IDs（`app/lib/demo-data.ts:160-239`），需改用正式 ID、版本及使用者身分。
7. 重做學習本清單及編輯畫面：名稱統一、無排程也可儲存、篩選器、同步標籤、分享與建立個人副本流程；目前動作仍要求日期後直接「加入練習計劃」（`app/page.tsx:4758-4825`）。
8. 建立一次性 localStorage 搬移流程與差異報告；成功前不移除舊資料。
9. 更新資料庫完成矩陣、roadmap、API 契約與使用者說明；跨帳號分享目前仍明列未完成（`docs/ROADMAP.md:35`、`docs/database-completion-matrix.md:26,106`）。

## 驗收條件

- 不選日期也能建立、重開及編輯學習本計畫。
- 同一學習本可建立至少兩筆不同時間的排程，取消其中一筆不影響另一筆。
- 「未安排」只回傳沒有 active schedule 的學習本；已完成／取消／錯過排程不會讓它被算為已安排。
- 建立者與分享者篩選可組合使用，回傳資料不得跨 learner 或未授權帳號。
- 分享 token 不含可辨識 ID，資料庫不保存 token 原文；過期、撤銷、已領取 token 均不可再次領取。
- 未登入開啟分享網址，登入後能回到同一邀請，且不能被利用導向外部網址。
- 領取者只能選擇自己具有有效 access 的 learner；兩個帳號同時領取時只有一個成功。
- 發布新版後，共享清單顯示新版；舊排程、active session、completed session 的題目與 revision 完全不變。
- 收件者修改共享內容時只可建立個人副本；副本發布或編輯不影響來源。
- 分享者無 learner result 權限時，任何分享 API 都不能讀到收件者作答或成績。
- 撤銷分享後不可建立新排程；既有完成紀錄仍可由收件 learner 依原權限查看。
- localStorage 重複匯入使用同一 migration ID 不會產生重複資料；失敗不刪除本機舊資料。
- 桌面與手機寬度皆能完成建立、篩選、分享領取、安排與開始練習流程。

## 驗證方式

- Migration contract：upgrade／rollback、外鍵、唯一索引、狀態 check、既有資料保留。
- Service unit tests：安排狀態計算、發布版本、撤銷、fork、權限矩陣、token expiry。
- DB integration：併發領取、併發發布、idempotency、lock version 衝突、跨 learner isolation。
- API tests：未登入、權限不足、過期／撤銷 token、惡意 return path、篩選組合與分頁穩定性。
- E2E：建立未排程學習本、建立兩次排程、跨帳號登入領取、發布新版、舊排程固定、建立個人副本、撤銷。
- Migration E2E：有資料、空資料、部分無法對應、重送、網路中斷後重試。
- Responsive browser verification：至少桌面與手機寬度各走一次主要流程。
- 執行與改動直接相關的型別檢查、測試及 production build；本規劃不包含 Vercel 部署。

## 主要風險與緩解

- 舊排程被新版污染：排程與 session 明確固定 plan revision 及題目 revision。
- 分享造成隱私越權：分享 subscription 與 learner access 分離，結果權限不隨分享附送。
- token 外洩：短效、單次、hash 保存、可撤銷、rate limit、audit。
- localStorage 搬移遺失：預覽、冪等、回讀驗證、延後刪除、錯誤項目隔離。
- 大量清單變慢：server-side filter、複合索引、cursor pagination，避免全量載入。
- 多人同時更新：不可變 revision、lock version、transaction 與明確 409 衝突處理。

## 交付順序

1. 資料模型、權限政策及版本固定。
2. 學習本／排程 API 與前端切換 PostgreSQL。
3. localStorage 搬移。
4. 分享、領取、撤銷與同步。
5. 站內通知、完整稽核與文件。

這個順序先消除目前 localStorage 的資料風險，再開啟跨帳號分享，避免分享功能建立在非持久資料上。
