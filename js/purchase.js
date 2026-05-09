/*********************************
 * Purchase Orders Module v2 (API 版)
 * STEP 1：PO 不產生庫存
 *********************************/

let poEditing = false;
let poItemsDraft = [];
let poProducts = [];
let poSuppliers = [];
let purchaseSort = { field:"", asc:true };
let poReadOnly = false;
/** 載入時主檔 status（OPEN／PARTIAL／CLOSED／CANCELLED），供鎖定與提示用 */
let poLoadedStatus_ = "";
let poSelectedDbItemId_ = "";
let poLoadInFlight_ = false;
let poPendingLoadId_ = "";
let poLoadWarnToken_ = "";
let poHeaderEditMode_ = false;
let poItemsEditMode_ = false;
let poHeaderSnapshot_ = null;
let poItemsSnapshot_ = null;

function poBuildIdempotencyKey_(scope, payload){
  const raw = String(scope || "") + "|" + String(payload || "");
  let h = 0;
  for(let i = 0; i < raw.length; i++){
    h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
  }
  return "IDEM-" + String(scope || "PO") + "-" + String(Math.abs(h)).toUpperCase();
}

function poDocStatusZh_(status){
  const s = String(status || "").trim().toUpperCase();
  if(s === "OPEN") return "未收貨";
  if(s === "PARTIAL") return "部分收貨";
  if(s === "CANCELLED") return "已作廢";
  return (typeof termLabelZhOnly === "function" ? termLabelZhOnly(s) : s) || s;
}

function poNormPoStatus_(raw){
  const s0 = String(raw || "").trim().toUpperCase();
  if(!s0) return "";
  const m = s0.match(/^([A-Z0-9_]+)/);
  return (m && m[1]) ? m[1] : s0;
}

function poIsTerminalStatus_(){
  const st = poNormPoStatus_(poLoadedStatus_);
  return st === "CLOSED" || st === "CANCELLED";
}

/** 有收貨紀錄，或主檔已結案／作廢：不可改結構欄位與明細結構（備註除外） */
function poStructuralFieldsLocked_(){
  return !!(poEditing && (poReadOnly || poIsTerminalStatus_()));
}

function poAllowHeaderRemarkSave_(){
  return !!poEditing;
}

/** 未收貨且主檔未結束：可整批改主檔（供應商／日期等，不含單獨備註鍵） */
function poAllowFullHeaderOps_(){
  return !!(poEditing && !poStructuralFieldsLocked_());
}

function poAllowFullLineOps_(){
  return poAllowFullHeaderOps_();
}

function poSetV_(id, v){
  try{
    if(typeof window.erpSetVById_ === "function") return window.erpSetVById_(id, v);
  }catch(_e){}
  const el = document.getElementById(String(id || ""));
  if(el && "value" in el) el.value = v;
}

function poClear_(ids){
  try{
    if(typeof window.erpClearIds_ === "function") return window.erpClearIds_(ids);
  }catch(_e){}
  const list = Array.isArray(ids) ? ids : [ids];
  for(let i = 0; i < list.length; i++){
    const el = document.getElementById(String(list[i] || ""));
    if(el && "value" in el) el.value = "";
  }
}

const PO_RULES = {
  idRegex: /^[A-Z0-9_-]+$/,
  idMax: 30
};

function bindUppercaseIdInput(elementId){
  const el = document.getElementById(elementId);
  if(!el) return;
  if(el.dataset.uppercaseBound) return;
  el.dataset.uppercaseBound = "1";

  el.addEventListener("input", () => {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const upper = (el.value || "").toUpperCase();
    if(el.value !== upper){
      el.value = upper;
      if(start != null && end != null){
        el.setSelectionRange(start, end);
      }
    }
  });
}

async function purchaseInit(){
  bindUppercaseIdInput("po_id");
  await initPurchaseDropdowns();
  resetPOForm();
  syncPOItemUnitSuffix_();
  setPOReceiptState_("收貨：未載入 · 請先 Load 採購單", "warn");
  // 主檔變更時，更新「更新」按鈕可用性
  ["po_supplier_id","po_order_date","po_expected_arrival_date","po_document_link","po_remark"].forEach(function(id){
    const el = document.getElementById(id);
    if(!el || el.dataset.poDirtyBound) return;
    el.dataset.poDirtyBound = "1";
    el.addEventListener("input", poUpdateToolbar_);
    el.addEventListener("change", poUpdateToolbar_);
  });
  // UX：關鍵欄位變更（供應商）若已有草稿/明細，提示並清空
  try{
    const supplierEl = document.getElementById("po_supplier_id");
    if(supplierEl && typeof window.erpBindGuardedValueChangeByKey === "function"){
      window.erpBindGuardedValueChangeByKey(supplierEl, {
        key: "poSupplier",
        messageKey: "po.supplier",
        hasBlocking: function(){ return Array.isArray(poItemsDraft) && poItemsDraft.length > 0; },
        onClear: function(){
          poSelectedDbItemId_ = "";
          poItemsDraft = [];
          renderPOItemsDraft();
          try{
            poClear_(["po_item_product_id","po_item_order_qty","po_item_unit","po_item_remark"]);
            syncPOItemUnitSuffix_();
          }catch(_eClr){}
        },
        onAfter: function(){ poUpdateToolbar_(); }
      });
    }
  }catch(_eUx){}
  bindAutoSearchToolbar_([
    ["search_po_keyword", "input"],
    ["search_po_status", "change"]
  ], () => searchPurchaseOrders());
  await renderPurchaseOrders();
}

function setPOReceiptState_(text, type = ""){
  const el = document.getElementById("poReceiptState");
  if(!el) return;
  el.textContent = text;
  el.style.color =
    type === "ok" ? "#166534" :
    type === "warn" ? "#92400e" :
    type === "error" ? "#991b1b" :
    "#64748b";
}

