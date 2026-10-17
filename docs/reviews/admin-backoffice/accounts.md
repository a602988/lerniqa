# 帳號管理契約核對

狀態：帳號唯讀 repository、管理 API、管理頁面與 unit tests 已整合正式 `0010` 契約。PostgreSQL fixture 與瀏覽器驗收尚未執行；依隔離要求，沒有啟動資料庫或網站服務。

## 授權與一致性

帳號頁、帳號清單 API 與帳號詳情 API 都在 `READ ONLY REPEATABLE READ` transaction 內重新確認 `system_admin` 授權。授權、route params 與 query 解析、清單查詢，以及詳情的多次查詢共用同一個 transaction-scoped runner。請求不會沿用頁面 layout 較早取得的授權結果；在 transaction snapshot 建立前已提交的撤權會被重新授權讀到，而 snapshot 建立後才提交的並行撤權則從下一個請求生效。這項邊界確保同一請求的授權與資料不會落在兩個不同資料版本。

Next.js 的 `redirect()` 與 `notFound()` 會用例外中斷 render。帳號頁的錯誤處理先呼叫 `unstable_rethrow()`，再顯示一般讀取錯誤，避免把登入 redirect 誤畫成管理頁錯誤畫面。transaction 或授權失敗後，頁面只建立預設空查詢，不再解析受保護網址中的篩選值。

## 正式資料來源

- 一般帳號身份直接讀取 `users.account_role`，值域是 `parent`、`learner`、`tutor`。這個欄位不代表 `system_admin` 授權。
- 有效角色讀取未撤銷的 `user_roles`。歷史授權仍在詳情中顯示授予與撤銷時間。
- 帳號與學習者只透過 `learner_access` 關聯，不建立或查詢其他平行關聯表。
- 登入身份 provider 只接受 schema 的 `email`、`google`、`line`、`facebook`。repository 收到其他值時停止回傳，不把未知 provider 當成正式資料。

登入與信箱驗證服務要求同一帳號只能有一個有效 email identity。資料庫目前允許同一帳號持有多筆不同信箱，因此帳號清單會先檢查所有帳號的有效 email identity 數量，帳號詳情也會再次檢查目標帳號。發現多筆時回傳內部錯誤，不用 `LIMIT 1` 任選一筆，也不把其中一筆顯示成主要信箱。

## 畫面狀態

登入身份會分開顯示驗證狀態與是否撤銷。已撤銷但曾驗證的信箱會標示「已撤銷」及撤銷時間；原驗證時間只作歷史證據，不表示目前仍可登入。

每筆學習者關係顯示兩個獨立狀態：

- 關係狀態依 `accepted_at` 與 `revoked_at` 分成已接受、待接受、已撤銷。
- 學習者狀態依 `learners.status` 分成啟用中、已封存。

只有「關係已接受、尚未撤銷、學習者啟用中」才標為有效。待接受、已撤銷或學習者已封存時，畫面仍保留權限設定作歷史證據，但清楚標示目前不生效。

帳號清單提供關鍵字、帳號狀態、一般帳號身份、有效角色、信箱驗證與註冊日期篩選。註冊起日與迄日使用可操作的 date input；查詢仍以臺北當地日期轉成包含起點、不包含迄日次日零時的時間範圍。缺少信箱、年級或學期時顯示「未填」，不補造資料。

## 寫入邊界

帳號頁與 API 只讀取資料。帳號停權、關閉、角色授予或撤銷、人工信箱驗證及學習者關係異動均未開放；本輪測試沒有變更任何帳號。

## 驗證範圍

Unit tests 涵蓋授權撤銷後不讀取、授權與資料使用同一 snapshot runner、詳情 params 在授權後才解析、多個有效 email identity 封閉拒絕、安全 DTO、provider allowlist、登入身份撤銷、學習者關係三種狀態、學習者啟用／封存，以及註冊日期輸入契約。

PostgreSQL fixture、桌面／平板／手機瀏覽器操作及本機預覽仍待獨立資料庫可安全啟動後執行。Unit fixture 只證明程式契約，不代表真實帳號資料已讀取或正式環境已上線。
