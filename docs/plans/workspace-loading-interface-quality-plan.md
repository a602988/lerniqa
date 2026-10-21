# 學習工作區載入介面調整計畫

## 核准範圍

使用者已核准調整學習工作區的全頁載入畫面。預期結果是保留 Lerniqa 品牌與頁面結構、降低載入完成時的版面跳動，並在等待過久時提供重新載入操作。

## 修改範圍

- `app/page.tsx`：以真實 bootstrap phase(啟動階段)驅動載入文案，改用工作區骨架。
- `app/globals.css`：新增桌面、平板與手機的載入版面。
- `tests/practice-catalog-integration.test.mjs`：保護新載入介面，禁止退回置中小卡片。

登入 bootstrap(啟動流程)只等待帳號、目前學習者與可用題庫。完整練習歷史不屬於工作區顯示前的必要資料；總覽或錯題排行榜需要統計時，才在工作區顯示後讀取，並在該區塊顯示載入或重試狀態。

不修改 API、權限、題目資料、學習者資料或持久化流程。回退時只需移除新的載入元件、樣式與測試，恢復原本 `!isHydrated` 分支。

## 驗證

- TypeScript 型別檢查與 production build。
- 既有 practice catalog 整合測試。
- 實際啟動頁面，在桌面與 390px 手機寬度檢查載入中狀態、長時間提示、無水平溢位與 reduced motion(減少動態效果)樣式。

## 驗證結果

- `npm run lint`：通過。
- `node --test tests/practice-catalog-integration.test.mjs`：26 項全數通過。
- `npm run build`：通過；prebuild runtime guardrails 31 項全數通過。`@keel-design/ui` 的文件預覽元件仍回報既有 optional dependency(選用相依套件)警告，不影響本次 build 完成。
- 瀏覽器驗證：桌面 `1440 × 900` 與手機 `390 × 844` 均正確顯示工作區骨架；手機頁面 `scrollWidth` 與 `innerWidth` 相同，沒有水平溢位。
- 延遲 API 回應超過 8 秒後，畫面會顯示等待說明與「重新載入」操作；`prefers-reduced-motion` 啟用時會停用狀態點動畫。
- 登入 bootstrap 不再呼叫練習歷史 API。production 模式下工作區頁面可先顯示，再由總覽或錯題排行榜讀取練習歷史；讀取時顯示區塊狀態，不阻塞整個工作區。
- `npm start` 與 `npm run dev` 都固定監聽 `127.0.0.1:3500`，讓現有 Tailnet 反向代理不必因執行模式改變而調整。
