# 全站互動與轉場回饋交接

## 範圍

- Repository：`/Users/jean/Documents/GitHub/lerniqa`
- Branch：`main`
- 起始 commit：`2c1715e`
- 本工作區有大量其他尚未提交的修改，不得回退或覆寫。

## 已完成

- 新增根層 `NavigationFeedbackProvider` 與 `useAppRouter`，統一站內 Link、`push`、`replace`、`refresh`、上一頁與下一頁的導覽等待回饋。
- 專案內原本直接使用 Next.js `useRouter` 的呼叫端已改用共用 hook。
- 新增根 `app/template.tsx` 頁面進場與主工作區 keyed section 轉場。
- 全域控制項具有短暫按壓回饋，狀態、錯誤與自訂 dialog 顯示時具有克制的進場效果。
- 保留 Keel 原有 Dialog／Dropdown／Select 動效，不建立平行元件。
- `prefers-reduced-motion` 會停用位移、縮放與反覆動畫，但保留載入狀態文字與進度條 DOM。

## 驗證

- `node --test tests/interaction-motion.test.mjs`：3 項通過。
- `npm run lint`：通過。
- `npm run build`：通過；runtime guardrails 31 項通過。
- production 瀏覽器已確認頁面動畫、控制項 transition 與跨頁完成後進度復位。
- `npm start` 正在 `127.0.0.1:3500` 執行；`/account` 回傳 HTTP 200。
- 驗證紀錄與方案：`docs/plans/interaction-motion-interface-quality-plan.md`。

## 目前狀態

尚未提交或推送。production 服務由 `npm start` 常駐執行。瀏覽器 Console 的 Google OAuth localhost origin 錯誤為既有外部設定問題，不屬於本次變更。

## 下一個可執行動作

由使用者實際操作常用流程，確認 140–220ms 的節奏是否符合體感；若只需調快或調慢，應集中修改 `app/globals.css` 的動態效果契約，不在個別頁面另加覆寫。
