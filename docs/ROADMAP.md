# 開發路線圖

正式匯入的題目、帳號、角色、學習者、練習與作答紀錄屬持久資料，不得用 seed、reset、fixture 還原或測試 cleanup 覆蓋。合成 fixture 只用於明確隔離的測試資料庫；資料量少不會改變持久資料的性質。

Lerniqa 是持續開發中的多科目正式產品。892 題正式發布內容接入既有 `/practice` 的「國語 → 國一 → 翰林版 → 第一冊 → 第四至第六課／語文常識（二）」，不另建單科替代流程。

## P0 專案啟動（本次）
- [x] 建立 Next.js / TypeScript / Tailwind 基礎
- [x] 建立首頁與多科目練習介面
- [x] 建立產品規格與任務規劃
- [ ] 完成 GitHub Actions CI、正式測試環境

## P1 資料與練習
- [x] `/account` 本機電子郵件密碼註冊、登入、登出與 session
- [x] 註冊與密碼重設共用新密碼驗證規則：至少 8 字元、不強制字元種類混用、阻擋常見弱密碼；既有密碼不批次變更
- [x] 帳號郵件樣板、Synology MailPlus adapter、Nodemailer transport 與不連網測試
- [x] 本機信箱驗證 challenge、寄送／確認 API、帳號介面與注入式 mock 驗證
- [x] 本機密碼重設 challenge、寄送／確認 API 與介面程式；不改動 `verified_at`，成功後撤銷全帳號 session，不連網針對性測試已通過
- [x] 本機角色 PIN 設定／重設 challenge、寄送／確認 API 與介面程式；要求已驗證電子郵件與有效目標角色，成功後只撤銷目標角色 session，不連網針對性測試已通過
- [x] 整合 `0012` 的復原 challenge identity binding，並完成空庫、既有資料升級、migration 往返與帳號復原 DB E2E
- [ ] 另建不屬於 `0012` 的 SMTP outbox／等時回應，消除同步寄信對已知／未知帳號造成的 timing enumeration
- [x] 合成資料驗證的私有 tailnet HTTPS 入口
- [x] Google、LINE 與 Facebook 快速註冊程式、短效 PostgreSQL 狀態、社群身份重登入與既有電子郵件衝突保護
- [ ] Google Cloud Web Client、LINE Login Channel、Meta App 設定與三家真實帳號往返驗收
- [ ] 實際 SMTP 執行環境設定、真實寄送驗證、公開／production HTTPS、登入 rate limit 及帳號綁定
- [ ] 讓角色 PIN 參與成人角色切換；完成前仍使用帳號密碼重新確認
- [ ] 後端預設系統管理員、MFA 與 Secret 輪替
- [ ] 系統管理員授權、稽核紀錄與帳號管理介面
- [x] `/system-settings` 以 PostgreSQL 管理帳號身分、有效角色與可存取學習者；`accountRole` 是主要身分，持有有效 parent／tutor 授權的 session 切到相應 `activeRole` 後可管理學習者，即使 `accountRole=learner`
- [x] `/settings` 獨立管理目前學習者；寫入只允許目前 learner 且有效 `learner_access.can_manage_settings=true`
- [x] 驗證目前 session 只能切換至既有有效角色；不得藉此新增或授予角色
- [x] 分開一般帳號本身的 `accountRole`、session 的目前角色／學習者與 `system_admin` 授權；每個帳號只保留一位名稱同步的 self learner
- [x] session 切到受管學習者的 learner mode 時隱藏 `/system-settings`，帳號層 API 回傳 `403`；只有 self learner 能力的帳號仍可查看自己的系統設定
- [x] 當頁登入狀態遺失或失效時清除帳號範圍狀態並導回帳號頁，不回退到 fixture 或預設測試身分
- [x] 登出或 session 到期時同步清除其他已開分頁的帳號工作區；角色與目前學習者改變時重新載入其他分頁，頁面取得焦點或恢復可見時重新驗證 `auth/me`
- [ ] 單一帳號管理多位學習者的完整生命週期與跨頁資料隔離
- [ ] 學習者跨帳號分享、權限檢查與成果共用
- [x] 學習本跨帳號分享：一次性網址、登入後選擇有權限的學習者領取、撤銷、版本同步、分叉、站內通知與稽核；不授予成果查看權
- [ ] 家長／學習者／家教／審核者角色
- [ ] 將成果統計併入總覽，移除獨立成果導覽，並把舊 `/results` 轉址到總覽
- [x] PostgreSQL schema 與 `0001` 至 `0025` 共二十五個原生 SQL migration；隔離資料庫往返驗證已通過；持久本機資料庫仍須依部署節點執行只向前 migration
- [x] 相同／相近題的可審核模板與關鍵字 schema、正式關聯推薦層級、來源證據及錯題頁提示
- [ ] 對 279 題執行關聯分析、人工審核並寫入已確認模板與關鍵字關聯
- [x] `0009` 限制 published／superseded 的自動判分小題必須有可用參考答案，升級前發現缺漏就停止，不補造資料
- [x] `0010` 加入 `users.account_role`、self learner 唯一性、名稱／設定權限一致性與只向前修正
- [x] `0011` 讓 `score` 只保存 session aggregate 與不含答案／逐題判定的冪等收據；既有逐題明細、錯題／相近題佇列與 outbox 會在升級時清除，五張統計表從剩餘非 `score` 明細重建，exclusive 私有作答 asset 會標記刪除並建立 pending 清理工作，共用 asset 與非 `score` 明細保留
- [x] 私有 Unix socket 的持久本機 PostgreSQL 執行環境與只向前 migration 指令
- [x] 既有 `/practice` 接上本機 PostgreSQL 的題庫、session、作答、歷程與錯題流程；`/local-practice` 僅供內部診斷與相容
- [x] 三種答案檢核方式都可建立 PostgreSQL session；`instant` 逐題揭露、`complete` 完成前遮罩、`score` 進行中遮罩且完成後保存可重載的整體統計與不含答案／判定的冪等收據，不保存逐題作答／判定或建立錯題佇列，歷程遵守相同規則
- [x] 重新整理進行中的練習時，以伺服器 session UUID 恢復已送出的進度並暫停；尚未送出的文字與手寫內容不保存
- [x] 歷程缺少安全 revision 快照時只顯示結果、時間與不可安全顯示提示；resume 發現 revision mismatch 時關閉舊 session 並要求建立新練習
- [x] 帳號 API 提供練習所需的年級、學期、偏好、已啟用科目與書籍版本；題庫 API 支援單頁最多 500 題並讀取正式知識點關聯
- [x] 匯入 ownership 與本機練習端到端驗證使用 `/tmp` 私有 PostgreSQL cluster，不接觸持久資料
- [x] 封閉舊 `/bootstrap`、`state`、`reset`、`questions`、`imports` 與 storage-key asset 路徑；HTTP 固定回 `410`
- [ ] ORM／查詢層、正式 repository 與歷史 JSON 搬移
- [x] 年級與學期正式目錄：國小、國中、高中共十二個年級，學期含上下學期；科目與版本維持資料驅動
- [ ] 可新增多筆的考試設定
- [ ] 家教個人題庫
- [x] 學習者與有 `can_create_plans` 權限的照顧者／家教建立「學習本計畫」；學習本可不排時間、可有多筆排程，發布版本後不可變
- [x] 學習本與排程由 `localStorage` 切換至 PostgreSQL；舊本機資料使用預覽、明確確認、冪等收據與原始備份安全搬移
- [ ] 題庫 CRUD、選擇／填充／問答題
- [ ] 系統題目與帳號題目的所有權、版本及異動權限
- [x] 相近題群組、候選、成員與生成來源資料模型及 migration
- [ ] 相近題候選審核、正式關聯與共用查詢 API
- [x] 推薦 API 依已確認模板、相似群組、共同正式關鍵字與共同主題逐層選題並保存來源證據；來源題型與同單元不再產生新推薦，`score` 禁止
- [x] 整合 `0012` 的同題型佇列／session origin 值域
- [x] 建立文字骨架、可變值與正式關鍵字關係的版本化資料模型、pending 分析管線及管理員審核介面
- [ ] 完成 279 題全量關係分析與逐筆人工核准；目前只有一題煙霧測試待審，confirmed 關聯仍為 0
- [ ] 寫入並審核相同／相近題關係資料，保存共同關聯數量與比對證據
- [ ] 完成由近到遠、尚未作答優先及排除最近答對題目的推薦 DB E2E
- [ ] 作答狀態進階篩選、相近題成效與複習排程
- [ ] 複習與相近題 session 將實際選入來源完整寫入 `practice_session_item_origins`
- [x] `instant`／`complete` private 手寫 PNG 格式驗證、冪等儲存、受權讀取與重現程式針對性測試；缺文字答案時保持 pending／manual，已有完整答案時只作為計算過程附件，`score` 禁止
- [ ] 完成 private 手寫 PNG 的完整資料庫 E2E 與瀏覽器驗收
- [ ] 審核者身份設定與答案／手寫內容比對
- [x] 作答統計、隱私政策、管理員稽核與資料刪除 schema
- [ ] 統計 worker、重算工具、管理稽核與資料刪除 API
- [ ] 執行 `asset_object_cleanup_jobs` 的受控 storage worker；確認實際物件刪除後才標記 completed／`object_deleted_at`，不得把 migration 排程當成實體物件已刪除

