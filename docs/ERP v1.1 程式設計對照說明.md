# ERP 程式設計對照說明

本系統依以下三份資料整理與對齊：

1. **《公司營運流程總整理》** — 公司定位、產品來源、營運流程、模組架構  
2. **《食品及其相關產品追溯追蹤系統管理辦法》** — 法規要求之追溯追蹤與紀錄保存  
3. **《ERP v1.1 設計整理文件》** — 技術架構、資料表、驗證規則、錯誤碼

---

## 一、公司定位與流程對應（依《公司營運流程總整理》）

| 文件描述 | 程式對應 |
|----------|----------|
| 品牌方 + 委外加工管理者 + 批次責任持有人 | 系統以 Lot 為核心，支援委外加工單與批次追溯 |
| 產品類型 RM / WIP / FG | `products.type`、`lots.type` |
| STEP 1 採購（PO）| PURCHASE → Purchase Orders |
| STEP 2 收貨（產生 Lot，PENDING）| Goods Receipt 收貨入庫 |
| STEP 3 QA 放行（APPROVED/REJECTED）| `lots.status`，僅 APPROVED 可加工/出貨 |
| STEP 4 委外加工（單段/雙段）| PROCESS → Outsource Work Orders，支援多來源投料、部分投料、損耗 |
| STEP 5 成品入庫 | 加工回收產生 FG 批次 |
| STEP 6 銷售 | SALES → Sales Orders（不扣庫）|
| STEP 7 出貨（扣庫）| Shipment 出貨管理 → `inventory_movement(SHIP_OUT)` |
| STEP 8 追溯（向上/向下）| TRACEABILITY → Lot Traceability |

**核心原則在程式中的體現：**

- PO 不產生庫存 → 僅在 Goods Receipt 時寫入 `inventory_movement(IN)` 與 `lot`
- 收貨才產生 Lot → `goods_receipt_item.lot_id` 關聯新 Lot
- Lot 是庫存核心 → 所有異動皆以 `lot_id` 為單位
- Work Order 是製程核心 → `process_order`、`process_order_input`、`process_order_output`、`lot_relation`
- Movement 是扣庫核心 → 僅透過 `inventory_movements` 增減庫存
- Trace 是責任核心 → `lot_relation`、追溯查詢向上/向下

---

## 二、系統模組架構對應（依《公司營運流程總整理》）

| 文件模組 | 程式選單與功能 |
|----------|----------------|
| **MASTER DATA** | Products、Suppliers、Customers、Users |
| **PURCHASE** | Purchase Orders、Goods Receipt 收貨入庫、Import Documents 進口報單 |
| **INVENTORY** | Lots 批次管理、Inventory Movements 庫存異動、Split 拆批、Merge 合批 |
| **PROCESS** | Outsource Work Orders 委外加工單（含 Factory Receipt 加工回收）|
| **SALES** | Sales Orders 銷售單、Shipment 出貨管理 |
| **TRACEABILITY** | Lot Traceability 批次追溯 |
| **AUDIT** | Logs 操作紀錄（Audit Trail）|

---

## 三、食品追溯辦法對應（依《食品及其相關產品追溯追蹤系統管理辦法》）

| 法規要求 | 程式支援 |
|----------|----------|
| 原材料來源：供應商名稱、地址、聯絡人、聯絡電話、批號、有效/製造日期、收貨日期、原料原產地 | `suppliers` 主檔；`lots` 有批號、製造日、有效日、收貨日；進口可透過 `import_item.origin_country` |
| 產品資訊：產品名稱、主副原料、包裝、儲運、淨重/數量、有效/製造日期 | `products`、`lots`；可於產品規格或備註擴充 |
| 標記識別：批號、獨特記號 | `lot_id` 為唯一批號 |
| 產品流向：物流、買受人、產品、批號、數量、交貨日期、回收/退貨處理 | `shipment`、`shipment_item` 關聯 `lot_id`；客戶主檔；Logs 可記錄異動 |
| 庫存原材料及產品之名稱、總重量或總容量 | 可由 `lots` + `inventory_movement` 彙總計算 |
| 報廢/逾效期之處理措施及原因 | 可透過 ADJUST 或專用流程記錄，Logs 留存 |
| 紀錄保存至少五年 | 以 Google Sheets + Logs 留存，需由部署單位確保備份與保存年限 |

---

## 四、ERP v1.1 設計對應（依《ERP v1.1 設計整理文件》）

| 設計項目 | 程式實作 |
|----------|----------|
| 14 張表 | Master: products, suppliers, customers, users；Purchase: purchase_orders, purchase_order_items；Inventory: lots, inventory_movements；Process: process_orders, process_order_input/output, lot_relations；Sales: sales_orders, sales_order_items；Shipment: shipment, shipment_item；Import: import_document, import_item, import_receipt, import_receipt_item；Goods Receipt: goods_receipt, goods_receipt_item；Audit: logs |
| 批號類型 RM / WIP / FG | `lot.type`、`product.type` |
| process_type | PROCESS、PACKING、REPACK、REWORK、SPLIT、MERGE（schema 與驗證已支援）|
| 銷售不直接扣庫、出貨才扣庫 | sales_order 僅記錄訂單；實際扣庫由 shipment + inventory_movement(SHIP_OUT) |
| 訂單狀態 OPEN / PARTIAL / SHIPPED / CANCELLED | `sales_order.status`，由系統依出貨量計算 |
| 庫存唯一來源為 inventory_movements | 所有入出庫皆透過 `inventory_movement`，movement_type: IN, OUT, ADJUST, PROCESS_IN, PROCESS_OUT, SHIP_OUT |
| 錯誤整筆不存、錯誤碼系統 | 後端驗證回傳錯誤清單；前端顯示完整錯誤訊息 |
| 不允許負庫存、未放行不可加工/出貨 | 由後端驗證與流程控制 |

---

## 五、產品來源與特殊流程（依《公司營運流程總整理》）

| 來源/情境 | 程式支援 |
|-----------|----------|
| 台灣供應商：PO → 收貨 → Lot | Purchase Orders + Goods Receipt |
| 進口：報關 → Import Receipt（含報單）→ Lot | Import Documents + Import Receipt 關聯報單與 Lot |
| 批發成品：PO → 收貨 → 成品 Lot | 同上，product.type=FG |
| 改包裝：原成品 Lot → Repack → 新 Lot | process_type=REPACK、lot_relation |

---

## 六、未來可擴充（文件提及）

- 多加工廠管理  
- 良率分析、加工成本分析  
- 客戶批次回收追溯  
- 應收帳款 / 收款紀錄  
- 食品業者登錄字號欄位（供應商/客戶主檔）  
- 查廠報表、FIFO 自動配庫  

以上欄位或報表可於主檔與報表階段再擴充，不影響目前流程與追溯邏輯。
