# 手寫辨識流程驗收

## 範圍

本次驗收涵蓋 `/practice` 手寫題的送出前辨識流程。圖片先由 PP-OCRv5 與 Apple Vision 在本機辨識；兩者文字相同時直接採用，沒有一致結果時才呼叫固定 digest 的 `qwen3.8:27b`。可靠來源仍有衝突時不填入文字，保留給人工判別。辨識器不接收題幹、參考答案、解析或評分規則。

## 結果

- `npm run handwriting:setup` 成功建立 Python 3.12 隔離環境，PaddlePaddle 自我檢查通過，`PP-OCRv5_server_rec` 已預載。
- `npm run handwriting:smoke:hybrid` 通過。四張可讀合成筆跡有三張逐字相符；外形相近的 `4` 因 PP-OCRv5、Apple Vision 與視覺模型結果衝突而保持待人工判別。空白與模糊圖均未產生辨識文字。
- 兩個 OCR 一致的合成樣本約在 1.4 至 1.5 秒完成。相同 PNG 再次辨識直接使用十分鐘記憶體快取，本機量測為 0 毫秒。需要 27B 模型複核的衝突樣本約 15 秒完成並回到人工判別。
- `npm run test:handwriting-ai` 通過 17 項，`npm run test:handwriting` 通過 13 項。共識、衝突、手寫保存、權限、冪等重送與重新書寫清除辨識結果都有測試。
- `npm run test:local-practice` 通過隔離 PostgreSQL、Next.js、資料庫重啟與作答持久性驗證，沒有接觸持久資料庫。
- `npm run lint`、`npm test`、`npm run build` 與 `git diff --check` 通過。build 只有 Keel 文件預覽元件既有的選用套件缺少警告。
- `pip check` 沒有發現 Python 依賴衝突。`npm audit --omit=dev` 回報 Next.js 內含的 PostCSS 公告；本功能沒有接收或處理使用者提供的 CSS，因此沒有新增可利用路徑。修正版本需要升級至 Next.js 16，應另行安排框架升級與回歸驗證。
- `https://linmacbook-pro.tailc132cc.ts.net:8443/practice` 回傳 HTTP 200。

## 尚待驗證

現有合成樣本只有數字與英文字母。Apple Vision runtime 支援 `zh-Hant`，PP-OCRv5 也使用支援繁體中文的 recognition model，但這不等於真實學生繁中手寫品質已通過。正式調整門檻前，仍需使用取得同意且去識別化的真實筆跡，依年級、字數與常見誤字建立測試集。
