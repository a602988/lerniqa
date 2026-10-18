# 管理後台介面審查證據

狀態：source-level 審查與介面修正已完成；`npm run lint`、`npm run test:admin`（161/161）與 `git diff --check` 通過。因本機 System V shared-memory slot 仍為 32/32，本輪沒有啟動資料庫、網站、preview 或瀏覽器；響應式呈現、焦點行為與截圖仍待 maintenance window 驗收。

## 審查範圍與證據界線

本輪檢查 `/admin` 總覽、帳號、題庫、題目審核佇列、訂閱方案、報表、稽核頁，以及共用 AppShell、篩選列、表格、分頁、Notice、Drawer、Dialog 和表單。判斷依據是 React、CSS、view model、已安裝 KEEL source 與 unit/static contracts；沒有把 fixture、靜態程式或測試通過寫成已讀到真實資料、已部署或已完成瀏覽器驗收。

沒有啟動或停止 3500、3617、8443、5432、55432、55439，也沒有連線或改動任何真實帳號、學習者、題庫、付款或收入資料。

## KEEL 來源與重用邊界

Lerniqa 使用已發布的 KEEL packages，不使用本機 workspace link，也沒有從 `dist/*` deep import：

| 項目 | 來源或版本 |
| --- | --- |
| KEEL 唯讀 source | `/Users/jean/Documents/GitHub/keel-design` |
| source HEAD | `f53704350e7756492ea0a8399877c457570dc3ca` |
| `@keel-design/ui` 發布 commit | `bd03988eafc4d5fa7be9b6f35a435f7b7dfd7173` |
| `@keel-design/ui` | `0.4.0-test.25` |
| `@keel-design/icons` | `0.0.4-test.4` |
| `@keel-design/tailwind-config` | `0.0.5-test.3` |
| `@keel-design/themes` | `0.2.0-test.6` |
| `@keel-design/tokens` | `0.3.0-test.11` |

共用外層直接使用 KEEL `AppShell`；清單使用 `DataTable` 與 `Pagination`；輸入、選單、Button、Badge、Card、Alert、Drawer 與 Dialog 也沿用 KEEL。Lerniqa 的 wrapper 只補產品資料契約、路由狀態、loading／empty／no-results／error 呈現與少量版面 CSS。KEEL 目前沒有匯出的 Textarea，因此題目長文字欄位使用原生 `textarea`，仍由 KEEL `FormField` 提供 label／description，並沿用共同 focus token。沒有自造同名 KEEL 元件。

ERP repository 只用於唯讀參考後台資訊密度與頁面組合；沒有搬入 ERP 客戶資料、fixture、secrets、`.env`、憑證、權限值、Paces／Preline 外層或 ERP 專用狀態。

## 響應式與等價任務的 source 意圖

下列是 CSS／markup 契約，不是實際像素截圖結論：

| 寬度 | source 行為 | 等價任務 |
| --- | --- | --- |
| 390 px | `<48rem` 顯示摘要卡、隱藏桌面表格；篩選與操作可換行，主要操作滿寬 | 帳號、題目、審核佇列、方案、稽核都有關鍵欄位、狀態和查看動作；分頁可橫向捲動 |
| 768 px | `48rem` 起切換為 KEEL DataTable 與桌面 AppShell；表格位於可水平捲動的 `DataTableViewport` | 保留排序、篩選、分頁與詳情入口；窄平板是否需要改用卡片須由瀏覽器驗收決定 |
| 1024 px | 桌面表格、可換行篩選列，主內容 padding 提升 | 欄位不因 sidebar 壓縮而直接裁切；過寬表格在自己的 viewport 捲動 |
| 1440 px | 指標四欄、兩欄內容區、較寬主內容留白 | 完整桌面資訊密度，不以放大單一卡片填滿畫面 |

所有主要容器使用 `min-width: 0`，動態標題、ID、題幹、表格 cell、狀態 badge 與 Drawer 標題採 `overflow-wrap: anywhere`。Drawer header 另保留 close button 空間，避免長標題蓋住關閉按鈕。上述仍需以中文長名稱、50,000 字題幹上限、200% zoom 與實際字型做 browser stress test。

## 可用性、狀態與無障礙檢查

