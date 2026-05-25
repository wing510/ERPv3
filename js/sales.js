/**
 * Sales Orders（API 版）
 * - 建單不扣庫；出貨由 Shipment 模組扣庫
 */

let soEditing = false;
let soItemsDraft = [];
let soProducts = [];
let soCustomers = [];
let soUsers = [];
/** 主檔狀態由系統維護（出貨 bundle 回寫），前端僅顯示與鎖定用 */
let soLoadedStatus_ = "OPEN";
/** 草稿列點列帶回表單後再「新增明細」時，暫存已出貨量下限（訂購數不可小於此） */
let soEditingShippedQtyHold = 0;
/** 點選已存檔列（so_item_id）供「儲存備註」（明細列） */
let soSelectedDbItemId_ = "";
let soLoadInFlight_ = false;
let soPendingLoadId_ = "";
let soLoadWarnToken_ = "";
let soHeaderEditMode_ = false;
let soItemsEditMode_ = false;
let soHeaderSnapshot_ = null;
let soItemsSnapshot_ = null;
/** 載入時快取：是否有未作廢出貨單（用於「僅未出貨可整批改主檔／明細」） */
let soHasShipmentsCached_ = false;

function soSetHeaderReadOnly_(readOnly){
  const ro = !!readOnly;
  ["so_customer_id","so_salesperson_id","so_order_date","so_type","so_reship_ref_type","so_reship_ref_id"].forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    try{ el.disabled = ro; }catch(_e){}
  });
  const rem = document.getElementById("so_remark");
  if(rem){
    try{ rem.disabled = false; }catch(_e2){}
  }
}

function soSetItemsReadOnly_(readOnly){
  const ro = !!readOnly;
  // 新建單 soEditing=false 時，soAllowFullLineOps_() 亦為 false，不可因此鎖死品項表單
  const lineFormLocked = soEditing
    ? (!soAllowFullLineOps_() || !soItemsEditMode_)
    : !!ro;
  ["so_item_product_id","so_item_order_qty","so_item_unit_price"].forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    try{ el.disabled = !!lineFormLocked; }catch(_e){}
  });
  const rm = document.getElementById("so_item_remark");
  if(rm){
    try{ rm.disabled = false; }catch(_eR){}
  }
  const addBtn = document.getElementById("so_add_item_btn");
  if(addBtn) addBtn.disabled = ro;
}

/** 主按鈕：有選取已存檔列時為「套用至本列」，否則「新增明細」 */
function soSyncSOItemAddButton_(){
  const b = document.getElementById("so_add_item_btn");
  if(!b) return;
  const sid = String(soSelectedDbItemId_ || "").trim();
  const isDbSel = !!(sid && !sid.startsWith("DRAFT-"));
  if(soEditing && soItemsEditMode_ && isDbSel && soAllowFullLineOps_()){
    b.textContent = "套用至本列";
    b.title = "將下方表單寫入目前選取的明細列（改數量／單價／產品後按此）";
  }else{
    b.textContent = "新增明細";
    b.title = soEditing ? "將表單內容新增為一筆明細（未選取已存檔列時）" : "將表單內容新增為一筆明細";
  }
}

/** 自後端重載指定 SO 的明細到 soItemsDraft（draft_id = so_item_id），供儲存後或載入時同步畫面 */
async function soReloadItemsDraftFromServer_(soId){
  const id = String(soId || "").trim().toUpperCase();
  if(!id) return;
  let items = [];
  try{
    const r = await callAPI({ action: "list_sales_order_item_by_so", so_id: id }, { method: "GET" });
    items = (r && r.data) ? r.data : [];
  }catch(_e){
    items = (await getAll("sales_order_item")).filter(it => String(it.so_id || "").trim().toUpperCase() === id);
  }
  soItemsDraft = items.map(it => ({
    draft_id: it.so_item_id,
    product_id: it.product_id,
    product_name: (soProducts.find(p => p.product_id === it.product_id) || {}).product_name || "",
    product_spec: (soProducts.find(p => p.product_id === it.product_id) || {}).spec || "",
    order_qty: Number(it.order_qty || 0),
    shipped_qty: Number(it.shipped_qty || 0),
    unit: it.unit || "",
    unit_price: Number(it.unit_price || 0),
    amount: Number(it.amount || 0),
    remark: it.remark || ""
  }));
  renderSOItemsDraft();
}

function soCaptureHeaderSnapshot_(){
  return {
    so_customer_id: String(document.getElementById("so_customer_id")?.value || ""),
    so_salesperson_id: String(document.getElementById("so_salesperson_id")?.value || ""),
    so_order_date: String(document.getElementById("so_order_date")?.value || ""),
    so_remark: String(document.getElementById("so_remark")?.value || ""),
    so_type: String(document.getElementById("so_type")?.value || ""),
    so_reship_ref_type: String(document.getElementById("so_reship_ref_type")?.value || ""),
    so_reship_ref_id: String(document.getElementById("so_reship_ref_id")?.value || "")
  };
}

function soRestoreHeaderSnapshot_(snap){
  if(!snap) return;
  try{ document.getElementById("so_customer_id").value = snap.so_customer_id || ""; }catch(_e){}
  try{ document.getElementById("so_salesperson_id").value = snap.so_salesperson_id || ""; }catch(_e){}
  try{ document.getElementById("so_order_date").value = snap.so_order_date || ""; }catch(_e){}
  try{ document.getElementById("so_remark").value = snap.so_remark || ""; }catch(_e){}
  try{ document.getElementById("so_type").value = snap.so_type || "NORMAL"; }catch(_e){}
  try{ document.getElementById("so_reship_ref_type").value = snap.so_reship_ref_type || ""; }catch(_e){}
  try{ document.getElementById("so_reship_ref_id").value = snap.so_reship_ref_id || ""; }catch(_e){}
  try{ soSyncReshipRefUI_(); }catch(_e2){}
}

function toggleSOHeaderEditSave_(triggerEl){
  if(!soAllowFullHeaderOps_()){
    return showToast("已有出貨或單據已結束，無法編輯主檔欄位。備註請用「儲存備註」。", "error");
  }
  if(!soEditing) return showToast("請先載入銷售單", "error");
  if(!soHeaderEditMode_){
    soHeaderSnapshot_ = soCaptureHeaderSnapshot_();
    soHeaderEditMode_ = true;
    soSetHeaderReadOnly_(false);
    setSOButtons_();
    return;
  }
  // 儲存主檔
  return saveSOHeaderOnly_(triggerEl);
}

function cancelSOHeaderEdit_(){
  if(!soHeaderEditMode_) return;
  const ok = window.erpConfirmDiscardKey_
    ? window.erpConfirmDiscardKey_("confirm.so.cancel_header_edit", { fallback: "主檔已修改尚未儲存，確定放棄變更？" })
    : confirm("主檔已修改尚未儲存，確定放棄變更？");
  if(!ok) return;
  soRestoreHeaderSnapshot_(soHeaderSnapshot_);
  soHeaderSnapshot_ = null;
  soHeaderEditMode_ = false;
  soSetHeaderReadOnly_(true);
  setSOButtons_();
}

function toggleSOItemsEditSave_(triggerEl){
  if(!soAllowFullLineOps_()){
    return showToast("已有出貨或單據已結束，無法編輯／儲存整張明細。明細備註可點列後按「儲存備註」。", "error");
  }
  if(!soEditing) return showToast("請先載入銷售單", "error");
  if(!soItemsEditMode_){
    soItemsSnapshot_ = JSON.parse(JSON.stringify(Array.isArray(soItemsDraft) ? soItemsDraft : []));
    soItemsEditMode_ = true;
    soSetItemsReadOnly_(false);
    setSOButtons_();
    renderSOItemsDraft();
    return;
  }
  return saveSOItemsOnly_(triggerEl);
}

function cancelSOItemsEdit_(){
  if(!soItemsEditMode_) return;
  const ok = window.erpConfirmDiscardKey_
    ? window.erpConfirmDiscardKey_("confirm.so.cancel_items_edit", { fallback: "明細已修改尚未儲存，確定放棄變更？" })
    : confirm("明細已修改尚未儲存，確定放棄變更？");
  if(!ok) return;
  soItemsDraft = Array.isArray(soItemsSnapshot_) ? JSON.parse(JSON.stringify(soItemsSnapshot_)) : [];
  soItemsSnapshot_ = null;
  soItemsEditMode_ = false;
  soSetItemsReadOnly_(true);
  clearSOItemEntry();
  renderSOItemsDraft();
  setSOButtons_();
}

