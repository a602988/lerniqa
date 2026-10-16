# 2026-10-16 本機 PostgreSQL 中斷與 shared memory 用盡

本文記錄 2026 年 10 月 16 日晚間，Lerniqa 本機前台顯示「帳號資料庫無法使用」的事故。文中的時間均為主機時間 CST（UTC+8）。調查只讀取服務狀態、系統資源、日誌與 runner 程式碼，沒有讀取帳號、學習者、作答或兒童資料。

## 結論

使用者無法開啟帳號功能的直接原因，是 Lerniqa 的持久 PostgreSQL 在 22:30:46 收到 administrator fast shutdown 後停止，而前台仍在提供頁面。現有證據無法指出是誰或哪一條命令送出這次 shutdown；可確定的流程缺失，是資料庫被停止後，開發與驗收工作沒有立刻確認 `55432` 仍可用，也沒有在前台保持可查看的狀態。

後續恢復又遇到另一個問題。23:45:47 與 23:46:07 的啟動均在 `shmget` 失敗，PostgreSQL 明確回報 `No space left on device`，但提示也明確說明這不是磁碟空間不足。主機的 System V shared-memory identifier 上限 `kern.sysv.shmmni` 是 32；23:57 的快照正好有 32 個區段，因此沒有任何餘裕讓新的 PostgreSQL master 建立 interlock 區段。

這兩件事必須分開看：shared memory 用盡沒有證據顯示它觸發了 22:30 的停機，但它確實阻擋了 23:45 之後的重新啟動。

23:47:15，另一個由 Homebrew 管理、使用 `5432` 的本機 PostgreSQL 完成 smart shutdown。23:47:25，Lerniqa 的 `55432` 成功啟動。這個先後關係與釋放一個 shared-memory identifier 後恢復的結果一致。Homebrew `5432` 目前維持暫停，不應在 shared-memory 餘裕恢復前自動重啟。

沒有發現資料毀損。`55432` 的關閉日誌包含完成的 shutdown checkpoint，恢復後也沒有 crash recovery 或資料毀損訊息。事故前已建立並驗證備份 `local-data/backups/lerniqa-local-20261016T140759Z`，其中包含資料庫 dump、資產封存與 checksum；事故處理沒有執行 reset、seed 或清除持久資料。

## 影響

- 前台仍能回傳頁面時，帳號、角色、學習者與練習紀錄等需要 PostgreSQL 的功能無法使用。
- 使用者看到的是應用程式的資料庫不可用訊息，不是登入資料錯誤。
- 重新啟動曾被主機 shared-memory identifier 用盡阻擋約兩分鐘。
- 目前服務已恢復，但主機資源快照仍是 32/32，下一個新 PostgreSQL master 或下一次重啟仍可能失敗。這是尚未解除的可用性風險。

## 時序

| 時間 | 可驗證事件 |
| --- | --- |
| 18:00:21 | Lerniqa PostgreSQL 在 `local-data/postgres` 啟動，Unix socket port 為 `55432`。 |
| 19:51:37 | 收到一次 fast shutdown；19:52:00 重新啟動成功。現有日誌無法識別操作者。 |
| 21:33:51 | 對同一個 PGDATA 的啟動嘗試遇到 `pre-existing shared memory block ... is still in use`；當時原 master 仍在執行。 |
| 21:34:19 | 原 master 收到 fast shutdown。21:34:22 的第一次重啟遇到 `Operation not permitted`，21:34:30 重啟成功。 |
| 22:08 | 持久資料備份目錄完成寫入；checksum 在本輪工作中已驗證。 |
| 22:30:46 | `55432` 收到 administrator fast shutdown，完成 shutdown checkpoint 後停止。這是使用者後續看到資料庫不可用的直接事件。 |
| 23:45:47 | 重新啟動 `55432` 失敗：`shmget(..., 56, 03600)` 回報 `No space left on device`。 |
| 23:46:07 | 第二次重新啟動遇到相同錯誤。 |
| 23:47:15 | Homebrew `5432` 收到 smart shutdown，23:47:15 完成關閉。 |
| 23:47:25 | Lerniqa `55432` 以 master PID `42252` 啟動並開始接受連線。 |
| 23:57 | `SHMMNI=32`，系統共有 32 個 shared-memory 區段：13 個仍有附著程序，19 個沒有附著程序。 |
| 10 月 17 日 00:00 後 | sandbox 外驗證 `/account` 與 `/practice` 均回傳 HTTP 200；`55432` 接受 Unix socket 連線，schema 為 `0001` 至 `0011`。 |