## P2 題目匯入

- [x] 所有帳號可建立自訂科目，以及科目下的單選／複選分類欄位與選項；目錄、發布與 AI 建議均執行帳號隔離
- [x] 每題可保存不同的自訂分類；加入題庫只要求科目，其他分類可留空，內部題型由作答結構選用
- [x] 本機 AI 從封閉選項清單提出含理由與信心值的分類候選；候選不自動建立、不自動套用，模型不可用時仍可手動分類
- [x] 受權限、可追溯的 PostgreSQL 個人草稿與正式發布 API；草稿不需分類，可編輯並以正式練習元件預覽，發布後才計入題目額度
- [x] 手動、JPG／PNG／WebP／PDF、題目圖片、JSON v2 草稿與多題 AI 交換格式（相容 v1 草稿載入）；格式匯入共用題目範本，圖片採上傳配對或原稿比例裁切；掃描流程接入透視校正、影像模式、彩色手寫去除預覽與本機 OCR
- [x] 新增題目所有圖片與檔案入口共用來源元件；系統選檔與拍照分離，裝置端雲端文件提供者可直接使用，Google Picker 只在完整設定時顯示；Drive API 與真實帳號往返仍需環境憑證驗收
- [ ] AI 拆題、完整文件版面模型、曲面展平固定模型、即時相機品質提示與市場基準盲測
- [ ] 安全檔案上傳與物件儲存
- [ ] 圖片／掃描 PDF OCR 與逐題切分
- [ ] 人工校對、答案核對、頁碼與來源追溯
- [x] 本機舊版 Word 題庫安全匯入：VBA 原檔隔離，只接受通過檢查的 DOCX 衍生檔
- [x] 已發布系統題的補全 CLI、dry-run／checkpoint 與針對性測試；建議維度為細題型、主要知識點與解題方法
- [x] 整合 `0012` 的 enrichment run／pending suggestion schema
- [ ] 用抽樣完成品質門檻與人工核准；279 題目前尚未 apply

