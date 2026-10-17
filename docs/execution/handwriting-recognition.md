# 手寫辨識交接

- Repository：`/Users/jean/Documents/GitHub/lerniqa`
- Branch：`main`
- 最後手寫辨識 production code commit：`430eac5`
- 推送狀態：已推送至 `origin/main`

## 已完成

- 撤回無法穩定處理既有圖片資料的 PencilKit 路徑，恢復影像 OCR 主流程。
- PP-OCRv6 同批辨識原圖與單字強化圖；強化圖會加粗細筆畫並補足水平留白。
- 兩個候選一致時採最高信心；候選衝突時只接受信心高且差距明顯者，其餘轉人工判讀。
- 繁體中文、英文與數字沿用同一條辨識流程，不將題目或標準答案傳給辨識器。
- 題庫正式細題型決定辨識方式：「寫出國字、注音」使用單一字元模式；「注釋」使用保留字距與順序的單行多字模式。
- 前端顯示唯讀文字答案欄位；手寫辨識成功後自動填入。送出端重新由資料庫判定模式，未設定辨識方式的細題型不交給 worker。

## 驗證證據

- `node /tmp/lerniqa-accept-four.mjs`：`謀、儒、省、覆` 四題全部精確命中；暖機後單題 179–203 ms。
- `npm run handwriting:smoke:hybrid`：通過；可讀樣本 3/4 精確，空白或模糊樣本 2/2 保持未辨識，刻意歧義樣本轉人工判讀。
- 已保存的真實註釋筆跡以單行模式辨識為 `因為`；暖機後約 720 ms，信心 0.9916。私人圖片留在 `local-data`，未提交至 Git。
- `npm run test:handwriting-ai`：22/22 通過。
- `npm run test:handwriting`：13/13 通過。
- `npm run lint`：exit code 0。
- `npm run build`：exit code 0；只有既有 `@keel-design/ui` 文件預覽 optional dependency 警告。
- `python -m py_compile scripts/handwriting-paddle-worker.py` 與 `pip check`：通過。
- `node scripts/process-handwriting-analysis.mjs --once --dry-run`：通過，未寫入持久資料。

## 審查狀態

- 候選數量、信心範圍與資料結構均驗證；格式異常會失敗關閉。
- 既有輸入大小、子程序輸出上限與逾時保護仍保留。
- 不修改已保存的原始手寫圖片；前處理只在記憶體中執行。
- 四個真實樣本通過只證明這四筆資料，不能視為所有字形的辨識保證。
- 瀏覽器端登入狀態已失效，因此本輪沒有完成登入後的註釋作答畫面操作驗證；程式、API、真實圖片辨識與 build 已完成驗證。

## 工作目錄與後續

- 工作目錄可能有其他功能的獨立變更；手寫辨識不得覆寫或回退那些範圍。
- 下一步先使用有效登入 session 完成桌面、平板與手機的註釋題實際作答驗證，再持續蒐集經人工確認的多字、連筆與跨裝置失敗樣本。
- 不得把私人手寫圖片提交到 Git，也不得移除低信心人工判讀與不傳送標準答案的限制。