## 已證實、合理推論與未知事項

### 已證實

- `local-data/postgres.log` 記錄 22:30:46 的 administrator fast shutdown。日誌沒有記錄呼叫者。
- 同一份日誌記錄 23:45:47、23:46:07 的 `shmget` 失敗與 PostgreSQL 對 shared-memory 上限的提示。
- `sysctl kern.sysv.shmmni` 回傳 32；同一時間的 `ipcs -ma` 也列出 32 個區段。
- 32 個區段中，13 個有附著程序。其中一個屬於目前的 Lerniqa `55432`，另外 12 個各自屬於仍在執行的 ERP preview PostgreSQL。
- 另外 19 個區段的 `NATTCH=0`，而它們的 creator PID 均已不存在。這些區段目前沒有程序使用。
- 12 個 ERP preview master 均於 10 月 15 日啟動，早於本次 10 月 16 日的 Lerniqa 資料庫工作；其資料目錄名稱與 Lerniqa runner 的 `/tmp/lerniqa-*` 命名也不同。因此這 12 個仍在執行的 master 不是本輪 Lerniqa runner 建立的。
- Homebrew `5432` 的日誌記錄 23:47:15 smart shutdown。現在 `brew services list` 顯示 `postgresql@18 none`，`pg_ctl` 顯示沒有 server，資料目錄也沒有 `postmaster.pid`。
- 目前的 Lerniqa master PID 是 `42252`，PGDATA 是 `local-data/postgres`，只監聽專用 Unix socket，port 是 `55432`，且不是 recovery server。

### 合理推論

- `NATTCH=0` 且 creator PID 已不存在的 19 個區段，符合 PostgreSQL 或相關程序未正常回收 System V shared memory 後留下的資源。這能解釋為何仍在執行的 master 數量少於 `SHMMNI`，卻已沒有新 identifier 可用。
- Homebrew `5432` 關閉後十秒，Lerniqa `55432` 成功啟動，符合前者釋出一個 identifier、後者立即取得該餘裕的情況。
- 22:30 的 fast shutdown 行為與 `pg_ctl -m fast` 相符，專案的 `npm run db:local:stop` 也會使用這種模式；但僅靠 PostgreSQL 日誌不能判定實際呼叫路徑。

### 無法證實

- 無法由現存日誌判定 22:30 的 shutdown 是哪個人、agent、shell 或 script 發出。
- 無法把 19 個未附著區段逐一歸因到 Lerniqa、ERP preview 或其他過去的 PostgreSQL 執行。creator PID 已消失，臨時目錄與完整命令稽核資料也不足以完成可靠映射。
- `.automation-center-preview.instance.lock` 只在 12 個 ERP preview 目錄中的 2 個存在。調查沒有讀取鎖檔內容；標記缺少也不等於可以安全停止該服務，因為這個 repository 不定義 ERP preview 的 ownership 規則。

## ERP preview PostgreSQL 快照

下表只列資料目錄、master PID、啟動時間、port 與實例鎖標記是否存在，沒有讀取 preview 的資料庫或帳號內容。所有 master 在快照時的 parent PID 都是 1，表示原 launcher 已不是它們的直接 parent，但這本身不能證明服務已無人使用。