## P3 智慧補強
- [ ] 知識點分類與相似題檢索
- [ ] 相近題關聯分析、人工審核與版本管理
- [ ] AI 類題生成、數學答案驗算／品質審核
- [x] 本地 AI 手寫辨識：國字題使用單一字元模式，注釋題使用單行多字模式；不解題、不比對參考答案、不判斷正誤
- [ ] 真實筆跡品質驗收與 AI 建議人工修正介面
- [x] 整合 `0012` 的手寫 AI job／run sidecar schema
- [x] 建立受控 worker 與目前品質驗收；模型只提供建議，不得直接改判、寫錯題佇列或統計
- [ ] 考試範圍自動組卷、成效分析

## P4 正式上線
- [ ] RWD 與平板手寫作答體驗驗收
- [ ] 測試、監控、備份、權限、法遵與成本控制

決策原則：避免過早綁定特定雲端供應商；所有 AI 與 OCR 服務經由可替換的 adapter。

勾選 schema／migration 代表程式庫已具備對應結構與限制，不代表同列的全部表單、production 權限或部署已完成。`/account`、`/system-settings`、`/settings` 與 `/practice` 的正式主流程已改用本機 PostgreSQL，不保留瀏覽器學習者快照，也不在登入失效時回退到 fixture。學習本、版本、分享、排程、通知與稽核已由 PostgreSQL 保存；瀏覽器只保留非識別性的 UI 設定、尚未切換資料庫的收藏，以及安全搬移後的舊學習本原始備份。目前學習者的顯示名稱、年級、學期與各科書籍版本可寫入 PostgreSQL；就學狀態、學校、代表圖片、練習偏好與考試仍待補齊正式寫入 API。本機信箱驗證、密碼重設及角色 PIN 設定／重設的 challenge、API 與介面已完成；三家社群快速註冊程式已完成，但各供應商 App 與真實帳號往返尚未驗收。真實匯入、SMTP 真實投遞、帳號綁定、角色 PIN 切換、正式相近題關聯與查詢、`practice_session_item_origins` 完整來源、production 權限與部署仍未完成；正式切換條件見 `docs/database-completion-matrix.md`。