function updatePOFlowHint_(){
  const el = document.getElementById("poFlowHint");
  if(!el) return;
  if(poEditing && poReadOnly){
    el.textContent = "採購：已載入 · 已有收貨 · 主檔／明細備註可改";
    return;
  }
  if(poEditing && poIsTerminalStatus_()){
    const zh = poDocStatusZh_(poLoadedStatus_) || poNormPoStatus_(poLoadedStatus_);
    el.textContent = "採購：已載入 · " + zh + " · 僅備註可改";
    return;
  }
  if(poEditing && poAllowFullHeaderOps_()){
    if(poHeaderEditMode_ && poItemsEditMode_){
      el.textContent = "採購：已載入 · 編輯中 · 請「儲存主檔／儲存明細」或「取消編輯」";
      return;
    }
    if(poHeaderEditMode_){
      el.textContent = "採購：已載入 · 主檔編輯中 · 請儲存或取消";
      return;
    }
    if(poItemsEditMode_){
      el.textContent = "採購：已載入 · 明細編輯中 · 請儲存或取消";
      return;
    }
    el.textContent = "採購：已載入 · 未收貨 · 請先「編輯主檔／編輯明細」再儲存";
    return;
  }
  if(poEditing){
    el.textContent = "採購：已載入 · 狀態依收貨自動維護（OPEN／PARTIAL／CLOSED）";
    return;
  }
  el.textContent = "採購：新單 · 填主檔與明細後按「建立」開單";
}

/**
 * 結構鎖：收貨後／結案／作廢 — 只開備註相關欄位。
 * 未收貨可整批：預設主檔／明細鎖，需按「編輯主檔／編輯明細」；主檔備註欄始終可編（另見「儲存備註」）。
 */
function poSyncHeaderAndLineFieldLocks_(){
  const struct = poStructuralFieldsLocked_();
  if(struct){
    ["po_supplier_id", "po_order_date", "po_expected_arrival_date", "po_document_link"].forEach(id => {
      const el = document.getElementById(id);
      if(el) try{ el.disabled = !!poEditing; }catch(_e){}
    });
    const hdrRm = document.getElementById("po_remark");
    if(hdrRm) try{ hdrRm.disabled = false; }catch(_eH){}
    const pr = document.getElementById("po_item_product_id");
    const qty = document.getElementById("po_item_order_qty");
    const irm = document.getElementById("po_item_remark");
    if(pr) try{ pr.disabled = !!poEditing; }catch(_e){}
    if(qty) try{ qty.disabled = !!poEditing; }catch(_e2){}
    if(irm) try{ irm.disabled = !poEditing; }catch(_e3){}
    const addBtn = document.getElementById("po_add_item_btn");
    if(addBtn) try{ addBtn.disabled = !!poEditing; }catch(_e4){}
    return;
  }

  const headRo = poEditing && !poHeaderEditMode_;
  ["po_supplier_id", "po_order_date", "po_expected_arrival_date", "po_document_link"].forEach(id => {
    const el = document.getElementById(id);
    if(el) try{ el.disabled = !!headRo; }catch(_e){}
  });
  const hdrRm2 = document.getElementById("po_remark");
  if(hdrRm2) try{ hdrRm2.disabled = false; }catch(_eH2){}

  const lineLocked = poEditing && !poItemsEditMode_;
  const pr2 = document.getElementById("po_item_product_id");
  const qty2 = document.getElementById("po_item_order_qty");
  const irm2 = document.getElementById("po_item_remark");
  if(pr2) try{ pr2.disabled = !!lineLocked; }catch(_e5){}
  if(qty2) try{ qty2.disabled = !!lineLocked; }catch(_e6){}
  if(irm2) try{ irm2.disabled = !poEditing; }catch(_e7){}

  const addBtn2 = document.getElementById("po_add_item_btn");
  if(addBtn2) try{ addBtn2.disabled = !!lineLocked; }catch(_e8){}
}

function poUpdateToolbar_(){
  const hdrBtn = document.getElementById("po_update_btn");
  const hdrCancel = document.getElementById("po_header_cancel_edit_btn");
  const itemsBtn = document.getElementById("po_items_save_btn");
  const itemsCancel = document.getElementById("po_items_cancel_edit_btn");
  const saveHdr = document.getElementById("po_save_remark_btn");
  const saveLine = document.getElementById("po_save_line_remark_btn");

  if(hdrBtn){
    if(!poEditing){
      hdrBtn.disabled = true;
      hdrBtn.textContent = "編輯主檔";
      hdrBtn.title = "請先載入採購單";
    }else if(!poAllowFullHeaderOps_()){
      hdrBtn.disabled = true;
      hdrBtn.textContent = "編輯主檔";
      hdrBtn.title = "已有收貨或單據已結束，請使用「儲存備註」";
    }else{
      hdrBtn.disabled = false;
      hdrBtn.textContent = poHeaderEditMode_ ? "儲存主檔" : "編輯主檔";
      hdrBtn.title = poHeaderEditMode_ ? "儲存主檔（供應商／日期／連結／備註）" : "解鎖主檔欄位以供修改";
    }
  }
  if(hdrCancel){
    hdrCancel.style.display = (poEditing && poAllowFullHeaderOps_() && poHeaderEditMode_) ? "" : "none";
  }

  if(itemsBtn){
    if(!poEditing){
      itemsBtn.disabled = true;
      itemsBtn.textContent = "編輯明細";
      itemsBtn.title = "請先載入採購單";
    }else if(!poAllowFullLineOps_()){
      itemsBtn.disabled = true;
      itemsBtn.textContent = "編輯明細";
      itemsBtn.title = "已有收貨或單據已結束，請使用「儲存備註」";
    }else{
      itemsBtn.disabled = false;
      itemsBtn.textContent = poItemsEditMode_ ? "儲存明細" : "編輯明細";
      itemsBtn.title = poItemsEditMode_
        ? "依列表重建明細（未收貨才可；會重新編號 POI-）"
        : "解鎖品項／數量／新增刪除";
    }
  }
  if(itemsCancel){
    itemsCancel.style.display = (poEditing && poAllowFullLineOps_() && poItemsEditMode_) ? "" : "none";
  }

  if(saveHdr){
    saveHdr.disabled = !poAllowHeaderRemarkSave_();
    saveHdr.title = poAllowHeaderRemarkSave_() ? "只更新主檔備註（不變更供應商／日期等）" : "請先載入採購單";
  }
  if(saveLine){
    saveLine.disabled = !poEditing;
    saveLine.title = !poEditing ? "請先載入採購單" : "寫回明細備註（請先點選明細列）";
  }
}

function poCaptureHeaderSnapshot_(){
  return {
    po_supplier_id: String(document.getElementById("po_supplier_id")?.value || ""),
    po_order_date: String(document.getElementById("po_order_date")?.value || ""),
    po_expected_arrival_date: String(document.getElementById("po_expected_arrival_date")?.value || ""),
    po_document_link: String(document.getElementById("po_document_link")?.value || "").trim(),
    po_remark: String(document.getElementById("po_remark")?.value || "").trim()
  };
}

