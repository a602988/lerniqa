# 社群快速註冊交接

## 目前狀態

- Repository：`/Users/jean/Documents/GitHub/lerniqa`
- Branch：`main`
- 最後已推送 commit：`2c1715e`
- Google、LINE 與 Facebook 快速註冊程式、資料庫 migration、測試與產品文件已完成。
- 本次沒有部署至 Vercel，也沒有將 `0020` 至 `0022` 套用到持久本機或 production 資料庫。

## 已完成

- `/account` 直接提供 Google Identity Services、LINE Login 與 Facebook Login 入口；既有供應商身份不經過中繼頁即可登入。`/quick-register` 只承接新使用者完成供應商授權後所需的角色與學習者資料。
- LINE 與 Facebook 使用 authorization code flow；伺服器驗證 `state`，LINE 另驗證 `nonce`、ID token issuer 與 audience，Facebook 驗證 access token 的 App 與 user ID。
- 供應商身份已存在時直接建立登入 session；相同電子郵件若已屬於其他身份，拒絕自動合併。
- 新使用者完成身份確認後，必須選擇角色及學習者資料才會建立帳號。
- 短效註冊狀態寫入 `social_quick_registrations`，OAuth 嘗試寫入 `social_oauth_attempts`。瀏覽器只保存 HttpOnly 不透明 cookie，資料庫只存 token、`state` 與 `nonce` 雜湊。
- 密碼與三家社群註冊共用同一個帳號建立交易。

## 驗證證據

- `npm run test:auth`：35 項通過。
- `npm run lint`：通過。
- `npm run db:test`：`0001` 至 `0022` 首次升級、限制測試、完整降級、第二次升級與 schema parity 全部通過；沒有異動持久 `lerniqa_local`。
- `npm run build`：通過；產物包含三個社群登入端點與 `/quick-register`。既有 Keel 文件預覽 optional dependency 警告仍存在。
- 瀏覽器驗收：桌面與 `390×844` 手機寬度通過；Google、LINE、Facebook 三個入口可見，console 無錯誤。

## 阻擋與下一步

真實帳號往返需要設定 `GOOGLE_OAUTH_CLIENT_ID`、`LINE_CHANNEL_ID`、`LINE_CHANNEL_SECRET`、`FACEBOOK_APP_ID` 與 `FACEBOOK_APP_SECRET`。LINE Channel 需取得電子郵件 scope 權限。三家控制台都要登記實際開發與 production origin 或 callback URL。取得明確部署指示前不得部署；取得資料庫套用指示前不得將 `0020` 至 `0022` 套用到持久資料庫。

## 不得回退或覆寫

- 不得把快速註冊改成帳號綁定、電子郵件自動合併，或要求供應商內容權限。
- 不得清除或以 fixture 覆寫既有帳號、角色、學習者、練習及作答紀錄。
- `app/account/page.tsx` 與 `app/account/account.module.css` 同時包含既有登入頁調整；後續修改需保留非本功能的既有內容。
