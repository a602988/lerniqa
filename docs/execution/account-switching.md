# 帳號切換交接

## 目前狀態

- Repository：`/Users/jean/Documents/GitHub/lerniqa`
- Branch：`main`
- 基準 commit：`2c1715e`
- 帳號切換的程式、migration、契約測試與產品規格已完成；`0028` 已套用到 Lerniqa 持久本機資料庫。尚未提交、推送或部署。

## 已完成

- 工作區的「切換帳號」直接前往 `/account?switch=1`，不再經過 `/login` 的登入中繼畫面。
- 帳號選擇器列出這台裝置成功登入過的帳號，可直接切換、登入其他帳號，或移除該裝置的快速切換資格。
- `auth_devices` 只保存裝置憑證雜湊；`auth_device_accounts` 保存裝置與帳號的可撤銷關聯。瀏覽器只收到 HttpOnly 不透明裝置 cookie，不保存密碼、多組 session token 或帳號清單。
- 密碼、Google、LINE 與 Facebook 成功登入時共用同一個記錄裝置帳號流程。切換帳號時會重新檢查帳號、角色及學習者授權，並簽發新的目前 session。
- 電子郵件登入成功後，合法 `returnTo` 優先；未提供目的地時直接前往 `/overview`。帳號快速切換成功後廣播帳號情境變更，不再誤送 session 失效事件。
- 「切換帳號 → 登入其他帳號」依登入表單的顯示狀態初始化 Google Identity Services；保留目前 session 時也能載入 Google 按鈕，不再因 `account` 存在而跳過。

## 驗證證據

- `npm run test:auth`：40 項通過；登入導頁回歸測試先在缺少預設導頁時失敗，修正後通過。
- `npm run lint`：通過。
- `npm run db:test`：28 組 migration 的前進、限制測試、逐階段回滾、再次前進與 schema parity 全部通過。
- `npm run build`：通過；新增兩個帳號切換 API route。既有 Keel 文件預覽 optional dependency 警告仍存在。
- 瀏覽器：正式 HTTPS 開發入口可載入 `/account?switch=1`；桌面與 `390×844` viewport 的單欄 breakpoint 生效。
- `npm run db:local:migrate`：已套用 `0028_remembered_accounts`；`schema_migrations`、`auth_devices` 與 `auth_device_accounts` 已核對存在，HTTPS 帳號清單 API 回傳 HTTP 200。

## 待完成

- 以實際帳號完成登入、切換、登入其他帳號及移除裝置帳號的往返驗收；驗收不得在自動化流程輸入或保存使用者密碼。

## 不得回退或覆寫

- 不得把帳號清單、密碼或多組 session token 改存 `localStorage`。
- 「從這台裝置移除」只撤銷快速切換資格，不得刪除正式帳號或學習資料。
- 不得以固定帳號或 mock 清單讓帳號選擇器看似可用。
