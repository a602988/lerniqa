# 手寫辨識流程驗收

## 範圍

本次驗收涵蓋 `/practice` 手寫題的送出前辨識流程。學習者進入手寫題後，網站會在背景載入 PP-OCRv5。圖片先由常駐的 PP-OCRv5 與 Apple Vision 在本機辨識；兩者文字相同時直接採用，沒有一致結果時才呼叫固定 digest 的 `qwen3.8:27b`。快速辨識器與模型結果衝突時以模型為準；模型也無法確認時才保留給人工判別。辨識器不接收題幹、參考答案、解析或評分規則。

## 結果

- `npm run handwriting:setup` 成功建立 Python 3.12 隔離環境，PaddlePaddle 自我檢查通過，`PP-OCRv5_server_rec` 已預載。
- `npm run handwriting:smoke:hybrid` 通過。四張可讀合成筆跡有三張逐字相符；空白與模糊圖均未產生辨識文字。
- PP-OCRv5 第一次載入約需 6.5 秒，進入手寫題時會在背景完成。暖機後，兩個 OCR 一致的合成樣本約在 289 毫秒完成，不會呼叫 27B 模型。需要模型複核的題目仍約需 15 秒；這類題目無法只靠調整呼叫流程縮短到即時回應。
- 常駐 PP-OCRv5 在五分鐘沒有工作後自動關閉，避免網站閒置時持續占用約 0.8 GB 記憶體。下一次進入手寫題時會重新暖機。
- `npm run test:handwriting-ai` 通過 17 項，`npm run test:handwriting` 通過 13 項。共識、衝突、手寫保存、權限、冪等重送與重新書寫清除辨識結果都有測試。
- `npm run test:local-practice` 本輪在隔離資料庫執行 `initdb` 時受到 macOS 共享記憶體上限阻擋，尚未進入資料庫測試，也沒有接觸持久資料庫。本次修改沒有變更資料庫 schema 或作答儲存流程。
- `npm run lint`、`npm test`、`npm run build` 與 `git diff --check` 通過。build 只有 Keel 文件預覽元件既有的選用套件缺少警告。
- `pip check` 沒有發現 Python 依賴衝突。`npm audit --omit=dev` 回報 Next.js 內含的 PostCSS 公告；本功能沒有接收或處理使用者提供的 CSS，因此沒有新增可利用路徑。修正版本需要升級至 Next.js 16，應另行安排框架升級與回歸驗證。
- `https://linmacbook-pro.tailc132cc.ts.net:8443/practice` 回傳 HTTP 200。

## 尚待驗證

現有合成樣本只有數字與英文字母。Apple Vision runtime 支援 `zh-Hant`，PP-OCRv5 也使用支援繁體中文的 recognition model，但這不等於真實學生繁中手寫品質已通過。正式調整門檻前，仍需使用取得同意且去識別化的真實筆跡，依年級、字數與常見誤字建立測試集。
