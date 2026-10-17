# Lerniqa 管理後台程式碼共用審查

## 審查摘要

- 呼叫專案：`/Users/jean/Documents/Codex/2026-10-16/task/lerniqa-admin`，分支 `codex/lerniqa-admin-20261016`，審查時 HEAD `a52ee0b17be13c538e1ac5d62144026c3f85baa1`，共同基準 `6ef62eb139d35693e31ed78ee966f2d1f37a61f9`。
- 審查範圍：目前管理後台的 `/admin` 頁面、views、route handlers、輸入與 view-model 契約、題庫／訂閱管理寫入流程、repository 與共用管理元件。
- 搜尋範圍：Lerniqa 全 repository；另唯讀比對 `/Users/jean/Documents/GitHub/keel-design` 的公開 package exports，以及 `/Users/jean/Documents/GitHub/erp_2026` 的管理頁組合方式。ERP 的客戶資料、fixture、secrets、`.env`、憑證與權限值不在搜尋或搬移範圍。
- 既有變更：建立本報告前 worktree 有 81 筆已修改／未追蹤項目，且其他工作仍在同一 worktree 進行。本審查只新增這份報告，沒有改程式、schema 或測試，也沒有執行 formatter、測試、資料庫或 server。
- 結論：管理後台對 KEEL 的重用是真實的：`AppShell`、`DataTable`、`Pagination`、`Button`、`Badge`、`Card`、`Alert`、`Drawer`、`Dialog` 與表單元件均從 `@keel-design/ui` package root 使用，沒有 deep import、假冒同名元件或另建一套設計系統。共確認 11 項可收斂問題：高 1 項、中 6 項、低 4 項；主要風險集中在管理讀取授權邊界、寫入 delivery／冪等證據，以及同一訂閱契約在多層平行實作。

## 發現項目

### CR-01 集中管理讀取的 snapshot 與授權邊界

- 優先程度：高
- 信心：高
- 目標實作：`app/lib/admin/admin-account-handler.ts` 的兩個 `loadAdminAccount*Request`、`app/lib/admin/question-read-handler.ts` 的兩個 `loadAdminQuestion*Request`、`app/lib/admin/admin-report-handler.ts` 的 `loadAdminReportRequest`，以及 audit、subscription list/detail、feature definitions 與 asset metadata GET routes。
- 既有或候選實作：`app/lib/admin/admin-server.ts` 已有 `withAdminReadOnlySnapshot` 與 `requireAdminReadContext`，但每個 handler／route 仍自行組合兩者；可在同一模組增加一個只負責外層邊界的 `withAuthorizedAdminRead(request, operation, dependencies?)`（名稱可調整）。
- 重疊行為：上述入口都必須先進入 read-only repeatable-read snapshot、在同一 runner 驗證 system admin，再解析受保護的 path/query，最後才呼叫 repository。這個順序同時是授權 oracle 防護與資料一致性契約，目前由至少八個 callsites 手動維持。
- 影響：現況多數 callsite 是正確的，但新增端點只要漏掉其中一步、把解析提前，或讓授權與讀取使用不同 runner，就會形成資料範圍或授權時序缺口。各 handler 也重複宣告 `withSnapshot`／`authorize` dependency shape 與相同 callback 骨架。
- 建議：只抽出 snapshot＋授權＋context 的穩定外層，不建立萬用 endpoint factory。帳號、題庫、報表、訂閱仍保留自己的 params/query parser、loader 與 response shape。Asset handler 只共用 metadata 的授權外層；檔案 I/O 必須繼續等 snapshot commit 後才開始。
- 預計影響範圍：`admin-server.ts`、三個 read handler、audit／subscription GET routes、asset handler dependency wiring，以及 `admin-read-snapshot`、HTTP 與 asset handler tests。
- 驗證方式：逐一驗證未登入／非管理員在任何 path/query validation 前被拒絕；授權與資料查詢共用同一 runner；snapshot 失敗不執行 loader；asset 檔案 I/O 在 transaction 結束後才開始；執行管理端 read-handler、HTTP、asset 與 snapshot-order tests。
- 狀態：待確認

### CR-02 共用管理寫入的 client delivery 與重試契約

