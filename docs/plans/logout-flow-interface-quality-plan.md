# 登出流程調整計畫

## 使用者結果

使用者從學習工作區按下「登出」後，系統應立即結束目前的登入狀態，清除工作區內的帳號資料，並顯示帳號頁的登入表單。流程不再經過 `/logout` 中介畫面，也不要求使用者再次按下登出。

## 修改範圍

- `app/lib/auth-session-client.ts`：集中處理瀏覽器端登出請求、回應驗證與跨分頁通知。
- `app/page.tsx`：工作區登出入口直接執行登出；失敗時保留目前登入狀態並顯示錯誤。
- `app/account/page.tsx`：改用相同的共用登出函式。
- `tests/practice-catalog-integration.test.mjs`：驗證登出請求成功後才清除狀態，並防止 `/logout` 中介流程恢復。

不修改登入、建立帳號、權限、帳號資料或伺服器端 Session 規則。若需回退，恢復原本工作區登出導向及帳號頁的登出請求即可。

## 驗證方式

- 先以現有程式執行回歸測試，確認測試能重現缺少直接登出的問題。
- 修改後執行 TypeScript 型別檢查、登出相關測試與 production build。
- 在瀏覽器登入後，從工作區執行登出，確認只操作一次便進入登入表單；重新整理後不得恢復原帳號。

## 驗證結果

- 回歸測試先以 `logoutAuthSession is not a function` 失敗，證明原本沒有可由工作區直接呼叫的正式登出流程；完成共用函式後通過。
- `node --test tests/practice-catalog-integration.test.mjs`：28 項全數通過。
- `npm run test:auth`：38 項全數通過，包含登入與登出的 host-only、no-store Session Cookie 契約。
- `npm run lint`：通過。
- `npm run build`：通過；prebuild runtime guardrails 31 項全數通過。`@keel-design/ui` 的文件預覽元件仍有既有 optional dependency(選用相依套件)警告，不影響 build 完成。
- 瀏覽器驗證：執行登出後進入 `/account` 登入表單；重新開啟工作區網址仍回到登入表單，原帳號資料沒有恢復。
- `next.config.ts` 不再把 `/logout` 改寫成工作區頁面；唯一保留的是 `POST /api/v1/auth/logout` API。
