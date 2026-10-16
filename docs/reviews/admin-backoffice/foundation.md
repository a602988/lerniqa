# 管理後台基礎審查證據

狀態：基礎程式與不需資料庫的測試已完成一輪檢查；資料庫、瀏覽器與整合驗收尚未執行。

這份文件記錄 2026-10-16 可由目前 worktree 證明的結果。它不是上線證明，也不代表前台 schema、管理寫入、隔離資料庫或響應式介面已通過驗收。

## 程式基準與隔離

| 項目 | 本次使用值 |
| --- | --- |
| worktree | `/Users/jean/Documents/Codex/2026-10-16/task/lerniqa-admin` |
| 分支 | `codex/lerniqa-admin-20261016` |
| 建立 worktree 的基準 commit | `6ef62eb139d35693e31ed78ee966f2d1f37a61f9` |
| 管理後台 web | `127.0.0.1:3617` |
| Next.js 開發目錄 | `.next-admin` |
| Next.js正式 build 目錄 | `.next-admin-build` |
| 管理後台 PostgreSQL socket port | `55439` |
| 管理後台測試 database | `lerniqa_admin_e2e` |
| 管理後台 PostgreSQL data | `local-data/admin-e2e/postgres` |
| 管理後台 PostgreSQL socket | `local-data/admin-e2e/socket` |

`3500`、`8443`、`55432`、`local-data/postgres`、原始 checkout 的執行程序與真實資料庫不在這項工作的使用範圍。本次證據蒐集沒有啟動 PostgreSQL 或 Next.js，也沒有占用任何端口。

## 目前已有的基礎程式

目前 source tree 已有 `/admin` 的共同 layout，以及總覽、帳號、題庫、訂閱方案、報表與稽核頁面。管理 API 目前有帳號清單與詳情、題目清單與詳情、稽核清單的唯讀 route。這些檔案的存在只代表程式已建立；在資料庫和瀏覽器驗收完成前，不能據此判定整段流程可用。

共同伺服器程式已包含下列邊界：

- session cookie 只在伺服器雜湊後查詢，不以瀏覽器提交的 `activeRole` 或管理員旗標授權。
- 有效 session 與有效 `user_roles.role='system_admin'` 分開查核，未登入與已登入但沒有管理權限分別使用 `401` 與 `403`。
- 帳號、題目與稽核清單使用白名單排序、參數化篩選、固定 tie-breaker 與伺服器分頁。
- 回應 helper 固定送出 `Cache-Control: private, no-store, max-age=0`，未知錯誤不把 SQL、連線資訊或 stack message 回傳給瀏覽器。
- 帳號與學習者關聯只使用正式表名 `learner_access`，沒有建立 `user_learner_access`。

這些項目已有 unit test；route、真實 SQL、資料範圍和 session 撤銷仍要等整合後以隔離資料庫驗證。

## 不需資料庫的測試結果

2026-10-16 在本 worktree 執行：

```text
npm run test:admin
npm run test:runtime-guardrails
```

結果：

| 測試組 | 通過 | 失敗 | 跳過 |
| --- | ---: | ---: | ---: |
| 管理後台 input、報表、repository、HTTP unit tests | 33 | 0 | 0 |
| runtime 隔離 guardrails | 2 | 0 | 0 |
| 合計 | 35 | 0 | 0 |

unit tests 已涵蓋輸入白名單、分頁上限、穩定排序、日期區間、ISO 幣別、minor-unit 金額、題目版本輸入、錯誤遮罩、臺北時區分組、缺值與零值、隱私門檻、管理員授權、帳號與題目安全 DTO、稽核欄位 allowlist。guardrails 驗證管理後台 script 使用獨立 web、build 與 PostgreSQL 路徑。

這 35 個測試都不會連接資料庫，也沒有證明 migration、SQL 在 PostgreSQL 的實際結果、route rendering 或瀏覽器操作。

## 仍在處理的基礎問題

- 管理後台 migration runner 的 checksum 檢查正在修正。修正後要重新跑 shell 檢查、guardrails 與隔離資料庫 migration。
- 前台 `0008` 至 `0011` 尚待單一本機 commit 整合。本分支目前不能宣稱已取得 `users.account_role` 或 `0011` score aggregates／receipts。
- 題目詳情的歷史版本分頁仍待補上，不能把目前的詳情查詢當成無上限的完整歷史。
- 目前 UI 修正尚未完成 lint、production build 與瀏覽器回驗。

## 待補交付證據

下列欄位要等相應工作真的完成後才填：

- schema 整合 commit：待前台交付 `0008` 至 `0011` 的正式 commit。
- 管理後台本機 commit：待程式、文件與驗收證據凍結後填入。
- migration／DB E2E：尚未執行。
- desktop／tablet／mobile screenshots：尚未產生。
- 獨立 preview：尚未啟動；預定位置是 `http://127.0.0.1:3617`。
