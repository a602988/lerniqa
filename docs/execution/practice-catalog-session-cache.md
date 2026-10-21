# 題庫工作階段快取交接

## 狀態

- Repository：`/Users/jean/Documents/GitHub/lerniqa`
- Branch：`main`
- Commit：未提交；本次沒有 commit、push 或部署。
- 範圍：`/questions` 返回時重複下載完整正式題庫的效能問題。

## 已完成

- `app/lib/practice-client.ts` 保留每次 `/api/v1/auth/me` 驗證，只在相同帳號、角色、learner、年級與科目設定 context 下重用分頁記憶體中的題庫。
- 相同 context 的並行請求共用一個 Promise。
- 登出、401、工作區清除、正式題目匯入與管理端題目異動會清除題庫快取。
- context 改變時不會沿用舊 learner 的題庫。
- 未使用 `localStorage`、IndexedDB、Service Worker 或可跨登入保留的持久快取。

## 驗證證據

- `node --test tests/practice-catalog-integration.test.mjs`：31 項通過。
- `npm run lint`：exit code 0。
- `npm run build`：exit code 0。
- 回歸測試證明連續兩次載入仍呼叫 `/api/v1/auth/me` 2 次，但題庫 API 只呼叫 1 次；明確失效與 learner context 改變會重新呼叫題庫 API。
- 既有量測基準見 `docs/execution/handoff-2026-10-18-filter-and-practice-performance.md`：11,005 題、gzip 約 7,652,855 bytes、題庫 API 約 3,069 ms。

## 注意事項

- 工作樹原先已有大量未提交修改；不得回退或覆寫其他功能。
- Build 仍顯示 `@keel-design/ui` 文件預覽 optional dependency 缺少的既有警告：`exceljs`、`docx-preview`、`@aiden0z/pptx-renderer`、`markdown-it`。此次 build 仍成功。
- 快取只在目前分頁生命週期有效；重新整理頁面會重新取得正式題庫，避免長期保存過期題目或權限資料。
