# 手寫辨識流程驗收

## 範圍

本次驗收涵蓋 `/practice` 手寫題的送出前辨識流程。學習者進入手寫題後，網站會在背景載入 PP-OCRv5。圖片先由常駐的 PP-OCRv5 與 Apple Vision 在本機辨識；兩者文字相同時直接採用，沒有可靠候選時直接保留給人工判別。兩者有可靠候選但無法達成一致時，才在互動式辨識剩餘的 4.5 秒時限內呼叫固定 digest 的 `qwen3.8:27b`；逾時或本機 AI 無法使用時同樣交由人工判別。正式送出後的背景分析不受互動時限限制。辨識器不接收題幹、參考答案、解析或評分規則。

## 結果

- `npm run handwriting:setup` 成功建立 Python 3.12 隔離環境，PaddlePaddle 自我檢查通過，`PP-OCRv5_server_rec` 已預載。
- `npm run handwriting:smoke:hybrid` 通過。四張可讀合成筆跡有三張逐字相符；空白與模糊圖均未產生辨識文字。
- PP-OCRv5 第一次載入約需 6.5 秒，進入手寫題時會在背景完成。暖機後，兩個 OCR 一致的合成樣本約在 300 毫秒內完成，不會呼叫 27B 模型。互動式辨識整體時限為 4.5 秒；需要模型複核但無法及時完成的題目會停止等待並交由人工判別，畫面不再等待約 15 秒。
- 2026-10-17 逐張互動路徑量測中，六張合成樣本最慢為 2,089 毫秒，其餘為 80 至 121 毫秒；另一個新 Node.js 程序首次辨識為 1,318 毫秒，均低於 5 秒目標。這是目前開發機上的合成樣本結果，並不代表不同硬體與真實筆跡都有相同耗時。
- Apple Vision 的 `.accurate` 模式在同一批裁切樣本沒有產生文字，首次呼叫為 12,342 毫秒，因此保留 `.fast`。將失敗樣本改成裁切圖片交給 27B 模型仍辨識為 `A`，且耗時 15,519 毫秒，沒有納入正式流程。
- 常駐 PP-OCRv5 在五分鐘沒有工作後自動關閉，避免網站閒置時持續占用約 0.8 GB 記憶體。下一次進入手寫題時會重新暖機。
- `npm run test:handwriting-ai` 通過 18 項，`npm run test:handwriting` 通過 13 項。共識、衝突、互動模型時限、手寫保存、權限、冪等重送與重新書寫清除辨識結果都有測試。
- `npm run test:local-practice` 本輪在隔離資料庫執行 `initdb` 時受到 macOS 共享記憶體上限阻擋，尚未進入資料庫測試，也沒有接觸持久資料庫。本次修改沒有變更資料庫 schema 或作答儲存流程。
- `npm run lint`、`npm test`、`npm run build` 與 `git diff --check` 通過。build 只有 Keel 文件預覽元件既有的選用套件缺少警告。
- `pip check` 沒有發現 Python 依賴衝突。`npm audit --omit=dev` 回報 Next.js 內含的 PostCSS 公告；本功能沒有接收或處理使用者提供的 CSS，因此沒有新增可利用路徑。修正版本需要升級至 Next.js 16，應另行安排框架升級與回歸驗證。
- `https://linmacbook-pro.tailc132cc.ts.net:8443/practice` 回傳 HTTP 200。

## 尚待驗證

現有合成樣本只有數字與英文字母。Apple Vision runtime 支援 `zh-Hant`，PP-OCRv5 也使用支援繁體中文的 recognition model，但這不等於真實學生繁中手寫品質已通過。正式調整門檻前，仍需使用取得同意且去識別化的真實筆跡，依年級、字數與常見誤字建立測試集。
