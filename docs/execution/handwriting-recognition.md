# 手寫辨識交接

- Repository：`/Users/jean/Documents/GitHub/lerniqa`
- Branch：`main`
- 最後 production code commit：`622d4b7`
- 推送狀態：已推送至 `origin/main`

## 已完成

- 撤回無法穩定處理既有圖片資料的 PencilKit 路徑，恢復影像 OCR 主流程。
- PP-OCRv6 同批辨識原圖與單字強化圖；強化圖會加粗細筆畫並補足水平留白。
- 兩個候選一致時採最高信心；候選衝突時只接受信心高且差距明顯者，其餘轉人工判讀。
- 繁體中文、英文與數字沿用同一條辨識流程，不將題目或標準答案傳給辨識器。

## 驗證證據

- `node /tmp/lerniqa-accept-four.mjs`：`謀、儒、省、覆` 四題全部精確命中；暖機後單題 179–203 ms。
- `npm run handwriting:smoke:hybrid`：通過；可讀樣本 3/4 精確，空白或模糊樣本 2/2 保持未辨識，刻意歧義樣本轉人工判讀。
- `npm run test:handwriting-ai`：20/20 通過。
- `npm run test:handwriting`：13/13 通過。
- `npm run lint`：exit code 0。
- `npm run build`：exit code 0；只有既有 `@keel-design/ui` 文件預覽 optional dependency 警告。
- `python -m py_compile scripts/handwriting-paddle-worker.py` 與 `pip check`：通過。

## 審查狀態

- 候選數量、信心範圍與資料結構均驗證；格式異常會失敗關閉。
- 既有輸入大小、子程序輸出上限與逾時保護仍保留。
- 不修改已保存的原始手寫圖片；前處理只在記憶體中執行。
- 四個真實樣本通過只證明這四筆資料，不能視為所有字形的辨識保證。

## 工作目錄與後續

- 工作目錄另有管理後台、題目關聯與教學助理等未提交變更，本次未納入、未覆寫。
- 下一步應持續蒐集經人工確認的失敗樣本，擴充固定驗收資料集，再依字體尺寸與裝置來源調整前處理參數。
- 不得把私人手寫圖片提交到 Git，也不得移除低信心人工判讀與不傳送標準答案的限制。
