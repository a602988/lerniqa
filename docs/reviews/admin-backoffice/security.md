# 管理後台安全審查證據

狀態：後台 production code 的靜態安全審查與無資料庫測試已完成。本輪沒有發現 P0；兩項 P1 已修正。仍在編輯的 `0012` migration 不在本輪範圍內，資料庫整合與瀏覽器實際回應仍待隔離環境可用後驗證。

## 審查範圍

本輪檢查 `/admin` 頁面、`/api/v1/admin` 讀寫端點，以及它們使用的管理員授權、repository 和 service。檢查內容包括：

- 管理員登入與 `system_admin` 授權。
- GET 讀取的 repeatable-read snapshot，以及授權與資料查詢是否使用同一個 snapshot。
- 寫入端點的 Origin／CSRF、body 大小、輸入欄位和冪等鍵驗證。
- 交易開始後的管理員重新授權、auth lock、目標資料鎖與稽核紀錄。
- 帳號個資、題目版本與答案、訂閱目錄的資料範圍。
- SQL 注入、IDOR、資產檔案路徑、錯誤訊息與記錄內容。
- 報表小樣本抑制，以及可由總數反推隱藏結果的情況。

`0012` migration 的 constraint、trigger、權限與 up/down 行為由資料庫審查另行驗證。本文件不把 unit fixture 當成 migration 已可上線的證據。

## P0

沒有發現 P0 問題。

## P1 修正

### 管理頁可被外站框架嵌入

管理頁原本沒有明確禁止被 iframe 嵌入。攻擊者如果能在同站的另一個 origin 控制頁面，就可能把已登入的管理介面蓋在誘導操作之下。頁面內的 fetch 仍由真正的 Lerniqa origin 發出，因此 Origin 與自訂 CSRF header 不會擋下被誘導的點擊。

`next.config.ts` 現在對 `/admin/:path*` 回傳 `Content-Security-Policy: frame-ancestors 'none'` 與 `X-Frame-Options: DENY`，並使用 `Referrer-Policy: no-referrer` 避免管理頁路徑與查詢字串經 Referer 外流。`tests/admin-http.test.ts` 固定檢查這三個 header。

### Non-score 報表可用總數反推被隱藏的結果

報表原本分別判斷 correct、wrong、pending 是否達到不同學習者門檻，但只用全部活躍學習者判斷作答總數。若總數和兩個結果可見，第三個被抑制的結果仍可用減法求出。

現在只要任一 non-score 結果被抑制，`nonScoreActivity.attempts` 也會被抑制；其餘達到門檻的結果仍可顯示。回歸測試使用門檻 5、總數 20、correct 12、wrong 7、pending 1，確認 pending 和總數都不會回傳數字。

## 已確認的安全邊界

- 共用登入流程會簽發 HttpOnly session cookie；管理員 guard 只從 cookie 讀取格式固定的 token。伺服器先雜湊 token，再檢查帳號狀態、session 有效性及未撤銷的 `system_admin` grant；`activeRole` 不是授權依據。
- 每個會讀取管理資料的頁面與 GET API 都在同一個 read-only repeatable-read transaction 內重新授權、解析受保護輸入並查詢資料。未通過授權時不解析 route ID，也不執行 repository 查詢。
- 寫入先完成初次管理員授權，再驗證精確 Origin、`Sec-Fetch-Site`、固定 CSRF header、UUID v4/v7 冪等鍵和最多 64 KiB 的 JSON。JSON 只接受各 route 明列的欄位，不能從 body 指定 actor、request ID 或冪等證據。
- 寫入交易先取得與帳號／session／角色異動共用的 auth advisory lock，再用原 cookie 重新授權。操作者的 user ID 或 session ID 有變化就停止寫入。
- 管理寫入使用 PostgreSQL receipt。receipt、業務資料與 `admin_audit_logs` 共用同一個 transaction runner；相同 actor、operation、key 和 payload 只回放同一份結果，不同 payload 會回覆 conflict。
- 題目修改只接受 `origin=system`，並以 `question_id` 同時限定 revision。建立草稿會複製固定版本；發布時保留舊版本並檢查草稿基準、目前版本、審核者和建立者。account-owned 題目在後台保持唯讀。
- 訂閱寫入只處理 catalog。價格必須同時符合 route 的 plan ID 與 price ID，功能限制必須同時符合 plan ID 與 feature definition ID；所有查詢均使用參數，不接受付款 provider、訂閱者或收入欄位。
- 帳號 API 只回傳管理流程需要的身分、角色與學習者存取資料，不回傳 password hash、session token、token hash 或 provider credential。多筆有效 email identity 會使 repository 停止回傳結果。
- 題目資產必須是仍有效、掃描結果為 clean，且正式連到題目內容或來源裁切圖的 raster image／audio。檔案讀取會檢查相對 storage key、根目錄範圍、symlink、大小、checksum 和 MIME allowlist；回應不包含 storage key 或本機路徑。
- repository 的 filter value 全部使用 query parameters。排序 SQL 只能由固定 allowlist 產生。React 畫面不使用 `dangerouslySetInnerHTML`，由資料庫讀出的文字不會直接成為 HTML。
- API 對未知錯誤只回傳固定訊息與 UUID request ID。伺服器錯誤事件使用固定欄位，不記錄 cookie、token、URL、查詢字串、body、SQL、錯誤訊息或 stack。稽核畫面也只顯示 action 對應的欄位 allowlist。

## P2 與待驗證事項

- 本機資產讀取在檢查路徑與 `readFile` 之間仍有檔案系統 TOCTOU 視窗。要利用它必須能同時修改 repository 管理的資產目錄；這不構成遠端 IDOR，但部署時仍應限制該目錄的寫入者，或改用能綁定已開啟 file descriptor 的安全讀取方式。
- 報表的小樣本門檻不是 differential privacy。API 只接受固定的最近 7、30、90 日，已降低任意區間差分風險，但有權限的人仍可能長期保存多次快照做差分分析。若報表日後提供任意日期或更多交叉篩選，需先設計固定發布 bucket、query budget 或其他抗差分措施。
- 管理頁 repository 的讀取錯誤會顯示固定安全訊息，但部分頁面不會產生 request ID 或伺服器失敗事件。這不會把內部錯誤送給瀏覽器，卻會降低異常調查能力。
- 應用程式尚未限制每位管理員的寫入頻率。冪等 receipt 只防止同一個 key 重複寫入，不能限制持續使用新 key 的大量請求；若後台日後開放到公網，需在應用程式或可信 reverse proxy 加入管理端點的速率限制。
- `0012` 尚未納入本輪安全結論。receipt 唯一性、append-only 稽核、訂閱狀態約束和跨列併發規則，必須在 migration 凍結後做 SQL 靜態審查與隔離資料庫測試。
- 目前沒有啟動 PostgreSQL 或 Next server。真實 `401`／`403`、session 或角色在交易中被撤銷、DB rollback、deadlock、實際 response header、cookie 與瀏覽器 clickjacking 行為仍待整合測試。
- dependency audit、secret scan 與 production reverse-proxy 設定不在本輪執行範圍。

## 本輪驗證

- `npm run test:admin`：158 個測試通過，0 失敗。
- `npm run lint`：`tsc --noEmit` 通過。
- `git diff --check`：通過。

上述命令沒有啟動資料庫或伺服器，也沒有讀寫真實帳號、學習者、題庫或付款資料。