function poRestoreHeaderSnapshot_(snap){
  if(!snap) return;
  try{ document.getElementById("po_supplier_id").value = snap.po_supplier_id || ""; }catch(_e){}
  try{ document.getElementById("po_order_date").value = snap.po_order_date || ""; }catch(_e2){}
  try{ document.getElementById("po_expected_arrival_date").value = snap.po_expected_arrival_date || ""; }catch(_e3){}
  try{ document.getElementById("po_document_link").value = snap.po_document_link || ""; }catch(_e4){}
  try{ document.getElementById("po_remark").value = snap.po_remark || ""; }catch(_e5){}
}

function togglePOHeaderEditSave_(triggerEl){
  if(!poAllowFullHeaderOps_()){
    return showToast("已有收貨或單據已結束，無法編輯主檔欄位。備註請用「儲存備註」。", "error");
  }
  if(!poEditing) return showToast("請先載入採購單", "error");
  if(!poHeaderEditMode_){
    poHeaderSnapshot_ = poCaptureHeaderSnapshot_();
    poHeaderEditMode_ = true;
    poSyncHeaderAndLineFieldLocks_();
    poUpdateToolbar_();
    updatePOFlowHint_();
    return;
  }
  return savePOHeaderOnly_(triggerEl);
}

function cancelPOHeaderEdit_(){
  if(!poHeaderEditMode_) return;
  const ok = window.erpConfirmDiscardKey_
    ? window.erpConfirmDiscardKey_("confirm.po.cancel_header_edit", { fallback: "主檔已修改尚未儲存，確定放棄變更？" })
    : confirm("主檔已修改尚未儲存，確定放棄變更？");
  if(!ok) return;
  poRestoreHeaderSnapshot_(poHeaderSnapshot_);
  poHeaderSnapshot_ = null;
  poHeaderEditMode_ = false;
  poSyncHeaderAndLineFieldLocks_();
  poUpdateToolbar_();
  updatePOFlowHint_();
}

function togglePOItemsEditSave_(triggerEl){
  if(!poAllowFullLineOps_()){
    return showToast("已有收貨或單據已結束，無法編輯／儲存整張明細。明細備註可點列後按「儲存備註」。", "error");
  }
  if(!poEditing) return showToast("請先載入採購單", "error");
  if(!poItemsEditMode_){
    poItemsSnapshot_ = JSON.parse(JSON.stringify(Array.isArray(poItemsDraft) ? poItemsDraft : []));
    poItemsEditMode_ = true;
    poSyncHeaderAndLineFieldLocks_();
    poUpdateToolbar_();
    updatePOFlowHint_();
    renderPOItemsDraft();
    return;
  }
  return savePOItemsOnly_(triggerEl);
}

function cancelPOItemsEdit_(){
  if(!poItemsEditMode_) return;
  const ok = window.erpConfirmDiscardKey_
    ? window.erpConfirmDiscardKey_("confirm.po.cancel_items_edit", { fallback: "明細已修改尚未儲存，確定放棄變更？" })
    : confirm("明細已修改尚未儲存，確定放棄變更？");
  if(!ok) return;
  poItemsDraft = Array.isArray(poItemsSnapshot_) ? JSON.parse(JSON.stringify(poItemsSnapshot_)) : [];
  poItemsSnapshot_ = null;
  poItemsEditMode_ = false;
  poSelectedDbItemId_ = "";
  poClear_(["po_item_product_id", "po_item_order_qty", "po_item_unit", "po_item_remark"]);
  syncPOItemUnitSuffix_();
  poSyncHeaderAndLineFieldLocks_();
  poUpdateToolbar_();
  updatePOFlowHint_();
  renderPOItemsDraft();
}

function poSyncSelectedLineToDraft_(){
  const pid = String(poSelectedDbItemId_ || "").trim();
  if(!pid || pid.startsWith("DRAFT-")) return;
  const row = poItemsDraft.find(x => String(x?.draft_id || "") === pid);
  if(!row) return;

  const productId = (document.getElementById("po_item_product_id")?.value || "").trim();
  if(productId && String(productId) !== String(row.product_id || "")){
    showToast("已存檔明細不支援直接更換產品（請刪除該列後重新新增）", "error");
    throw new Error("產品不可直接更換");
  }

  const qty =
    (typeof window.erpVNumById_ === "function")
      ? window.erpVNumById_("po_item_order_qty")
      : Number(document.getElementById("po_item_order_qty")?.value || 0);
  const unit =
    (typeof window.erpVById_ === "function")
      ? window.erpVById_("po_item_unit") || ""
      : (document.getElementById("po_item_unit")?.value || "");
  const remark =
    (typeof window.erpVTrimById_ === "function")
      ? window.erpVTrimById_("po_item_remark")
      : (document.getElementById("po_item_remark")?.value || "").trim();

  if(!(qty > 0)) { showToast("訂購數量需大於 0", "error"); throw new Error("訂購數量需大於 0"); }
  if(!unit) { showToast("找不到產品單位，請先確認產品主檔", "error"); throw new Error("找不到產品單位"); }

  row.order_qty = qty;
  row.unit = unit;
  row.remark = remark;
}

