# 訂閱方案目錄審查

審查日期：2026-10-16

這個功能只管理未來可能使用的方案、價格與功能限制。畫面和 API 都固定標示支付尚未串接；資料模型、查詢與操作不包含訂閱者、付款、發票、退款或收入。

## 已完成範圍

- `/admin/subscription-plans` 提供方案搜尋、狀態篩選、白名單排序、伺服器分頁與詳情抽屜。
- 管理員可建立及編輯方案草稿，並依 `draft → active → retired` 的單向規則變更狀態。方案停用前必須先停用所有仍在草稿或啟用中的價格。
- 價格使用 ISO 4217 幣別、minor unit 整數金額、週期與生效區間。草稿可編修；啟用後金額、幣別、週期與生效日不可修改，只能為原本沒有結束日的價格設定一次結束日。改價必須停用舊價格並建立新草稿。
- 功能定義支援 boolean 與 integer。boolean 不接受單位；integer 必須使用穩定的機器代碼作為單位。功能限制保留四種有效狀態：不包含、boolean 包含、integer 有限數量、integer 無上限。
- 已啟用方案只能包含已啟用的功能。功能仍被未停用方案包含時不能停用，以免留下無法再調整的功能限制。
- 清單、詳情與功能定義讀取都在同一個 read-only repeatable-read snapshot 中完成授權與查詢。頁面遇到登入導向時使用 `unstable_rethrow`，不會把導向誤顯示成一般錯誤。

## 寫入與稽核

所有寫入路由都使用共用的管理操作處理器。處理順序是先驗證管理員，再檢查同源請求、CSRF header、UUID v4/v7 冪等鍵與 JSON 欄位；開始交易後會重新確認管理員權限，最後才執行 catalog service。

`admin_mutation_receipts` 是唯一的管理操作收據。收據、業務資料與 `admin_audit_logs` 使用同一個 transaction runner，沒有記憶體備援：

- 相同 actor、operation、key 與 request fingerprint 會回放已完成的 JSON 結果。
- 相同鍵搭配不同內容會回傳 `409`。
- 業務操作或稽核失敗時，交易回滾，不會留下可提交的 pending 收據。
- 收據只保存完成回放及稽核關聯，不把請求內容或支付資料放進稽核畫面。

稽核畫面只允許顯示各 action 所需的安全欄位。方案、價格、功能定義與功能限制各自使用固定 target type；冪等鍵、request fingerprint、provider 欄位與收入欄位不會透過 before/after JSON 顯示。

## API

| 方法與路徑 | 用途 |
| --- | --- |
| `GET /api/v1/admin/subscription-plans` | 查詢方案清單 |
| `POST /api/v1/admin/subscription-plans` | 建立方案草稿 |
| `GET /api/v1/admin/subscription-plans/:planId` | 查詢方案詳情 |
| `PATCH /api/v1/admin/subscription-plans/:planId` | 編輯方案名稱與說明 |
| `POST /api/v1/admin/subscription-plans/:planId/status` | 啟用或停用方案 |
| `POST /api/v1/admin/subscription-plans/:planId/prices` | 建立價格草稿 |
| `PATCH /api/v1/admin/subscription-plans/:planId/prices/:priceId` | 編輯草稿，或為啟用價格設定一次結束日 |
| `POST /api/v1/admin/subscription-plans/:planId/prices/:priceId/status` | 啟用或停用價格 |
| `GET /api/v1/admin/subscription-plans/feature-definitions` | 查詢功能定義 |
| `POST /api/v1/admin/subscription-plans/feature-definitions` | 建立功能定義草稿 |
| `PATCH /api/v1/admin/subscription-plans/feature-definitions/:featureDefinitionId` | 編輯功能定義 |
| `POST /api/v1/admin/subscription-plans/feature-definitions/:featureDefinitionId/status` | 啟用或停用功能定義 |
| `PUT /api/v1/admin/subscription-plans/:planId/feature-limits/:featureDefinitionId` | 建立或更新方案功能限制 |

路徑中的 UUID 不會在授權前解析。mutation route 只在共用處理器的 parse callback 中解析路徑參數；GET 詳情則在 snapshot 中完成授權後才解析參數。

## 驗證結果

在未啟動 PostgreSQL 或 Next.js server 的情況下完成下列驗證：

- `npm run test:admin`：156 項通過，0 項失敗。
- `tests/admin-subscription-catalog.test.ts`、`tests/admin-mutation-receipts.test.ts` 與 `tests/admin-input.test.ts` 合計 41 項通過。
- `npx tsc --noEmit --pretty false`：通過。
- `git diff --check`：通過。

測試涵蓋輸入驗證、功能限制四態、價格與功能定義編修、樂觀鎖定、方案與價格啟用順序、跨表狀態拒絕、稽核欄位清理、共用收據回放與內容衝突、操作失敗不完成收據、查詢 snapshot，以及 mutation 路徑參數的授權順序。

## 尚待整合驗收

目前沒有啟動隔離資料庫，因為主機的 System V shared-memory slots 已用完，而且不得停止使用者的 PostgreSQL 或既有服務。因此尚未執行 migration、資料庫 constraint／trigger、真實並行交易、瀏覽器操作、響應式畫面截圖與 `127.0.0.1:3617` 預覽。

資料庫維護時段確認後，應使用專用 port、database 與 build 目錄完成 migration up/down/up、schema parity、合成 catalog 資料 E2E、兩個並行請求共用冪等鍵，以及桌面／平板／手機驗收。這些驗證通過前，不能把 catalog 稱為已部署，也不能宣稱支付已串接。
