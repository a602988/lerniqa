# 手寫辨識流程驗收

## 範圍

本次驗收涵蓋 `/practice` 手寫題的送出前辨識流程。學習者進入手寫題後，網站會在背景載入 PP-OCRv6。裁切後的圖片會以原始筆畫及加粗單字版在同一批次辨識；兩個版本一致時採用較高信心，結果衝突時只接受信心至少 0.9 且領先至少 0.05 的候選，再與 Apple Vision 交叉檢查。PP-OCRv6 對純漢字輸出達到 0.85 信心時可直接採用；英文與數字仍要求兩個辨識器一致。沒有可靠候選時保留給人工判別；有可靠候選但無法採用時，才在互動式辨識剩餘的 4.5 秒內呼叫固定 digest 的 `qwen3.8:27b`。逾時或本機 AI 無法使用時同樣交由人工判別。正式送出後的背景分析不受互動時限限制。辨識器不接收題幹、參考答案、解析或評分規則。

## 結果

- `npm run handwriting:setup` 成功建立 Python 3.12 隔離環境，PaddlePaddle 自我檢查通過，`PP-OCRv6_medium_rec` 已預載。
- `npm run handwriting:smoke:hybrid` 通過。四張可讀合成筆跡有三張逐字相符；空白與模糊圖均未產生辨識文字。
- 四張已保存的繁體中文真實筆跡逐字相符：`謀` 458 毫秒、`儒` 430 毫秒、`省` 422 毫秒、`覆` 469 毫秒。信心依序為 0.9988、0.9920、0.9998、0.9385。辨識器冷啟動為 3,947 毫秒，進入手寫題時既有暖機請求會先載入模型。這組結果只代表目前四張樣本與目前開發機。
- PP-OCRv6 會在進入手寫題時於背景載入。暖機後，純漢字的高信心結果與兩個 OCR 一致的英數樣本不會呼叫 27B 模型。互動式辨識整體時限為 4.5 秒；需要模型複核但無法及時完成的題目會停止等待並交由人工判別。
- 2026-10-17 使用四種繁體中文字型建立「雖」的本機對照樣本：PP-OCRv6 四張皆正確，信心為 0.908 至 0.999，單張暖機辨識為 36 至 45 毫秒。PP-OCRv5 雖然四張也輸出正確文字，其中兩張信心只有 0.317 與 0.719；Apple Vision 沒有正確結果，27B 模型四張全部誤判且耗時 4,391 至 5,507 毫秒。這批樣本用於選擇引擎，不代表真實學生筆跡已通過。
- 2026-10-17 逐張互動路徑量測中，六張合成樣本最慢為 2,089 毫秒，其餘為 80 至 121 毫秒；另一個新 Node.js 程序首次辨識為 1,318 毫秒，均低於 5 秒目標。這是目前開發機上的合成樣本結果，並不代表不同硬體與真實筆跡都有相同耗時。
- Apple Vision 的 `.accurate` 模式在同一批裁切樣本沒有產生文字，首次呼叫為 12,342 毫秒，因此保留 `.fast`。將失敗樣本改成裁切圖片交給 27B 模型仍辨識為 `A`，且耗時 15,519 毫秒，沒有納入正式流程。
- 常駐 PP-OCRv6 在五分鐘沒有工作後自動關閉，避免網站閒置時持續占用模型記憶體。下一次進入手寫題時會重新暖機。
- `npm run test:handwriting-ai` 通過 20 項，`npm run test:handwriting` 通過 13 項。共識、衝突、互動模型時限、手寫保存、權限、冪等重送與重新書寫清除辨識結果都有測試。
- `npm run test:local-practice` 本輪在隔離資料庫執行 `initdb` 時受到 macOS 共享記憶體上限阻擋，尚未進入資料庫測試，也沒有接觸持久資料庫。本次修改沒有變更資料庫 schema 或作答儲存流程。
- `npm run lint`、`npm test`、`npm run build` 與 `git diff --check` 通過。build 只有 Keel 文件預覽元件既有的選用套件缺少警告。
- `pip check` 沒有發現 Python 依賴衝突。`npm audit --omit=dev` 回報 Next.js 內含的 PostCSS 公告；本功能沒有接收或處理使用者提供的 CSS，因此沒有新增可利用路徑。修正版本需要升級至 Next.js 16，應另行安排框架升級與回歸驗證。
- `https://linmacbook-pro.tailc132cc.ts.net:8443/practice` 回傳 HTTP 200。

## 尚待驗證

現有正式合成品質門檻涵蓋英文、數字、空白與模糊筆跡，另有四張繁體中文真實筆跡通過。樣本數仍不足以代表不同年級、書寫工具、連筆方式與多字答案；後續仍需在取得同意並去識別化後，依這些差異擴充測試集。`qwen3.8:27b` 的冷啟動與推論時間不適合當主要互動辨識器，因此只保留為時限內的補充來源，超時即交給人工判別。

## 技術依據

- [Google ML Kit Digital Ink Recognition](https://developers.google.com/ml-kit/vision/digital-ink-recognition) 說明觸控筆順辨識使用含座標與時間的 `Ink` 筆畫資料，可離線辨識 300 多種語言；目前官方只提供 Android 與 iOS SDK，無法直接接入這個 Next.js 網頁執行環境。
- [ML Kit 支援模型清單](https://developers.google.com/ml-kit/vision/digital-ink-recognition/base-models) 包含台灣漢字 `zh-Hani-TW`，也支援拉丁字母與數字所屬模型。
- [PaddleOCR PP-OCRv6 說明](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/algorithm/PP-OCRv6/PP-OCRv6.md) 說明 medium／small 模型支援繁體中文、英文及其他 46 種拉丁語系語言；目前專案使用 `PP-OCRv6_medium_rec`，並以本機真實筆跡驗證實際結果。
- [Apple Vision 文字辨識文件](https://developer.apple.com/documentation/vision/recognizing-text-in-images) 說明 `VNRecognizeTextRequest` 屬於影像 OCR，並指出中文不支援 language correction 與 `customWords`，因此只保留為獨立交叉檢查來源。