| 資料目錄 | PID | 啟動時間 | Port | `.automation-center-preview.instance.lock` |
| --- | ---: | --- | ---: | --- |
| `/tmp/erp-lanes-preview.fLpKY2/pgdata` | 54748 | 10/15 12:59:44 | 5432 | 無 |
| `/private/tmp/erp-lanes-preview-ILJK4s/postgres` | 65193 | 10/15 13:14:49 | 55784 | 有 |
| `/private/tmp/erp-lanes-preview-v2-xqR1wC/postgres` | 55642 | 10/15 20:06:08 | 55667 | 無 |
| `/private/tmp/erp-lanes-preview-tZfg6a/postgres` | 68835 | 10/15 20:27:18 | 56053 | 無 |
| `/private/tmp/erp-lanes-preview-onSZHC/postgres` | 87490 | 10/15 20:57:37 | 56198 | 無 |
| `/private/tmp/erp-lanes-preview-aetxJ6/postgres` | 93310 | 10/15 21:05:18 | 56306 | 無 |
| `/private/tmp/erp-lanes-preview-OrWgPz/postgres` | 9949 | 10/15 21:27:11 | 55703 | 無 |
| `/private/tmp/erp-lanes-preview-4OFLeP/postgres` | 17058 | 10/15 21:37:50 | 56189 | 無 |
| `/private/tmp/erp-lanes-preview-RgYKOD/postgres` | 19343 | 10/15 21:42:15 | 56132 | 無 |
| `/private/tmp/erp-lanes-preview-pRMUWV/postgres` | 49355 | 10/15 21:53:08 | 55628 | 無 |
| `/private/tmp/erp-lanes-preview-ldPzA2/postgres` | 64901 | 10/15 22:04:01 | 55861 | 無 |
| `/private/tmp/erp-lanes-preview-jaRo7r/postgres` | 68123 | 10/15 22:10:04 | 56310 | 有 |

不得因這份清單直接停止任何一個 ERP preview。處理前要先由該專案的 ownership 與使用狀態確認哪一個實例可以關閉。

## 恢復與資料保護

本次恢復採取的動作如下：

- 保留 `local-data/postgres` 與既有持久資料，不做 reset、seed 或測試 cleanup。
- 使用事故前已完成的備份作為回復點，不把備份還原到正在使用的資料庫上。
- 暫停另一個可逆的 Homebrew `5432` 服務，讓 Lerniqa `55432` 取得一個 shared-memory identifier；沒有停止 12 個 ownership 不明的 ERP preview。
- 重新啟動後確認 PGDATA、Unix socket、port 與 recovery 狀態，避免連到別的 cluster。
- 在 sandbox 外確認 `/account` 與 `/practice` 回傳 HTTP 200，並確認 schema migration 為 `0001` 至 `0011`。sandbox 內的 loopback `curl` 會因執行環境網路隔離回傳 connection refused，不能用來判定主機服務再次中斷。

目前可用不等於風險已解除。`ipcs` 快照仍是 32/32；在清理已確認無人使用的資源前，不應啟動新的本機 PostgreSQL cluster，也不應自動恢復 Homebrew `5432`。

## Runner 生命週期檢查

目前三個 integration runner 的 `npm` 入口已共用 `scripts/with-local-postgres-test-lock.mjs`：`db:test`、`test:local-practice` 與 `test:import-ownership` 不會再透過這三個標準入口同時執行。三者也都有明確的 existing-local-server 模式；借用既有 server 時，只能建立帶有本次 ownership token 的隨機測試資料庫，cleanup 不會停止共享 server。

就目前的標準 `npm` 入口、一般成功與一般例外路徑，沒有發現尚未處理的 P0 程式缺陷。下列操作限制仍然有效；本輪已把可由 Lerniqa 程式處理的 P1 runner 問題補齊。

### 當前操作限制：停止預設啟動新 cluster，直到主機有餘裕

