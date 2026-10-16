# 管理後台安全審查證據

狀態：唯讀基礎程式已完成靜態檢查與 unit test；寫入、資料庫、CSRF、瀏覽器與完整攻擊面尚未驗收。

## 已檢查的範圍

本輪檢查限於目前分支中的管理員 guard、唯讀帳號／題目／稽核 repository、管理 HTTP response helper、輸入解析與隔離 runner。尚未整合的 migration、尚未建立的正式寫入端點、真實 session 撤銷、PostgreSQL 權限、瀏覽器 cookie 行為與 production 環境不在本輪結論內。

在這個範圍內，審查目前沒有發現 SQL 注入、SQL alias 錯用、以 `activeRole` 繞過管理權限，或把 credential 欄位送到管理 API 的問題。這個結論有以下程式與測試依據：

- 管理員 guard 只接受伺服器端 cookie，查詢前先雜湊 token，並重新檢查有效 session、有效使用者與未撤銷的 `system_admin` grant。
- unit test 明確確認 `activeRole` 不參與管理員授權，且缺少登入與缺少管理角色會得到不同錯誤。
- repository 的 filter value 使用 query parameters；排序欄位與方向由固定 allowlist 映射，不把 query string 拼成 SQL expression。
- 帳號 DTO 不包含密碼雜湊、token、token hash、provider subject 或完整 credential payload；題目 DTO 不回傳 storage 與 import payload。
- 未知例外經安全錯誤契約處理，不會回傳 SQL、連線字串或 stack message。
- 管理資料 response 固定使用 `private, no-store`。
- 稽核資料的 `before` 與 `after` 依 action 使用欄位 allowlist，不直接把整份 JSON payload 回傳。

相關 unit tests 包含在 `npm run test:admin` 的 33 個通過案例中。這些測試使用 fake query runner，沒有連到 PostgreSQL，因此仍需 DB integration test 證明資料範圍與 SQL 行為。

## 權限與資料範圍判斷

正式的帳號與學習者關聯表是 `learner_access`。`accountRole` 與 `activeRole` 是應用程式欄位，不是管理員授權來源。前台 `0010` 整合後，後台還要把 `users.account_role` 納入讀取 DTO 與查詢測試；完成前不能說帳號角色資料已完整。

題目讀取目前將 `origin=account` 標成唯讀。只有 `origin=system` 能進入未來的管理版本流程。這項 UI 提示不能代替後端檢查；建立 revision、審核與發布端點完成時仍要在同一交易重新取得並鎖定題目和權限資料。

## 寫入功能的安全門檻

任何帳號狀態、角色、題目版本、審核、發布或訂閱目錄寫入，在滿足下列條件前都不能通過安全驗收：

- 在交易內重新驗證操作者仍有 `system_admin`，並鎖定對應 auth grant。
- 鎖定目標資料，再檢查狀態轉換、owner、origin 與目前 revision。
- 使用冪等鍵，重複送出只能得到同一結果，不能產生第二筆角色 grant、revision、審核或價格。
- 業務資料與 `admin_audit_logs` 在同一交易寫入；稽核失敗時整筆回滾。
- 寫入 route 驗證 `Origin`／CSRF，不能只依賴 SameSite cookie，也不能接受 body 內的 actor、owner 或可信角色。
- 錯誤 response 延續 `no-store` 與安全遮罩，不回傳資料庫或內部授權細節。

目前尚未以隔離資料庫證明這些條件，所以不能把表單原型或 unit fixture 視為可安全操作真實資料的功能。

## 正在修正與待回驗

- migration runner checksum 檢查正在修正。這項修正要先通過靜態 guardrail，再於隔離 cluster 驗證 manifest 前綴與檔案內容沒有漂移。
- `0008` 至 `0011` 尚未整合；`0010` 的 `users.account_role` 和 `0011` 的 score 資料契約仍是 gate。
- 題目詳情歷史分頁尚未完成。完成前要限制讀取範圍，不能一次無上限載入完整 revision 歷史。
- 寫入端點的交易重授權、auth lock、target lock、冪等、稽核與 Origin／CSRF 測試尚未完成。

以上項目修正後要重新執行 lint、unit tests、migration tests、DB integration tests 與瀏覽器驗收。本輪沒有啟動資料庫或伺服器，也沒有對任何真實帳號升權、停權、人工驗證或變更角色。

## 尚未執行的安全測試

- 真實 PostgreSQL 上的 `401`、`403`、撤銷 session 與撤銷角色。
- IDOR、跨帳號讀取、owner／actor／origin 偽造與 asset 引用授權。
- SQL 注入 payload 在實際 route 與 PostgreSQL 的結果。
- CSRF、Origin、cookie 與重放行為。
- 寫入失敗、稽核失敗、deadlock、連點與逾時重試的整筆回滾。
- dependency audit、Secret scan 與 production 設定審查。