- 優先程度：中
- 信心：高
- 目標實作：`app/components/admin/views/question-mutation-workflow.tsx` 的 `sendMutation`／`RetryEvidence`、`question-mutation-client.ts` 的 `questionMutationRetryIdentity`；`subscription-catalog-actions.tsx` 的 `mutateCatalog`／`CatalogMutationDialog`、`subscription-catalog-client.ts` 的 `resolveCatalogMutationAttempt`。
- 既有或候選實作：建立 client-safe 的共同 admin mutation transport，集中 method＋URL＋serialized body signature、UUID idempotency key、CSRF／content-type headers、安全錯誤 fallback、request ID 呈現與成功後清除 retry evidence。Domain workflow 只保留表單、Dialog 與刷新行為。
- 重疊行為：兩套 client 都序列化 body、用 operation/target/body 決定是否重用冪等鍵、送出 same-origin credentials、`x-lerniqa-csrf` 與 `idempotency-key`，失敗保留 key、成功才清除。題庫版本要求 2xx response 具有 `data` 並顯示 `error.requestId`；訂閱版本則接受任意 `response.ok` 且忽略 request ID，已出現同一協定的行為分歧。
- 影響：新增 admin mutation 容易複製第三套 transport；malformed 2xx、錯誤 correlation ID、method 是否納入 retry identity 等安全與復原行為會依畫面不同。現有兩份測試也分別固定了相似但不相同的演算法。
- 建議：共用一個 typed envelope fetcher 與一個 retry-attempt resolver；signature 必須含 method、endpoint 與 exact serialized body。Client-safe header 常數應置於不含 `server-only`／PostgreSQL import 的小模組，讓 server security 與 client transport 使用同一協定字串。不要與一般使用者的 practice API client 合併，後者有不同的 session-expiry broadcast 與非管理端冪等契約。
- 預計影響範圍：上述四個 client 檔案、新的共用 client-safe 模組、題庫 delivery tests、訂閱 catalog tests，以及所有 admin mutation form 呼叫端。
- 驗證方式：驗證 exact retry 重用 key，method／URL／body 任一改變會換 key；network error 與 4xx/5xx 保留 key；成功才清除；malformed 2xx fail closed；安全 fallback 不渲染 raw response；可用 request ID 會顯示；題庫與訂閱的重複提交測試都通過。
- 狀態：待確認

### CR-03 統一 server mutation evidence 與 payload fingerprint

- 優先程度：中
- 信心：高
- 目標實作：`question-mutation-service.ts` 的 `MUTATION_EVIDENCE_UUID_PATTERN`、`assertRequestEvidence`、`fingerprint` 與 `QuestionMutationIdempotency*` aliases；`subscription-service.ts` 的 `EVIDENCE_UUID_PATTERN`、`assertEvidence`、`fingerprint`；`admin-input.ts`／`admin-types.ts` 中 active subscription input 對 `AdminMutationEvidence` 的複製。
- 既有或候選實作：`admin-mutation-security.ts` 已在 HTTP 邊界建立 canonical evidence，`admin-mutation-handler.ts` 已把它放在 `AdminMutationContext.evidence`，`admin-mutation-receipts.ts` 已定義共用 receipt/idempotency types。可在這個既有共用層加入 pure `assertAdminMutationEvidence` 與 `fingerprintAdminMutationPayload`。
- 重疊行為：question 與 subscription services 都以 SHA-256(JSON.stringify(parts)) 建 fingerprint，也各自驗 UUID v4/v7 evidence；HTTP 邊界另驗一次。Question direct-service 驗證回 400，subscription/HTTP 回 422。Subscription parsers 又把同一 evidence 展開到每個 input DTO，但 service 實際使用的是 `context.evidence`。
- 影響：同一冪等證據的格式、錯誤碼與 fingerprint 演算法可能漂移，造成 direct-service、route 與 receipt replay 的結果不一致；把 trusted header evidence 混入 domain payload type 也形成兩個來源。
- 建議：保留 service 的防禦式重驗，但全部呼叫同一 pure helper；fingerprint 也只保留一個 canonical implementation。對 `handleAdminMutation` 管理的正式 routes，以 `AdminMutationContext.evidence` 為唯一證據來源，active subscription input 不再繼承或攜帶 evidence；刪除 question 對共用 receipt types 的空 alias／未使用 receipt interface。不要把 question 與 subscription 的 lock、狀態機或 audit payload 合成 generic mutation service。
- 預計影響範圍：mutation security/handler/receipts、兩個 domain services、active subscription input types/parsers、route specs 與 question/subscription/receipt tests。
- 驗證方式：route 與 direct-service 對大小寫、錯誤 UUID version、key reuse/different payload 的結果一致；既有 operation fingerprints 保持不變以免破壞 replay；input JSON 不能指定 evidence；所有 mutation receipt、question mutation 與 subscription catalog tests 通過。
- 狀態：待確認

