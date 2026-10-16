# 管理後台驗收紀錄

狀態：部分完成。35 個不需資料庫的測試已通過；schema 整合、DB E2E、完整 lint／build、瀏覽器驗收、截圖與 preview 尚未完成。

這份紀錄只把實際執行並得到結果的項目標為通過。測試 fixture、靜態頁面程式、規劃中的 migration 與未啟動的本機服務都不算已串接或已上線。

## 目前驗收結果

| 範圍 | 狀態 | 證據或未完成原因 |
| --- | --- | --- |
| worktree 隔離 | 靜態檢查通過 | 分支與路徑獨立；runtime guardrails 2/2 通過 |
| 管理輸入驗證 | unit 通過 | 分頁、排序、filter、UUID、冪等鍵、帳號狀態、訂閱目錄與題目版本輸入 |
| 管理員 guard | unit 通過 | cookie server-side hash、`activeRole` 不可信、`401`／`403` 分流 |
| 唯讀 repository | unit 通過 | 帳號、題目、稽核查詢使用參數與白名單；安全 DTO 有檢查 |
| HTTP 安全回應 | unit 通過 | `private, no-store`、一致 response shape、未知錯誤遮罩 |
| 報表日期與顯示語意 | unit 通過 | Asia/Taipei、包含下界／不包含上界、週月邊界、缺值／空值／零值／零分母／隱私門檻 |
| 管理後台 unit tests | 通過 | `npm run test:admin`：33/33，0 fail，0 skip |
| runtime guardrails | 通過 | `npm run test:runtime-guardrails`：2/2，0 fail，0 skip |
| 全部已執行測試 | 通過 | 合計 35/35，0 fail，0 skip |
| TypeScript lint | 待重新執行 | UI 與 route 修正仍在進行，尚無凍結後的通過結果 |
| production build | 未執行 | 需先完成修正並確認不會誤連資料庫 |
| `0008` 至 `0011` 整合 | 阻擋 | 尚待前台提供單一本機 commit 與最終 schema 契約 |
| migration checksum | 修正進行中 | 修正後需跑 manifest、shell 與隔離 DB 驗證 |
| PostgreSQL migration／E2E | 未執行 | 為避免碰到前台使用中的 DB 資源，本輪沒有啟 cluster |
| 帳號 production 寫入 | 未完成且保持關閉 | 尚未完成交易重授權、鎖定、冪等、稽核與 CSRF 契約 |
| 題目版本／審核寫入 | 未完成 | 題目完整詳情和歷史分頁仍在處理；DB 版本流程未驗收 |
| 訂閱方案 catalog schema | 未完成 | 等 `0008` 至 `0011` 整合後才能取得下一個 migration 編號；支付不在範圍內 |
| score 報表 | 阻擋 | 依賴 `0011` session aggregates 與 answer-free receipts |
| 瀏覽器功能驗收 | 未執行 | 尚未啟動 preview |
| 響應式與無障礙 | 修正進行中 | 390 px 摘要卡、題目完整內容與其他審查項目待重新 lint／browser 驗收 |
| 截圖 | 未產生 | desktop／tablet／mobile 都待 browser 驗收後保存 |

## 已執行命令

```text
npm run test:admin
npm run test:runtime-guardrails
```

兩個命令都以 exit code 0 結束。執行過程沒有啟動 PostgreSQL、Next.js dev server 或 preview server。

## 完成與未完成界線

目前完成的是管理後台架構文件、隔離 script 契約、共同介面骨架、輸入與報表 helper、伺服器授權基礎、唯讀 repository，以及 35 個不需資料庫的測試。這些成果可以作為後續整合的基礎，但不足以交付可操作真實資料的管理後台。

下列項目仍未完成：

- 前台正式 commit 與 `0008` 至 `0011` schema 整合。
- `users.account_role`、`learner_access`、score aggregates 與 receipts 的 PostgreSQL 實際契約驗證。
- 管理寫入的交易重授權、鎖定、冪等、稽核、Origin／CSRF 與失敗回滾。
- 題目完整詳情、歷史分頁、revision 建立、不同人審核、發布與舊作答依據驗證。
- 訂閱方案 migration、價格換版與 catalog transaction；任何 payment／checkout／收入功能都不在本階段。
- 已知 fixture 手算的報表 SQL、資料範圍、排序、篩選、分頁與重複提交 DB E2E。
- 390／768／1024／1440 px、鍵盤、焦點、錯誤恢復與 browser screenshots。

## 禁止資源與未發生的動作

本輪沒有使用 `3500`、`8443`、`55432` 或 `local-data/postgres`，也沒有啟動 `55439`。沒有讀寫真實資料庫、建立真實子女資料、修改真實帳號、覆寫第四課 279 題、連接支付、推送、合併或公開部署。

## 最終交付待填

只有相應驗收完成後才能填入：

- 前台 schema commit：待提供。
- 管理後台本機 commit：待建立。
- 最終 migration manifest：待整合。
- DB E2E 命令與結果：待執行。
- lint／build 命令與結果：待執行。
- desktop／tablet／mobile screenshots：待產生。
- 獨立 preview：預定 `http://127.0.0.1:3617`，目前未啟動。
- 剩餘阻擋與整合依賴：待最終驗收時依實際結果更新。
