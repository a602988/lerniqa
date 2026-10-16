# 管理後台介面審查證據

狀態：共用元件與主要頁面已有程式，介面審查發現正在修正；尚未完成 lint、build 或瀏覽器響應式驗收。

## KEEL 來源與實際使用邊界

Lerniqa 使用已發布的 KEEL packages，不以本機 workspace link 或 `dist/*` deep import 取代正式依賴。本機唯讀來源與套件版本如下：

| 項目 | 來源或版本 |
| --- | --- |
| KEEL source | `/Users/jean/Documents/GitHub/keel-design` |
| source HEAD | `f53704350e7756492ea0a8399877c457570dc3ca` |
| `@keel-design/ui` 發布 commit | `bd03988eafc4d5fa7be9b6f35a435f7b7dfd7173` |
| `@keel-design/ui` | `0.4.0-test.25` |
| `@keel-design/icons` | `0.0.4-test.4` |
| `@keel-design/tailwind-config` | `0.0.5-test.3` |
| `@keel-design/themes` | `0.2.0-test.6` |
| `@keel-design/tokens` | `0.3.0-test.11` |

後台共同外層直接使用 KEEL `AppShell`，資料清單使用 `DataTable` 與 `Pagination`，表單、按鈕、Badge、Card、Alert、Drawer 與 Dialog 也優先沿用 KEEL。ERP repository 只作為頁面密度與組合方式的唯讀參考；沒有搬入 ERP 客戶資料、環境變數、憑證、權限常數、Paces／Preline 外層或 ERP 專用狀態。

## 已具備但仍待瀏覽器證明的介面

目前 source 已有總覽、帳號、題庫、訂閱方案、報表和稽核頁面，以及共同的頁首、篩選列、指標卡、表格狀態、分頁、狀態 Badge、Notice、Drawer 與政策 Dialog。程式已區分 loading、empty、no-results 與 error，也為表格排序、導覽、Drawer 關閉和部分狀態提供 accessible name。

訂閱方案頁固定說明「支付尚未串接」，報表頁把地區顯示為「無資料（尚未蒐集）」。介面沒有填入假付費用戶、收入、註冊人數或報表數字。這些 source-level 檢查不能代替瀏覽器呈現、鍵盤操作或 assistive technology 驗收。

## 審查發現與修正狀態

目前有兩項高優先問題正在修正：

- 390 px 畫面要為帳號、題目、訂閱方案與稽核清單提供可完成同一任務的摘要卡，不能只把桌面表格縮窄或要求橫向捲動。
- 題目詳情要完整呈現 parts、options、blocks、answers、sources、reviews 與 classifications；只顯示題目摘要無法支援全題庫查閱和版本審核。

其他正在修正的介面問題如下：

- 靜態說明不應使用會重複朗讀的 live region；只有載入或錯誤變化需要適當的 `status`、`alert` 或 `aria-live`。
- 表格查詢失敗要提供可操作的重新載入動作，不能只有錯誤文字。
- 關閉以 query parameter 開啟的 Drawer 時要使用 route replace，避免瀏覽器返回鍵再次打開同一 Drawer。
- 頁面 h1、內容分區與卡片標題要維持連續 heading hierarchy。
- `archived`、`changes_requested` 等資料狀態要使用清楚、一致的中文標籤，不能直接露出資料庫字串。

上述項目都必須標為「修正進行中／待重新 lint 與瀏覽器驗收」。即使 source 已出現部分修正，也要等整批程式穩定後重新檢查，不能在這份證據中先宣稱完成。

## 尚未執行的介面驗收

- 390、768、1024、1440 px 的頁面與 Drawer／Dialog 操作。
- 鍵盤導覽、可見焦點、焦點返回、Escape 關閉與螢幕閱讀器名稱。
- 200% 縮放、長名稱、長題目、空資料、無符合結果、慢速載入、API 失敗和 session 逾時。
- 表格排序、複合篩選、第一／中間／最後一頁，以及 route query 的返回行為。
- 中文與英文混排、日期、金額、週期、缺值、實際零與零分母的顯示。
- 一般使用者頁面沒有被 admin layout 或 CSS 影響。

## 待補視覺證據

目前沒有管理後台瀏覽器截圖。下列項目只能在獨立 preview 啟動並完成驗收後填入：

- desktop 1440 px：待補。
- tablet 1024 px 與 768 px：待補。
- mobile 390 px：待補。
- keyboard／focus 操作紀錄：待補。
- preview URL：預定 `http://127.0.0.1:3617`，目前未啟動。