### CR-04 移除被正式 delivery 取代的輸入契約並共用小型 parser primitives

- 優先程度：中
- 信心：高
- 目標實作：`admin-input.ts` 的 `parseSubscriptionFeatureLimitInput`、`parseQuestionDraftInput`、`parseQuestionRevisionMutationInput`；`admin-types.ts` 的同名舊 input types；`question-mutation-input.ts` 內重新實作的 record、UUID、整數與字串 primitives。
- 既有或候選實作：正式 feature-limit route 已使用 `parseSubscriptionFeatureLimitWriteInput`（`featureDefinitionId`＋lock version）；正式題庫 routes 已使用 `parseCreateQuestionDraftInput`、`parseReviewQuestionRevisionInput`、`parsePublishQuestionRevisionInput` 並從 route 綁定 question/revision IDs。`admin-input.ts` 已有 UUID、bounded integer、text 與 enum primitives。
- 重疊行為：舊 feature parser 仍使用 `featureKey` 且沒有 concurrency version；舊 question parsers 從 body 接受 target IDs，也不含正式 `contentPatch`／review contract。三者 production callsite 都是 0，只由舊 unit cases 引用，卻仍透過 `app/lib/admin/index.ts` barrel 對外匯出。另一方面，新的 question parser 為了不同錯誤碼複製了多個基礎驗證函式。
- 影響：測試可能通過已不會被 route 呼叫的契約，未來開發者也可能從 barrel 誤用弱化的舊版本。兩套 parser primitive 對 exact keys、錯誤碼與正規化行為會分開演進。
- 建議：刪除三個舊 parser/type 與只驗它們的 tests；保留正式 route-bound contracts。把真正相同且穩定的 record／UUID／bounded integer／string primitive 抽到 admin server input 共用層，讓呼叫端傳入 domain error code；`contentPatch`、review decision 與 exact required-field 規則仍留在 question domain，避免做成帶大量 flags 的 generic schema builder。
- 預計影響範圍：`admin-input.ts`、`admin-types.ts`、`question-mutation-input.ts`、admin barrel exports、`admin-input.test.ts`、`admin-subscription-catalog.test.ts` 與 question mutation parser tests。
- 驗證方式：以 repo-wide reference scan 確認舊 symbols 為 0；正式 routes 拒絕 body target ID、缺欄位、額外欄位與錯誤 UUID；feature limit 必須綁定 definition ID／lock version；只測正式 parser 契約。
- 狀態：待確認

### CR-05 讓訂閱 list/detail 共用 canonical DTO mapper

- 優先程度：中
- 信心：高
- 目標實作：`subscription-repository.ts` 的 JSON aggregate `parsePrice`／`parseFeatureLimit`，以及 row-based `priceFromRow`／`limitFromRow`。
- 既有或候選實作：四個函式都輸出相同的 `AdminSubscriptionPrice`／`AdminSubscriptionFeatureLimit`。可保留 list 的 JSON aggregate 與 detail 的 row query，但先用薄 adapter 將 camelCase JSON／snake_case PG row 轉成同一 canonical raw shape，再由單一 mapper 驗 enum、數字、日期與 null semantics。
- 重疊行為：price 的 id、plan、currency、amount、interval、status、effective dates、lock/version timestamps，以及 limit 的 definition labels、value type、status、included/unlimited/limit、lock/version timestamps，都在兩條路徑各映射一次。
- 影響：新增欄位、變更日期/null 規則或 enum 時，list 與 detail 可能顯示不同資料；測試需要重複覆蓋兩份相同轉換。
- 建議：只共用同一訂閱 domain 內的 canonical decoder，不合併兩種 SQL query，也不建立跨 account/question/report 的萬用 row mapper。
- 預計影響範圍：`subscription-repository.ts` 的 raw row types、list/detail mappers，以及 repository/list/detail view-model tests。
- 驗證方式：用同一組 price/feature fixtures 經兩個 adapter 後 deep-equal；補齊 invalid enum、負數、null date／limit 與 timestamp cases；list、detail、排序與分頁結果維持不變。
- 狀態：待確認

### CR-06 共用訂閱功能定義與限制的純領域規則