- 每頁只有一個可見 `h1`；共同內容區有隱藏 `h2`，Card、版本、小題與子區段依序使用 `h2` 至 `h5`。
- 主要導覽有 accessible name、目前頁狀態與 skip link；focus-visible 樣式涵蓋品牌、內容目標、排序連結、資產連結與原生 textarea。
- 篩選輸入由 `FormField` 的 `htmlFor` 連到唯一 `id`。日期起訖互設 min／max；稽核日期現在是可見篩選欄位，單獨使用日期也會顯示 no-results，而不會誤稱整個稽核表為空。
- 表格與 mobile cards 都區分 loading、查詢失敗、真正空資料與有條件但無符合結果。錯誤狀態保留 retry 動作；靜態說明是 `note`，只有動態 loading、error、success 使用適當 live region。
- Route Drawer 關閉時用 `router.replace` 移除 detail query；KEEL Drawer／Dialog source 提供 modal focus containment、Escape 與 close label。訂閱 mutation pending 時會拒絕 Escape、外點與取消關閉，錯誤出現時移焦並捲到錯誤。題庫編修有未儲存內容時，關閉 Drawer、切換版本／route link 會先確認放棄，整頁 reload／close 另使用 `beforeunload`；確認離開後先清除 dirty state，避免重複提示。
- 題目發布改用 KEEL Dialog 重述草稿版本、目前版本與歷史保留後果；送出中不可關閉。題目 mutation error 會把焦點與捲動移到 assertive error Notice，題目內容區塊的顯示與編修共用同一組中文 placement／content-type labels。
- 訂閱表單依值類型只顯示有效欄位：boolean 不送 unit，integer 要求 unit；有限額才顯示且要求 limit。失敗重試重用相同 method＋URL＋body 的 idempotency key，成功才清除。
- `suspended` 在篩選、列表、詳情與報表統一為「已停權」。稽核列表與總覽近期活動共用 action／target 中文 label，未知新值仍保留原值以避免隱藏證據。
- 總覽不再把活躍學習者與完成練習誤稱為等待 0011 或等待 repository；卡片明確顯示「請至報表查看」，並保留 `/admin/reports` 入口讓管理員選擇統計期間。

## 真實資料與文案界線

訂閱頁固定說明「支付尚未串接」，並明列沒有 checkout、扣款、付款資料、帳號訂閱、發票或收入。catalog schema 尚不可用時顯示未串接狀態；正式 catalog 為空或篩選無結果時使用不同文案。畫面不建立示意方案，也不顯示假付費人數或營收。

報表的地區缺資料顯示「無資料（尚未蒐集）」；小樣本依政策顯示抑制狀態；真正 0、無分母、未蒐集、未設定政策與查詢失敗不共用同一個數字。題庫與帳號頁也不以 fixture 數值補空畫面。Unit fixture 只證明 mapping、計算與呈現契約，不代表 279 題、帳號或報表已由這個 worktree 的資料庫讀取。

## Source-level 問題收斂狀態

P0：本輪 source inspection 沒有發現會直接阻斷全部管理任務的介面問題；這不等同於 runtime P0 已排除。

P1：本輪發現的 source-level P1 已修正，包括題目發布確認、長表單 dirty guard、題目 mutation error focus／scroll、內容區塊 label 本地化，以及題目審核佇列的 mobile pagination。它們仍列入 maintenance browser 操作驗收，不能只以 source 宣稱 runtime 通過。

P2：

- 768 px 會切到桌面表格；source 有內層水平捲動，但 sidebar 後的實際可用寬度與觸控操作是否足夠，必須由 maintenance browser 驗收決定，不能只靠 breakpoint 推定。

## 已執行驗證

| 驗證 | 結果 | 證明範圍 |
| --- | --- | --- |
| `npm run lint` | 通過 | TypeScript 靜態型別 |
| `npm run test:admin` | 161/161 通過 | 管理輸入、授權、repository、view model、報表、題庫 mutation、訂閱與 shared contracts；不含瀏覽器 |
| `git diff --check` | 通過 | 目前 worktree diff 無 whitespace error |
| `tests/admin-view-model.test.ts` | 14/14 通過，包含本輪新增案例 | 稽核 date-only filter、中文 audit label、停權文案、Dashboard report-only 狀態 |
| `tests/admin-question-mutation-delivery.test.ts` | 7/7 通過，包含本輪新增案例 | 發布確認、dirty route guard、error focus、中文 label 與 mobile pagination 的 source／pure contract |

## Maintenance window 待驗收

- 390、768、1024、1440 px 的每一頁、mobile navigation、Drawer、Dialog、表格 viewport 與分頁。
- 鍵盤順序、可見焦點、Dialog／Drawer 初始焦點與返回焦點、Escape、外點、pending 鎖定、skip link 與 VoiceOver 名稱。
- 200% zoom、長姓名／信箱／ID／題幹、空資料、no-results、慢速載入、API 失敗、重複提交、session 失效與 retry。
- 中文／英文混排、日期、金額、週期、缺值、真實 0、零分母與小樣本抑制。
- 一般使用者頁面不受 admin layout 或 CSS 影響。
- desktop 1440、tablet 1024／768、mobile 390、focus 操作的截圖；preview 預定 `http://127.0.0.1:3617`，目前未啟動，沒有可交付的 browser URL 或截圖。