async function savePOHeaderOnly_(triggerEl){
  if(!poAllowFullHeaderOps_()){
    return showToast("已有收貨或單據已結束，無法變更主檔欄位。請使用「儲存備註」。", "error");
  }
  if(!poEditing) return showToast("請先載入採購單", "error");
  const po_id = (typeof window.erpVTrimUpperById_ === "function") ? window.erpVTrimUpperById_("po_id") : (document.getElementById("po_id")?.value || "").trim().toUpperCase();
  const supplier_id = (typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_("po_supplier_id") : (document.getElementById("po_supplier_id")?.value || "").trim();
  const order_date = (typeof window.erpVDateById_ === "function") ? window.erpVDateById_("po_order_date") : (document.getElementById("po_order_date")?.value || "");
  const expected_arrival_date = (typeof window.erpVDateById_ === "function") ? window.erpVDateById_("po_expected_arrival_date") : (document.getElementById("po_expected_arrival_date")?.value || "");
  const document_link = (typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_("po_document_link") : (document.getElementById("po_document_link")?.value || "").trim();
  const remark = (typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_("po_remark") : (document.getElementById("po_remark")?.value || "").trim();

  const missing = [];
  if(!po_id) missing.push("採購單號");
  if(!supplier_id) missing.push("供應商");
  if(!order_date) missing.push("下單日期");
  if(missing.length) return showToast("缺少必填：" + missing.join("、"), "error");

  const header = await getOne("purchase_order", "po_id", po_id).catch(()=>null);
  if(header){
    const hs = String(header.status || "").toUpperCase();
    if(hs === "CLOSED") return showToast("此採購單已結案 (CLOSED)，不可再修改。", "error");
    if(hs === "CANCELLED") return showToast("此採購單已取消 (CANCELLED)，不可再修改。", "error");
  }

  showSaveHint(triggerEl || document.getElementById("po_update_btn"));
  try{
    await updateRecord("purchase_order", "po_id", po_id, {
      supplier_id,
      order_date,
      expected_arrival_date,
      status: header?.status || "OPEN",
      document_link,
      remark,
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
    showToast("主檔已儲存");
    try{ if(typeof invalidateCache === "function") invalidateCache("purchase_order"); }catch(_eInv){}
    await renderPurchaseOrders();
    poHeaderEditMode_ = false;
    poHeaderSnapshot_ = null;
    poSyncHeaderAndLineFieldLocks_();
    try{
      if(window.erpDirty_){
        window.erpDirty_.bind("purchase", poBuildSnapshot_);
        window.erpDirty_.markSaved("purchase");
      }
    }catch(_eDirty){}
  }finally{
    hideSaveHint();
    poUpdateToolbar_();
    updatePOFlowHint_();
  }
}

async function savePOItemsOnly_(triggerEl){
  const po_id = (typeof window.erpVTrimUpperById_ === "function") ? window.erpVTrimUpperById_("po_id") : (document.getElementById("po_id")?.value || "").trim().toUpperCase();
  if(!po_id) return;
  if(!poAllowFullLineOps_()){
    return showToast("已有收貨或單據已結束，無法儲存整張明細。明細備註可點列後按「儲存備註」。", "error");
  }
  if(!poEditing) return showToast("請先載入採購單", "error");

  try{
    poSyncSelectedLineToDraft_();
  }catch(_e){
    return;
  }

  const items0 = Array.isArray(poItemsDraft) ? poItemsDraft : [];
  if(items0.length === 0) return showToast("缺少必填：品項（至少 1 筆）", "error");

  const header = await getOne("purchase_order", "po_id", po_id).catch(()=>null);
  if(header){
    const hs = String(header.status || "").toUpperCase();
    if(hs === "CLOSED") return showToast("此採購單已結案 (CLOSED)，不可再修改。", "error");
    if(hs === "CANCELLED") return showToast("此採購單已取消 (CANCELLED)，不可再修改。", "error");
  }

  showSaveHint(triggerEl || document.getElementById("poItemsCommitGroup"));
  try{
    const hasReceipt = await hasPOReceipts_(po_id);
    if(hasReceipt){
      showToast("此採購單已有收貨紀錄，無法重建明細。", "error");
      return;
    }

    const allItems = await getAll("purchase_order_item");
    const pidU = String(po_id || "").trim().toUpperCase();
    const items = allItems.filter(it => String(it.po_id || "").trim().toUpperCase() === pidU);
    for(const it of items){
      await deleteRecord("purchase_order_item", "po_item_id", it.po_item_id);
    }

    for(let idx = 0; idx < poItemsDraft.length; idx++){
      const it = poItemsDraft[idx];
      const po_item_id = `POI-${po_id}-${String(idx + 1).padStart(3, "0")}`;
      const item = {
        po_item_id,
        po_id,
        product_id: it.product_id,
        order_qty: String(it.order_qty),
        received_qty: "0",
        unit: it.unit,
        remark: it.remark || "",
        created_by: getCurrentUser(),
        created_at: nowIso16(),
        updated_by: "",
        updated_at: ""
      };
      await createRecord("purchase_order_item", item);
    }

    const allItems2 = await getAll("purchase_order_item");
    const rows = allItems2.filter(x => String(x.po_id || "").trim().toUpperCase() === po_id);
    poItemsDraft = rows.map(it => ({
      draft_id: it.po_item_id,
      product_id: it.product_id,
      product_name: (poProducts.find(p => p.product_id === it.product_id) || {}).product_name || "",
      product_spec: (poProducts.find(p => p.product_id === it.product_id) || {}).spec || "",
      order_qty: Number(it.order_qty || 0),
      received_qty: Number(it.received_qty || 0),
      unit: it.unit || "",
      remark: it.remark || ""
    }));

    showToast("明細已儲存");
    try{ if(typeof invalidateCache === "function") invalidateCache("purchase_order_item"); }catch(_eInv2){}
    await renderPurchaseOrders();
    poItemsEditMode_ = false;
    poItemsSnapshot_ = null;
    poSelectedDbItemId_ = "";
    poClear_(["po_item_product_id", "po_item_order_qty", "po_item_unit", "po_item_remark"]);
    syncPOItemUnitSuffix_();
    poSyncHeaderAndLineFieldLocks_();
    try{
      if(window.erpDirty_){
        window.erpDirty_.bind("purchase", poBuildSnapshot_);
        window.erpDirty_.markSaved("purchase");
      }
    }catch(_eDirty){}
    renderPOItemsDraft();
  }finally{
    hideSaveHint();
    poUpdateToolbar_();
    updatePOFlowHint_();
  }
}

async function savePOHeaderRemarkOnly_(triggerEl){
  if(!poAllowHeaderRemarkSave_()){
    return showToast("請先載入採購單", "error");
  }
  const po_id = (typeof window.erpVTrimUpperById_ === "function") ? window.erpVTrimUpperById_("po_id") : (document.getElementById("po_id")?.value || "").trim().toUpperCase();
  if(!po_id) return;
  const remark = (typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_("po_remark") : (document.getElementById("po_remark")?.value || "").trim();
  showSaveHint(triggerEl || document.getElementById("po_save_remark_btn"));
  try{
    await updateRecord("purchase_order", "po_id", po_id, {
      remark,
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
    try{ if(typeof invalidateCache === "function") invalidateCache("purchase_order"); }catch(_eInv){}
    showToast("備註已儲存");
    await renderPurchaseOrders();
    try{
      if(window.erpDirty_){
        window.erpDirty_.bind("purchase", poBuildSnapshot_);
        window.erpDirty_.markSaved("purchase");
      }
    }catch(_eDirty){}
  }finally{
    hideSaveHint();
    poUpdateToolbar_();
  }
}

function setPOReadOnly_(readOnly){
  poReadOnly = !!readOnly;
  const createBtn = document.getElementById("po_create_btn");
  if(createBtn) createBtn.disabled = poReadOnly || poEditing;
  updatePOFlowHint_();
  poSyncHeaderAndLineFieldLocks_();
  poUpdateToolbar_();
}

function formatPOProductDisplay_(productId, productName, productSpec){
  const id = String(productId || "").trim();
  const name = String(productName || id || "").trim();
  const spec = String(productSpec || "").trim();
  if(!name && !id) return "";
  // 對齊其他模組：產品名稱（規格）；不把 product_id 混在同一段顯示字串
  if(spec) return `${name}（${spec}）`;
  return name || id;
}

function poBuildSnapshot_(){
  const po_id = (typeof window.erpVTrimUpperById_ === "function") ? window.erpVTrimUpperById_("po_id") : (document.getElementById("po_id")?.value || "").trim().toUpperCase();
  const supplier_id = (typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_("po_supplier_id") : (document.getElementById("po_supplier_id")?.value || "").trim();
  const order_date = (typeof window.erpVDateById_ === "function") ? window.erpVDateById_("po_order_date") : (document.getElementById("po_order_date")?.value || "");
  const expected_arrival_date = (typeof window.erpVDateById_ === "function") ? window.erpVDateById_("po_expected_arrival_date") : (document.getElementById("po_expected_arrival_date")?.value || "");
  const document_link = (typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_("po_document_link") : (document.getElementById("po_document_link")?.value || "").trim();
  const remark = (typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_("po_remark") : (document.getElementById("po_remark")?.value || "").trim();
  const header = { po_id, supplier_id, order_date, expected_arrival_date, document_link, remark };
  const items = (poItemsDraft || []).map(it => ({
    product_id: it.product_id,
    order_qty: Number(it.order_qty || 0),
    unit: it.unit || "",
    remark: it.remark || ""
  }));
  // 以顯示順序做穩定比較
  return JSON.stringify({ header, items });
}

async function hasPOReceipts_(poId){
  const id = String(poId || "").trim();
  if(!id) return false;
  const [items, grs] = await Promise.all([
    getAll("goods_receipt_item").catch(()=>[]),
    getAll("goods_receipt").catch(()=>[])
  ]);
  const cancelledGr = new Set(
    (grs || [])
      .filter(
        g =>
          String(g.po_id || "") === id && String(g.status || "").toUpperCase() === "CANCELLED"
      )
      .map(g => g.gr_id)
  );
  return (items || []).some(
    r => r.po_id === id && r.gr_id && !cancelledGr.has(r.gr_id)
  );
}

async function initPurchaseDropdowns(){
  const supplierSelect = document.getElementById("po_supplier_id");
  const productSelect = document.getElementById("po_item_product_id");

  const [suppliersRaw, productsRaw] = await Promise.all([
    getAll("supplier"),
    getAll("product")
  ]);
  const suppliers = (suppliersRaw || [])
    .filter(s => s.status === "ACTIVE")
    .filter(s => {
      const flows = String(s.supplier_flow || "").toUpperCase();
      // 未填 flow 視為可用（避免舊資料突然消失）
      return !flows || flows.split(",").map(x=>x.trim()).includes("PO");
    });
  const products = (productsRaw || []).filter(p => p.status === "ACTIVE");
  poProducts = products;
  poSuppliers = suppliers;

  if(supplierSelect){
    supplierSelect.innerHTML =
      `<option value="">請選擇</option>` +
      suppliers.map(s=>{
        const name = String(s.supplier_name || "").trim();
        const label = name || s.supplier_id;
        return `<option value="${s.supplier_id}">${label}</option>`;
      }).join("");
  }

  if(productSelect){
    productSelect.innerHTML =
      `<option value="">請選擇</option>` +
      products.map(p=>{
        const name = String(p.product_name || "").trim();
        const spec = String(p.spec || "").trim();
        const label = spec ? `${name}（${spec}）` : (name || (p.product_id || ""));
        return `<option value="${p.product_id}" data-unit="${p.unit}" data-spec="${(p.spec || "").replace(/"/g, "&quot;")}">${label}</option>`;
      }).join("");
  }
}

function syncPOItemUnitSuffix_(){
  syncErpQtyUnitSuffix_("po_item_unit", "po_item_unit_suffix");
}

function onSelectPOItemProduct(){
  const productSelect = document.getElementById("po_item_product_id");
  const unitEl = document.getElementById("po_item_unit");
  if(!productSelect || !unitEl) return;
  const opt = productSelect.selectedOptions?.[0];
  if(!opt || !String(productSelect.value || "").trim()){
    poClear_("po_item_unit");
    poClear_(["po_item_order_qty", "po_item_remark"]);
    syncPOItemUnitSuffix_();
    return;
  }
  unitEl.value = opt.getAttribute("data-unit") || "";
  syncPOItemUnitSuffix_();
}

function isPOItemDraftRow_(it){
  return String(it?.draft_id || "").startsWith("DRAFT-");
}

/** 與銷售明細對齊：草稿＋依已收／訂購量 */
function formatPOItemLineStatus_(it){
  if(isPOItemDraftRow_(it)) return "草稿";
  const oq = Number(it.order_qty || 0);
  const rq = Number(it.received_qty || 0);
  if(oq <= 0) return "—";
  if(rq <= 1e-9) return "未收貨";
  if(rq + 1e-9 >= oq) return "已收完";
  return "部分收貨";
}

function selectPOItemDbRow_(poItemId){
  const id = String(poItemId || "");
  const it = poItemsDraft.find(x => x.draft_id === id);
  if(!it) return;
  poSelectedDbItemId_ = id;
  const productSelect = document.getElementById("po_item_product_id");
  if(productSelect) productSelect.value = it.product_id || "";
  onSelectPOItemProduct();
  const qtyEl = document.getElementById("po_item_order_qty");
  if(qtyEl) qtyEl.value = String(it.order_qty ?? "");
  const rmEl = document.getElementById("po_item_remark");
  if(rmEl) rmEl.value = String(it.remark || "");
  showToast(
    poItemsEditMode_
      ? "已帶入明細（可修改後調整列表，或「儲存明細」寫回）"
      : "已帶入明細（僅改備註請按「儲存備註」；改數量請先「編輯明細」）"
  );
}

async function updateSelectedPOItemRemark(triggerEl){
  if(!poEditing) return showToast("請先載入一張採購單", "error");
  const pid = String(poSelectedDbItemId_ || "").trim();
  if(!pid || pid.startsWith("DRAFT-")){
    return showToast("請先點選一筆已存檔的明細列（非草稿列）", "error");
  }
  const remark =
    (typeof window.erpVTrimById_ === "function")
      ? window.erpVTrimById_("po_item_remark")
      : (document.getElementById("po_item_remark")?.value || "").trim();

  showSaveHint(triggerEl || document.getElementById("poItemsCommitGroup"));
  try{
    await updateRecord("purchase_order_item", "po_item_id", pid, {
      remark,
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
    const row = poItemsDraft.find(x => x.draft_id === pid);
    if(row) row.remark = remark;
    renderPOItemsDraft();
    showToast("明細備註已儲存");
  }finally{
    hideSaveHint();
    setPOReadOnly_(poReadOnly);
  }
}

function addPOItemDraft(){
  if(poStructuralFieldsLocked_()){
    return showToast("已有收貨或單據已結束，無法新增品項。請使用「儲存備註」更新備註。", "error");
  }
  if(poEditing && !poItemsEditMode_){
    return showToast("請先按「編輯明細」才能新增或調整品項。", "error");
  }
  const productSelect = document.getElementById("po_item_product_id");
  const productId = productSelect?.value || "";
  const qty =
    (typeof window.erpVNumById_ === "function")
      ? window.erpVNumById_("po_item_order_qty")
      : Number(document.getElementById("po_item_order_qty")?.value || 0);
  const unit =
    (typeof window.erpVById_ === "function")
      ? window.erpVById_("po_item_unit") || ""
      : document.getElementById("po_item_unit")?.value || "";
  const remark =
    (typeof window.erpVTrimById_ === "function")
      ? window.erpVTrimById_("po_item_remark")
      : (document.getElementById("po_item_remark")?.value || "").trim();

  const missing = [];
  if(!productId) missing.push("產品");
  if(!(qty > 0)) missing.push("訂購數量（>0）");
  if(!unit) missing.push("產品單位（請先確認產品主檔）");
  if(missing.length) return showToast("缺少必填：" + missing.join("、"), "error");

  const draftId = "DRAFT-" + Date.now() + "-" + Math.floor(Math.random()*1000);
  const pRow = poProducts.find(x => x.product_id === productId) || {};
  const productName = String(pRow.product_name || "").trim() || productId;
  const productSpec = String(pRow.spec || "").trim();

  poItemsDraft.push({
    draft_id: draftId,
    product_id: productId,
    product_name: productName,
    product_spec: productSpec,
    order_qty: qty,
    received_qty: 0,
    unit,
    remark
  });

  // 清空明細輸入
  poSelectedDbItemId_ = "";
  poClear_(["po_item_product_id", "po_item_order_qty", "po_item_unit", "po_item_remark"]);
  syncPOItemUnitSuffix_();

  renderPOItemsDraft();
  poUpdateToolbar_();
}

function removePOItemDraft(draftId){
  if(poStructuralFieldsLocked_()){
    return showToast("已有收貨或單據已結束，無法刪除品項。", "error");
  }
  if(poEditing && !poItemsEditMode_){
    return showToast("請先按「編輯明細」才能刪除品項。", "error");
  }
  if(String(poSelectedDbItemId_) === String(draftId)) poSelectedDbItemId_ = "";
  poItemsDraft = poItemsDraft.filter(it => it.draft_id !== draftId);
  renderPOItemsDraft();
  poUpdateToolbar_();
}

function renderPOItemsDraft(){
  const tbody = document.getElementById("poItemsBody");
  if(!tbody) return;

  tbody.innerHTML = "";
  const structLock = poStructuralFieldsLocked_();
  const delLock = structLock || (poEditing && !poItemsEditMode_);
  poItemsDraft.forEach((it, idx) => {
    const p = poProducts.find(x => x.product_id === it.product_id) || {};
    const display = formatPOProductDisplay_(
      it.product_id,
      it.product_name || p.product_name || it.product_id,
      it.product_spec || p.spec || ""
    );
    const safeId = String(it.draft_id || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const rowClick = isPOItemDraftRow_(it) ? "" : `onclick="selectPOItemDbRow_('${safeId}')"`;
    const u = String(it.unit || "").trim();
    const qtyUnitHtml = u ? `${it.order_qty} ${u.replace(/</g, "")}` : String(it.order_qty);
    tbody.innerHTML += `
      <tr style="${rowClick ? "cursor:pointer;" : ""}" ${rowClick}>
        <td>${idx+1}</td>
        <td title="${String(display).replace(/"/g, "&quot;")}">${display}</td>
        <td>${qtyUnitHtml}</td>
        <td>${formatPOItemLineStatus_(it)}</td>
        <td><button class="btn-secondary" ${delLock ? "disabled" : ""} onclick="event.stopPropagation(); removePOItemDraft('${safeId}')">刪除</button></td>
      </tr>
    `;
  });
  poUpdateToolbar_();
}

function resetPOForm(){
  poEditing = false;
  poLoadedStatus_ = "";
  poHeaderEditMode_ = false;
  poItemsEditMode_ = false;
  poHeaderSnapshot_ = null;
  poItemsSnapshot_ = null;
  setPOReadOnly_(false);
  poSelectedDbItemId_ = "";
  poItemsDraft = [];
  renderPOItemsDraft();

  const poIdEl = document.getElementById("po_id");
  if(poIdEl){
    // 清除：強制產生新單號（避免沿用剛載入的 po_id）
    erpInitAutoId_("po_id", { gen: () => (typeof generateId === "function" ? generateId("PO") : ""), force: true });
    poIdEl.disabled = false;
  }

  const supplierEl = document.getElementById("po_supplier_id");
  poClear_(["po_supplier_id", "po_expected_arrival_date", "po_remark", "po_document_link"]);

  const orderDateEl = document.getElementById("po_order_date");
  // 下單日期：改為 date（不含時間）
  if(orderDateEl){
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    orderDateEl.value = `${yyyy}-${mm}-${dd}`;
  }

  // po_status 已移除（狀態由系統維護）
  setPOReceiptState_("收貨：未載入 · 請先 Load 採購單", "warn");
  updatePOFlowHint_();
  poSyncHeaderAndLineFieldLocks_();
  const cancelBtn = document.getElementById("po_cancel_btn");
  if(cancelBtn){
    cancelBtn.disabled = true;
    cancelBtn.title = "請先載入採購單";
  }
  try{
    if(window.erpDirty_){
      window.erpDirty_.bind("purchase", poBuildSnapshot_);
      window.erpDirty_.markSaved("purchase");
    }
  }catch(_eDirty){}
  poUpdateToolbar_();
}

async function createPurchaseOrder(triggerEl){
  if(poStructuralFieldsLocked_()){
    return showToast("已有收貨或單據已結束，無法建立。請先「清除」回到新單。", "error");
  }
  const poIdEl = document.getElementById("po_id");
  const po_id = (typeof window.erpVTrimUpperById_ === "function") ? window.erpVTrimUpperById_("po_id") : (poIdEl?.value || "").trim().toUpperCase();
  if(poIdEl) poIdEl.value = po_id;

  const supplier_id = (typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_("po_supplier_id") : (document.getElementById("po_supplier_id")?.value || "").trim();
  const order_date = (typeof window.erpVDateById_ === "function") ? window.erpVDateById_("po_order_date") : (document.getElementById("po_order_date")?.value || "");
  const expected_arrival_date = (typeof window.erpVDateById_ === "function") ? window.erpVDateById_("po_expected_arrival_date") : (document.getElementById("po_expected_arrival_date")?.value || "");
  const status = "OPEN"; // 狀態由系統依收貨單自動維護
  const document_link = (typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_("po_document_link") : (document.getElementById("po_document_link")?.value || "").trim();
  const remark = (typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_("po_remark") : (document.getElementById("po_remark")?.value || "").trim();

  const missing = [];
  if(!po_id) missing.push("採購單號");
  if(po_id.length > PO_RULES.idMax) return showToast("採購單號過長（最多 30 字元）","error");
  if(!PO_RULES.idRegex.test(po_id)) return showToast("採購單號只能使用 A-Z 0-9 _ -","error");
  if(!supplier_id) missing.push("供應商");
  if(!order_date) missing.push("下單日期");
  if(poItemsDraft.length === 0) missing.push("品項（至少 1 筆）");
  if(missing.length) return showToast("缺少必填：" + missing.join("、"), "error");

  showSaveHint(triggerEl || document.getElementById("poItemsCommitGroup"));
  try {
  // 檢查 PO 是否已存在
  const existing = await getOne("purchase_order", "po_id", po_id).catch(()=>null);
  if(existing) return showToast("採購單號已存在","error");

  const header = {
    po_id,
    supplier_id,
    order_date,
    expected_arrival_date,
    status,
    document_link,
    remark,
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    updated_by: "",
    updated_at: ""
  };

  await createRecord("purchase_order", header);

  // 寫入明細
  for (let idx = 0; idx < poItemsDraft.length; idx++) {
    const it = poItemsDraft[idx];
    const po_item_id = `POI-${po_id}-${String(idx+1).padStart(3,"0")}`;

    const item = {
      po_item_id,
      po_id,
      product_id: it.product_id,
      order_qty: String(it.order_qty),
      received_qty: "0",
      unit: it.unit,
      remark: it.remark || "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: ""
    };

    await createRecord("purchase_order_item", item);
  }

  await renderPurchaseOrders();
  resetPOForm();
  showToast("採購單已建立");
  } finally { hideSaveHint(); }
}

async function loadPurchaseOrder(poId){
  const id = String(poId || "").trim().toUpperCase();
  if(!id) return;
  if(poLoadInFlight_){
    poPendingLoadId_ = id;
    setPOReceiptState_(`收貨：載入中 · 已排隊 ${id}（完成後自動載入）`, "warn");
    return;
  }
  poLoadInFlight_ = true;
  try{
    if(typeof erpBeginLoadWarnToast_ === "function"){
      poLoadWarnToken_ = erpBeginLoadWarnToast_(`載入中...請稍等（${id}）`);
    }
  }catch(_eWarn){}
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
  setPOReceiptState_("收貨：檢查中…", "warn");
  try{
    const header = await getOne("purchase_order", "po_id", id);
    if(!header) return showToast("找不到採購單","error");

    poEditing = true;
    poSelectedDbItemId_ = "";
    poLoadedStatus_ = poNormPoStatus_(header.status || "OPEN");
    poHeaderEditMode_ = false;
    poItemsEditMode_ = false;
    poHeaderSnapshot_ = null;
    poItemsSnapshot_ = null;

  const poIdEl = document.getElementById("po_id");
  poIdEl.value = header.po_id;
  poIdEl.disabled = true;

  document.getElementById("po_supplier_id").value = header.supplier_id || "";
  document.getElementById("po_order_date").value = header.order_date || "";
  document.getElementById("po_expected_arrival_date").value = header.expected_arrival_date || "";
  // po_status 已移除（狀態由系統維護）
  document.getElementById("po_remark").value = header.remark || "";

  // 載入明細（產品名稱由 poProducts 在 render 時解析）
  const allItems = await getAll("purchase_order_item");
  const items = allItems.filter(it => String(it.po_id || "").trim().toUpperCase() === id);
  poItemsDraft = items.map(it => ({
    draft_id: it.po_item_id,
    product_id: it.product_id,
    product_name: (poProducts.find(p => p.product_id === it.product_id) || {}).product_name || "",
    product_spec: (poProducts.find(p => p.product_id === it.product_id) || {}).spec || "",
    order_qty: Number(it.order_qty || 0),
    received_qty: Number(it.received_qty || 0),
    unit: it.unit || "",
    remark: it.remark || ""
  }));

  const locked = await hasPOReceipts_(id);
  setPOReadOnly_(locked);
  const cancelBtn = document.getElementById("po_cancel_btn");
  if(cancelBtn){
    const hs = String(header.status || "").toUpperCase();
    if(hs === "CANCELLED"){
      cancelBtn.disabled = true;
      cancelBtn.title = "此採購單已作廢";
    }else if(locked){
      cancelBtn.disabled = true;
      cancelBtn.title = "此採購單已有未作廢收貨單，請先作廢所有收貨單";
    }else{
      cancelBtn.disabled = false;
      cancelBtn.title = "作廢此採購單（需先無有效收貨單）";
    }
  }
  if(locked){
    setPOReceiptState_("收貨：已載入 · 已收貨 · 主檔／明細備註可改", "warn");
    showToast("此採購單已有收貨紀錄：結構欄位已鎖，主檔／明細備註仍可更新。", "warn", 6000);
  }else if(poIsTerminalStatus_()){
    const zh = poDocStatusZh_(poLoadedStatus_) || poNormPoStatus_(poLoadedStatus_);
    setPOReceiptState_("收貨：已載入 · " + zh + " · 僅備註可改", "warn");
  }else{
    setPOReceiptState_("收貨：已載入 · 未收貨 · 可編輯", "ok");
  }

    renderPOItemsDraft();
    try{
      if(window.erpDirty_){
        window.erpDirty_.bind("purchase", poBuildSnapshot_);
        window.erpDirty_.markSaved("purchase");
      }
    }catch(_eDirty){}
  } finally {
    try{
      if(typeof erpEndLoadWarnToast_ === "function"){
        erpEndLoadWarnToast_(poLoadWarnToken_);
      }
      poLoadWarnToken_ = "";
    }catch(_eWarnEnd){}
  }
  poUpdateToolbar_();
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
  poLoadInFlight_ = false;
  // 若載入期間又點了其他單號，完成後自動載入最後一次點選的單號
  try{
    const nextId = String(poPendingLoadId_ || "").trim().toUpperCase();
    poPendingLoadId_ = "";
    if(nextId && nextId !== id){
      setTimeout(function(){
        try{ loadPurchaseOrder(nextId); }catch(_e){}
      }, 0);
    }
  }catch(_eNext){}
}

async function renderPurchaseOrders(list=null){
  const tbody = document.getElementById("poTableBody");
  if(!tbody) return;

  let listResolved = list;
  if(listResolved == null){
    setTbodyLoading_(tbody, 7);
    listResolved = await getAll("purchase_order");
  }

  tbody.innerHTML = "";
  if (!listResolved.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#64748b;padding:24px;">尚無採購單。請先至「產品」「供應商」建立主檔，再在此建立採購單。</td></tr>';
    return;
  }
  const supMap = {};
  (poSuppliers || []).forEach(s => { if(s && s.supplier_id) supMap[s.supplier_id] = s; });

  listResolved.forEach(po => {
    const sid = po.supplier_id || "";
    const s = supMap[sid] || null;
    const supplierNameOnly = (s && s.supplier_name) ? s.supplier_name : sid;
    const btn = `
      <button class="btn-edit" onclick="loadPurchaseOrder('${po.po_id}')">Load</button>
      <button class="btn-secondary" onclick="gotoReceive('PO','${po.po_id}')">收貨</button>
    `;
    const docLink = String(po.document_link || "").trim();
    const linkCell = docLink
      ? `<a href="${docLink.replace(/"/g, "&quot;")}" target="_blank" rel="noopener">連結</a>`
      : "";
    tbody.innerHTML += `
      <tr>
        <td>${po.po_id}</td>
        <td>${supplierNameOnly}</td>
        <td>${po.order_date || ""}</td>
        <td>${po.expected_arrival_date || ""}</td>
        <td>${poDocStatusZh_(po.status)}</td>
        <td>${linkCell}</td>
        <td>${btn}</td>
      </tr>
    `;
  });
}

async function sortPurchaseOrders(field){
  setTbodyLoading_("poTableBody", 7);
  const list = await getAll("purchase_order");
  const sorted = applySorting(list, field, purchaseSort);
  renderPurchaseOrders(sorted);
}

async function searchPurchaseOrders(){
  setTbodyLoading_("poTableBody", 7);
  const kw = (document.getElementById("search_po_keyword")?.value || "").trim().toLowerCase();
  const status = document.getElementById("search_po_status")?.value || "";

  const list = await getAll("purchase_order");
  const supMap = {};
  (poSuppliers || []).forEach(s => { if(s && s.supplier_id) supMap[s.supplier_id] = s; });
  const result = list.filter(po => {
    const s = supMap[po.supplier_id] || null;
    const supName = String(s?.supplier_name || "").toLowerCase();
    const matchKw = !kw ||
      (po.po_id || "").toLowerCase().includes(kw) ||
      (po.supplier_id || "").toLowerCase().includes(kw) ||
      (supName && supName.includes(kw));
    return matchKw && (!status || po.status === status);
  });
  renderPurchaseOrders(result);
}

async function cancelPurchaseOrder(triggerEl){
  if(!poEditing) return showToast("請先載入一張採購單再作廢","error");
  const po_id = (typeof window.erpVTrimUpperById_ === "function") ? window.erpVTrimUpperById_("po_id") : (document.getElementById("po_id")?.value || "").trim().toUpperCase();
  if(!po_id) return showToast("採購單號缺失","error");

  showSaveHint(triggerEl || document.getElementById("poItemsCommitGroup"));
  try{
    const header = await getOne("purchase_order","po_id",po_id).catch(()=>null);
    if(!header) return showToast("找不到採購單","error");
    const st = String(header.status || "").toUpperCase();
    if(st === "CANCELLED") return showToast("此採購單已作廢","error");

    const hasReceipt = await hasPOReceipts_(po_id);
    if(hasReceipt){
      return showToast("此採購單已有未作廢收貨紀錄，請先至「收貨入庫」作廢所有收貨單後再作廢採購單。","error");
    }

    const note = prompt("作廢原因（可留空）") ?? "";
    const ok = window.erpConfirmActionKey_("confirm.cancel.po", {
      po_id,
      fallback: `確定作廢此採購單？\n- PO：${po_id}\n\n限制：需先作廢所有收貨單。`
    });
    if(!ok) return;

    await callAPI(
      {
        action: "cancel_purchase_order_bundle",
        po_id,
        idempotency_key: poBuildIdempotencyKey_("PO_CANCEL", [po_id, String(note || "").trim(), getCurrentUser()]),
        cancel_note: String(note || "").trim(),
        updated_by: getCurrentUser()
      },
      { method: "POST" }
    );

    if(typeof invalidateCache === "function") invalidateCache("purchase_order");
    await renderPurchaseOrders();
    await loadPurchaseOrder(po_id);
    showToast("採購單已作廢（CANCELLED）");
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
        if(typeof invalidateCache === "function") invalidateCache("purchase_order");
        await renderPurchaseOrders();
        await loadPurchaseOrder(po_id);
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
  }
}

async function resetPurchaseSearch(){
  poClear_(["search_po_keyword","search_po_status"]);
  await renderPurchaseOrders();
}