- 優先程度：中
- 信心：高
- 目標實作：`admin-input.ts` 的 `parseSubscriptionFeatureDefinitionFields`／`parseSubscriptionFeatureLimitWriteInput`，以及 `subscription-service.ts` 的 create/update feature definition 與 set feature limit 檢查。
- 既有或候選實作：抽出同一訂閱模組內的 pure 規則，例如 value type＋unit shape，以及 included/unlimited/limit 的基本四態；parser 與 service 鎖定資料後的防禦式重驗都呼叫它們。
- 重疊行為：boolean 不得有 unit、integer 必須有合法 unit，以及 excluded/unlimited/finite limit 的互斥規則目前在 input 與 service 各寫一次；create/update 的 service 內也有幾乎相同區塊，連錯誤文案都已出現差異。
- 影響：表單/route 能接受但 service 拒絕，或 create/update/set 各自採不同規則；改一處容易漏掉其他路徑。依已鎖定 plan/definition status 才能判斷的規則則必須留在 service。
- 建議：只抽沒有 I/O 的 domain invariant，保留 parser 的形狀／正規化責任與 service 的 lock、現況、transition、audit、idempotency 責任。錯誤碼與 client-safe 文案由共用規則固定。
- 預計影響範圍：`admin-input.ts`、`subscription-service.ts`、可能新增的 subscription domain-rules module，以及 input/service/catalog tests。
- 驗證方式：boolean/integer definition、excluded/included/finite/unlimited 的 truth table 在 parser 與 direct-service 得到一致結果；retired definition、active plan 等 lock-time rules 仍只由 service 驗證；create/update/set tests 全通過。
- 狀態：待確認

### CR-07 抽出價格草稿共用欄位組

- 優先程度：中
- 信心：高
- 目標實作：`subscription-catalog-actions.tsx` 的 `PriceCreateAction` 與 `PriceUpdateAction` draft branch。
- 既有或候選實作：同檔已用 `FeatureDefinitionTypeFields` 示範適當的小型 domain component；價格可建立 `PriceTermsFields` 與共用 billing interval options，接受 `prefix` 與 optional initial price。
- 重疊行為：create 與 draft edit 各自渲染 currency、amount minor、billing interval、interval count、effective from/until 六組完全相同的 KEEL `FormField`／`Input`／`NativeSelect` 契約，只差 default values。Active price 的「只設定結束日」分支是不同狀態機，不應合併。
- 影響：欄位限制、label、日期、週期 options 或無障礙 id 變更需要改兩處，容易讓 create/edit contract 漂移。
- 建議：抽出單一價格草稿欄位組與 options constant；body builder 與 active end-date-only branch 保持各自清楚，不做通用 catalog form generator。
- 預計影響範圍：`subscription-catalog-actions.tsx`，必要時一個同目錄小元件，以及訂閱 UI/static contract tests。
- 驗證方式：create 與 draft edit 都保留 required、min/max/step、defaults、unique IDs 與提交 body；active price 只顯示 required end date；桌面與 mobile form layout 不變。
- 狀態：待確認

### CR-08 共用可選排序的表頭元件

- 優先程度：低
- 信心：高
- 目標實作：`accounts-view.tsx`、`audit-view.tsx`、`questions-view.tsx`、`subscription-plans-view.tsx` 各自的本地 `HeaderCell`。
- 既有或候選實作：`view-shared.tsx` 已集中 `sortLinkFor` 與 `ViewSortHeader`，可再匯出一個「有 sort link 就渲染排序表頭，否則一般 `AdminTableHeadCell`」的小元件。
- 重疊行為：四份函式有相同 props、相同 sort lookup、相同 JSX fallback，只有呼叫位置不同。
- 影響：aria-sort、icon、link 或 fallback cell 行為改變時必須同步四份；這是已確認的逐字級 clone。
- 建議：把目前函式原樣提升至 `view-shared.tsx`，不要延伸成欄位 schema 或萬用 table builder。
- 預計影響範圍：四個 views、`view-shared.tsx` 與 table/view tests。
- 驗證方式：sortable 欄位保留正確 href、label 與 `aria-sort`；無對應 sort 的欄位仍是一般 `<th>`；四個桌面表格快照／source contracts 維持。
- 狀態：待確認

### CR-09 讓管理後台拒絕／不可用畫面沿用 KEEL surface 與 action