async function saveSOHeaderOnly_(triggerEl){
  const so_id = (document.getElementById("so_id")?.value || "").trim().toUpperCase();
  const customer_id = document.getElementById("so_customer_id")?.value || "";
  const salesperson_id = document.getElementById("so_salesperson_id")?.value || "";
  const order_date = document.getElementById("so_order_date")?.value || "";
  const remark = (document.getElementById("so_remark")?.value || "").trim();
  const so_type = String(document.getElementById("so_type")?.value || "NORMAL").trim().toUpperCase();
  const reshipRef = soReadReshipRef_();

  const missing = [];
  if(!customer_id) missing.push("客戶");
  if(!salesperson_id) missing.push("銷售人員");
  if(!order_date) missing.push("下單日期");
  if(missing.length) return showToast("缺少必填：" + missing.join("、"), "error");
  if(so_type === "OTHER" && !remark) return showToast("選擇「其他」時，請填寫備註/原因", "error");
  const reshipErr = soValidateReshipRef_(so_type);
  if(reshipErr) return showToast(reshipErr, "error");
  if(!soAllowFullHeaderOps_()){
    return showToast("已有出貨或單據已結束，無法變更主檔欄位。請使用「儲存備註」。", "error");
  }

  // 先顯示「儲存中」：避免 await getOne 期間 UI 沒有立即回饋
  showSaveHint(triggerEl || document.getElementById("so_update_btn"));
  try{
    const header = await getOne("sales_order","so_id",so_id).catch(()=>null);

    await updateRecord("sales_order","so_id",so_id,{
      customer_id,
      salesperson_id,
      so_type,
      reship_ref_type: reshipRef.reship_ref_type,
      reship_ref_id: reshipRef.reship_ref_id,
      order_date,
      status: header?.status || "OPEN",
      remark,
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
    showToast("主檔已儲存");
    await renderSalesOrders();
    soHeaderEditMode_ = false;
    soHeaderSnapshot_ = null;
    soSetHeaderReadOnly_(true);
  }finally{
    hideSaveHint();
    setSOButtons_();
  }
}

async function saveSOHeaderRemarkOnly_(triggerEl){
  if(!soEditing) return showToast("請先載入銷售單", "error");
  const so_id = (document.getElementById("so_id")?.value || "").trim().toUpperCase();
  if(!so_id) return;
  const remark = (document.getElementById("so_remark")?.value || "").trim();
  const so_type = String(document.getElementById("so_type")?.value || "NORMAL").trim().toUpperCase();
  if(so_type === "OTHER" && !remark) return showToast("選擇「其他」時，請填寫備註/原因", "error");

  showSaveHint(triggerEl || document.getElementById("so_save_remark_btn"));
  try{
    const header = await getOne("sales_order","so_id",so_id).catch(()=>null);
    if(!header) return showToast("找不到銷售單", "error");
    await updateRecord("sales_order","so_id",so_id,{
      remark,
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
    showToast("備註已儲存");
    try{ if(typeof invalidateCache === "function") invalidateCache("sales_order"); }catch(_eInv){}
    await renderSalesOrders();
  }finally{
    hideSaveHint();
    setSOButtons_();
  }
}

async function saveSOItemsOnly_(triggerEl){
  const so_id = (document.getElementById("so_id")?.value || "").trim().toUpperCase();
  if(!so_id) return;
  if(!soAllowFullLineOps_()){
    return showToast("已有出貨或單據已結束，無法儲存整張明細。明細備註可點列後按「儲存備註」。", "error");
  }
  const items0 = Array.isArray(soItemsDraft) ? soItemsDraft : [];
  if(items0.length === 0) return showToast("缺少必填：銷售明細（至少 1 筆）", "error");

  // 先顯示「儲存中」：避免 await hasSOShipments_ 期間 UI 沒有立即回饋
  showSaveHint(triggerEl || document.getElementById("soItemsCommitGroup"));
  try{
    // 若已有出貨紀錄，禁止重建明細（保持追溯一致）
    const hasShip = await hasSOShipments_(so_id);
    if(hasShip){
      showToast("此銷售單已有出貨紀錄，明細不可修改。", "error");
      return;
    }
    await callAPI({
      action: "reset_sales_order_items_cmd",
      so_id,
      items_json: JSON.stringify(items0.map(function (it) {
        return {
          product_id: it.product_id,
          order_qty: String(it.order_qty),
          unit: it.unit,
          unit_price: String(it.unit_price),
          amount: money2(it.amount).toFixed(2),
          remark: it.remark || ""
        };
      })),
      updated_by: getCurrentUser()
    }, { method: "POST" });
    showToast("明細已儲存");
    await renderSalesOrders();
    await soReloadItemsDraftFromServer_(so_id);
    try{
      soHasShipmentsCached_ = await hasSOShipments_(so_id);
    }catch(_eHs2){
      soHasShipmentsCached_ = false;
    }
    clearSOItemEntry();
    soItemsEditMode_ = false;
    soItemsSnapshot_ = null;
    soSetItemsReadOnly_(true);
  }finally{
    hideSaveHint();
    setSOButtons_();
  }
}

function soBuildIdempotencyKey_(scope, payload){
  const raw = String(scope || "") + "|" + String(payload || "");
  let h = 0;
  for(let i = 0; i < raw.length; i++){
    h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
  }
  return "IDEM-" + String(scope || "SO") + "-" + String(Math.abs(h)).toUpperCase();
}

function downloadSalesOrderPdf(){
  try{
    const so_id = (document.getElementById("so_id")?.value || "").trim().toUpperCase();
    if(!so_id) return showToast("請先載入一張銷售單再下載 PDF", "error");
    const customerId = String(document.getElementById("so_customer_id")?.value || "").trim();
    const salespersonId = String(document.getElementById("so_salesperson_id")?.value || "").trim();
    const orderDate = String(document.getElementById("so_order_date")?.value || "").trim();
    const soRemark = String(document.getElementById("so_remark")?.value || "").trim();
    const fillDate = (function(){
      try{ return String(nowIso16() || "").slice(0,10); }catch(_e){ return ""; }
    })();

    const cust = (soCustomers || []).find(x => String(x?.customer_id || "") === customerId) || null;
    const custName = cust ? (String(cust.customer_name || "").trim() || customerId) : customerId;
    const sp = (soUsers || []).find(x => String(x?.user_id || "") === salespersonId) || null;
    const spName = sp ? (String(sp.user_name || "").trim() || salespersonId) : salespersonId;

    const items = Array.isArray(soItemsDraft) ? soItemsDraft.slice() : [];
    if(items.length === 0) return showToast("此銷售單沒有明細，無法下載 PDF", "error");

    const rowsHtml = items.map((it, idx) => {
      const p = (soProducts || []).find(x => String(x?.product_id || "") === String(it?.product_id || "")) || {};
      const name = String(it.product_name || p.product_name || it.product_id || "");
      const spec = String(it.product_spec || p.spec || "");
      const display = (spec ? `${name}（${spec}）` : name) || String(it.product_id || "");
      const u = String(it.unit || "").trim();
      const oq = u ? `${it.order_qty} ${u}` : String(it.order_qty || "");
      const sq = u ? `${it.shipped_qty} ${u}` : String(it.shipped_qty || "");
      const price = (it.unit_price != null) ? String(it.unit_price) : "";
      const amt = (it.amount != null && typeof it.amount === "number") ? it.amount.toFixed(2) : String(it.amount || "");
      return `<tr>
        <td>${idx+1}</td>
        <td>${erpEscapeHtml_(String(display || ""))}</td>
        <td>${erpEscapeHtml_(oq)}</td>
        <td>${erpEscapeHtml_(sq)}</td>
        <td>${erpEscapeHtml_(price)}</td>
        <td>${erpEscapeHtml_(amt)}</td>
      </tr>`;
    }).join("");

    const total = items.reduce((acc, it) => acc + Number(it && it.amount || 0), 0);
    const body = `
      <div style="display:flex; align-items:flex-end; justify-content:center; position:relative; margin:2px 0 10px;">
        <h1 style="margin:0; text-align:center; font-size:20px; letter-spacing:1px;">銷售紀錄表</h1>
        <div style="position:absolute; right:0; bottom:2px; font-size:12.5px; color:#111;">
          填寫日期：<span style="display:inline-block; min-width:110px; border-bottom:1px solid #111; padding:0 4px;">${erpEscapeHtml_(fillDate || "")}</span>
        </div>
      </div>

      <table style="font-size:13px; table-layout:fixed; width:100%;">
        <tbody>
          <tr>
            <td style="width:110px;"><b>銷售單號</b></td>
            <td style="width:260px;">${erpEscapeHtml_(so_id)}</td>
            <td style="width:110px;"><b>銷售日期</b></td>
            <td>${erpEscapeHtml_(orderDate || "")}</td>
          </tr>
          <tr>
            <td><b>客戶</b></td>
            <td>${erpEscapeHtml_(custName || customerId || "")}</td>
            <td><b>銷售人員</b></td>
            <td>${erpEscapeHtml_(spName || salespersonId || "")}</td>
          </tr>
        </tbody>
      </table>

      <table style="margin-top:10px; font-size:13px; table-layout:fixed; width:100%;">
        <colgroup>
          <col style="width:46px;">
          <col style="width:38%;">
          <col style="width:90px;">
          <col style="width:60px;">
          <col style="width:100px;">
          <col style="width:90px;">
        </colgroup>
        <thead>
          <tr>
            <th style="width:46px;">項次</th>
            <th>產品</th>
            <th style="width:110px;">數量</th>
            <th style="width:110px;">單價</th>
            <th style="width:110px;">金額</th>
            <th style="width:150px;">備註</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((it, idx) => {
            const p = (soProducts || []).find(x => String(x?.product_id || "") === String(it?.product_id || "")) || {};
            const name = String(it.product_name || p.product_name || it.product_id || "");
            const spec = String(it.product_spec || p.spec || "");
            const displayName = (spec ? `${name}（${spec}）` : name) || String(it.product_id || "");
            const u = String(it.unit || "").trim();
            const oq = u ? `${it.order_qty} ${u}` : String(it.order_qty || "");
            const price = (it.unit_price != null) ? String(it.unit_price) : "";
            const amt = (it.amount != null && typeof it.amount === "number") ? it.amount.toFixed(2) : String(it.amount || "");
            const rmk = String(it.remark || "");
            return `<tr>
              <td>${idx+1}</td>
              <td>
                <div style="font-size:11px; color:#334155; line-height:1.1;">產品編號：${erpEscapeHtml_(String(it.product_id || ""))}</div>
                <div style="line-height:1.25; margin-top:2px;">${erpEscapeHtml_(String(displayName || ""))}</div>
              </td>
              <td>${erpEscapeHtml_(oq)}</td>
              <td>${erpEscapeHtml_(price)}</td>
              <td>${erpEscapeHtml_(amt)}</td>
              <td>${erpEscapeHtml_(rmk)}</td>
            </tr>`;
          }).join("")}
          <tr>
            <td colspan="4" style="text-align:right; font-weight:700; background:#eef2f7;">合計</td>
            <td style="font-weight:700;">${erpEscapeHtml_(Number(total || 0).toFixed(2))}</td>
            <td></td>
          </tr>
        </tbody>
      </table>

      <table style="margin-top:12px; font-size:13px;">
        <tbody>
          <tr>
            <td style="width:110px;"><b>其他備註</b></td>
            <td style="height:56px;">${erpEscapeHtml_(soRemark || "")}</td>
          </tr>
        </tbody>
      </table>

      <div style="height:36px;"></div>
      <div style="margin-top:0; font-size:13px; text-align:right;">
        <span style="font-weight:700;">簽收人：</span>＿＿＿＿＿＿＿＿＿＿
        <span style="display:inline-block; width:14px;"></span>
        <span style="font-weight:700;">簽收日期：</span>＿＿＿＿＿＿＿＿＿＿
      </div>
    `;
    // 讓列印/另存 PDF 的預設檔名更好辨識：銷售單號 + 下載日期
    erpOpenPrintWindow_(`${so_id}-${fillDate || ""}`, body);
  }catch(_e){
    showToast("無法產生 PDF：請確認瀏覽器未阻擋彈出視窗", "error");
  }
}

function soSetV_(id, v){
  try{
    if(typeof window.erpSetVById_ === "function") return window.erpSetVById_(id, v);
  }catch(_e){}
  const el = document.getElementById(String(id || ""));
  if(el && "value" in el) el.value = v;
}

function soClear_(ids){
  try{
    if(typeof window.erpClearIds_ === "function") return window.erpClearIds_(ids);
  }catch(_e){}
  const list = Array.isArray(ids) ? ids : [ids];
  for(let i = 0; i < list.length; i++){
    const el = document.getElementById(String(list[i] || ""));
    if(el && "value" in el) el.value = "";
  }
}

function soSyncReshipRefUI_(){
  const tp = String(document.getElementById("so_type")?.value || "NORMAL").trim().toUpperCase();
  const block = document.getElementById("soReshipRefBlock");
  const refType = document.getElementById("so_reship_ref_type");
  const refId = document.getElementById("so_reship_ref_id");
  const on = tp === "RESHIP";
  if(block) block.style.display = on ? "" : "none";
  if(!on){
    soClear_(["so_reship_ref_type","so_reship_ref_id"]);
  }
}

function soReadReshipRef_(){
  return {
    reship_ref_type: String(document.getElementById("so_reship_ref_type")?.value || "").trim().toUpperCase(),
    reship_ref_id: String(document.getElementById("so_reship_ref_id")?.value || "").trim().toUpperCase()
  };
}

function soValidateReshipRef_(soType){
  const t = String(soType || "").trim().toUpperCase();
  if(t !== "RESHIP") return null;
  const ref = soReadReshipRef_();
  if(!ref.reship_ref_type) return "補寄：請選擇參考類型（原 SO / 原出貨）";
  if(ref.reship_ref_type !== "SO" && ref.reship_ref_type !== "SHIPMENT") return "補寄：參考類型不正確";
  if(!ref.reship_ref_id) return "補寄：請填寫參考ID（原 SO ID / 原出貨單 ID）";
  return null;
}

async function hasSOShipments_(soId){
  const id = String(soId || "").trim().toUpperCase();
  if(!id) return false;
  // 只要有「未作廢」出貨單（不論 POSTED/OPEN），就視為已有出貨紀錄
  try{
    const r = await callAPI({ action: "list_shipment_by_so", so_id: id }, { method: "GET" });
    const ships = (r && r.data) ? r.data : [];
    return (ships || []).some(s => String(s?.status || "").toUpperCase() !== "CANCELLED");
  }catch(_e){
    const all = await getAll("shipment").catch(()=>[]);
    return (all || [])
      .filter(s => String(s?.so_id || "").trim().toUpperCase() === id)
      .some(s => String(s?.status || "").toUpperCase() !== "CANCELLED");
  }
}

function isSOFormLocked_(){
  if(!soEditing) return false;
  const st = String(soLoadedStatus_ || "OPEN").trim().toUpperCase();
  return st === "SHIPPED" || st === "CANCELLED";
}

/** 未出貨且未結束單：可整批改主檔（客戶／日期等，不含備註；備註另見「儲存備註」） */
function soAllowFullHeaderOps_(){
  if(!soEditing) return false;
  const st = String(soLoadedStatus_ || "OPEN").trim().toUpperCase();
  if(st === "SHIPPED" || st === "CANCELLED") return false;
  return !soHasShipmentsCached_;
}

function soAllowFullLineOps_(){
  return soAllowFullHeaderOps_();
}

function updateSOStatusHint_(){
  const el = document.getElementById("soStatusHint");
  const shipEl = document.getElementById("soShipState");
  if(!el) return;
  if(soEditing){
    const st = String(soLoadedStatus_ || "OPEN").trim().toUpperCase();
    const label = typeof termLabel === "function" ? termLabel(st) : st;
    if(shipEl){
      const shipHint =
        st === "SHIPPED" ? ["已載入 · 已出畢", "備註可改"] :
        st === "PARTIAL"
          ? (soAllowFullLineOps_()
            ? ["已載入 · 部分出貨", ""]
            : ["已載入 · 部分出貨", "僅備註"])
        : ["已載入 · 未出貨", ""];
      shipEl.textContent =
        (typeof window.erpFlowHintText_ === "function")
          ? window.erpFlowHintText_("出貨", shipHint[0], shipHint[1])
          : ("出貨：" + shipHint[0] + (shipHint[1] ? " · " + shipHint[1] : ""));
      shipEl.style.color = st === "SHIPPED" ? "#166534" : "#64748b";
    }
    const shortLocked = "銷售：已載入 · " + (label || st) + " · 整批已鎖 · 備註可改";
    if(isSOFormLocked_()){
      el.textContent = shortLocked;
      return;
    }
    if(!soAllowFullLineOps_()){
      el.textContent = shortLocked;
      return;
    }
    let editHint = "請先「編輯主檔／編輯明細」再儲存";
    if(soHeaderEditMode_ && soItemsEditMode_){
      editHint = "編輯中：請「儲存主檔／儲存明細」或「取消編輯」";
    }else if(soHeaderEditMode_){
      editHint = "主檔編輯中：請儲存或取消";
    }else if(soItemsEditMode_){
      editHint = "明細編輯中：請儲存或取消";
    }
    el.textContent =
      (typeof window.erpFlowHintText_ === "function")
        ? window.erpFlowHintText_("銷售", "已載入 · " + (label || st), editHint)
        : ("銷售：已載入 · " + (label || st) + " · " + editHint);
    return;
  }
  el.textContent =
    (typeof window.erpFlowHintText_ === "function")
      ? window.erpFlowHintText_("銷售", "新單", "填妥後按「建立」")
      : "銷售：新單 · 填妥後按「建立」";
  if(shipEl){
    shipEl.textContent = "出貨：未載入 · 請先 Load 銷售單";
    shipEl.style.color = "#92400e";
  }
}

function setSOButtons_(){
  const locked = isSOFormLocked_();
  const fullHead = soAllowFullHeaderOps_();
  const fullLine = soAllowFullLineOps_();
  const createBtn = document.getElementById("so_create_btn");
  const updateBtn = document.getElementById("so_update_btn");
  const saveRemarkBtn = document.getElementById("so_save_remark_btn");
  const cancelEditBtn = document.getElementById("so_header_cancel_edit_btn");
  const cancelBtn = document.getElementById("so_cancel_btn");
  const addBtn = document.getElementById("so_add_item_btn");
  const itemsSaveBtn = document.getElementById("so_items_save_btn");
  const itemsCancelEditBtn = document.getElementById("so_items_cancel_edit_btn");
  if(createBtn) createBtn.disabled = locked || soEditing;
  if(updateBtn){
    updateBtn.disabled = !soEditing || !fullHead;
    updateBtn.textContent = soHeaderEditMode_ ? "儲存主檔" : "編輯主檔";
    updateBtn.title =
      !soEditing ? "請先載入銷售單" :
      !fullHead ? "已有出貨或單據已結束，無法整批改主檔（請用「儲存備註」）" :
      (soHeaderEditMode_ ? "儲存主檔" : "編輯主檔");
  }
  if(saveRemarkBtn){
    saveRemarkBtn.disabled = !soEditing;
    saveRemarkBtn.title = !soEditing ? "請先載入銷售單" : "只更新備註欄（不變更客戶／日期等）";
  }
  if(cancelEditBtn){
    cancelEditBtn.style.display = (soEditing && fullHead && soHeaderEditMode_) ? "" : "none";
  }
  if(itemsSaveBtn){
    itemsSaveBtn.disabled = !soEditing || !fullLine;
    itemsSaveBtn.textContent = soItemsEditMode_ ? "儲存明細" : "編輯明細";
    itemsSaveBtn.title =
      !soEditing ? "請先載入銷售單" :
      !fullLine ? "已有出貨或單據已結束，無法整批改明細（明細備註可點列後更新）" :
      (soItemsEditMode_ ? "儲存明細" : "編輯明細");
  }
  if(itemsCancelEditBtn){
    itemsCancelEditBtn.style.display = (soEditing && fullLine && soItemsEditMode_) ? "" : "none";
  }
  if(addBtn) addBtn.disabled = soEditing && (!soItemsEditMode_ || !fullLine);
  soSyncSOItemAddButton_();
  if(cancelBtn){
    if(!soEditing){
      cancelBtn.disabled = true;
      cancelBtn.title = "請先載入銷售單";
    }else{
      const st = String(soLoadedStatus_ || "OPEN").toUpperCase();
      if(st === "CANCELLED"){
        cancelBtn.disabled = true;
        cancelBtn.title = "此銷售單已作廢";
      }else if(st === "SHIPPED"){
        cancelBtn.disabled = true;
        cancelBtn.title = "此銷售單已出畢（SHIPPED），不可作廢";
      }else{
        // 需等載入時的出貨檢查（loadSalesOrder 會補 title）；這裡先給預設
        cancelBtn.disabled = false;
        cancelBtn.title = "作廢銷售單（需先無有效出貨單）";
      }
    }
  }
  updateSOStatusHint_();
}

function formatSOProductDisplay_(productId, productName, productSpec){
  const id = String(productId || "").trim();
  const name = String(productName || id || "").trim();
  const spec = String(productSpec || "").trim();
  if(!name && !id) return "";
  // 對齊其他模組規則：產品名稱（規格）；不把 product_id 混在同一段字串裡
  if(spec) return `${name}（${spec}）`;
  return name || id;
}

function soFindProduct_(productId){
  const id = String(productId || "").trim();
  if(!id) return null;
  return (soProducts || []).find(p => String(p.product_id || "").trim() === id) || null;
}

function money2(n){
  const num = Number(n);
  if(Number.isNaN(num)) return 0;
  return Math.round(num * 100) / 100;
}

async function salesInit(){
  await initSalesDropdowns();
  resetSOForm();
  try{
    const tp = document.getElementById("so_type");
    if(tp && !tp.dataset.bound){
      tp.dataset.bound = "1";
      tp.addEventListener("change", soSyncReshipRefUI_);
    }
  }catch(_e){}
  try{ soSyncReshipRefUI_(); }catch(_e2){}
  bindAutoSearchToolbar_([
    ["so_search_keyword", "input"],
    ["so_search_status", "change"]
  ], () => renderSalesOrders());
  await renderSalesOrders();
}

async function initSalesDropdowns(){
  const [productsRaw, customersRaw, usersRaw] = await Promise.all([
    getAll("product"),
    getAll("customer"),
    getAll("user").catch(() => [])
  ]);
  soProducts = (productsRaw || []).filter(p => p.status === "ACTIVE");
  soCustomers = (customersRaw || []).filter(c => c.status === "ACTIVE");
  soUsers = usersRaw || [];

  const cSel = document.getElementById("so_customer_id");
  if(cSel){
    cSel.innerHTML =
      `<option value="">請選擇</option>` +
      soCustomers.map(c => {
        const name = String(c.customer_name || "").trim();
        const label = name || c.customer_id;
        return `<option value="${c.customer_id}">${label}</option>`;
      }).join("");
  }

  const pSel = document.getElementById("so_item_product_id");
  if(pSel){
    pSel.innerHTML =
      `<option value="">請選擇</option>` +
      soProducts.map(p => {
        const name = String(p.product_name || "").trim();
        const spec = String(p.spec || "").trim();
        const label = formatSOProductDisplay_(p.product_id, name || p.product_id, spec);
        const safeSpec = String(p.spec || "").replace(/"/g, "&quot;");
        return `<option value="${p.product_id}" data-unit="${p.unit}" data-spec="${safeSpec}">${label}</option>`;
      }).join("");
  }

  const spSel = document.getElementById("so_salesperson_id");
  if(spSel){
    const roleZh = function(role){
      const r = String(role || "").trim().toUpperCase();
      if(r === "ADMIN") return "管理員";
      if(r === "CEO") return "CEO";
      if(r === "QA") return "品保";
      if(r === "OP") return "作業";
      if(r === "SL" || r === "SALES") return "業務";
      if(r === "WH" || r === "WAREHOUSE") return "倉管";
      if(r === "FN" || r === "FINANCE") return "財務";
      if(r === "GA" || r === "GENERAL_AFFAIRS") return "總務";
      return r || "—";
    };
    const salesUsers = (soUsers || []).filter(u => String(u.status || "").toUpperCase() === "ACTIVE");
    salesUsers.sort((a,b)=>{
      const an = String(a.user_name || "").trim();
      const bn = String(b.user_name || "").trim();
      if(an && bn && an !== bn) return an.localeCompare(bn);
      return String(a.user_id || "").localeCompare(String(b.user_id || ""));
    });
    spSel.innerHTML =
      `<option value="">請選擇</option>` +
      salesUsers.map(u => {
        const name = String(u.user_name || "").trim();
        const rz = roleZh(u.role);
        const id = String(u.user_id || "").trim();
        const label = name ? `${rz}-${name}(${id})` : `${rz}(${id})`;
        return `<option value="${u.user_id}">${label}</option>`;
      }).join("");
  }
}

function resetSOForm(){
  soEditing = false;
  soItemsDraft = [];
  renderSOItemsDraft();
  soLoadedStatus_ = "OPEN";
  soHasShipmentsCached_ = false;
  soHeaderEditMode_ = false;
  soItemsEditMode_ = false;
  soHeaderSnapshot_ = null;
  soItemsSnapshot_ = null;
  // 新建模式：可直接編輯
  soSetHeaderReadOnly_(false);
  soSetItemsReadOnly_(false);

  const idEl = document.getElementById("so_id");
  if(idEl){
    // 清除：強制產生新單號（避免沿用剛載入的 so_id）
    erpInitAutoId_("so_id", { gen: () => (typeof generateId === "function" ? generateId("SO") : ""), force: true });
    idEl.disabled = false;
  }

  const d = document.getElementById("so_order_date");
  if(d) d.value = nowIso16().slice(0, 10);

  soClear_(["so_customer_id", "so_salesperson_id", "so_reship_ref_type", "so_reship_ref_id", "so_remark"]);

  const tp = document.getElementById("so_type");
  if(tp) tp.value = "NORMAL";
  try{ soSyncReshipRefUI_(); }catch(_eSync){}

  clearSOItemEntry();
  setSOButtons_();
}

function clearSOItemEntry(){
  soEditingShippedQtyHold = 0;
  soSelectedDbItemId_ = "";
  soClear_([
    "so_item_product_id",
    "so_item_order_qty",
    "so_item_unit",
    "so_item_unit_price",
    "so_item_amount",
    "so_item_remark"
  ]);
  soSetV_("so_item_amount", "0.00");
  syncSOItemUnitSuffix_();
  soSyncSOItemAddButton_();
}

function isSOItemDraftRow_(it){
  return String(it?.draft_id || "").startsWith("DRAFT-");
}

/** 明細列表「狀態」欄：對齊投料表（草稿／已送加工）概念 */
function formatSOItemLineStatus_(it){
  if(isSOItemDraftRow_(it)) return "草稿";
  const oq = Number(it.order_qty || 0);
  const sq = Number(it.shipped_qty || 0);
  if(oq <= 0) return "已存檔";
  if(sq <= 0) return "未出貨";
  if(sq + 1e-9 >= oq) return "已出畢";
  return "部分出貨";
}

function selectSOItemDbRow_(soItemId){
  const id = String(soItemId || "");
  const it = soItemsDraft.find(x => x.draft_id === id);
  if(!it) return;
  soSelectedDbItemId_ = id;
  const sel = document.getElementById("so_item_product_id");
  if(sel) sel.value = it.product_id || "";
  onSelectSOProduct();
  const qtyEl = document.getElementById("so_item_order_qty");
  if(qtyEl) qtyEl.value = String(it.order_qty ?? "");
  const priceEl = document.getElementById("so_item_unit_price");
  if(priceEl) priceEl.value = String(it.unit_price ?? "");
  calcSOAmount();
  const rm = document.getElementById("so_item_remark");
  if(rm) rm.value = String(it.remark || "");
  const canEdit = soAllowFullLineOps_();
  const hint =
    (typeof window.erpHintPickedLineText_ === "function")
      ? window.erpHintPickedLineText_({
          canEditStructure: !!canEdit,
          needsEditItemsFirst: true,
          extraStructureHint: "改數量／單價後請按「套用至本列」"
        })
      : (canEdit
        ? "已帶入明細（僅改備註請按「儲存備註」；改數量／單價請先「編輯明細」；改數量／單價後請按「套用至本列」）"
        : "已帶入明細（僅改備註請按「儲存備註」）");
  showToast(hint);
  soSyncSOItemAddButton_();
}

async function updateSelectedSOItemRemark(triggerEl){
  if(!soEditing) return showToast("請先載入銷售單", "error");
  const sid = String(soSelectedDbItemId_ || "").trim();
  if(!sid || sid.startsWith("DRAFT-")){
    return showToast("請先點選一筆已存檔的明細列（非草稿列）", "error");
  }
  const remark = (document.getElementById("so_item_remark")?.value || "").trim();

  showSaveHint(triggerEl || document.getElementById("soItemsCommitGroup"));
  try{
    await updateRecord("sales_order_item", "so_item_id", sid, {
      remark,
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
    const row = soItemsDraft.find(x => x.draft_id === sid);
    if(row) row.remark = remark;
    renderSOItemsDraft();
    showToast("明細備註已儲存");
  }finally{
    hideSaveHint();
    setSOButtons_();
  }
}

function beginEditSOItemDraft_(draftId){
  if(!soAllowFullLineOps_()){
    return showToast("已有出貨或單據已結束，無法從列表帶入草稿編輯。明細備註可點列後更新。", "error");
  }
  if(soEditing && !soItemsEditMode_){
    return showToast("請先按「編輯明細」再修改", "error");
  }
  const id = String(draftId || "");
  const it = soItemsDraft.find(x => x.draft_id === id);
  if(!it) return;

  soSelectedDbItemId_ = "";
  soEditingShippedQtyHold = Number(it.shipped_qty || 0);
  soItemsDraft = soItemsDraft.filter(x => x.draft_id !== id);

  const sel = document.getElementById("so_item_product_id");
  if(sel) sel.value = it.product_id || "";
  onSelectSOProduct();
  const qtyEl = document.getElementById("so_item_order_qty");
  if(qtyEl) qtyEl.value = String(it.order_qty ?? "");
  const priceEl = document.getElementById("so_item_unit_price");
  if(priceEl) priceEl.value = String(it.unit_price ?? "");
  calcSOAmount();
  const rm = document.getElementById("so_item_remark");
  if(rm) rm.value = String(it.remark || "");

  renderSOItemsDraft();
  soSyncSOItemAddButton_();
}

function syncSOItemUnitSuffix_(){
  syncErpQtyUnitSuffix_("so_item_unit", "so_item_unit_suffix");
}

function onSelectSOProduct(){
  const sel = document.getElementById("so_item_product_id");
  const opt = sel?.selectedOptions?.[0];
  const uEl = document.getElementById("so_item_unit");
  if(!uEl) return;
  if(!opt || !String(sel?.value || "").trim()){
    soClear_("so_item_unit");
    syncSOItemUnitSuffix_();
    return;
  }
  uEl.value = opt.getAttribute("data-unit") || "";
  syncSOItemUnitSuffix_();
}

function calcSOAmount(){
  const qty = Number(document.getElementById("so_item_order_qty")?.value || 0);
  const price = Number(document.getElementById("so_item_unit_price")?.value || 0);
  const amount = money2(qty * price).toFixed(2);
  const el = document.getElementById("so_item_amount");
  if(el) el.value = amount;
}

function addSOItemDraft(){
  if(soEditing && !soAllowFullLineOps_()){
    return showToast("已有出貨或單據已結束，無法新增／套用明細（備註除外）。", "error");
  }
  if(soEditing && !soItemsEditMode_){
    return showToast("請先按「編輯明細」再新增/修改明細", "error");
  }
  const sel = document.getElementById("so_item_product_id");
  const product_id = sel?.value || "";
  const order_qty = Number(document.getElementById("so_item_order_qty")?.value || 0);
  const unit = document.getElementById("so_item_unit")?.value || "";
  const unit_price = Number(document.getElementById("so_item_unit_price")?.value || 0);
  const amount = money2(order_qty * unit_price);
  const remark = (document.getElementById("so_item_remark")?.value || "").trim();

  if(!product_id) return showToast("請選擇產品","error");
  if(!order_qty || order_qty <= 0) return showToast("訂購數量需大於 0","error");
  if(!unit) return showToast("產品單位缺失","error");

  // 正常訂單：必須有單價（避免後續對帳/業績無法計算）
  const soType = String(document.getElementById("so_type")?.value || "NORMAL").trim().toUpperCase();
  if(soType === "NORMAL" && !(unit_price > 0)){
    return showToast("正常訂單：單價必填且需大於 0", "error");
  }

  const sid = String(soSelectedDbItemId_ || "").trim();
  const existingIdx =
    sid && !sid.startsWith("DRAFT-")
      ? soItemsDraft.findIndex(x => String(x.draft_id || "") === sid)
      : -1;
  const holdShip =
    existingIdx >= 0
      ? Number(soItemsDraft[existingIdx].shipped_qty || 0)
      : Number(soEditingShippedQtyHold || 0);
  if(holdShip > 0 && order_qty + 1e-9 < holdShip){
    return showToast(`訂購數量不可小於已出貨量（${holdShip}）`, "error");
  }

  const opt = sel?.selectedOptions?.[0];
  const p = soFindProduct_(product_id);
  const product_name = String(p?.product_name || product_id || "").trim();
  const product_spec = opt?.getAttribute("data-spec") || "";

  if(existingIdx >= 0){
    const row = soItemsDraft[existingIdx];
    row.product_id = product_id;
    row.product_name = product_name;
    row.product_spec = product_spec;
    row.order_qty = order_qty;
    row.unit = unit;
    row.unit_price = money2(unit_price);
    row.amount = amount;
    row.remark = remark;
    showToast("已套用至本列；請按「儲存明細」寫入後端。");
  }else{
    const draft_id = "DRAFT-" + Date.now() + "-" + Math.floor(Math.random()*1000);
    soItemsDraft.push({
      draft_id,
      product_id,
      product_name,
      product_spec,
      order_qty,
      shipped_qty: holdShip,
      unit,
      unit_price: money2(unit_price),
      amount,
      remark
    });
  }

  clearSOItemEntry();
  renderSOItemsDraft();
}

function removeSOItemDraft(draftId){
  if(soEditing && !soAllowFullLineOps_()){
    return showToast("已有出貨或單據已結束，無法刪除明細。", "error");
  }
  if(soEditing && !soItemsEditMode_){
    return showToast("請先按「編輯明細」再刪除明細", "error");
  }
  const id = String(draftId || "");
  if(id && String(soSelectedDbItemId_ || "") === id){
    clearSOItemEntry();
  }
  soItemsDraft = soItemsDraft.filter(x => x.draft_id !== draftId);
  renderSOItemsDraft();
}

function renderSOItemsDraft(){
  const tbody = document.getElementById("soItemsBody");
  if(!tbody) return;

  tbody.innerHTML = "";
  const footLock = isSOFormLocked_();
  const fullLine = soAllowFullLineOps_();
  soItemsDraft.forEach((it, idx) => {
    const p = soProducts.find(x => x.product_id === it.product_id) || {};
    const display = formatSOProductDisplay_(
      it.product_id,
      it.product_name || p.product_name || it.product_id,
      it.product_spec || p.spec || ""
    );
    const safeId = String(it.draft_id || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const draftClick =
      soItemsEditMode_ && fullLine && !footLock
        ? `onclick="beginEditSOItemDraft_('${safeId}')"`
        : "";
    const savedClick = soEditing ? `onclick="selectSOItemDbRow_('${safeId}')"` : "";
    const rowClick = isSOItemDraftRow_(it) ? draftClick : savedClick;
    const rowCursor = rowClick ? "cursor:pointer;" : "";
    const opHtml =
      soItemsEditMode_ && fullLine && !footLock
        ? `<button type="button" class="btn-secondary" onclick="event.stopPropagation(); removeSOItemDraft('${safeId}')">刪除</button>`
        : "—";
    const su = String(it.unit || "").trim();
    const orderQtyCell = su ? `${it.order_qty} ${su.replace(/</g, "")}` : String(it.order_qty);
    tbody.innerHTML += `
      <tr style="${rowCursor}" ${rowClick}>
        <td>${idx+1}</td>
        <td title="${String(display).replace(/"/g, "&quot;")}">${display}</td>
        <td>${orderQtyCell}</td>
        <td>${it.shipped_qty}</td>
        <td>${it.unit_price}</td>
        <td>${it.amount.toFixed(2)}</td>
        <td>${formatSOItemLineStatus_(it)}</td>
        <td>${opHtml}</td>
      </tr>
    `;
  });
  soSyncSOItemAddButton_();
}

async function createSalesOrder(triggerEl){
  const so_id = (document.getElementById("so_id")?.value || "").trim().toUpperCase();
  document.getElementById("so_id").value = so_id;
  const customer_id = document.getElementById("so_customer_id")?.value || "";
  const salesperson_id = document.getElementById("so_salesperson_id")?.value || "";
  const so_type = String(document.getElementById("so_type")?.value || "NORMAL").trim().toUpperCase();
  const order_date = document.getElementById("so_order_date")?.value || "";
  const status = "OPEN"; // 狀態由系統依出貨自動維護
  const remark = (document.getElementById("so_remark")?.value || "").trim();
  const reshipRef = soReadReshipRef_();

  const missing = [];
  if(!so_id) missing.push("銷售單ID");
  if(!customer_id) missing.push("客戶");
  if(!salesperson_id) missing.push("銷售人員");
  if(!order_date) missing.push("下單日期");
  if(soItemsDraft.length === 0) missing.push("品項（至少 1 筆）");
  if(missing.length) return showToast("缺少必填：" + missing.join("、"), "error");

  if(!so_type) return showToast("請選擇 用途", "error");
  if(so_type === "OTHER" && !remark) return showToast("選擇「其他」時，請填寫備註/原因", "error");
  const reshipErr = soValidateReshipRef_(so_type);
  if(reshipErr) return showToast(reshipErr, "error");
  if(so_type === "NORMAL"){
    const bad = (soItemsDraft || []).some(x => !(Number(x?.unit_price || 0) > 0));
    if(bad) return showToast("正常訂單：所有品項都必須有單價（>0）", "error");
  }

  showSaveHint(triggerEl || document.getElementById("soItemsCommitGroup"));
  try {
  const exists = await getOne("sales_order","so_id",so_id).catch(()=>null);
  if(exists) return showToast("銷售單ID 已存在","error");

  await createRecord("sales_order", {
    so_id,
    customer_id,
    salesperson_id,
    so_type,
    reship_ref_type: reshipRef.reship_ref_type,
    reship_ref_id: reshipRef.reship_ref_id,
    // 補寄/衍生單：同步寫入 parent_ref（讓交易鏈「延伸上一段」更穩）
    parent_ref_type: reshipRef.reship_ref_type || "",
    parent_ref_id: reshipRef.reship_ref_id || "",
    order_date,
    status,
    remark,
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    updated_by: "",
    updated_at: ""
  });

  // 讓每筆銷售單明細與主單共用同一條 transaction_id（由後端若缺則自動產生）
  const soAfter = await getOne("sales_order", "so_id", so_id).catch(() => null);
  const txId = String(soAfter && soAfter.transaction_id || "").trim().toUpperCase();

  for(let idx=0; idx<soItemsDraft.length; idx++){
    const it = soItemsDraft[idx];
    const so_item_id = `SOI-${so_id}-${String(idx+1).padStart(3,"0")}`;
    await createRecord("sales_order_item", {
      so_item_id,
      so_id,
      product_id: it.product_id,
      transaction_id: txId,
      parent_ref_type: "SO",
      parent_ref_id: so_id,
      order_qty: String(it.order_qty),
      shipped_qty: "0",
      unit: it.unit,
      unit_price: String(it.unit_price),
      amount: it.amount.toFixed(2),
      remark: it.remark || "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: ""
    });
  }

  await renderSalesOrders();
  resetSOForm();
  showToast("銷售單已建立");
  } finally {
    hideSaveHint();
    setSOButtons_();
  }
}

async function loadSalesOrder(soId, triggerEl){
  const id = String(soId || "").trim().toUpperCase();
  if(!id) return;
  if(soLoadInFlight_){
    soPendingLoadId_ = id;
    try{
      const hint = document.getElementById("soStatusHint");
      if(hint) hint.textContent = `銷售：載入中 · 已排隊 ${id}`;
    }catch(_e){}
    return;
  }
  soLoadInFlight_ = true;
  try{
    if(typeof erpBeginLoadWarnToast_ === "function"){
      soLoadWarnToken_ = erpBeginLoadWarnToast_(`載入中...請稍等（${id}）`);
    }
  }catch(_eWarn){}
  try{ if(triggerEl) triggerEl.disabled = true; }catch(_e){}
  try{
    const hint = document.getElementById("soStatusHint");
    if(hint) hint.textContent = `銷售：載入中 · ${id}`;
    const shipHint = document.getElementById("soShipState");
    if(shipHint) shipHint.textContent = "出貨：載入中…";
  }catch(_e){}
  try{
    if(typeof scrollToEditorTop === "function") scrollToEditorTop();
    const so = await getOne("sales_order","so_id",id);
    if(!so) return;

    soEditing = true;
    soHeaderEditMode_ = false;
    soItemsEditMode_ = false;
    soHeaderSnapshot_ = null;
    soItemsSnapshot_ = null;
    // Load 預設唯讀（需按「編輯主檔／編輯明細」才可修改）
    soLoadedStatus_ = String(so.status || "OPEN").toUpperCase();
    try{
      soHasShipmentsCached_ = await hasSOShipments_(id);
    }catch(_eHs){
      soHasShipmentsCached_ = false;
    }
    soSetHeaderReadOnly_(true);
    soSetItemsReadOnly_(true);
    clearSOItemEntry();
    const idEl = document.getElementById("so_id");
    idEl.value = so.so_id;
    idEl.disabled = true;

  document.getElementById("so_customer_id").value = so.customer_id || "";
  const sp = document.getElementById("so_salesperson_id");
  if(sp) sp.value = so.salesperson_id || "";
  const tp = document.getElementById("so_type");
  if(tp) tp.value = String(so.so_type || "NORMAL").trim().toUpperCase() || "NORMAL";
  const rt = document.getElementById("so_reship_ref_type");
  if(rt) rt.value = String(so.reship_ref_type || "").trim().toUpperCase();
  const rid = document.getElementById("so_reship_ref_id");
  if(rid) rid.value = String(so.reship_ref_id || "").trim().toUpperCase();
  try{ soSyncReshipRefUI_(); }catch(_eSync2){}
  document.getElementById("so_order_date").value = dateInputValue_(so.order_date);
  document.getElementById("so_remark").value = so.remark || "";

    await soReloadItemsDraftFromServer_(id);
    const stLoaded = String(soLoadedStatus_ || "").toUpperCase();
    if(stLoaded === "SHIPPED" || stLoaded === "CANCELLED"){
      showToast("此銷售單已結束：整批主檔／明細已鎖；備註仍可更新。", "warn");
    }
    // 作廢按鈕狀態（對齊 PO/進口）：若已有未作廢出貨單，禁止作廢
    try{
    const cancelBtn = document.getElementById("so_cancel_btn");
    if(cancelBtn){
      if(stLoaded === "CANCELLED"){
        cancelBtn.disabled = true;
        cancelBtn.title = "此銷售單已作廢";
      }else if(stLoaded === "SHIPPED"){
        cancelBtn.disabled = true;
        cancelBtn.title = "此銷售單已出畢（SHIPPED），不可作廢";
      }else{
        const hasShip = soHasShipmentsCached_;
        if(hasShip){
          cancelBtn.disabled = true;
          cancelBtn.title = "此銷售單已有未作廢出貨單，請先作廢所有出貨單";
        }else{
          cancelBtn.disabled = false;
          cancelBtn.title = "作廢銷售單（需先無有效出貨單）";
        }
      }
    }
    }catch(_e){}
    setSOButtons_();
    if(typeof scrollToEditorTop === "function") scrollToEditorTop();
  }finally{
    try{
      if(typeof erpEndLoadWarnToast_ === "function"){
        erpEndLoadWarnToast_(soLoadWarnToken_);
      }
      soLoadWarnToken_ = "";
    }catch(_eWarnEnd){}
    try{ if(triggerEl) triggerEl.disabled = false; }catch(_e2){}
    soLoadInFlight_ = false;
    // 若載入期間又點了其他單號，完成後自動載入最後一次點選的單號
    try{
      const nextId = String(soPendingLoadId_ || "").trim().toUpperCase();
      soPendingLoadId_ = "";
      if(nextId && nextId !== id){
        setTimeout(function(){
          try{ loadSalesOrder(nextId); }catch(_e){}
        }, 0);
      }
    }catch(_eNext){}
  }
}

async function cancelSalesOrder(triggerEl){
  if(!soEditing) return showToast("請先載入一張銷售單再作廢","error");
  const so_id = (document.getElementById("so_id")?.value || "").trim().toUpperCase();
  if(!so_id) return showToast("銷售單ID 缺失","error");

  showSaveHint(triggerEl || document.getElementById("soItemsCommitGroup"));
  try{
    const header = await getOne("sales_order","so_id",so_id).catch(()=>null);
    if(!header) return showToast("找不到銷售單","error");
    const st = String(header.status || "").toUpperCase();
    if(st === "CANCELLED") return showToast("此銷售單已作廢","error");
    if(st === "SHIPPED") return showToast("此銷售單已出畢（SHIPPED），不可作廢","error");

    const hasShip = await hasSOShipments_(so_id);
    if(hasShip){
      return showToast("此銷售單已有未作廢出貨單，請先至「出貨管理」作廢所有出貨單後再作廢銷售單。","error");
    }

    const note = prompt("作廢原因（可留空）") ?? "";
    const ok = window.erpConfirmActionKey_("confirm.cancel.so", {
      so_id,
      fallback: `確定作廢此銷售單？\n- SO：${so_id}\n\n限制：需先作廢所有出貨單。`
    });
    if(!ok) return;

    await callAPI(
      {
        action: "cancel_sales_order_bundle",
        so_id,
        idempotency_key: soBuildIdempotencyKey_("SO_CANCEL", [so_id, String(note || "").trim(), getCurrentUser()]),
        cancel_note: String(note || "").trim(),
        updated_by: getCurrentUser()
      },
      { method: "POST" }
    );

    soLoadedStatus_ = "CANCELLED";
    if(typeof invalidateCache === "function") invalidateCache("sales_order");
    await renderSalesOrders();
    await loadSalesOrder(so_id);
    showToast("銷售單已作廢（CANCELLED）");
  } catch(err){
    const msg = String(err && err.message != null ? err.message : err || "");
    const backendErrors = err && Array.isArray(err.backendErrors) ? err.backendErrors : [];
    const full = (msg + " " + backendErrors.join(" ")).toLowerCase();
    const shouldReload =
      /duplicate\s+request\s+detected/.test(full) ||
      /already\s+cancelled|already\s+canceled|already\s+posted/.test(full) ||
      /狀態.*(已作廢|已過帳|不可重做)/.test(full) ||
      /此單據已被處理|狀態已變更/.test(full);
    if(shouldReload){
      showToast("狀態可能已更新，系統正在為你重新載入…", "warn", 6000);
      try{
        if(typeof invalidateCache === "function") invalidateCache("sales_order");
        await renderSalesOrders();
        await loadSalesOrder(so_id);
        showToast("已重新載入最新資料，請確認後再操作", "warn", 6000);
        return;
      }catch(_eReload){
        showToast("自動重新載入失敗，請手動重新載入後再試", "error");
        return;
      }
    }
    if(!(err && err.erpApiToastShown)){
      showToast("作廢失敗：請稍後重試；若仍失敗請重新載入後再試", "error");
    }
  } finally {
    hideSaveHint();
    setSOButtons_();
  }
}

async function updateSalesOrder(triggerEl){
  if(!soAllowFullHeaderOps_()){
    return showToast("已有出貨或單據已結束，無法使用整單更新。請改用「儲存備註」或明細備註。", "error");
  }
  if(!soEditing) return showToast("請先載入銷售單再更新","error");
  const so_id = (document.getElementById("so_id")?.value || "").trim().toUpperCase();
  const customer_id = document.getElementById("so_customer_id")?.value || "";
  const salesperson_id = document.getElementById("so_salesperson_id")?.value || "";
  const order_date = document.getElementById("so_order_date")?.value || "";
  const remark = (document.getElementById("so_remark")?.value || "").trim();
  const so_type = String(document.getElementById("so_type")?.value || "NORMAL").trim().toUpperCase();
  const reshipRef = soReadReshipRef_();

  const missing = [];
  if(!customer_id) missing.push("客戶");
  if(!salesperson_id) missing.push("銷售人員");
  if(!order_date) missing.push("下單日期");
  if(missing.length) return showToast("缺少必填：" + missing.join("、"), "error");
  if(so_type === "OTHER" && !remark) return showToast("選擇「其他」時，請填寫備註/原因", "error");
  const reshipErr = soValidateReshipRef_(so_type);
  if(reshipErr) return showToast(reshipErr, "error");

  // 明細必填：至少 1 筆（避免後端 command 因缺明細而拒絕）
  const items0 = Array.isArray(soItemsDraft) ? soItemsDraft : [];
  if(items0.length === 0){
    return showToast("缺少必填：銷售明細（至少 1 筆）", "error");
  }

  const header = await getOne("sales_order","so_id",so_id).catch(()=>null);

  showSaveHint(triggerEl || document.getElementById("soItemsCommitGroup"));
  try {
  // 若已有出貨紀錄，禁止重建明細（保持追溯一致）
  let hasShip = false;
  try{
    let relatedShipmentIds = [];
    try{
      const rShips = await callAPI({ action: "list_shipment_by_so", so_id: so_id }, { method: "GET" });
      const ships = (rShips && rShips.data) ? rShips.data : [];
      relatedShipmentIds = (ships || []).map(s => String(s.shipment_id || "").trim()).filter(Boolean);
    }catch(_e0){
      // fallback：先用近期出貨（避免全表 shipment），最後才全表
      try{
        const rr = await callAPI({ action: "list_shipment_recent", days: 365, _ts: String(Date.now()) }, { method: "POST" });
        const recent = (rr && rr.data) ? rr.data : [];
        relatedShipmentIds = (recent || [])
          .filter(s => String(s.so_id || "").toUpperCase() === so_id)
          .map(s => String(s.shipment_id || "").trim())
          .filter(Boolean);
      }catch(_eRecent){
        const allShips = await getAll("shipment").catch(()=>[]);
        relatedShipmentIds = (allShips || [])
          .filter(s => String(s.so_id || "").toUpperCase() === so_id)
          .map(s => String(s.shipment_id || "").trim())
          .filter(Boolean);
      }
    }

    if(relatedShipmentIds.length){
      // 優先一次打包查詢（避免逐單多次 API）
      let anyItems = null;
      try{
        const r = await callAPI({
          action: "list_shipment_item_by_shipments",
          shipment_ids_json: JSON.stringify(relatedShipmentIds)
        }, { method: "POST" });
        const rows = (r && r.data) ? r.data : [];
        anyItems = Array.isArray(rows) ? (rows.length > 0) : false;
      }catch(_ePack){
        anyItems = null;
      }

      if(anyItems === true){
        hasShip = true;
      }else if(anyItems === false){
        hasShip = false;
      }else{
        // fallback：逐單查 shipment_item（避免全表下載）
        const rItems = await Promise.all(relatedShipmentIds.map(async (sid) => {
          try{
            const r = await callAPI({ action: "list_shipment_item_by_shipment", shipment_id: sid });
            return (r && r.data) ? r.data : [];
          }catch(_e){
            return null;
          }
        }));

        hasShip = rItems.some(arr => Array.isArray(arr) && arr.length > 0);
        if(!hasShip && rItems.every(arr => arr === null)){
          const shipments = await getAll("shipment_item").catch(()=>[]);
          hasShip = shipments.some(s => s.so_id === so_id);
        }
      }
    }
  }catch(_e2){
    // 最後兜底：避免直接全表 shipment_item
    try{
      const rShips = await callAPI({ action: "list_shipment_by_so", so_id: so_id }, { method: "GET" });
      const ships = (rShips && rShips.data) ? rShips.data : [];
      const ids = (ships || []).map(s => String(s.shipment_id || "").trim()).filter(Boolean);
      if(ids.length){
        const r = await callAPI({ action: "list_shipment_item_by_shipments", shipment_ids_json: JSON.stringify(ids) }, { method: "POST" });
        const rows = (r && r.data) ? r.data : [];
        hasShip = Array.isArray(rows) && rows.length > 0;
      }else{
        hasShip = false;
      }
    }catch(_e3){
      const shipments = await getAll("shipment_item").catch(()=>[]);
      hasShip = shipments.some(s => s.so_id === so_id);
    }
  }

  await updateRecord("sales_order","so_id",so_id,{
    customer_id,
    salesperson_id,
    so_type: String(document.getElementById("so_type")?.value || header?.so_type || "NORMAL").trim().toUpperCase(),
    reship_ref_type: reshipRef.reship_ref_type,
    reship_ref_id: reshipRef.reship_ref_id,
    order_date,
    // 狀態由系統依出貨單自動維護；此處維持原值
    status: header?.status || "OPEN",
    remark,
    updated_by: getCurrentUser(),
    updated_at: nowIso16()
  });
  soLoadedStatus_ = String(header?.status || "OPEN").toUpperCase();

  if(hasShip){
    showToast("此銷售單已有出貨紀錄，已更新主檔但不允許重建明細。", "error");
    await renderSalesOrders();
    return;
  }

  // 重建明細（尚未出貨才允許）：改由後端 command 一次完成（避免 direct delete 被禁止）
  await callAPI({
    action: "reset_sales_order_items_cmd",
    so_id,
    items_json: JSON.stringify((soItemsDraft || []).map(function (it) {
      return {
        product_id: it.product_id,
        order_qty: String(it.order_qty),
        unit: it.unit,
        unit_price: String(it.unit_price),
        amount: money2(it.amount).toFixed(2),
        remark: it.remark || ""
      };
    })),
    updated_by: getCurrentUser()
  }, { method: "POST" });

  await soReloadItemsDraftFromServer_(so_id);
  await renderSalesOrders();
  showToast("銷售單已更新");
  } finally {
    hideSaveHint();
    setSOButtons_();
  }
}

function resetSalesSearch(){
  soClear_(["so_search_keyword","so_search_status"]);
  renderSalesOrders();
}

async function renderSalesOrders(){
  const tbody = document.getElementById("soTableBody");
  if(!tbody) return;
  setTbodyLoading_(tbody, 6);
  const qKw = (document.getElementById("so_search_keyword")?.value || "").trim().toUpperCase();
  const qSt = (document.getElementById("so_search_status")?.value || "").trim().toUpperCase();
  let list = [];
  try{
    const r = await callAPI({ action: "list_sales_order_recent", days: 365, _ts: String(Date.now()) }, { method: "POST" });
    list = (r && r.data) ? r.data : [];
  }catch(_e){
    list = await getAll("sales_order").catch(()=>[]);
  }
  const userMap = {};
  (soUsers || []).forEach(u => { if(u && u.user_id) userMap[u.user_id] = u; });
  const customerMap = {};
  (soCustomers || []).forEach(c => { if(c && c.customer_id) customerMap[c.customer_id] = c; });

  const filtered = (list || []).filter(so => {
    const stOk = !qSt || String(so.status || "").toUpperCase() === qSt;
    if(!stOk) return false;
    if(!qKw) return true;
    const sid = String(so.so_id || "").toUpperCase();
    const cid = String(so.customer_id || "").toUpperCase();
    const spid = String(so.salesperson_id || "").toUpperCase();
    const spUser = userMap[so.salesperson_id] || null;
    const spName = String(spUser?.user_name || "").toUpperCase();
    const cn = String(customerMap[so.customer_id]?.customer_name || "").toUpperCase();
    return sid.includes(qKw) || cid.includes(qKw) || (cn && cn.includes(qKw)) || spid.includes(qKw) || (spName && spName.includes(qKw));
  });
  const sorted = [...filtered].sort((a,b)=>{
    const ta = String(a?.order_date || a?.created_at || "");
    const tb = String(b?.order_date || b?.created_at || "");
    if(ta !== tb) return tb.localeCompare(ta);
    return String(b?.created_at || "").localeCompare(String(a?.created_at || ""));
  });
  tbody.innerHTML = "";
  if (!sorted.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#64748b;padding:24px;">尚無銷售單。請先至「產品」「客戶」建立主檔，再於銷售單填妥主檔與明細後按明細下方「建立」。</td></tr>';
    return;
  }
  sorted.forEach(so => {
    const sp = userMap[so.salesperson_id] || null;
    const spLabel = so.salesperson_id
      ? (String(sp?.user_name || "").trim() || "—")
      : "";
    const typeCode = String(so.so_type || "NORMAL").trim().toUpperCase() || "NORMAL";
    const typeLabel = (typeof termLabelZhOnly === "function")
      ? termLabelZhOnly(typeCode)
      : typeCode;
    const c = customerMap[so.customer_id] || null;
    const customerNameOnly = (c && c.customer_name) ? c.customer_name : (so.customer_id || "");
    tbody.innerHTML += `
      <tr>
        <td>${so.so_id || ""}</td>
        <td>${customerNameOnly}</td>
        <td>${spLabel}</td>
        <td>${typeLabel}</td>
        <td>${so.order_date || ""}</td>
        <td>${termLabelZhOnly(so.status)}</td>
        <td>
          <button class="btn-edit" onclick="loadSalesOrder('${so.so_id}', this)">Load</button>
          <button type="button" class="btn-secondary" onclick="gotoShippingFromSO_('${so.so_id}')">出貨</button>
        </td>
      </tr>
    `;
  });
}

function gotoShippingFromSO_(soId){
  const id = String(soId || "").trim().toUpperCase();
  if(!id) return;
  try{ window.__ERP_PREFILL_SHIP_SO_ID__ = id; }catch(_e){}
  if(typeof navigate === "function"){
    navigate("shipping");
  }else{
    showToast("無法切換到出貨頁面（navigate 未定義）", "error");
  }
}

