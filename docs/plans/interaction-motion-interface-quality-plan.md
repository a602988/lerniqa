# 全站互動與轉場回饋調整計畫

## 核准範圍

使用者已直接指定全站操作、內容區塊變化與頁面切換都需要清楚的過渡回饋。預期結果是按下控制項後立即看得出操作已被接收，跨頁等待時有持續但不遮擋內容的狀態，主要工作區切換時不會瞬間跳換。

本次不修改 API、資料、權限、導覽目的地或業務流程，也不為裝飾而替每個子元素加入位移動畫。

## 方案比較

| 方案 | 優點 | 缺點 | 決定 |
| --- | --- | --- | --- |
| 只加全域 CSS | 改動最少 | 無法表達跨頁仍在處理，按下後等待仍不明確 | 不採用 |
| 共用導覽狀態、頁面模板與全域互動樣式 | 可同時涵蓋立即回饋、等待狀態、頁面及區塊切換；新增畫面可沿用 | 需讓程式式導覽改用共用 hook | 採用 |
| Browser View Transitions API | 頁面銜接效果完整 | 瀏覽器支援與 Next.js 路由整合仍需額外相容處理 | 暫不採用 |

## 動態效果契約

- 按鈕、連結與可點擊控制項在按下時提供短暫位移／縮放回饋，不改變版面尺寸。
- 程式式導覽與站內連結導覽共用頁首進度條，導覽完成或失敗後移除。
- 路由頁面由 `app/template.tsx` 套用一次進場效果；工作區內容依目前 section 重新進場。
- `aria-busy="true"` 的控制項顯示一致的忙碌狀態，既有 Keel `loading` 能力維持為正式 spinner 來源。
- Keel 已提供動效的 Dialog、Dropdown 與 Select 不建立平行實作。
- `prefers-reduced-motion: reduce` 時移除位移、縮放與進場動畫，仍保留可辨識的載入狀態。

## 工作包與驗證

- `IQ-MOTION-01`：建立共用導覽回饋與程式式導覽 hook。驗證站內 Link、`push`、`replace` 與 `refresh` 都會開始回饋，URL 完成變化後停止。
- `IQ-MOTION-02`：新增根頁面與工作區內容轉場。驗證 `/overview`、`/questions`、`/account` 與 `/questions/new`，且不重設頁面資料狀態。
- `IQ-MOTION-03`：補齊全域控制項按壓、區塊顯示與 reduced motion 樣式。驗證桌面與 390px 手機畫面、鍵盤焦點及無水平溢位。
- `IQ-MOTION-04`：加入契約測試、TypeScript 檢查、production build，最後用 `npm start` 實際操作。

## Throughput checkpoint

- **Blocking first steps**：先確認 Keel 現有 button、dialog 動效與目前所有 `useRouter` 呼叫端，避免重複實作。
- **Independent workstreams**：共用導覽元件、樣式、頁面套用與測試可分檔處理；因目前規則不允許委派，由同一執行者依序完成。
- **Shared mutable state**：導覽中的狀態只由根 provider 管理；頁面不各自保存另一份全域狀態。
- **Smallest safe decomposition**：一個共用 provider／hook、一個根 template、一組全域樣式，加上工作區的單一 keyed wrapper；不建立動畫工具箱或新 UI 套件。

## 回退方式

移除共用導覽元件、根 template、全域動態樣式與工作區 wrapper，並讓呼叫端恢復使用 Next.js `useRouter`。這些改動不涉及持久資料或資料庫回退。

## 驗證結果

- `node --test tests/interaction-motion.test.mjs`：3 項全數通過。
- `npm run lint`：通過。
- `npm run build`：通過；prebuild runtime guardrails 31 項全數通過。Keel 文件預覽的 4 個選用套件仍出現既有 warning，不影響 build。
- `npm start`：production build 已啟動於 `127.0.0.1:3500`，`/account` 回傳 HTTP 200。
- production 瀏覽器：頁面套用 `app-page-enter`，按鈕取得 140ms 的 color、background、border、shadow、opacity、transform 過渡，跨頁完成後 `data-navigation-pending` 回到 `false`。
- 桌面 viewport 為 `1280 × 720`，頁面沒有新增水平溢位。另以 Chrome headless `390 × 844` 截圖檢查手機呈現；本次新增的頂端進度與頁面容器沒有遮擋操作。
- Console 未發現本次改動錯誤。Google Identity Services 在 localhost 顯示 origin 未列入 OAuth client 的既有錯誤，與本次動態效果無關。

`IQ-MOTION-01` 至 `IQ-MOTION-04` 均為已驗證。