- 優先程度：低
- 信心：高
- 目標實作：`app/admin/admin-page-auth.tsx` 的 `AdminAccessState`，以及 `app/admin/admin-route.module.css` 的 `accessCard`／`accessLink`。
- 既有或候選實作：已安裝的 KEEL `Card`、`Button`、`Alert`，以及 Lerniqa 的 `AdminNotice` 均能在 server-rendered admin 畫面使用。
- 重疊行為：`AdminAccessState` 手寫 surface border/radius/background/shadow 與一個 44px action link/focus ring，重複 KEEL Card/Button 已提供的視覺與互動契約。
- 影響：這個高敏感度錯誤／拒絕入口會脫離 KEEL token、focus、disabled 與未來主題調整；也留下另一套只服務單一頁面的 card/button CSS。
- 建議：保留獨立 full-page centering 與授權文案，只把內容 surface、狀態提示及返回 action 換成 KEEL primitives，刪除被取代的 CSS。此項已與介面審查協調，由 code-reuse 報告負責，不另建立介面 finding。
- 預計影響範圍：`admin-page-auth.tsx`、`admin-route.module.css` 與 admin auth render/source tests。
- 驗證方式：forbidden／unavailable／有 request ID 三種輸出不變；返回 `/account`、keyboard focus、200% zoom 與 mobile width 可用；瀏覽器 maintenance window 補桌面／手機截圖。
- 狀態：待確認

### CR-10 依領域拆分過大的 view-model 與 DTO 邊界

- 優先程度：低
- 信心：中
- 目標實作：2,175 行的 `app/lib/admin/admin-view-model.ts` 與 583 行的 `app/components/admin/views/view-types.ts`。
- 既有或候選實作：保留一個小型 shared module，容納 search params、URL/sort/pagination helpers、共同 display DTO 與 time-zone formatting；帳號、題庫、審核佇列、總覽、訂閱、報表、稽核各自放入同領域 view-model／DTO 模組，再由既有 barrel 維持呼叫端 import 穩定。
- 重疊行為：這不是逐字 clone，而是邊界錯置：七個獨立頁面與五個 repository domain 的 mappings、labels、query helpers、report calculations 與 DTO 都被同一模組共同擁有。每個 page 只需要其中一小段，卻都依賴同一變更熱點。
- 影響：平行開發容易在同一檔衝突；domain tests、ownership 與 review 範圍被放大，未來想共用真正穩定的 helpers 時也難以分辨它們是否帶有其他 domain 假設。
- 建議：先用 mechanical move 依現有 exported builders 切分，不同時改 mapping 行為；只有兩個以上 domain 實際使用的 pure helper 才留在 shared。不要因拆檔再建立一套平行 DTO 或改公開 UI contract。
- 預計影響範圍：兩個大檔、views barrel、七個 admin pages、admin view-model/report tests；公開 props shape 應維持。
- 驗證方式：import graph 不產生 cycle；所有 builders/DTO exports 的 type identity 與輸出 deep-equal；分域測試與 full admin typecheck 通過；git diff 應主要是 move 而非行為重寫。
- 決策事項：若 0012／題庫整合仍頻繁修改這兩檔，可延後到功能收斂後再做，避免機械移動放大 merge conflict。
- 狀態：待確認

### CR-11 移除無呼叫端的平行 public surfaces

- 優先程度：低
- 信心：高
- 目標實作：`AdminApiError.toBody`、`toAdminApiErrorBody`，以及 `report-repository.ts` 的 `ADMIN_REPORT_DEFINITIONS`。
- 既有或候選實作：正式 HTTP error serialization 已由 `admin-http.ts` 的 `adminErrorResponse`／`handleAdminHttpError` 負責 correlation ID、500 logging 與 headers；報表查詢／mapping 本身已是唯一 production source。
- 重疊行為：`toBody`／`toAdminApiErrorBody` 是第二套 error body serializer，production callsite 為 0，只由 `admin-input.test.ts` 測試。`ADMIN_REPORT_DEFINITIONS` 的註解稱供測試使用，但全 repo 沒有 callsite。
- 影響：測試固定了不經正式 logging/header contract 的 serializer，可能誘使新 route 繞過 `admin-http.ts`；未使用的 report export 則讓讀者誤以為它是有消費者的契約。
- 建議：刪除 dead serializer 與其專屬 tests，保留 `AdminApiError` 純資料；若 report definitions 真有外部驗收用途，先新增明確 consumer，否則移除 export。不要把未使用常數留作推測性的未來 API。
- 預計影響範圍：`admin-types.ts`、`admin-http.ts` tests、`admin-input.test.ts`、`report-repository.ts` 與 barrel exports。
- 驗證方式：repo-wide symbol scan 為 0；所有 route error tests 只經正式 serializer；5xx 仍有 correlation event/header；report repository tests 不依賴未使用 export。
- 狀態：待確認

