# Win11 自動化測試環境安裝 SOP（Node.js + Playwright｜v3.3）

> 目的：讓你可以在 Windows 11 直接執行 `npm run test:smoke` 做全自動上線驗證。

---

### 1) 安裝 Node.js（含 npm）

1. 下載並安裝 **Node.js LTS**（建議用 LTS 版）
2. 安裝時保持預設選項（會自動包含 npm）
3. 安裝完成後 **關掉所有 PowerShell / Terminal 視窗再重新開**（讓 PATH 生效）

---

### 2) 確認 Node / npm 已可用

在 PowerShell 執行：

```powershell
node -v
npm -v
```

你應該會看到版本號（例如 `v20.x.x`、`10.x.x`）。  
若顯示「找不到命令」，代表 PATH 還沒生效：請重開終端機，或重開電腦一次再試。

---

### 3) 在 ERP 專案內安裝測試依賴

切到專案資料夾（你目前是 `c:\Users\小斌\Desktop\ERP`）後執行：

```powershell
cd "c:\Users\小斌\Desktop\ERP"
npm i
npx playwright install
```

---

### 4) 準備設定檔（只要第一次）

打開 `docs/erp-smoke-config.json`，至少填這三個：
- `siteUrl`：前端網址（GitHub Pages）
- `login.userId`：測試用帳號（建議 ADMIN）
- `login.password`：密碼

若你要跑閉環（自動 seed/cleanup + 收貨/出貨作廢），把：
- `fullFlow` 設為 `true`

---

### 5) 執行全自動冒煙測試

在專案根目錄執行：

```powershell
npm run test:smoke
```

---

### 6) 常見問題排除

- **npm / node 找不到**
  - 先重開終端機
  - 再執行 `node -v`、`npm -v` 確認
  - 仍不行：重開機一次通常可解

- **Playwright 安裝卡住**
  - 重跑：`npx playwright install`

- **跑測試登入失敗**
  - 檢查 `docs/erp-smoke-config.json` 的帳密是否正確
  - 確認該帳號允許帳密登入（若你有關閉帳密登入則需改用其他登入方案）