共用 lock 只能避免 Lerniqa 的三個標準入口彼此同時啟動，不能處理其他專案已存在的 PostgreSQL，也沒有在啟動前檢查 Darwin 的 `SHMMNI` 餘裕。主機目前是 32/32。清理完成前，驗收只能使用已核准的 existing-local-server 模式與獨立、具 ownership marker 的合成測試資料庫；不得執行會建立新 postmaster 的預設模式。

### 本輪已完成的 runner 修正

- `run-hanlin-import-ownership-isolated.mjs` 已集中處理 `SIGHUP`、`SIGINT`、`SIGTERM`，追蹤 child，且 cleanup 期間不會因第二個 signal 重複中止清理；signal 測試涵蓋正常轉送、spawn race 與 cleanup retry。
- 三個底層 integration runner 會驗證共用 wrapper 的 proof、token 與 direct parent，沒有 wrapper 時 fail closed；不能再靠直接執行 `.mjs` 或 migration shell 繞過標準 lock。
- migration runner 在嘗試 start 前記錄狀態；cleanup 會用 `pg_ctl status` 判斷、執行 stop、再次確認狀態，只有完成 I/O 與 cleanup 後才移除測試根目錄。
- practice runner 已把 Next child 的 spawn `error` 接回同一套序列化 cleanup；測試證明 spawn 失敗仍會清理其擁有的 PostgreSQL。
- `local-postgres.sh` 的 `init`、`start`、`stop`、`migrate`、`ensure` 已共用 `local-data/.postgres-lifecycle-lock`。一般 `stop` 若偵測到 port `3500` 正在使用，會拒絕停止；只有明確設定 `LERNIQA_POSTGRES_MAINTENANCE=1` 的維護操作才能繞過這項保護。

以上防護由 `test:runtime-guardrails` 的動態與靜態測試覆蓋。它們防止 Lerniqa 自己重演生命週期競爭，但不能釋放其他專案持有的 shared-memory identifier，也不構成操作其他專案服務的授權。

## 恢復 SOP

1. 先確認 `local-data/postgres` 的 `pg_ctl status`、`postmaster.pid`、Unix socket 與 `local-data/postgres.log`。不要先刪檔、reset 資料庫或重新 initdb。
2. 若啟動日誌出現 `could not create shared memory segment`，先讀 `sysctl kern.sysv.shmmni` 與 `ipcs -ma`。這類訊息在本次事故中不是磁碟不足。
3. 用 `ps` 把有附著程序的區段對應到實際 PGDATA。不得停止路徑屬於別的專案或 ownership 未確認的服務。
4. 對 `NATTCH=0` 的區段，還要確認 creator PID 已不存在，並追查原 PGDATA 或 runner 紀錄。`ipcrm` 是會改變主機狀態的動作，只有在逐筆確認 ownership 並取得明確批准後才能執行；不得寫成自動 cleanup。
5. 若必須暫時騰出一個 identifier，優先由擁有者正常關閉一個已確認可暫停的服務。本次選擇 Homebrew `5432`，日誌確認它完成 smart shutdown。不得為了 Lerniqa 任意停止 ERP preview。
6. 啟動 Lerniqa 後，確認 master 的 PGDATA 是 `local-data/postgres`、socket 是 `local-data/postgres-socket`、port 是 `55432`、`listen_addresses` 為空，並確認不是 recovery server。
7. 確認 migration manifest 是 repository 的完整前綴，再驗證 `/account` 與 `/practice`。兩者都成功後才能對外說前台已恢復。
8. 記錄為了恢復而暫停的服務。Homebrew `5432` 只能在 shared-memory 有明確餘裕、且確認沒有其他工作依賴它後恢復。

## 後續完成條件

這起事故只有在以下項目完成後，才算解除再發風險：

- 由各專案擁有者盤點 12 個 ERP preview，正常關閉已確認不再使用的 instance。
- 逐筆確認並經批准清理 19 個未附著 shared-memory 區段，清理後重新記錄 `SHMMNI` 與餘裕。
- 在不停止其他專案服務的前提下，重做一次「資料庫停止、正常啟動、身分核對、前台兩個入口成功」的恢復演練。
