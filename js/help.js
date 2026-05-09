/*********************************
 * ERP Global Help Component v1
 * Inline (藍底展開式)
 *********************************/

/* ===============================
   Help Content 集中管理
================================ */

const HelpConfig = {

  productEdit: `
    <strong>流程：</strong><br>
    • 填寫欄位後按「建立」新增產品；已建立的產品可從下方列表「Load」帶回上方後再「更新」<br>
    • 投料／回收單位不同時：展開「多單位換算」設定「投料單位（基準）」與「可產生的產出單位換算」，再按「建立」或「更新」<br>
    <strong>規則：</strong><br>
    • 產品 ID（product_id）可由系統自動產生，建立並儲存後不可修改<br>
    • ID 最長 30 字元，只能用 A–Z／0–9／_／-<br>
    • 產品類型僅允許：RM（原料）/ WIP（半成品）/ FG（成品）<br>
    • 單位必填（收貨/加工/出貨/庫存異動都會使用到）<br>
    • 委外若投料（原料）單位與回收（成品／半成品）單位不同：在<strong>產出產品</strong>設定多單位換算<br>
    • 停用（INACTIVE 停用）前若已有被使用，系統會提醒你確認（保留歷史、不破壞追溯）<br>
    • 狀態（ACTIVE/INACTIVE）屬高風險：僅 CEO／GA／ADMIN 可修改<br>
    <strong>常見提示：</strong><br>
    • 缺少必填：產品名稱／單位／類型<br>
    • ID 長度/格式不合法（最多 30；僅 A–Z 0–9 _ -）<br>
    • 名稱過長（最多 100）／規格過長（最多 200）／備註過長（最多 500）<br>
    • 產品 ID 已存在／找不到產品<br>
    • 委外回收若提示單位無法換算：請先在本產品完成多單位換算並更新<br>
    • 建立成功／更新成功
  `,

  productList: `
    <strong>流程：</strong><br>
    • 點欄位標題可排序；點「Load」會帶到上方編輯區<br>
    <strong>規則：</strong><br>
    • 篩選條件：關鍵字／類型／狀態<br>
    • 關鍵字比對：產品ID／名稱／規格／備註<br>
    • 狀態：ACTIVE（使用中）/ INACTIVE（停用保留歷史）<br>
    <strong>常見提示：</strong><br>
    • 若找不到資料：請確認關鍵字／類型／狀態條件<br>
    • 建立/修改資訊請到 Logs 查
  `,
  supplierEdit: `
    <strong>流程：</strong><br>
    • 填寫後按「建立」新增供應商；點列表「Load」後可帶回上方再「更新」<br>
    • 供應商可設定「類型(可複選)」與「可用流程(可複選)」，用於下游模組下拉篩選/限制<br>
    • 稽核/修改紀錄請到 Logs 查<br>
    <strong>規則：</strong><br>
    • 供應商 ID（supplier_id）可由系統自動產生，建立並儲存後不可修改<br>
    • ID 最長 30 字元，只能用 A–Z／0–9／_／-<br>
    • 名稱必填（supplier_name）<br>
    • 供應商類型與可用流程為必填（用於下游模組下拉篩選/限制）<br>
    • 「國家」選「其他」或「供應商類型」勾選「其他」時：備註/原因必填<br>
    • 停用（INACTIVE 停用）前若已有被使用，系統會提醒你確認<br>
    • 狀態（ACTIVE/INACTIVE）屬高風險：僅 CEO／GA／ADMIN 可修改<br>
    <strong>常見提示：</strong><br>
    • 缺少必填：供應商ID／供應商名稱／供應商類型／可用流程<br>
    • 國家/供應商類型 選「其他」時，請填寫備註/原因<br>
    • ID 長度/格式不合法<br>
    • 供應商 ID 已存在／找不到供應商<br>
    • 建立成功／更新成功
  `,

  supplierList: `
    <strong>流程：</strong><br>
    • 點欄位標題可排序；點「Load」會帶到上方編輯區<br>
    <strong>規則：</strong><br>
    • 篩選條件：關鍵字／狀態<br>
    • 關鍵字比對：供應商ID／名稱／聯絡人／電話／Email／備註<br>
    • 狀態：ACTIVE（使用中）/ INACTIVE（停用保留歷史）<br>
    <strong>常見提示：</strong><br>
    • 若找不到資料：請確認關鍵字／狀態條件<br>
    • 建立/修改資訊請到 Logs 查
  `,

  customerEdit: `
    <strong>流程：</strong><br>
    • 填寫後按「建立」新增客戶；點列表「Load」後可帶回上方再「更新」<br>
    • 「分類」可用來標記客群（例如：經銷/門市/電商…），方便後續查詢與報表<br>
    • 稽核/修改紀錄請到 Logs 查<br>
    <strong>規則：</strong><br>
    • 客戶 ID（customer_id）可由系統自動產生，建立並儲存後不可修改<br>
    • ID 最長 30 字元，只能用 A–Z／0–9／_／-<br>
    • 名稱必填（customer_name）<br>
    • 分類必填（用於標記客群與後續查詢/報表）<br>
    • 「分類」或「國家」選「其他」時：備註/原因必填<br>
    • 停用（INACTIVE 停用）前若已有被使用，系統會提醒你確認<br>
    • 狀態（ACTIVE/INACTIVE）屬高風險：僅 CEO／GA／ADMIN 可修改<br>
    <strong>常見提示：</strong><br>
    • 缺少必填：客戶ID／客戶名稱／分類<br>
    • 分類/國家 選「其他」時，請填寫備註/原因<br>
    • ID 長度/格式不合法<br>
    • 客戶 ID 已存在／找不到客戶<br>
    • 建立成功／更新成功
  `,

  customerList: `
    <strong>流程：</strong><br>
    • 點欄位標題可排序；點「Load」會帶到上方編輯區<br>
    <strong>規則：</strong><br>
    • 篩選條件：關鍵字／分類／狀態<br>
    • 關鍵字比對：客戶ID／名稱／分類／聯絡人／電話／Email／備註<br>
    • 狀態：ACTIVE（使用中）/ INACTIVE（停用保留歷史）<br>
    <strong>常見提示：</strong><br>
    • 若找不到資料：請確認關鍵字／分類／狀態條件<br>
    • 建立/修改資訊請到 Logs 查
  `,

  usersMain: `
    <strong>流程：</strong><br>
    • 使用者建立/更新後，系統會記錄操作者（created_by/updated_by）為「目前登入的帳號」<br>
    • 需要調整姓名/角色/狀態/可用模組時：先載入再更新<br>
    <strong>規則：</strong><br>
    • 可用模組：未勾選任何模組＝預設只能使用「Dashboard 儀表板、Lot Traceability 批次追溯」<br>
    • 建議用 INACTIVE（停用）保留歷史帳號，不建議刪除（避免稽核斷裂）<br>
    • 停用後不得再登入；歷史操作紀錄仍保留可查<br>
    • 狀態（ACTIVE/INACTIVE）屬高風險：僅 CEO／GA／ADMIN 可修改<br>
    <strong>常見提示：</strong><br>
    • 缺少必填：User ID／姓名／Email／角色<br>
    • User ID 已存在<br>
    • 建立成功／更新成功（更新前需先載入）
  `,

  purchaseHeader: `
    <strong>流程：</strong><br>
    • 採購單號由系統自動產生（欄位唯讀）；先填主檔再到下方新增品項，最後按下方「建立」開單<br>
    • 需要入庫時請到「收貨入庫（Goods Receipt）」收貨，才會產生 Lot（批次）<br>
    <strong>規則：</strong><br>
    • 採購單（PO, Purchase Order）本身不產生庫存；收貨入庫才產生 Lot<br>
    • 文件連結：可貼 URL 方便追資料<br>
    • 點「Load」會先檢查收貨狀態（未載入/檢查中/已收貨/未收貨等）<br>
    • 已收貨後：整張採購單會鎖定不可改（避免破壞追溯）<br>
    • 狀態 CLOSED（結案）不可再修改<br>
    <strong>常見提示：</strong><br>
    • 請選擇供應商／請填寫下單日期<br>
    • 請至少新增 1 筆品項／請至少保留 1 筆品項<br>
    • 採購單號已存在／找不到採購單／請先載入再更新<br>
    • 已收貨：整張採購單不可修改<br>
    • CLOSED：不可再修改<br>
    • 更新成功
  `,
  purchaseItems: `
    <strong>流程：</strong><br>
    • 在採購單中新增品項（產品/數量）；明細表以「項次」對齊列<br>
    • 只改備註：點列帶回上方後按「更新本筆備註」<br>
    • 完成後按下方「建立」建立採購單；已建立的採購單可按下方「更新」更新主檔/明細<br>
    <strong>規則：</strong><br>
    • 明細表「狀態」：草稿；已存檔列則依已收／訂購顯示未收貨、部分收貨、已收畢；品項備註僅在上方表單編輯<br>
    • 明細的 產品 / 數量 / 單位 會決定後續「可收上限」<br>
    • 已收貨後不建議改明細（避免追溯與帳務不一致）<br>
    • 已收貨時：新增/刪除/更新會鎖定<br>
    <strong>常見提示：</strong><br>
    • 請選擇產品<br>
    • 訂購數量需大於 0<br>
    • 找不到產品單位：請先確認產品主檔
  `,
  purchaseList: `
    <strong>流程：</strong><br>
    • 「Load」：帶到上方編輯區；收貨：跳到收貨入庫並預選該 PO<br>
    <strong>規則：</strong><br>
    • 關鍵字比對：採購單號、供應商 ID<br>
    • 有填文件連結才會顯示「連結」<br>
    • 狀態：OPEN（開單中）/ PARTIAL（部分收貨）/ CLOSED（已結案）<br>
    <strong>常見提示：</strong><br>
    • 若找不到資料：請確認範圍/狀態條件
  `,

  importHeader: `
    <strong>流程：</strong><br>
    • 報單 ID 由系統自動產生（欄位唯讀）；先填主檔再到下方新增品項，最後按下方「建立」建立報單（主檔+明細一併送出）<br>
    • 需要入庫時到「收貨入庫」選該報單收貨，才會產生 Lot（批次）<br>
    <strong>規則：</strong><br>
    • 進口報單（Import Document）是來源文件：收貨入庫會以報單明細計算可收上限<br>
    • 批號（Inv No）必填（請依文件填）<br>
    • 點「Load」會先檢查收貨狀態（未載入/檢查中/已收貨/未收貨等）<br>
    • 已收貨後：整張報單會鎖定不可改（避免追溯風險）<br>
    • 若需調整：請以「沖銷/補單」處理<br>
    &nbsp;&nbsp;沖銷：多收/收錯要減量 → 到「庫存異動」選 Lot 扣回數量<br>
    &nbsp;&nbsp;補單：原報單不動；新建一張報單，再到「收貨入庫」收貨<br>
    <strong>常見提示：</strong><br>
    • CLOSED/CANCELLED：不可再修改<br>
    • 已有進口收貨：不可修改明細（請用沖銷/補單）<br>
    • 建立／更新成功或失敗會以 Toast 顯示<br>
    • 找不到報單／請先載入或建立一張報單<br>
    • 請至少新增 1 筆報單品項
  `,
  importItems: `
    <strong>流程：</strong><br>
    • 新增品項並寫入報單；明細表以「項次」對齊列<br>
    • 只改備註：點列帶回上方後按「更新本筆備註」<br>
    • 完成後按下方「建立」建立報單；已建立的報單可按下方「更新」更新主檔/明細<br>
    <strong>規則：</strong><br>
    • 明細表「狀態」為簡版：草稿／已存檔（與出貨明細「草稿／已過帳」同類）；品項備註僅在上方表單編輯<br>
    • 已收貨時：新增品項/刪除/更新會鎖定（避免追溯風險）<br>
    • Inv No 必填，建議全大寫一致<br>
    <strong>常見提示：</strong><br>
    • 請選擇產品<br>
    • Inv No 必填（請依文件發票號填寫）<br>
    • 數量需大於 0<br>
    • 找不到產品單位：請先確認產品主檔
  `,
  importList: `
    <strong>流程：</strong><br>
    • 「Load」：帶到上方編輯區；收貨：跳到收貨入庫並預選該報單<br>
    <strong>規則：</strong><br>
    • 列表不顯示備註（避免太擠），編輯區仍可填寫<br>
    • 狀態：OPEN（開單中）/ CLOSED（已結案）/ CANCELLED（已取消）<br>
    <strong>常見提示：</strong><br>
    • 若找不到資料：請確認狀態/關鍵字條件
  `,

  receiveHeader: `
    <strong>流程：</strong><br>
    • 先選「來源類型」（PO／IMPORT）→ 再選來源單號<br>
    • 填「收貨日期」（含時間）與「倉別」，再到下方明細逐列輸入「本次收貨」與日期，最後按「產生批次」建立 Lot<br>
    • 同卡下方「已收列表」需要點開才載入；作廢規則與限制請看列表提示<br>
    <strong>規則：</strong><br>
    • 收貨單 ID 自動產生（唯讀）<br>
    • 「剩餘可收」由系統計算；已作廢之收貨不計入彙總與判斷<br>
    • 建立的 Lot 預設 PENDING（待 QA）<br>
    <strong>常見提示：</strong><br>
    • 收貨日期 必填（含時間）／請先選擇來源類型與單號<br>
    • 請至少輸入一筆本次收貨<br>
    • 找不到報單或載入失敗：依畫面提示重試<br>
    • 收貨完成：已產生 X 個 Lot（PENDING 待QA）
  `,
  receiveLines: `
    <strong>流程：</strong><br>
    • 依「項次」對應來源明細逐列輸入「本次收貨」，並視需要填「製造日／有效期」<br>
    • 按「產生批次」後才會真正建立 Lot（批次）；成功會以提示顯示產生數量<br>
    • 「已收列表」點開才載入；作廢會開啟視窗選原因，選「其他」需填補充說明<br>
    <strong>規則：</strong><br>
    • 本次收貨不可超過剩餘可收；製造日／有效期寫入新 Lot<br>
    • 作廢：若已被出庫、加工或調整扣減，導致可用量不足以沖銷入庫，則無法作廢。<br>
    <strong>常見提示：</strong><br>
    • 品項超過剩餘可收／本次無可收量，將不產生 Lot
  `,

  lotsMain: `
    <strong>流程：</strong><br>
    • 先用關鍵字與下拉篩選（庫存狀態／品檢狀態）找批次<br>
    • 批次若為 PENDING：可執行 QA 放行/退回（會跳出確認視窗）<br>
    • 需要補登製造日／有效期時：使用「補登批次日期」視窗儲存<br>
    <strong>規則：</strong><br>
    • Lot（批次）是追溯單位；可用量以 inventory_movement 加總為準；系統追溯說明與使用者備註分欄存放<br>
    • 庫存狀態（inventory_status）：ACTIVE（可使用）／CLOSED（無庫存）／VOID（已過期）<br>
    • 品檢狀態（status）：PENDING（待 QA）／APPROVED（QA 已放行）／REJECTED（QA 已退回）<br>
    • 日期規則：有效期不可早於製造日<br>
    • 建議只出貨／扣庫已放行批次<br>
    <strong>常見提示：</strong><br>
    • 找不到此批次：確認關鍵字、倉別、狀態篩選條件<br>
    • 無法操作：批次可能已放行/已退回或狀態不允許
  `,

  movementsMain: `
    <strong>流程：</strong><br>
    • 先選「Lot」→ 選用途與「給誰」→ 填「扣庫數量」與「原因」→ 按「確認扣庫」建立異動<br>
    • 轉倉：先勾選「轉倉」（系統才會啟用/載入可轉倉 Lot 下拉）→ 選「轉倉到」目標倉並輸入數量後按「轉倉」；可按「轉全部」一鍵帶入全部可用量<br>
    • 下方列表可用關鍵字與「異動類型」篩選，必要時按「重新整理」刷新資料<br>
    <strong>規則：</strong><br>
    • 庫存異動為庫存帳本來源；手動扣庫預設僅 APPROVED 且 ACTIVE 的 Lot<br>
    • 不允許負庫存；扣庫／轉出量不可超過可用量<br>
    • 轉倉（QA 規則）：<br>
      - 待 QA（PENDING）：僅允許「全部轉倉」（轉倉數量必須 = 可用量）<br>
      - 部分轉倉：來源 Lot 必須 QA 已放行（APPROVED）<br>
      - 已退回（REJECTED）：不可轉倉（建議改用報廢或其他處置）<br>
    • 轉倉會沖帳並於目標倉產生新批號，追溯與備註與人為填寫分離<br>
    <strong>常見提示：</strong><br>
    • 請選擇 Lot／找不到 Lot／數量需大於 0<br>
    • 扣庫數量不可超過可用量／轉倉須選目標倉／原因必填<br>
    • 異動或轉倉已建立
  `,

  shippingHeader: `
    <strong>流程：</strong><br>
    • 先填主檔（出貨單ID／銷售單／客戶／出貨日期），再到下方新增出貨明細<br>
    • 完成後按下方「建立並過帳出貨（扣庫）」才會扣庫<br>
    • 作廢：按上方「作廢出貨單（反沖庫存）」；僅限 POSTED（已過帳）出貨單<br>
    <strong>規則：</strong><br>
    • 出貨會產生庫存扣庫異動<br>
    • 只允許使用 QA 已放行批次，且不允許負庫存<br>
    <strong>常見提示：</strong><br>
    • 出貨單ID 必填／請選擇客戶／出貨日期必填<br>
    • 請至少新增 1 筆出貨明細<br>
    • 找不到出貨單／請先載入出貨單<br>
    • 僅 POSTED 出貨單可作廢／作廢完成：已反沖庫存並回寫 SO
  `,
  shippingItems: `
    <strong>流程：</strong><br>
    • 先選「銷售品項」（可選），再指定 Lot 與出貨數量後按「新增明細」加入草稿<br>
    • 「Lot 自動分配（FEFO）」預設開啟：依效期先到期先出，可自動拆成多筆明細；系統自動分配帶出的數量為唯讀<br>
    • 關閉 FEFO 後改用「選擇 Lot」手動指定（也可先自動分配，再手動覆寫/調整）<br>
    • 「選擇 Lot」視窗可搜尋；可切換「flat（一般清單）／group_source（依來源分組）」；可勾「顯示不可選 Lot」查看被擋原因<br>
    • 只改備註：用「更新本筆備註」；完成後按下方「建立並過帳出貨（扣庫）」<br>
    <strong>規則：</strong><br>
    • Lot 與銷售品項的產品需一致（有綁品項時）<br>
    • 出貨不可超過可用量，亦不可超過銷售單剩餘未出貨量（若有綁 SO）<br>
    • 明細「狀態」：草稿／已過帳；備註僅在上方表單編輯<br>
    <strong>常見提示：</strong><br>
    • 找不到 Lot／Lot 單位缺失／出貨數量需大於 0<br>
    • 超過可用量或剩餘未出貨量／Lot 與銷售品項產品不一致<br>
    • FEFO 開啟時若效期資料不足：改手動選批或先補齊 Lot 日期
  `,
  shippingList: `
    <strong>流程：</strong><br>
    • 「Load」帶回上方檢視；作廢前請確認（會反沖庫存）<br>
    <strong>規則：</strong><br>
    • 關鍵字比對：出貨單／客戶／銷售單<br>
    • 只能作廢 POSTED（已過帳）出貨單<br>
    • 狀態：OPEN（開單中）/ POSTED（已過帳）/ CANCELLED（已取消）<br>
    <strong>常見提示：</strong><br>
    • 若找不到資料：請確認狀態/關鍵字條件
  `,

  logsMain: `
    <strong>流程：</strong><br>
    • 先用上方分頁（ALL / MASTER / INBOUND / INVENTORY / PROCESS / SALES / SHIPMENT）縮小範圍<br>
    • 再用篩選器（資料表／時間範圍／動作／關鍵字）精準查詢<br>
    • 點「明細（View）」可在下方展開差異內容<br>
    <strong>規則：</strong><br>
    • 動作代碼：CREATE（建立）/ UPDATE（更新）/ DELETE（刪除）<br>
    • 關鍵字可搜：ID / 參考ID / 舊值 / 新值<br>
    <strong>常見提示：</strong><br>
    • 若儲存/查詢失敗：畫面可能直接顯示後端錯誤訊息（err.message）
  `,

  salesHeader: `
    <strong>流程：</strong><br>
    • 先填主檔（客戶／銷售人員／下單日期／類型），再到下方新增明細，最後按下方「建立」建立銷售單（主檔+明細一併寫入）<br>
    • 需要出貨：到「Shipment 出貨管理」建立出貨單，按「建立並過帳出貨（扣庫）」後才會扣庫<br>
    • 類型選「補寄（RESHIP）」時：需填「補寄參考（原 SO / 原出貨）」以便稽核對照<br>
    <strong>規則：</strong><br>
    • Sales Orders（銷售單，SO）不直接扣庫；實際扣庫發生在 Shipment 出貨管理<br>
    • 已有出貨或單據已結束（SHIPPED/CANCELLED）：不可「編輯主檔／儲存主檔」整批欄位；主檔備註隨時可用「儲存備註」<br>
    <strong>常見提示：</strong><br>
    • 銷售單ID 必填／請選擇客戶／下單日期必填<br>
    • 請至少新增 1 筆品項<br>
    • 銷售單ID 已存在／找不到銷售單／請先載入再更新<br>
    • 類型「其他」：備註必填（含僅存備註時）
  `,
  salesItems: `
    <strong>流程：</strong><br>
    • 新單：選產品、數量、單價後按「新增明細」加入草稿，最後按「建立」<br>
    • 已載入且<strong>全部未出貨</strong>：按「編輯明細」→ 點列帶入 → 改數量/單價後「套用至本列」→「儲存明細」；草稿列點列可帶入修改<br>
    • 只改備註（已存檔列）：點列後按「儲存備註」（不必先按「編輯明細」；有出貨或已結束單亦可）<br>
    • 單價變更會即時計算金額<br>
    <strong>規則：</strong><br>
    • 明細決定後續可出貨的品項與上限<br>
    • 明細表「狀態」欄對齊委外投料列表：草稿／已存檔列則依已出貨量顯示未出貨、部分出貨、已出畢；品項備註僅在上方表單編輯<br>
    <strong>常見提示：</strong><br>
    • 請選擇產品<br>
    • 訂購數量需大於 0<br>
    • 產品單位缺失
  `,
  salesList: `
    <strong>流程：</strong><br>
    • 「Load」帶到上方編輯區；「出貨」可捷徑帶單至出貨模組<br>
    <strong>規則：</strong><br>
    • 關鍵字比對：銷售單 ID／客戶／業務等（與列表欄位一致）<br>
    • 狀態：OPEN（開單中）/ PARTIAL（部分出貨）/ SHIPPED（全數出貨）/ CANCELLED（已取消）<br>
    <strong>常見提示：</strong><br>
    • 若找不到資料：請確認狀態/關鍵字條件
  `,

  usersList: `
    <strong>流程：</strong><br>
    • 點欄位標題可排序；點「Load」會帶到上方編輯區<br>
    <strong>規則：</strong><br>
    • 篩選條件：關鍵字／角色／狀態<br>
    • 關鍵字比對：User ID／姓名／Email／角色／備註<br>
    • 狀態：ACTIVE（使用中）/ INACTIVE（停用保留歷史）<br>
    • 建議用 INACTIVE（停用）保留歷史使用者，不建議刪除（避免稽核斷裂）<br>
    <strong>常見提示：</strong><br>
    • 若找不到資料：請確認關鍵字／角色／狀態條件<br>
    • 建立/修改資訊請到 Logs 查
  `,

  outsourceHeader: `
    <strong>流程：</strong><br>
    • 先填主檔後按「1) 建立加工單」建立（或從列表 Load 載入既有加工單）<br>
    • 投料：在投料區新增草稿後按「2) 送加工（扣庫）」可分批、多次扣庫<br>
    • 回收：在回收區新增草稿後按「3) 回收加工品」入庫；每次有效回收會產生新 Lot（預設 PENDING）<br>
    • 需要修改主檔：用「更新備註/預計到貨日期」；取消加工單用「取消加工單（回沖）」<br>
    <strong>規則：</strong><br>
    • 投料只允許 QA已放行 且庫存 ACTIVE、可用量 &gt; 0 的批次（選 Lot 視窗已過濾）<br>
    • 回收中通常維持 OPEN；回收完畢會轉 POSTED（已結案）<br>
    • 取消加工單為整張回沖；若產出 Lot 已被下游使用會被阻擋；多筆原因時畫面會顯示可展開的阻擋明細<br>
    • 投料與產出若單位不同，需先在「產出產品」主檔設定多單位換算，系統才會換算到同一基準後比較總量<br>
    • 加工類型代碼：PROCESS / PACKING / REPACK / REWORK / SPLIT / MERGE<br>
    • 來源類別：RM（原料）/ WIP（半成品）/ FG（成品）供管理與篩選<br>
    <strong>常見提示：</strong><br>
    • 加工單ID 必填／請選擇加工類型／請選擇加工廠<br>
    • 找不到加工單／請先載入加工單<br>
    • 加工單主檔已更新
  `,
  outsourceInputs: `
    <strong>流程：</strong><br>
    • 按「選擇 Lot」開啟視窗（僅 ACTIVE + QA已放行 + 可用量&gt;0），可搜尋並切換 flat／group_source；點選列帶回 Lot<br>
    • 填投料數量後按「新增投料」加入草稿；可重複新增多筆草稿<br>
    • 按「2) 送加工（扣庫）」會把草稿投料過帳為扣庫（可分批多次送加工）<br>
    • 點選某一列後可更新備註；「更新本筆備註」只改備註、不影響已扣庫數量<br>
    <strong>規則：</strong><br>
    • 選單／列表僅顯示 QA已放行、庫存 ACTIVE、可用量 &gt; 0 的 Lot<br>
    • 系統會檢查可用量（不可超投）；可用量以 inventory_movement 加總為準<br>
    <strong>常見提示：</strong><br>
    • 請選擇 Lot／找不到符合條件的 Lot／Lot 單位缺失<br>
    • 投料數量需大於 0／投料不可超過可用量<br>
    • 送加工時若無新草稿投料：請先新增投料再按 2)
  `,
  outsourceOutputs: `
    <strong>流程：</strong><br>
    • 選產出產品、輸入回收數量後按「新增產出」加入草稿；可累積多筆草稿再按「3) 回收加工品」一次入庫<br>
    • 「預估損耗」主要依「尚未入帳的草稿產出」與已送加工總量（換算後）即時估算；已作廢的回收不計入有效產出<br>
    • 可勾選「本次回收後結案（允許耗損）」：在仍有合理耗損、總量未完全對齊時，仍可將加工單結案<br>
    • 下方表格同為「同一套明細」：草稿可編輯／刪除；已入帳列可「作廢本筆回收」；點列可帶出備註並用「更新本筆備註」<br>
    <strong>規則：</strong><br>
    • 新 Lot 預設 PENDING（待QA）；是否可出庫需到 Lots 放行（QA已放行）<br>
    • 回收總量（換算後）不可超過已送加工；單位對不上時，到<strong>本次選的產出產品</strong>主檔設好多單位即可<br>
    • 多筆投料合一筆產出時，損耗以 Σ投料（換算後基準）－Σ有效產出（換算後基準）理解；細到「每個原料各自配方」需另建 BOM 才支援<br>
    • 每次有效回收寫入的損耗會存於該筆 process_order_output（loss_base_qty_after 等欄位）<br>
    <strong>常見提示：</strong><br>
    • 請選擇產出產品／回收數量需大於 0／產出單位缺失<br>
    • 回收總量不可超過已送加工總量／單位無法換算時請先設定產品換算<br>
    • 作廢回收後若畫面數字異常：請重新載入加工單或確認草稿列是否已清除<br>
    • 回收完成：產生新 Lot（PENDING）
  `,
  outsourceList: `
    <strong>流程：</strong><br>
    • 在加工單列表點「Load」：帶回主檔並刷新投料／回收明細<br>
    • 最下方「已載入加工單明細」以文字區摘要投料、產出與 lot_relation 關聯（核對用）<br>
    • 需要稽核單筆異動時可用主檔卡片的「Log」<br>
    <strong>規則：</strong><br>
    • 列表可依狀態等條件篩選（與畫面上方條件一致）<br>
    • 明細操作以「投料／回收」兩張卡片內的表格為準；摘要區僅供閱讀、不提供按鈕<br>
    <strong>常見提示：</strong><br>
    • 若載入後表格仍空：請確認是否已按 2) 送加工／3) 回收，或加工單ID是否正確
  `,

  traceMain: `
    <strong>流程：</strong><br>
    • 輸入 Lot ID 後按「查詢」取得追溯結果<br>
    • 結果分三區：批次摘要／向上追（來源）／向下追（流向）<br>
    <strong>規則：</strong><br>
    • 向上追（來源）主要依 lot_relation<br>
    • 向下追（流向）包含加工產出與出貨扣庫<br>
    <strong>常見提示：</strong><br>
    • 請輸入 Lot ID
  `,

  traceTx: `
    <strong>流程：</strong><br>
    • 貼上 transaction_id（格式：TX-時間戳-隨機碼）後按「查詢交易鏈」<br>
    • 結果會依資料表分類顯示（例如：SO / Shipment / Receipt / Process / Movement / lot_relation）<br>
    <strong>規則：</strong><br>
    • 用來追同一次「過帳/交易 bundle」寫入了哪些表與庫存異動，常用於稽核、對帳與除錯<br>
    <strong>常見提示：</strong><br>
    • 查不到資料：先確認該單據/異動是否已過帳，或後端是否有寫入 transaction_id
  `,

  splitMain: `
    <strong>流程：</strong><br>
    • 先選「來源 Lot」後，於下方新增 1 筆或多筆「新 Lot」草稿<br>
    • 確認草稿無誤後按「確認拆批（過帳）」送出，系統會建立新批次並扣減來源可用量<br>
    <strong>規則：</strong><br>
    • 拆批（SPLIT）會用 inventory_movement 調整可用量<br>
    • 會寫入 lot_relation（SPLIT）供追溯（來源 → 新批次）<br>
    • 新批次預設沿用原批次 QA 狀態（PENDING/APPROVED/REJECTED）<br>
    <strong>常見提示：</strong><br>
    • 請先選擇來源 Lot／找不到來源 Lot<br>
    • 新 Lot ID 必填／新 Lot ID 重複<br>
    • 數量需大於 0／單位缺失／拆出總量不可超過可用量<br>
    • 拆批完成
  `,
  mergeMain: `
    <strong>流程：</strong><br>
    • 上方先填「新 Lot ID」與備註<br>
    • 於來源區加入至少 2 個來源 Lot（僅限 QA已放行）與取用數量，加入草稿後按「確認合批（過帳）」送出<br>
    <strong>規則：</strong><br>
    • 合批（MERGE）會用 inventory_movement 調整可用量<br>
    • 會寫入 lot_relation（MERGE）供追溯（來源 → 新批次）<br>
    • 合批必須同一產品、同一單位<br>
    <strong>常見提示：</strong><br>
    • 請選擇來源 Lot／找不到 Lot／同一 Lot 不可重複加入<br>
    • 取用數量需大於 0／取用不可超過可用量<br>
    • 新 Lot ID 必填／新 Lot ID 已存在<br>
    • 合批至少需要 2 個來源 Lot<br>
    • 合批完成
  `,

  warehouseMain: `
    <strong>流程：</strong><br>
    • 填倉庫名稱、溫層類別（常溫／冷藏／冷凍）、地址等後按「建立」；已存在倉庫可從列表載入後「更新」或停用<br>
    • 倉庫 ID 可由系統自動產生，建立前仍可手動調整；儲存後作為全站收貨、出貨、庫存異動、挑 Lot 之下拉依據<br>
    <strong>規則：</strong><br>
    • 收貨、出貨、加工、拆併、手動異動等倉別皆連倉庫主檔；下拉顯示「名稱＋溫層」，避免手打錯倉<br>
    • 類別（溫層）必填（用於下游流程顯示與判斷）<br>
    • 停用（INACTIVE）前若已有被使用，系統會提醒確認（保留歷史）<br>
    • 狀態（ACTIVE/INACTIVE）屬高風險：僅 CEO／GA／ADMIN 可修改<br>
    <strong>常見提示：</strong><br>
    • 缺少必填：倉庫ID／倉庫名稱／類別（常溫/冷藏/冷凍）<br>
    • 倉庫 ID 已存在／找不到倉庫／建立或更新成功<br>
    • 變更紀錄可到 Logs 查
  `,

  warehouseList: `
    <strong>流程：</strong><br>
    • 點欄位標題可排序；點「Load」會帶到上方編輯區<br>
    <strong>規則：</strong><br>
    • 篩選條件：關鍵字／類別／狀態<br>
    • 關鍵字比對：倉庫 ID／名稱／備註<br>
    • 狀態：ACTIVE（使用中）/ INACTIVE（停用保留歷史）<br>
    <strong>常見提示：</strong><br>
    • 若找不到資料：請確認關鍵字／類別／狀態條件<br>
    • 建立/修改資訊請到 Logs 查
  `,

  warehouseStockHeader: `
    <strong>流程：</strong><br>
    • 先選倉別，再選檢視「產品彙總」或「Lot 明細」；可輸入關鍵字並用「到期視窗」篩選（例如 30／60／90 天內到期）<br>
    • 按「更新」重新彙總<br>
    <strong>規則：</strong><br>
    • 可用量以 inventory_movement 加總為準；畫面會標示即將到期與已過期，利於先進先出規劃<br>
    • 到期判斷以 expiry_date 當日 23:59:59 為截止<br>
    <strong>常見提示：</strong><br>
    • 請先選擇倉別再查詢<br>
    • 若數字與預期不符：確認是否剛完成轉倉／扣庫，可按「更新」或切換視圖核對
  `,
};