## 不應整併或證據不足

- `PolicyDialog` 與 `CatalogMutationDialog` 都使用 KEEL `Dialog`，但前者是唯讀政策說明，後者擁有 form、pending、error focus、retry evidence 與關閉鎖定。共享一個 domain dialog 會隱藏不同生命週期；維持分開。
- Admin filter bar、pagination、table state、mobile record card 與 route drawer 已透過 Lerniqa wrappers 重用 KEEL primitives，wrapper 補的是 URL state、產品 empty/no-results/error 契約與 mobile layout；沒有證據支持改成 ERP 元件或直接刪掉 wrapper。
- Public `QuestionFilterPanel` 是 client-side/demo 題目篩選，admin filters 是 server URL/query 契約，資料來源、狀態與使用者任務不同；不應共用。
- 報表內的 plain table 是 chart series 的靜態可及資料，不具排序、選取或分頁任務；沒有必要為了表面一致強制改成互動式 KEEL `DataTable`。
- KEEL `@keel-design/ui@0.4.0-test.25` 沒有 export `Textarea`；題目長文字欄位使用原生 `textarea` 並包在 KEEL `FormField` 不是重造元件。
- Asset handler 不應與一般 JSON GET 合成 endpoint factory；檔案 I/O 必須在 DB snapshot commit 後才執行。CR-01 只涵蓋共同授權外層。
- Account、question、audit、report 的 SQL filters/mappers，以及不同 null/error semantics，不應用 flags 合成萬用 repository。Question 與 subscription mutation 的 lock、狀態機、audit payload 與 target 也應維持 domain-specific。
- Status 字串表面相似但跨 account、question、subscription、review 有不同 domain 語意。可見中文一致性由 `docs/reviews/admin-backoffice/interface.md` 負責；在 canonical wording 未固定前，不建立跨 domain generic status registry。
- Desktop table 與 mobile card 刻意呈現不同資訊密度；目前已有共同 state/card wrappers。沒有證據支持抽出一個 universal row renderer。
- ERP 的 `AdminPageLayout`、`Pagination`、`AccountDrawer` 與 users page 依賴 ERP 自有 i18n、UI layer 與資料契約，只能作資訊層級參考，不應成為 Lerniqa runtime dependency或被整檔複製。

## 跨 Skill 轉交與引用

- `docs/reviews/admin-backoffice/interface.md` 已負責使用者可見的題庫發布確認、dirty-state、錯誤 focus、enum 中文 label 與 768px 瀏覽器驗收；本報告不重複建立 CR。該報告目前沒有配置 `IQ-*` 識別碼，因此以「尚未收斂的 source-level 問題」及「Maintenance window 待驗收」章節引用。
- 審查時發現題目審核佇列 mobile cards 缺少與桌面相同的分頁入口，已交由介面審查 owner 直接收斂；它是等價任務缺口，不是另一個 code-reuse finding。
- `AdminAccessState` 的使用者可見呈現曾與介面審查 owner 對齊；元件邊界與既有 KEEL surface/action 未重用由本報告 CR-09 負責，避免重複立項。
- `docs/reviews/admin-backoffice/security.md` 負責 iframe 防護、報表抑制與其他安全結論；CR-01／CR-03 只處理重複邊界的共用設計，不重複宣稱安全缺陷已在本輪動態驗證。

## 建議執行順序

1. 先處理 CR-01，固定所有讀取端點的授權與 snapshot 外層，再讓後續 route 整理建立在單一安全邊界上。
2. 接著處理 CR-03 與 CR-04，先收斂 server mutation evidence、fingerprint 與正式 input contracts。
3. 再處理 CR-06、CR-05，讓訂閱 domain rules 與 DTO mapping 各只有一份；CR-07 可在這一階段跟著調整 UI 欄位組。
4. 處理 CR-02，統一題庫與訂閱 client delivery；需與介面報告中的題庫 Dialog/error focus 調整協調，避免同檔衝突。
5. CR-08、CR-09 與 CR-11 可獨立處理；CR-10 等題庫／0012 高變動區收斂後再做 mechanical split。

以上順序只表示依賴關係，不代表已取得修改授權。

## 待確認

- 請以這份報告路徑加 `CR-*` 識別碼核准、排除或調整範圍；目前所有項目都維持「待確認」，尚未依本報告修改任何程式。
- 若只先核准風險最高且會影響後續新增端點的項目，建議先選 CR-01、CR-02、CR-03、CR-04；其餘可在正式功能驗收後分批處理。
