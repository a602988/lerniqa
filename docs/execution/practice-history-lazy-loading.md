# 練習歷史按需載入交接

## 範圍

- Repository：`/Users/jean/Documents/GitHub/lerniqa`
- Branch：`main`
- 起始 commit：`2c1715e`
- 本工作區有其他尚未提交的修改，不得回退或覆寫。

## 已完成

- 登入 bootstrap 只讀取 `/api/v1/auth/me` 與 `/api/v1/local-practice/questions`。
- 完整作答紀錄、練習場次與錯題佇列改由總覽或錯題排行榜在工作區顯示後讀取。
- 歷史資料讀取中或失敗時顯示狀態，不把尚未載入顯示為零筆紀錄。
- 完成一輪練習後會重新取得完整歷史，更新成果及錯題資料。

## 驗證

- `node --test --test-name-pattern='bootstrap loads the accessible catalog without preloading practice history' tests/practice-catalog-integration.test.mjs`：先確認舊實作失敗，再於修正後通過。
- `node --test tests/practice-catalog-integration.test.mjs`：29 項通過。
- `npm run lint`：通過。
- `npm run build`：通過；runtime guardrails 31 項通過。build 仍有 `@keel-design/ui` 文件預覽選用套件未安裝的既有警告。
- `node --test tests/runtime-guardrails.test.mjs`：6 項通過。
- `npm start`：以 `.next-build` 啟動，監聽 `127.0.0.1:3500`。
- Tailnet production 路徑：`/account` 0.053 秒；`/overview` 0.019 秒，第二次 0.015 秒。
- Chrome 實際登入狀態：總覽先顯示工作區，隨後顯示 1 筆持久化練習紀錄與錯題統計。

## 目前狀態

production 服務已由 `npm start` 常駐執行。尚未提交或推送；本工作區的其他修改仍保留原狀。