/* ===============================
   Help Engine
================================ */

function initHelpComponent(){

  document.querySelectorAll("[data-help]").forEach(el=>{

    const key = el.getAttribute("data-help");
    const content = HelpConfig[key];
    if(!content) return;

    el.classList.add("info-icon");
    el.innerHTML = "!";
    el.setAttribute("title","注意事項");

    const header = el.closest(".card-header");

    const box = document.createElement("div");
    box.className = "help-inline";
    box.innerHTML = content;

    header.insertAdjacentElement("afterend", box);

    el.addEventListener("click",()=>{
      box.classList.toggle("show");
    });

  });

  // 明細列表：展開時 summary 改為「隱藏明細列表」，收合時改為「顯示明細列表」
  const content = document.getElementById("content");
  if (content) {
    content.querySelectorAll(".items-list-details").forEach(function (details) {
      const summary = details.querySelector("summary");
      if (!summary) return;
      const showText = summary.getAttribute("data-summary-show") || "顯示明細列表";
      const hideText = summary.getAttribute("data-summary-hide") || "隱藏明細列表";
      details.addEventListener("toggle", function () {
        summary.textContent = details.open ? hideText : showText;
      });
      summary.textContent = details.open ? hideText : showText;
    });
  }
}

function ensureHelpBoundForEl_(el){
  if(!el) return null;
  const key = el.getAttribute && el.getAttribute("data-help");
  if(!key) return null;
  const content = HelpConfig[key];
  if(!content) return null;

  // 已建立過就直接回傳
  const existedId = el.getAttribute("data-help-box-id");
  if(existedId){
    const existed = document.getElementById(existedId);
    if(existed) return existed;
  }

  // 找對應卡片 header
  const header = (typeof el.closest === "function") ? el.closest(".card-header") : null;
  if(!header) return null;

  // 建立 icon 樣式（避免 initHelpComponent 沒跑到時是空白 span）
  try{
    el.classList.add("info-icon");
    if(!String(el.textContent || "").trim()) el.textContent = "!";
    el.setAttribute("title","注意事項");
  }catch(_e0){}

  const box = document.createElement("div");
  box.className = "help-inline";
  box.innerHTML = content;

  // 產生唯一 id 供後續快速定位
  const id = "helpBox-" + key + "-" + String(Date.now()) + "-" + String(Math.floor(Math.random()*1000));
  box.id = id;
  try{ el.setAttribute("data-help-box-id", id); }catch(_e1){}

  header.insertAdjacentElement("afterend", box);
  return box;
}

