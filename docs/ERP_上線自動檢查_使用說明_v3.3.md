# 上線後自動檢查（冒煙測試｜v3.3）

> 你只要做 3 件事：**填兩個網址 → 複製一段指令 → 看結果有沒有 FAIL**。

這支「上線自動檢查」分兩種（你的決策：**只跑測試環境 DEV**）：

1) **快速檢查（不用登入）**：用 PowerShell 腳本檢查版本字樣、`?v=`、後端可連線  
2) **全自動 E2E（需要登入）**：用瀏覽器自動登入並打開核心模組做冒煙（可擴充成閉環流程）  
   - **僅允許在 DEV（測試）跑**，PROD（正式）不跑自動化，避免污染正式資料。

---

## A. 快速檢查（不用登入）

這支腳本會幫你檢查：
- **前端**：版本字樣是否為 v3.3 / Version 3.3、關鍵腳本是否有 `?v=`（避免快取）
- **後端**：`/exec` 是否可連線（至少有回應）
- **（選填）已登入 API**：提供 token 後，順便測幾個列表 API

> 建議用法（符合「只檢查 DEV」）：  
> - 這份快速檢查請固定傳入 **DEV 的 ApiBase**。  
> - 正式站上線後，只做「人工最小驗證」（登入、主檔列表能開、核心頁能開），不跑自動化。

---

### 1) 先準備兩個資料（照填）

- **SiteUrl（前端網址）**：你的 GitHub Pages 網址（不要加 `/index.html`）
  - 範例：`https://wing510.github.io/ERP`
- **ApiBase（後端網址）**：Apps Script 的 `/exec`
  - 範例：`https://script.google.com/macros/s/XXXXX/exec`

> 提醒（避免搞混 DEV/PROD）：
> - 現在 `js/core/config.js` 允許同時設定 `API_BASE_DEV` 與 `API_BASE_PROD`，前端會自動選用（也可用 `?env=DEV|PROD` 強制）。
> - **但這支快速檢查腳本仍建議你「明確傳入 ApiBase」**，因為它是直接打 API，不會讀前端的自動選用邏輯。

檔案位置：
- 腳本在：`docs/erp-smoke-test.ps1`

---

### 2) 直接跑（最常用，不需要登入）

打開 PowerShell（或 Windows Terminal），切到專案資料夾後執行下面這段。

把 `SiteUrl` 與 `ApiBase` 換成你的即可：

```powershell
pwsh -File .\docs\erp-smoke-test.ps1 `
  -SiteUrl "https://wing510.github.io/ERP" `
  -ApiBase "https://script.google.com/macros/s/XXXXX/exec" `
  -ExpectedVersion "3.3"
```

### 3) 怎樣算通過？

- 看到 **任何一行 `[FAIL]`**：代表有致命問題，要先修好再上線/再通知大家用
- 只有 `[OK]` / `[WARN]`：代表基本可用
  - `[WARN]` 常見原因是：某個關鍵腳本沒加 `?v=`、或帳號本來就沒權限

---

### 4) （選填）要測「已登入的列表 API」再加這兩個參數

你需要提供：
- `ActorId`：你的帳號（ERP 使用者ID）
- `SessionToken`：你目前登入拿到的 token

```powershell
pwsh -File .\docs\erp-smoke-test.ps1 `
  -SiteUrl "https://wing510.github.io/ERP" `
  -ApiBase "https://script.google.com/macros/s/XXXXX/exec" `
  -ExpectedVersion "3.3" `
  -ActorId "ADMIN" `
  -SessionToken "貼上session_token"
```

提醒：若該帳號本來就沒開某些功能，可能會看到 `Permission denied`，腳本會用 `[WARN]` 顯示（不算致命失敗）。

---

## B. 全自動 E2E（需要登入，會自動開啟多個模組）

### 1) 安裝一次（只要第一次要做）

在專案根目錄執行：

```powershell
npm i
npx playwright install
```

### 2) 準備設定檔（只要第一次要做）

1. 複製：`docs/erp-smoke-config.example.json`
2. 改名為：`docs/erp-smoke-config.json`
3. 填入：
   - `siteUrl`（前端網址）
   - `expectedVersion`（例如 3.3）
   - `login.userId`、`login.password`
   - 若要跑閉環：把 `fullFlow` 設為 `true`，並填好 `fixtures`（倉庫、PO、SO、銷售品項、測試數量）

### 3) 執行

在專案根目錄執行：

```powershell
npm run test:smoke
```

### 4) 結果怎麼看？

- 出現 FAIL：代表冒煙失敗（例如登入失敗、核心模組打不開、版本字樣不對）
- 全部通過：代表「最小上線可用」通過

---

## C. 閉環（收貨過帳→作廢、出貨過帳→作廢）— 全自動

> 強烈建議：只在**測試環境**跑，避免污染正式資料。

你只要把：
- `fullFlow` 設為 `true`

即可。測試會在登入後自動：
1) 呼叫後端建立一套測試資料（PO/SO/主檔/可出貨批次）  
2) 跑收貨過帳→作廢、出貨過帳→作廢  
3) 最後自動清理（取消/停用/標記 VOID）

再執行：

```powershell
npm run test:smoke
```


