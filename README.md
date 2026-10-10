# Lerniqa｜學睿卡

給國小／國中學生的智慧題目練習與錯題複習平台。

## 目前已建立
- Next.js 15 + React 19 + TypeScript + Tailwind CSS 專案
- 可操作的示範題庫（小四、小五；數學、國語、英文）
- 年級、科目、考試次別篩選（考試次別目前為展示設定）
- 作答、解析、錯題篩選與重新練習
- 瀏覽器 localStorage 保存最近作答結果
- 照片/PDF 檔案選取介面（尚未 OCR、上傳、儲存）

## 執行
需 Node.js 20+。

```bash
npm install
npm run dev
```

開啟 http://localhost:3000。

## 文件
- [產品規格](docs/PRODUCT_SPEC.md)
- [開發路線圖](docs/ROADMAP.md)

## 下一階段
學生／家長帳號與權限、題庫資料庫、考試單元範圍、圖片/PDF OCR 校對、知識點分析、相似題生成、報表。

> 目前是前端示範版，不包含正式 AI、OCR、雲端資料庫或正式部署。請勿輸入真實學生個資。