/**
 * 兼容：部分環境可能讓 initHelpComponent 未執行到，
 * 這裡用事件委派確保「藍色驚嘆號」永遠可點。
 */
function bindHelpDelegated_(){
  try{
    if(document.documentElement && document.documentElement.getAttribute("data-erp-helpbind") === "1") return;
    if(document.documentElement) document.documentElement.setAttribute("data-erp-helpbind","1");
  }catch(_e){}

  document.addEventListener("click", function(ev){
    const t = ev && ev.target;
    if(!t) return;
    const icon = (typeof t.closest === "function") ? t.closest("[data-help], .info-icon") : null;
    if(!icon) return;

    // 只處理有 data-help 的元素（避免誤傷別的 .info-icon）
    const key = icon.getAttribute && icon.getAttribute("data-help");
    if(!key) return;

    const box = ensureHelpBoundForEl_(icon);
    if(!box) return;

    try{
      ev.preventDefault();
      ev.stopPropagation();
    }catch(_e2){}

    box.classList.toggle("show");
  }, true);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", bindHelpDelegated_);
}else{
  bindHelpDelegated_();
}

/*********************************
 * Global Sort Engine v1
 *********************************/

function applySorting(list, field, sortState){

  if(sortState.field === field){
    sortState.asc = !sortState.asc;
  }else{
    sortState.field = field;
    sortState.asc = true;
  }

  const sorted = [...list].sort((a,b)=>{
    if(a[field] > b[field]) return sortState.asc ? 1 : -1;
    if(a[field] < b[field]) return sortState.asc ? -1 : 1;
    return 0;
  });

  updateSortIcons(sortState.field, sortState.asc);

  return sorted;
}


function updateSortIcons(field, asc){

  document.querySelectorAll("th span[id^='sort-']")
    .forEach(el=>el.innerHTML="");

  if(!field) return;

  const icon = asc ? " ▲" : " ▼";
  const target = document.getElementById("sort-"+field);

  if(target) target.innerHTML = icon;
}

/*********************************
 * Global Deactivate Engine v1
 *********************************/

function canDeactivate(recordId, relationConfig){

  for(const config of relationConfig){

    const moduleData = erpData[config.module] || [];

    if(moduleData.some(r => r[config.field] === recordId)){
      return false;
    }
  }

  return true;
}