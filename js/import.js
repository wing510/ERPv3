/*********************************
 * Import Module v3（API 版）
 * 海外 Supplier → 報關 → Import Receipt（含報單資料） → Lot
 *********************************/

let importEditing = false;
let importItemsDraft = [];
let importSort = { field:"", asc:true };
/** 快取報單列表，點 Edit 時可少打一次 API */
let importDocumentsCache = null;
let importItemsReadOnly = false;
let importDocReadOnly = false;
let importProducts = [];
let importSelectedDbItemId_ = "";
let importSuppliers = [];
let importLoadedStatus_ = ""; // OPEN/PARTIAL/CLOSED/CANCELLED（用於按鈕判斷）
let importLoading_ = false;
let importPendingLoadId_ = "";
let importLoadWarnToken_ = "";
let importHeaderEditMode_ = false;
let importItemsEditMode_ = false;
let importHeaderSnapshot_ = null;
let importItemsSnapshot_ = null;

function importBuildIdempotencyKey_(scope, payload){
  const raw = String(scope || "") + "|" + String(payload || "");
  let h = 0;
  for(let i = 0; i < raw.length; i++){
    h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
  }
  return "IDEM-" + String(scope || "IMP") + "-" + String(Math.abs(h)).toUpperCase();
}

function importDocStatusZh_(status){
  const s = String(status || "").trim().toUpperCase();
  if(s === "OPEN") return "未收貨";
  if(s === "PARTIAL") return "部分收貨";
  if(s === "CANCELLED") return "已作廢";
  return (typeof termLabelZhOnly === "function" ? termLabelZhOnly(s) : s) || s;
}

function impSetV_(id, v){
  try{
    if(typeof window.erpSetVById_ === "function") return window.erpSetVById_(id, v);
  }catch(_e){}
  const el = document.getElementById(String(id || ""));
  if(el && "value" in el) el.value = v;
}

function impClear_(ids){
  try{
    if(typeof window.erpClearIds_ === "function") return window.erpClearIds_(ids);
  }catch(_e){}
  const list = Array.isArray(ids) ? ids : [ids];
  for(let i = 0; i < list.length; i++){
    const el = document.getElementById(String(list[i] || ""));
    if(el && "value" in el) el.value = "";
  }
}

// `bindUppercaseInput` 已移至 `js/core/utils.js`

const IMPORT_LOCAL_DRAFT_KEY = "erp_import_unsaved_draft_v1";

function n2(v){
  const num = Number(v);
  return Number.isNaN(num) ? 0 : Math.round(num * 100) / 100;
}

function sleep(ms){
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getImportDocFormData_(){
  const has = (k) => typeof window[k] === "function";
  const vTrimUpper = (id) => has("erpVTrimUpperById_") ? window.erpVTrimUpperById_(id) : String(document.getElementById(id)?.value ?? "").trim().toUpperCase();
  const vTrim = (id) => has("erpVTrimById_") ? window.erpVTrimById_(id) : String(document.getElementById(id)?.value ?? "").trim();
  const vDate = (id) => has("erpVDateById_") ? window.erpVDateById_(id) : String(document.getElementById(id)?.value ?? "");
  const vRaw = (id) => document.getElementById(id)?.value ?? "";
  return {
    import_doc_id: vTrimUpper("import_doc_id"),
    import_no: vTrimUpper("import_no"),
    supplier_id: vRaw("import_supplier_id") || "",
    import_date: vDate("import_import_date"),
    release_date: vDate("import_release_date"),
    inspection_no: vTrim("import_inspection_no"),
    document_link: vTrim("import_document_link"),
    status: "OPEN",
    remark: vTrim("import_remark")
  };
}

function importBuildSnapshot_(){
  // 用穩定序列化比較「是否有變更」（不含 status，因為 status 由系統維護）
  const d = getImportDocFormData_();
  const doc = {
    import_doc_id: d.import_doc_id,
    import_no: d.import_no,
    supplier_id: d.supplier_id,
    import_date: d.import_date,
    release_date: d.release_date,
    inspection_no: d.inspection_no,
    document_link: d.document_link,
    remark: d.remark
  };
  const items = (importItemsDraft || []).map(it => ({
    item_no: it.item_no,
    product_id: it.product_id,
    hs_code: it.hs_code || "",
    lot_id: it.lot_id || it.invoice_no || "",
    origin_country: it.origin_country || "",
    declared_qty: Number(it.declared_qty || 0),
    declared_unit: it.declared_unit || "",
    remark: it.remark || ""
  })).sort((a,b)=>Number(a.item_no||0) - Number(b.item_no||0));
  return JSON.stringify({ doc, items });
}

function applyImportDocFormData_(data){
  const d = data || {};
  const set = (id, val) => {
    const el = document.getElementById(id);
    if(!el) return;
    el.value = val ?? "";
  };

  set("import_doc_id", d.import_doc_id || "");
  set("import_no", d.import_no || "");
  set("import_supplier_id", d.supplier_id || "");
  set("import_import_date", d.import_date || "");
  set("import_release_date", d.release_date || "");
  set("import_inspection_no", d.inspection_no || "");
  set("import_document_link", d.document_link || "");
  // 狀態由系統依收貨單自動維護；不顯示在表單
  set("import_remark", d.remark || "");
}

function saveImportLocalDraft_(){
  try{
    const draft = {
      saved_at: nowIso16(),
      doc: getImportDocFormData_(),
      items: importItemsDraft
    };
    localStorage.setItem(IMPORT_LOCAL_DRAFT_KEY, JSON.stringify(draft));
  }catch(_e){}
}

function clearImportLocalDraft_(){
  try{ localStorage.removeItem(IMPORT_LOCAL_DRAFT_KEY); }catch(_e){}
}

function restoreImportLocalDraft_(){
  try{
    const raw = localStorage.getItem(IMPORT_LOCAL_DRAFT_KEY);
    if(!raw) return false;
    const draft = JSON.parse(raw);
    if(!draft?.doc) return false;

    importEditing = false;
    applyImportDocFormData_(draft.doc);

    const idEl = document.getElementById("import_doc_id");
    if(idEl){
      idEl.disabled = false;
      idEl.value = String(idEl.value || "").trim().toUpperCase();
    }

    importItemsDraft = Array.isArray(draft.items) ? draft.items : [];
    renderImportItemsDraft();
    updateImportButtons_();
    updateImportFlowHint_();
    return true;
  }catch(_e){
    return false;
  }
}

function updateImportButtons_(){
  const createBtn = document.getElementById("import_create_btn");
  const updateBtn = document.getElementById("import_update_btn");
  const headerCancelBtn = document.getElementById("import_header_cancel_edit_btn");
  const saveRemarkBtn = document.getElementById("import_save_remark_btn");
  const cancelBtn = document.getElementById("import_cancel_btn");
  const itemSaveBtn = document.getElementById("import_items_save_btn");
  const itemsCancelBtn = document.getElementById("import_items_cancel_edit_btn");
  if(!createBtn || !updateBtn) return;
  const st = String(importLoadedStatus_ || "").toUpperCase();
  const terminal = st === "CLOSED" || st === "CANCELLED";
  const structLocked = !!(importDocReadOnly || importItemsReadOnly || terminal);

  // 建立：只在新單可用
  if(createBtn){
    createBtn.disabled = structLocked || importEditing;
    createBtn.title = importEditing ? "已載入報單（新建請清除）" : "建立報單";
  }

  // 主檔編輯/儲存
  if(updateBtn){
    if(!importEditing){
      updateBtn.disabled = true;
      updateBtn.textContent = "編輯主檔";
      updateBtn.title = "請先載入報單";
    }else if(structLocked){
      updateBtn.disabled = true;
      updateBtn.textContent = "編輯主檔";
      updateBtn.title = "已有收貨或報單已結束，請用「儲存備註」";
    }else{
      updateBtn.disabled = false;
      updateBtn.textContent = importHeaderEditMode_ ? "儲存主檔" : "編輯主檔";
      updateBtn.title = importHeaderEditMode_ ? "儲存主檔（報單號／日期／供應商／連結／備註）" : "解鎖主檔欄位以供修改";
    }
  }
  if(headerCancelBtn){
    headerCancelBtn.style.display = (importEditing && !structLocked && importHeaderEditMode_) ? "" : "none";
  }
  if(saveRemarkBtn){
    saveRemarkBtn.disabled = !importEditing;
    saveRemarkBtn.title = !importEditing ? "請先載入報單" : "只更新主檔備註（不變更其他欄位）";
  }

  // 明細編輯/儲存
  if(itemSaveBtn){
    if(!importEditing){
      itemSaveBtn.disabled = true;
      itemSaveBtn.textContent = "編輯明細";
      itemSaveBtn.title = "請先載入報單";
    }else if(structLocked){
      itemSaveBtn.disabled = true;
      itemSaveBtn.textContent = "編輯明細";
      itemSaveBtn.title = "已有收貨或報單已結束，明細結構不可改（可儲存備註）";
    }else{
      itemSaveBtn.disabled = false;
      itemSaveBtn.textContent = importItemsEditMode_ ? "儲存明細" : "編輯明細";
      itemSaveBtn.title = importItemsEditMode_
        ? "儲存明細（寫回報單與明細；未收貨才可）"
        : "解鎖品項/數量/新增刪除";
    }
  }
  if(itemsCancelBtn){
    itemsCancelBtn.style.display = (importEditing && !structLocked && importItemsEditMode_) ? "" : "none";
  }

  updateImportFlowHint_();
  if(cancelBtn){
    if(importLoading_){
      cancelBtn.disabled = true;
      cancelBtn.title = "檢查中…";
    }else{
      setImportCancelBtnState_({
        editing: importEditing,
        status: importLoadedStatus_ || "OPEN",
        hasReceipt: !!importDocReadOnly
      });
    }
  }
}

function setImportCancelBtnState_(opts){
  const cancelBtn = document.getElementById("import_cancel_btn");
  if(!cancelBtn) return;
  const editing = !!opts?.editing;
  const st = String(opts?.status || "").trim().toUpperCase();
  const hasReceipt = !!opts?.hasReceipt;
  if(!editing){
    cancelBtn.disabled = true;
    cancelBtn.title = "請先載入報單";
    return;
  }
  if(st === "CANCELLED"){
    cancelBtn.disabled = true;
    cancelBtn.title = "此報單已作廢";
    return;
  }
  if(hasReceipt){
    cancelBtn.disabled = true;
    cancelBtn.title = "此報單已有未作廢收貨單，請先作廢所有收貨單";
    return;
  }
  cancelBtn.disabled = false;
  cancelBtn.title = "作廢此報單（需先無有效收貨單）";
}

function bindImportDraftAutosave_(){
  const ids = [
    "import_doc_id","import_no","import_supplier_id","import_import_date","import_release_date",
    "import_inspection_no","import_document_link","import_remark"
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    if(el.dataset.draftAutosaveBound) return;
    el.dataset.draftAutosaveBound = "1";
    el.addEventListener("change", () => { saveImportLocalDraft_(); updateImportButtons_(); });
    el.addEventListener("input", () => { saveImportLocalDraft_(); updateImportButtons_(); });
  });
}

async function persistImportItems(import_doc_id, draftItems){
  const docId = String(import_doc_id || "").trim();
  if(!docId) throw new Error("import_doc_id required");

  const list = Array.isArray(draftItems) ? draftItems : [];
  if(list.length === 0) return { created: 0 };

  // 先刪除該報單既有明細，避免重複（以 import_item_id 為主鍵）
  const allItems = await getAll("import_item").catch(()=>[]);
  const exists = (allItems || []).filter(it => it.import_doc_id === docId);
  for(const it of exists){
    if(it?.import_item_id){
      await deleteRecord("import_item", "import_item_id", it.import_item_id);
    }
  }

  // 重新建立明細（由 draft index 決定序號）
  for(let idx=0; idx<list.length; idx++){
    const it = list[idx] || {};
    const import_item_id = `IMPI-${docId}-${String(idx+1).padStart(3,"0")}`;

    const item = {
      import_item_id,
      import_doc_id: docId,
      product_id: it.product_id,
      item_no: String(idx + 1),
      description: "",
      hs_code: it.hs_code || "",
      declared_qty: String(it.declared_qty),
      declared_unit: it.declared_unit || "",
      declared_price: String(it.declared_price ?? 0),
      declared_amount: Number(it.declared_amount || 0).toFixed(2),
      origin_country: it.origin_country || "",
      invoice_no: it.lot_id || it.invoice_no || "",
      net_weight: "",
      gross_weight: "",
      package_qty: "",
      package_unit: "",
      remark: it.remark || "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: ""
    };

    await createRecord("import_item", item);
  }

  return { created: list.length };
}

function setImportReceiptState_(text, type = ""){
  const el = document.getElementById("importReceiptState");
  if(!el) return;
  el.textContent = text;
  el.style.color =
    type === "ok" ? "#166534" :
    type === "warn" ? "#92400e" :
    type === "error" ? "#991b1b" :
    "#64748b";
}

function updateImportFlowHint_(){
  const el = document.getElementById("importFlowHint");
  if(!el) return;
  if(importEditing && importDocReadOnly){
    el.textContent =
      (typeof window.erpFlowHintText_ === "function")
        ? window.erpFlowHintText_("報單", "已載入 · 已有收貨", "主檔／明細備註可改")
        : "報單：已載入 · 已有收貨 · 主檔／明細備註可改";
    return;
  }
  if(importEditing){
    const st = String(importLoadedStatus_ || "").toUpperCase();
    const terminal = st === "CLOSED" || st === "CANCELLED";
    if(terminal){
      const zh = importDocStatusZh_(st) || st;
      el.textContent =
        (typeof window.erpFlowHintText_ === "function")
          ? window.erpFlowHintText_("報單", "已載入 · " + zh, "僅備註可改")
          : ("報單：已載入 · " + zh + " · 僅備註可改");
      return;
    }
    if(importHeaderEditMode_ && importItemsEditMode_){
      el.textContent =
        (typeof window.erpFlowHintText_ === "function")
          ? window.erpFlowHintText_("報單", "已載入 · 編輯中", "請「儲存主檔／儲存明細」或「取消編輯」")
          : "報單：已載入 · 編輯中 · 請「儲存主檔／儲存明細」或「取消編輯」";
      return;
    }
    if(importHeaderEditMode_){
      el.textContent =
        (typeof window.erpFlowHintText_ === "function")
          ? window.erpFlowHintText_("報單", "已載入 · 主檔編輯中", "請儲存或取消")
          : "報單：已載入 · 主檔編輯中 · 請儲存或取消";
      return;
    }
    if(importItemsEditMode_){
      el.textContent =
        (typeof window.erpFlowHintText_ === "function")
          ? window.erpFlowHintText_("報單", "已載入 · 明細編輯中", "請儲存或取消")
          : "報單：已載入 · 明細編輯中 · 請儲存或取消";
      return;
    }
    el.textContent =
      (typeof window.erpFlowHintText_ === "function")
        ? window.erpFlowHintText_("報單", "已載入 · 未收貨", "請先「編輯主檔／編輯明細」再儲存")
        : "報單：已載入 · 未收貨 · 請先「編輯主檔／編輯明細」再儲存";
    return;
  }
  el.textContent =
    (typeof window.erpFlowHintText_ === "function")
      ? window.erpFlowHintText_("報單", "新單", "填主檔與明細後按「建立」寫入")
      : "報單：新單 · 填主檔與明細後按「建立」寫入";
}

function importSyncFormLocks_(){
  const st = String(importLoadedStatus_ || "").toUpperCase();
  const terminal = st === "CLOSED" || st === "CANCELLED";
  const structLocked = !!(importDocReadOnly || importItemsReadOnly || terminal);

  function dis(id, v){
    const el = document.getElementById(id);
    if(!el) return;
    try{ el.disabled = !!v; }catch(_e){}
  }
  // 主檔：備註永遠可編；結構鎖或未進入主檔編輯時鎖其他欄
  const headLocked = structLocked || (importEditing && !importHeaderEditMode_);
  ["import_no","import_import_date","import_release_date","import_supplier_id","import_inspection_no","import_document_link"].forEach(id=>{
    dis(id, !!headLocked);
  });
  dis("import_remark", false);

  // 明細表單：結構鎖或未進入明細編輯時鎖產品/數量等；備註維持可編（已載入時）
  const lineLocked = structLocked || (importEditing && !importItemsEditMode_);
  ["import_item_product_id","import_item_hs_code","import_item_lot_id","import_item_origin_country","import_item_declared_qty"].forEach(id=>{
    dis(id, !!lineLocked);
  });
  dis("import_item_remark", !importEditing);
  const addBtn = document.getElementById("import_add_item_btn");
  if(addBtn) addBtn.disabled = !!(importEditing && lineLocked);
}

function importCaptureHeaderSnapshot_(){
  return {
    import_no: String(document.getElementById("import_no")?.value || "").trim().toUpperCase(),
    supplier_id: String(document.getElementById("import_supplier_id")?.value || ""),
    import_date: String(document.getElementById("import_import_date")?.value || ""),
    release_date: String(document.getElementById("import_release_date")?.value || ""),
    inspection_no: String(document.getElementById("import_inspection_no")?.value || "").trim(),
    document_link: String(document.getElementById("import_document_link")?.value || "").trim(),
    remark: String(document.getElementById("import_remark")?.value || "").trim()
  };
}

function importRestoreHeaderSnapshot_(snap){
  if(!snap) return;
  try{ document.getElementById("import_no").value = snap.import_no || ""; }catch(_e){}
  try{ document.getElementById("import_supplier_id").value = snap.supplier_id || ""; }catch(_e2){}
  try{ document.getElementById("import_import_date").value = snap.import_date || ""; }catch(_e3){}
  try{ document.getElementById("import_release_date").value = snap.release_date || ""; }catch(_e4){}
  try{ document.getElementById("import_inspection_no").value = snap.inspection_no || ""; }catch(_e5){}
  try{ document.getElementById("import_document_link").value = snap.document_link || ""; }catch(_e6){}
  try{ document.getElementById("import_remark").value = snap.remark || ""; }catch(_e7){}
}

function toggleImportHeaderEditSave_(triggerEl){
  const st = String(importLoadedStatus_ || "").toUpperCase();
  const terminal = st === "CLOSED" || st === "CANCELLED";
  if(!importEditing) return showToast("請先載入報單", "error");
  if(importDocReadOnly || importItemsReadOnly || terminal){
    return showToast("已有收貨或報單已結束，無法編輯主檔欄位。備註請用「儲存備註」。", "error");
  }
  if(!importHeaderEditMode_){
    importHeaderSnapshot_ = importCaptureHeaderSnapshot_();
    importHeaderEditMode_ = true;
    importSyncFormLocks_();
    updateImportButtons_();
    return;
  }
  return saveImportHeaderOnly_(triggerEl);
}

function cancelImportHeaderEdit_(){
  if(!importHeaderEditMode_) return;
  const ok = window.erpConfirmDiscardKey_
    ? window.erpConfirmDiscardKey_("confirm.import.cancel_header_edit", { fallback: "主檔已修改尚未儲存，確定放棄變更？" })
    : confirm("主檔已修改尚未儲存，確定放棄變更？");
  if(!ok) return;
  importRestoreHeaderSnapshot_(importHeaderSnapshot_);
  importHeaderSnapshot_ = null;
  importHeaderEditMode_ = false;
  importSyncFormLocks_();
  updateImportButtons_();
}

function toggleImportItemsEditSave_(triggerEl){
  const st = String(importLoadedStatus_ || "").toUpperCase();
  const terminal = st === "CLOSED" || st === "CANCELLED";
  if(!importEditing) return showToast("請先載入報單", "error");
  if(importDocReadOnly || importItemsReadOnly || terminal){
    return showToast("已有收貨或報單已結束，無法編輯／儲存整張明細。明細備註可點列後按「儲存備註」。", "error");
  }
  if(!importItemsEditMode_){
    importItemsSnapshot_ = JSON.parse(JSON.stringify(Array.isArray(importItemsDraft) ? importItemsDraft : []));
    importItemsEditMode_ = true;
    importSyncFormLocks_();
    updateImportButtons_();
    renderImportItemsDraft();
    return;
  }
  return saveImportItemsOnly_(triggerEl);
}

function cancelImportItemsEdit_(){
  if(!importItemsEditMode_) return;
  const ok = window.erpConfirmDiscardKey_
    ? window.erpConfirmDiscardKey_("confirm.import.cancel_items_edit", { fallback: "明細已修改尚未儲存，確定放棄變更？" })
    : confirm("明細已修改尚未儲存，確定放棄變更？");
  if(!ok) return;
  importItemsDraft = Array.isArray(importItemsSnapshot_) ? JSON.parse(JSON.stringify(importItemsSnapshot_)) : [];
  importItemsSnapshot_ = null;
  importItemsEditMode_ = false;
  importSelectedDbItemId_ = "";
  // 清空明細輸入區（同 reset）
  impClear_(["import_item_product_id","import_item_hs_code","import_item_lot_id"]);
  syncSelectWithLegacy_("import_item_origin_country", "");
  impClear_(["import_item_declared_qty","import_item_declared_unit"]);
  syncImportItemUnitSuffix_();
  impClear_("import_item_remark");
  importSyncFormLocks_();
  updateImportButtons_();
  renderImportItemsDraft();
}

async function saveImportHeaderOnly_(triggerEl){
  if(!importEditing) return showToast("請先載入報單", "error");
  const docId = (document.getElementById("import_doc_id")?.value || "").trim().toUpperCase();
  if(!docId) return;
  const d = getImportDocFormData_();
  const missing = [];
  if(!d.import_no) missing.push("報單號");
  if(!d.import_date) missing.push("進口日");
  if(!d.release_date) missing.push("放行日");
  if(!d.supplier_id) missing.push("供應商");
  if(missing.length) return showToast("缺少必填：" + missing.join("、"), "error");

  showSaveHint(triggerEl || document.getElementById("import_update_btn"));
  try{
    const header = await getOne("import_document","import_doc_id",docId).catch(()=>null);
    const st = String(header?.status || importLoadedStatus_ || "OPEN").toUpperCase();
    if(st === "CLOSED" || st === "CANCELLED"){
      showToast("此報單已結束（CLOSED/CANCELLED），不可再修改。", "error");
      return;
    }
    await updateRecord("import_document","import_doc_id",docId,{
      import_no: d.import_no,
      supplier_id: d.supplier_id,
      import_date: d.import_date,
      release_date: d.release_date,
      inspection_no: d.inspection_no,
      document_link: d.document_link,
      remark: d.remark,
      status: header?.status || "OPEN",
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
    try{ if(typeof invalidateCache === "function") invalidateCache("import_document"); }catch(_eInv){}
    await renderImportDocuments();
    importHeaderEditMode_ = false;
    importHeaderSnapshot_ = null;
    importSyncFormLocks_();
    updateImportButtons_();
    showToast("主檔已儲存");
  }finally{
    hideSaveHint();
  }
}

async function saveImportHeaderRemarkOnly_(triggerEl){
  if(!importEditing) return showToast("請先載入報單", "error");
  const docId = (document.getElementById("import_doc_id")?.value || "").trim().toUpperCase();
  if(!docId) return;
  const remark = (document.getElementById("import_remark")?.value || "").trim();
  showSaveHint(triggerEl || document.getElementById("import_save_remark_btn"));
  try{
    await updateRecord("import_document","import_doc_id",docId,{
      remark,
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
    try{ if(typeof invalidateCache === "function") invalidateCache("import_document"); }catch(_eInv){}
    await renderImportDocuments();
    showToast("備註已儲存");
  }finally{
    hideSaveHint();
    updateImportButtons_();
  }
}

async function saveImportItemsOnly_(triggerEl){
  if(!importEditing) return showToast("請先載入報單", "error");
  const docId = (document.getElementById("import_doc_id")?.value || "").trim().toUpperCase();
  if(!docId) return;
  const st = String(importLoadedStatus_ || "").toUpperCase();
  if(st !== "OPEN"){
    return showToast("僅未收貨（OPEN）可儲存明細；部分/已收貨請僅更新備註。", "error");
  }
  if(importDocReadOnly || importItemsReadOnly){
    return showToast("此報單已有收貨紀錄，明細結構不可修改。", "error");
  }
  // 把上方目前選取列同步回 draft（避免儲存時漏掉）
  try{
    syncSelectedImportItemEditsToDraft_();
  }catch(_e){
    return;
  }
  const items0 = Array.isArray(importItemsDraft) ? importItemsDraft : [];
  if(items0.length === 0) return showToast("缺少必填：報單品項（至少 1 筆）", "error");

  const payload = items0.map((it, idx) => ({
    product_id: String(it.product_id || "").trim().toUpperCase(),
    hs_code: String(it.hs_code || "").trim(),
    invoice_no: String(it.lot_id || it.invoice_no || "").trim(),
    origin_country: String(it.origin_country || "").trim(),
    declared_qty: String(it.declared_qty),
    declared_unit: String(it.declared_unit || "").trim(),
    remark: String(it.remark || "")
  }));

  showSaveHint(triggerEl || document.getElementById("importItemsCommitGroup"));
  try{
    await callAPI({
      action: "reset_import_items_cmd",
      import_doc_id: docId,
      items_json: JSON.stringify(payload),
      updated_by: getCurrentUser()
    }, { method: "POST" });
    if(typeof invalidateCache === "function") invalidateCache("import_item");
    showToast("明細已儲存");
    await loadImportDocument(docId);
    importItemsEditMode_ = false;
    importItemsSnapshot_ = null;
    importSyncFormLocks_();
    updateImportButtons_();
  }catch(err){
    if(typeof showToast === "function" && !err?.erpApiToastShown){
      showToast(err?.erpUserMessage || err?.message || "儲存明細失敗", "error");
    }
    throw err;
  }finally{
    hideSaveHint();
  }
}

function setImportItemsReadOnly_(readOnly){
  importItemsReadOnly = !!readOnly;
  const addBtn = document.getElementById("import_add_item_btn");
  if(addBtn) addBtn.disabled = importItemsReadOnly;
  try{ importSyncFormLocks_(); }catch(_e){}
  updateImportButtons_();
}

function setImportDocReadOnly_(readOnly){
  importDocReadOnly = !!readOnly;
  try{ importSyncFormLocks_(); }catch(_e){}
  updateImportButtons_();
}

function formatImportProductDisplay_(productId, productName, productSpec){
  const id = String(productId || "").trim();
  const name = String(productName || id || "").trim();
  const spec = String(productSpec || "").trim();
  if(!name && !id) return "";
  // 對齊其他模組：產品名稱（規格）；不把 product_id 混在同一段顯示字串
  if(spec) return `${name}（${spec}）`;
  return name || id;
}

function normalizeImportItemProductMeta_(it, product){
  const id = String(it?.product_id || "").trim();
  const p = product || {};
  const pn = String(it?.product_name || "").trim();
  const ps = String(it?.product_spec || "").trim();
  const name = (!pn || pn === id) ? String(p.product_name || id || "").trim() : pn;
  const spec = (!ps) ? String(p.spec || "").trim() : ps;
  return { name, spec };
}

async function hasImportReceipts_(importDocId){
  const docId = String(importDocId || "").trim();
  if(!docId) return false;
  const [allReceipts, allReceiptItems] = await Promise.all([
    getAll("import_receipt").catch(() => []),
    getAll("import_receipt_item").catch(() => [])
  ]);
  const receiptIds = (allReceipts || [])
    .filter(
      r =>
        r.import_doc_id === docId && String(r.status || "").toUpperCase() !== "CANCELLED"
    )
    .map(r => r.import_receipt_id);
  if(receiptIds.length === 0) return false;
  return (allReceiptItems || []).some(x => receiptIds.includes(x.import_receipt_id));
}

async function importInit(){
  bindUppercaseInput("import_doc_id");
  bindUppercaseInput("import_no");

  // 並行請求（只等最慢的那次）：供應商、產品、報單一次取完，避免 3 次排隊等
  const [suppliers, products, docList] = await Promise.all([
    getAll("supplier"),
    getAll("product"),
    getAll("import_document")
  ]).catch(() => [[], [], []]);

  initImportDropdownsWithData_(suppliers, products);
  bindImportDraftAutosave_();

  // UX：報單切換/重設時若已有品項草稿，需確認避免誤貼到下一張
  try{
    const idEl = document.getElementById("import_doc_id");
    if(idEl && typeof window.erpBindGuardedValueChangeByKey === "function"){
      window.erpBindGuardedValueChangeByKey(idEl, {
        key: "importDocId",
        messageKey: "import.doc_id",
        hasBlocking: function(){ return Array.isArray(importItemsDraft) && importItemsDraft.length > 0; },
        onClear: function(){
          importItemsDraft = [];
          renderImportItemsDraft();
          clearImportLocalDraft_();
          updateImportButtons_();
        }
      });
    }
  }catch(_eUx){}

  // 重新打開頁面時一律空白表單，不自動帶入上次草稿（避免誤以為是「最後一筆」）
  resetImportForm();
  syncImportItemUnitSuffix_();
  setImportReceiptState_("收貨狀態：未載入 — 請先載入報單", "warn");
  importDocumentsCache = docList;
  renderImportDocuments(docList);

  bindAutoSearchToolbar_([
    ["search_import_keyword", "input"],
    ["search_import_status", "change"]
  ], () => searchImportDocuments());
}

function buildImportDocPayload_(){

  const import_doc_id = (document.getElementById("import_doc_id")?.value || "").trim().toUpperCase();
  const import_no = (document.getElementById("import_no")?.value || "").trim().toUpperCase();
  const supplier_id = document.getElementById("import_supplier_id")?.value || "";
  const import_date = document.getElementById("import_import_date")?.value || "";
  const release_date = document.getElementById("import_release_date")?.value || "";
  const inspection_no = (document.getElementById("import_inspection_no")?.value || "").trim();
  const document_link = (document.getElementById("import_document_link")?.value || "").trim();
  const status = "OPEN"; // 狀態由系統依收貨單自動維護
  const remark = (document.getElementById("import_remark")?.value || "").trim();

  if(!import_doc_id) throw new Error("報單ID 必填");
  if(!import_no) throw new Error("報單號 必填");
  if(!supplier_id) throw new Error("供應商 必填");
  if(!release_date) throw new Error("放行日 必填");
  if(importItemsDraft.length === 0) throw new Error("請至少新增 1 筆品項");

  const items = importItemsDraft.map((it, idx)=>({
    import_item_id: `IMPI-${import_doc_id}-${String(idx+1).padStart(3,"0")}`,
    import_doc_id,
    // 項次以「目前列表順序」重新編號，避免刪除後再新增造成重複
    item_no: String(idx + 1),
    product_id: it.product_id,
    hs_code: it.hs_code || "",
    declared_qty: String(it.declared_qty),
    declared_unit: it.declared_unit || "",
    origin_country: importOriginCountryEn_(it.origin_country || ""),
    invoice_no: it.lot_id || it.invoice_no || "",
    remark: it.remark || "",
    created_at: nowIso16()
  }));

  const doc = {
    import_doc_id,
    import_no,
    supplier_id,
    import_date,
    release_date,
    inspection_no,
    document_link,
    status,
    remark
  };

  return { doc, items };
}

function syncSelectedImportItemEditsToDraft_(){
  if(importItemsReadOnly) return;
  const iid = String(importSelectedDbItemId_ || "").trim();
  if(!iid || iid.startsWith("DRAFT-")) return;
  const row = importItemsDraft.find(x => String(x?.draft_id || "") === iid);
  if(!row) return;

  const product_id = (document.getElementById("import_item_product_id")?.value || "").trim();
  if(product_id && String(product_id) !== String(row.product_id || "")){
    // 已存檔列：避免在未明確設計流程下讓使用者「換產品」導致追溯/品項對齊混亂
    showToast("已存檔明細不支援直接更換產品（請刪除該列後重新新增）", "error");
    throw new Error("產品不可直接更換");
  }

  const hs_code =
    (typeof window.erpVTrimById_ === "function")
      ? window.erpVTrimById_("import_item_hs_code")
      : (document.getElementById("import_item_hs_code")?.value || "").trim();
  const lot_id =
    (typeof window.erpVTrimById_ === "function")
      ? window.erpVTrimById_("import_item_lot_id")
      : (document.getElementById("import_item_lot_id")?.value || "").trim();
  const origin_country =
    (typeof window.erpVTrimById_ === "function")
      ? window.erpVTrimById_("import_item_origin_country")
      : (document.getElementById("import_item_origin_country")?.value || "").trim();
  const declared_qty =
    (typeof window.erpVNumById_ === "function")
      ? window.erpVNumById_("import_item_declared_qty")
      : Number(document.getElementById("import_item_declared_qty")?.value || 0);
  const declared_unit =
    (typeof window.erpVById_ === "function")
      ? (window.erpVById_("import_item_declared_unit") || "")
      : (document.getElementById("import_item_declared_unit")?.value || "");
  const remark =
    (typeof window.erpVTrimById_ === "function")
      ? window.erpVTrimById_("import_item_remark")
      : (document.getElementById("import_item_remark")?.value || "").trim();

  // 基礎檢核：避免按「更新」卻把已存檔列洗成空值
  if(!lot_id) { showToast("Inv No 必填，請依文件發票號填寫", "error"); throw new Error("Inv No 必填"); }
  if(!declared_qty || declared_qty <= 0) { showToast("數量需大於 0", "error"); throw new Error("數量需大於 0"); }
  if(!declared_unit) { showToast("找不到產品單位，請先確認產品主檔", "error"); throw new Error("找不到產品單位"); }
  if((origin_country === "Other" || origin_country === "其他") && !remark) { showToast("生產國別選「其他」時，請填寫備註/原因", "error"); throw new Error("生產國別=其他需備註"); }

  row.hs_code = hs_code;
  row.lot_id = lot_id;
  row.origin_country = importOriginCountryEn_(origin_country);
  row.declared_qty = declared_qty;
  row.declared_unit = declared_unit;
  row.remark = remark;
}

async function saveImportDocument(triggerEl){
  if(importDocReadOnly){
    showToast("此報單已有進口收貨紀錄，整張報單不可修改。","error");
    return;
  }
  showSaveHint(triggerEl || document.getElementById("importItemsCommitGroup"));
  try{
    // 使用者可能先點選列帶入上方，再直接改欄位後按「更新」；
    // 這裡先把上方目前編輯的值同步回列表，確保會被 buildImportDocPayload_ 寫回工作表。
    syncSelectedImportItemEditsToDraft_();
    const { doc, items } = buildImportDocPayload_();

    const header = await getOne("import_document","import_doc_id",doc.import_doc_id).catch(()=>null);
    const currentStatus = String(header?.status || "").toUpperCase();
    if(importEditing && (currentStatus === "CLOSED" || currentStatus === "CANCELLED")){
      showToast("此報單已結束（CLOSED/CANCELLED），不可再修改。", "error");
      return;
    }

    // 若已存在進口收貨紀錄，禁止修改明細（避免破壞追溯）
    if (importEditing) {
      try {
        const allReceipts = await getAll("import_receipt").catch(() => []);
        const allReceiptItems = await getAll("import_receipt_item").catch(() => []);
        const relatedReceipts = (allReceipts || []).filter(
          r =>
            r.import_doc_id === doc.import_doc_id &&
            String(r.status || "").toUpperCase() !== "CANCELLED"
        );
        if (relatedReceipts.length) {
          const receiptIds = relatedReceipts.map(r => r.import_receipt_id);
          const relatedItems = (allReceiptItems || []).filter(x => receiptIds.includes(x.import_receipt_id));
          if (relatedItems.length) {
            showToast("此報單已有進口收貨紀錄，請勿直接修改明細。若需調整，請改用沖銷/補單方式。", "error");
            return;
          }
        }
      } catch (_e) {
        // 若檢查失敗，不阻擋儲存，但仍嘗試繼續（後端仍有防呆）
      }
    }

    const wasNew = !importEditing;
    // 一鍵寫入（主檔+明細），用 POST 避免 URL 過長
    const res = await callAPI({
      action: "save_import_document",
      // 狀態由系統自動維護：更新時保留原狀態；新建時固定 OPEN
      ...({ ...doc, status: (header?.status || doc.status || "OPEN") }),
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: getCurrentUser(),
      updated_at: nowIso16(),
      items_json: JSON.stringify(items)
    }, { method: "POST" });

    // 成功後：視為已寫入，鎖住 ID，並清掉本機草稿
    importEditing = true;
    const idEl = document.getElementById("import_doc_id");
    if(idEl) idEl.disabled = true;
    clearImportLocalDraft_();
    saveImportLocalDraft_();

    // save_import_document 走 callAPI，需手動清掉快取，避免列表仍顯示舊資料
    if (typeof invalidateCache === "function") {
      invalidateCache("import_document");
      invalidateCache("import_item");
    }

    await renderImportDocuments();
    // 建立/更新後：以後端資料重載，讓草稿列消失、狀態/項次一致
    await loadImportDocument(doc.import_doc_id);
    // 成功後：更新狀態快照
    importLoadedStatus_ = String((header?.status || doc.status || "OPEN") || "OPEN").toUpperCase();
    try{
      if(window.erpDirty_){
        window.erpDirty_.bind("import", importBuildSnapshot_);
        window.erpDirty_.markSaved("import");
      }
    }catch(_eDirty){}
    updateImportButtons_();
    const n = res.items_created ?? items.length;
    showToast(wasNew ? `報單已建立（明細 ${n} 筆）` : `報單已更新（明細 ${n} 筆）`);
  }catch(err){
    if (typeof showToast === "function" && !err?.erpApiToastShown) {
      showToast(err?.erpUserMessage || err?.message || "更新失敗", "error");
    }
    throw err;
  }finally{
    updateImportButtons_();
    hideSaveHint();
  }
}

async function initImportDropdowns(){
  const [suppliers, products] = await Promise.all([getAll("supplier"), getAll("product")]);
  initImportDropdownsWithData_(suppliers, products);
}

function initImportDropdownsWithData_(suppliers, products){
  const supplierSelect = document.getElementById("import_supplier_id");
  const productSelect = document.getElementById("import_item_product_id");
  const supList = (suppliers || [])
    .filter(s => (s.status || "ACTIVE") === "ACTIVE")
    .filter(s => {
      const flows = String(s.supplier_flow || "").toUpperCase();
      // 未填 flow 視為可用（避免舊資料突然消失）
      return !flows || flows.split(",").map(x=>x.trim()).includes("IMPORT");
    });
  const prodList = (products || []).filter(p => (p.status || "ACTIVE") === "ACTIVE");
  importProducts = prodList;
  importSuppliers = supList;

  if(supplierSelect){
    supplierSelect.innerHTML =
      `<option value="">請選擇</option>` +
      supList.map(s=>{
        const name = String(s.supplier_name || "").trim();
        const label = name || s.supplier_id;
        return `<option value="${s.supplier_id}">${label}</option>`;
      }).join("");
  }
  if(productSelect){
    productSelect.innerHTML =
      `<option value="">請選擇</option>` +
      prodList.map(p=>{
        const name = String(p.product_name || "").trim();
        const spec = String(p.spec || "").trim();
        const label = spec ? `${name}（${spec}）` : (name || (p.product_id || ""));
        return `<option value="${p.product_id}" data-unit="${p.unit || ""}" data-spec="${(p.spec || "").replace(/"/g, "&quot;")}">${label}</option>`;
      }).join("");
  }
}

function syncImportItemUnitSuffix_(){
  syncErpQtyUnitSuffix_("import_item_declared_unit", "import_item_unit_suffix");
}

function importOriginCountryZh_(v){
  const s = String(v || "").trim();
  if(!s) return "";
  const k = s.toLowerCase();
  if(k === "taiwan" || s === "台灣") return "台灣";
  if(k === "china" || s === "中國") return "中國";
  if(k === "japan" || s === "日本") return "日本";
  if(k === "korea" || s === "韓國") return "韓國";
  if(k === "singapore" || s === "新加坡") return "新加坡";
  if(k === "malaysia" || s === "馬來西亞") return "馬來西亞";
  if(k === "vietnam" || s === "越南") return "越南";
  if(k === "indonesia" || s === "印尼") return "印尼";
  if(k === "thailand" || s === "泰國") return "泰國";
  if(k === "usa" || k === "us" || k === "u.s.a" || s === "美國") return "美國";
  if(k === "canada" || s === "加拿大") return "加拿大";
  if(k === "uk" || k === "u.k" || k === "united kingdom" || s === "英國") return "英國";
  if(k === "germany" || s === "德國") return "德國";
  if(k === "australia" || s === "澳洲") return "澳洲";
  if(k === "other" || s === "其他") return "其他";
  return s;
}

function importOriginCountryEn_(v){
  const s = String(v || "").trim();
  if(!s) return "";
  const k = s.toLowerCase();
  const known = new Set(["taiwan","china","japan","korea","singapore","malaysia","vietnam","indonesia","thailand","usa","canada","uk","germany","australia","other"]);
  if(known.has(k)) return s;
  if(s === "台灣") return "Taiwan";
  if(s === "中國") return "China";
  if(s === "日本") return "Japan";
  if(s === "韓國") return "Korea";
  if(s === "新加坡") return "Singapore";
  if(s === "馬來西亞") return "Malaysia";
  if(s === "越南") return "Vietnam";
  if(s === "印尼") return "Indonesia";
  if(s === "泰國") return "Thailand";
  if(s === "美國") return "USA";
  if(s === "加拿大") return "Canada";
  if(s === "英國") return "UK";
  if(s === "德國") return "Germany";
  if(s === "澳洲") return "Australia";
  if(s === "其他") return "Other";
  return s;
}

function onSelectImportItemProduct(){
  const productSelect = document.getElementById("import_item_product_id");
  const unitEl = document.getElementById("import_item_declared_unit");
  if(!productSelect || !unitEl) return;
  const opt = productSelect.selectedOptions?.[0];
  if(!opt || !String(productSelect.value || "").trim()){
    impClear_("import_item_declared_unit");
    impClear_(["import_item_hs_code","import_item_lot_id","import_item_declared_qty","import_item_remark"]);
    syncSelectWithLegacy_("import_item_origin_country", "");
    syncImportItemUnitSuffix_();
    return;
  }
  unitEl.value = opt.getAttribute("data-unit") || "";
  syncImportItemUnitSuffix_();
}

function isImportItemDraftRow_(it){
  return String(it?.draft_id || "").startsWith("DRAFT-");
}

/** 簡版：草稿／已存檔（與出貨明細「草稿／已過帳」同層級概念） */
function formatImportItemLineStatus_(it){
  // 已改成「收貨進度」：未收／部分收貨／已收完（草稿列保留顯示草稿）
  return isImportItemDraftRow_(it) ? "草稿" : "未收貨";
}

function selectImportItemDbRow_(importItemId){
  const id = String(importItemId || "");
  const it = importItemsDraft.find(x => x.draft_id === id);
  if(!it) return;
  importSelectedDbItemId_ = id;
  const productSelect = document.getElementById("import_item_product_id");
  if(productSelect) productSelect.value = it.product_id || "";
  onSelectImportItemProduct();
  const hs = document.getElementById("import_item_hs_code");
  if(hs) hs.value = String(it.hs_code || "");
  const lot = document.getElementById("import_item_lot_id");
  if(lot) lot.value = String(it.lot_id || "");
  syncSelectWithLegacy_("import_item_origin_country", importOriginCountryEn_(it.origin_country || ""));
  const dq = document.getElementById("import_item_declared_qty");
  if(dq) dq.value = String(it.declared_qty ?? "");
  const du = document.getElementById("import_item_declared_unit");
  if(du) du.value = String(it.declared_unit || "");
  syncImportItemUnitSuffix_();
  const rm = document.getElementById("import_item_remark");
  if(rm) rm.value = String(it.remark || "");
  (function(){
    const st = String(importLoadedStatus_ || "").toUpperCase();
    const terminal = st === "CLOSED" || st === "CANCELLED";
    // 規則：未收貨(OPEN) 才可改數量/結構；部分/已收貨或結束，只允許備註
    const canEditQty = !!(!importItemsReadOnly && !terminal && st === "OPEN");
    if(importItemsEditMode_ && canEditQty){
      showToast("已帶入明細（可修改後調整列表，或「儲存明細」寫回）");
      return;
    }
    const hint =
      (typeof window.erpHintPickedLineText_ === "function")
        ? window.erpHintPickedLineText_({ canEditStructure: !!canEditQty, needsEditItemsFirst: true })
        : (canEditQty
          ? "已帶入明細（僅改備註請按「儲存備註」；改數量請先「編輯明細」）"
          : "已帶入明細（僅改備註請按「儲存備註」）");
    showToast(hint);
  })();
}

async function updateSelectedImportItemRemark(triggerEl){
  if(!importEditing) return showToast("請先載入報單", "error");
  const iid = String(importSelectedDbItemId_ || "").trim();
  if(!iid || iid.startsWith("DRAFT-")){
    return showToast("請先點選一筆已存檔的明細列（非草稿列）", "error");
  }
  const remark =
    (typeof window.erpVTrimById_ === "function")
      ? window.erpVTrimById_("import_item_remark")
      : (document.getElementById("import_item_remark")?.value || "").trim();

  showSaveHint(triggerEl || document.getElementById("importItemsCommitGroup"));
  try{
    await updateRecord("import_item", "import_item_id", iid, {
      remark,
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
    const row = importItemsDraft.find(x => x.draft_id === iid);
    if(row) row.remark = remark;
    renderImportItemsDraft();
    if(typeof invalidateCache === "function") invalidateCache("import_item");
    showToast("明細備註已儲存");
  }finally{
    hideSaveHint();
    updateImportButtons_();
  }
}

async function renderImportItemsDraft(){
  const tbody = document.getElementById("importItemsBody");
  if(!tbody) return;
  tbody.innerHTML = "";

  // 收貨進度：以 import_receipt_item 彙總已收量（排除已作廢收貨單）
  const import_doc_id = (document.getElementById("import_doc_id")?.value || "").trim().toUpperCase();
  let receivedByItemId = {};
  try{
    if(import_doc_id){
      const [allReceipts, allReceiptItems] = await Promise.all([
        getAll("import_receipt").catch(() => []),
        getAll("import_receipt_item").catch(() => [])
      ]);
      const receiptIds = (allReceipts || [])
        .filter(r => String(r.import_doc_id || "").trim().toUpperCase() === import_doc_id)
        .filter(r => String(r.status || "").trim().toUpperCase() !== "CANCELLED")
        .map(r => String(r.import_receipt_id || "").trim());
      const allow = new Set(receiptIds.filter(Boolean));
      receivedByItemId = {};
      (allReceiptItems || []).forEach(function(ri){
        const rid = String(ri && ri.import_receipt_id || "").trim();
        if(!rid || !allow.has(rid)) return;
        const iid = String(ri && ri.import_item_id || "").trim();
        if(!iid) return;
        receivedByItemId[iid] = (receivedByItemId[iid] || 0) + Number(ri.received_qty || 0);
      });
    }
  }catch(_eRecv){
    receivedByItemId = {};
  }

  function importItemProgressZh_(it){
    if(isImportItemDraftRow_(it)) return "草稿";
    const iid = String(it && it.draft_id || it && it.import_item_id || "").trim();
    const declared = Number(it && it.declared_qty || 0);
    const received = Number(receivedByItemId[iid] || 0);
    if(received <= 1e-9) return "未收貨";
    if(declared > 1e-9 && received + 1e-9 < declared) return "部分收貨";
    return "已收完";
  }

  // 項次自動產生（1,2,3...）；順序：產品名稱、稅則號列、批號、生產國別、數量（含單位）、狀態、操作
  importItemsDraft.forEach((it, idx) => {
    const p = importProducts.find(x => x.product_id === it.product_id) || {};
    const meta = normalizeImportItemProductMeta_(it, p);
    const productDisplay = formatImportProductDisplay_(
      it.product_id,
      meta.name,
      meta.spec
    );
    const lotId = it.lot_id || it.invoice_no || "";
    const itemNo = idx + 1;
    const safeId = String(it.draft_id || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const rowClick =
      isImportItemDraftRow_(it) ? "" : `onclick="selectImportItemDbRow_('${safeId}')"`;
    const iu = String(it.declared_unit || "").trim();
    const qtyUnitCell = iu
      ? `${it.declared_qty} ${iu.replace(/</g, "")}`
      : String(it.declared_qty);
    tbody.innerHTML += `
      <tr style="${rowClick ? "cursor:pointer;" : ""}" ${rowClick}>
        <td>${itemNo}</td>
        <td title="${String(productDisplay).replace(/"/g, "&quot;")}">${productDisplay}</td>
        <td>${it.hs_code || ""}</td>
        <td>${lotId}</td>
        <td>${importOriginCountryZh_(it.origin_country || "")}</td>
        <td>${qtyUnitCell}</td>
        <td>${importItemProgressZh_(it)}</td>
        <td><button class="btn-secondary" ${(importItemsReadOnly || (importEditing && !importItemsEditMode_)) ? "disabled" : ""} onclick="event.stopPropagation(); removeImportItemDraft('${safeId}')">刪除</button></td>
      </tr>
    `;
  });
  updateImportButtons_();
}

function addImportItemDraft(){
  if(importItemsReadOnly){
    return showToast("此報單已有進口收貨紀錄，明細不可修改。請改用沖銷/補單方式。","error");
  }
  const productSelect = document.getElementById("import_item_product_id");
  const product_id = productSelect?.value || "";
  // 下拉選單文字本來就不是 "id - name"；用主檔資料避免解析錯誤導致只存到代碼
  const p = importProducts.find(x => x.product_id === product_id) || {};
  const product_name = String(p.product_name || "").trim() || product_id;
  const product_spec = String(p.spec || "").trim();
  const hs_code =
    (typeof window.erpVTrimById_ === "function")
      ? window.erpVTrimById_("import_item_hs_code")
      : (document.getElementById("import_item_hs_code")?.value || "").trim();
  const lot_id =
    (typeof window.erpVTrimById_ === "function")
      ? window.erpVTrimById_("import_item_lot_id")
      : (document.getElementById("import_item_lot_id")?.value || "").trim();
  const origin_country =
    (typeof window.erpVTrimById_ === "function")
      ? window.erpVTrimById_("import_item_origin_country")
      : (document.getElementById("import_item_origin_country")?.value || "").trim();
  const declared_qty =
    (typeof window.erpVNumById_ === "function")
      ? window.erpVNumById_("import_item_declared_qty")
      : Number(document.getElementById("import_item_declared_qty")?.value || 0);
  const declared_unit =
    (typeof window.erpVById_ === "function")
      ? window.erpVById_("import_item_declared_unit") || ""
      : document.getElementById("import_item_declared_unit")?.value || "";
  const remark =
    (typeof window.erpVTrimById_ === "function")
      ? window.erpVTrimById_("import_item_remark")
      : (document.getElementById("import_item_remark")?.value || "").trim();

  if(!product_id) return showToast("請選擇產品","error");
  if(!lot_id) return showToast("批號（Inv No）必填，請依文件發票號填寫","error");
  if(!declared_qty || declared_qty <= 0) return showToast("數量需大於 0","error");
  if(!declared_unit) return showToast("找不到產品單位，請先確認產品主檔","error");
  if((origin_country === "Other" || origin_country === "其他") && !remark) return showToast("生產國別選「其他」時，請填寫備註/原因", "error");

  importItemsDraft.push({
    draft_id: "DRAFT-" + Date.now() + "-" + Math.floor(Math.random()*1000),
    product_id,
    product_name,
    product_spec,
    hs_code,
    lot_id,
    declared_qty,
    declared_unit,
    origin_country: importOriginCountryEn_(origin_country),
    remark
  });

  // 清空輸入（順序：產品、稅則號列、批號、生產國別、數量、備註）
  impClear_([
    "import_item_product_id",
    "import_item_hs_code",
    "import_item_lot_id",
    "import_item_declared_qty",
    "import_item_declared_unit",
    "import_item_remark"
  ]);
  syncSelectWithLegacy_("import_item_origin_country", "");
  syncImportItemUnitSuffix_();
  importSelectedDbItemId_ = "";

  renderImportItemsDraft();
  saveImportLocalDraft_();
  updateImportButtons_();
}

function removeImportItemDraft(draftId){
  if(importItemsReadOnly){
    return showToast("此報單已有進口收貨紀錄，明細不可修改。請改用沖銷/補單方式。","error");
  }
  if(String(importSelectedDbItemId_) === String(draftId)) importSelectedDbItemId_ = "";
  importItemsDraft = importItemsDraft.filter(it => it.draft_id !== draftId);
  renderImportItemsDraft();
  saveImportLocalDraft_();
  updateImportButtons_();
}

function resetImportForm(clearLocalDraft = false){
  if(!clearLocalDraft){
    try{
      const hasDraft = Array.isArray(importItemsDraft) && importItemsDraft.length > 0;
      if(hasDraft){
        const ok = window.erpConfirmDiscardKey_("confirm.import.reset_draft", {
          fallback: "你目前已有報單品項草稿。\n重設會清空草稿與表單內容。\n\n是否繼續？"
        });
        if(!ok) return;
      }
    }catch(_eConfirm){}
  }
  importEditing = false;
  importHeaderEditMode_ = false;
  importItemsEditMode_ = false;
  importHeaderSnapshot_ = null;
  importItemsSnapshot_ = null;
  setImportDocReadOnly_(false);
  setImportItemsReadOnly_(false);
  importSelectedDbItemId_ = "";
  importItemsDraft = [];
  renderImportItemsDraft();

  const idEl = document.getElementById("import_doc_id");
  if(idEl){
    // 清除：強制產生新單號（避免沿用剛載入的 import_doc_id）
    erpInitAutoId_("import_doc_id", { gen: () => (typeof generateId === "function" ? generateId("IMP") : ""), force: true });
    idEl.disabled = false;
  }

  impClear_([
    "import_no",
    "import_supplier_id",
    "import_import_date",
    "import_release_date",
    "import_inspection_no",
    "import_document_link",
    "import_remark",
    "import_item_product_id",
    "import_item_hs_code",
    "import_item_lot_id",
    "import_item_declared_qty",
    "import_item_declared_unit",
    "import_item_remark"
  ]);
  const inspEl = document.getElementById("import_inspection_no");
  const linkEl = document.getElementById("import_document_link");
  // `impClear_` 已負責 fallback；這裡統一清空即可
  impClear_(["import_inspection_no","import_document_link","import_remark"]);

  updateImportButtons_();
  setImportCancelBtnState_({ editing: false });

  if(clearLocalDraft){
    clearImportLocalDraft_();
  }else{
    saveImportLocalDraft_();
  }
  setImportReceiptState_("收貨狀態：未載入 — 請先載入報單", "warn");
  try{
    if(window.erpDirty_){
      window.erpDirty_.bind("import", importBuildSnapshot_);
      window.erpDirty_.markSaved("import");
    }
  }catch(_eDirty){}
  importLoadedStatus_ = "";
  try{ importSyncFormLocks_(); }catch(_eLock){}

  // 明細輸入區清空（同 addImportItemDraft 流程一致）
  impClear_(["import_item_product_id","import_item_hs_code","import_item_lot_id"]);
  syncSelectWithLegacy_("import_item_origin_country", "");
  impClear_(["import_item_declared_qty","import_item_declared_unit"]);
  syncImportItemUnitSuffix_();
  impClear_("import_item_remark");
}

async function createImportDocument(triggerEl){
  // 保留舊函式名稱，改走一鍵儲存（更直覺）
  await saveImportDocument(triggerEl);
}

async function updateImportDocument(triggerEl){
  // 保留舊函式名稱，改走一鍵儲存（更直覺）
  await saveImportDocument(triggerEl);
}

async function cancelImportDocument(triggerEl){
  if(!importEditing) return showToast("請先載入一張報單再作廢","error");
  const import_doc_id = (document.getElementById("import_doc_id")?.value || "").trim().toUpperCase();
  if(!import_doc_id) return showToast("報單ID 缺失","error");

  showSaveHint(triggerEl || document.getElementById("importItemsCommitGroup"));
  try{
    const header = await getOne("import_document","import_doc_id",import_doc_id).catch(()=>null);
    if(!header) return showToast("找不到報單","error");
    const st = String(header.status || "").toUpperCase();
    if(st === "CANCELLED") return showToast("此報單已作廢","error");

    const hasReceipt = await hasImportReceipts_(import_doc_id);
    if(hasReceipt){
      return showToast("此報單已有未作廢收貨紀錄，請先至「收貨入庫」作廢所有收貨單後再作廢報單。","error");
    }

    const note = prompt("作廢原因（可留空）") ?? "";
    const ok = window.erpConfirmActionKey_("confirm.cancel.import", {
      import_doc_id,
      fallback: `確定作廢此報單？\n- 報單ID：${import_doc_id}\n\n限制：需先作廢所有收貨單。`
    });
    if(!ok) return;

    await callAPI(
      {
        action: "cancel_import_document_bundle",
        import_doc_id,
        idempotency_key: importBuildIdempotencyKey_("IMP_CANCEL", [import_doc_id, String(note || "").trim(), getCurrentUser()]),
        cancel_note: String(note || "").trim(),
        updated_by: getCurrentUser()
      },
      { method: "POST" }
    );

    if(typeof invalidateCache === "function") invalidateCache("import_document");
    await renderImportDocuments();
    await loadImportDocument(import_doc_id);
    showToast("報單已作廢（CANCELLED）");
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
        if(typeof invalidateCache === "function") invalidateCache("import_document");
        await renderImportDocuments();
        await loadImportDocument(import_doc_id);
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

async function loadImportDocument(importDocId){
  const id = String(importDocId || "").trim().toUpperCase();
  if(!id) return;
  if(importLoading_){
    importPendingLoadId_ = id;
    setImportReceiptState_(`收貨狀態：載入中 — 已排隊 ${id}（完成後自動載入）`, "warn");
    return;
  }
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
  importLoading_ = true;
  try{
    if(typeof erpBeginLoadWarnToast_ === "function"){
      importLoadWarnToken_ = erpBeginLoadWarnToast_(`載入中...請稍等（${id}）`);
    }
  }catch(_eWarn){}
  updateImportButtons_();
  setImportReceiptState_("收貨狀態：檢查中…", "warn");
  // 若有快取且含此報單，直接使用，只再拉明細（少打 1 次 list_import_document）
  let doc = importDocumentsCache && importDocumentsCache.find(d => String(d.import_doc_id || "").trim().toUpperCase() === id);
  if(!doc){
    doc = await getOne("import_document","import_doc_id",id);
  }
  if(!doc){
    try{
      if(typeof erpEndLoadWarnToast_ === "function"){
        erpEndLoadWarnToast_(importLoadWarnToken_);
      }
      importLoadWarnToken_ = "";
    }catch(_eWarnEnd2){}
    return showToast("找不到報單","error");
  }

  importEditing = true;
  importSelectedDbItemId_ = "";
  importHeaderEditMode_ = false;
  importItemsEditMode_ = false;
  importHeaderSnapshot_ = null;
  importItemsSnapshot_ = null;
  clearImportLocalDraft_();
  updateImportButtons_();

  const idEl = document.getElementById("import_doc_id");
  idEl.value = doc.import_doc_id;
  idEl.disabled = true;

  document.getElementById("import_no").value = doc.import_no || "";
  document.getElementById("import_supplier_id").value = doc.supplier_id || "";
  document.getElementById("import_import_date").value = doc.import_date || "";
  document.getElementById("import_release_date").value = doc.release_date || "";
  const inspEl = document.getElementById("import_inspection_no");
  const linkEl = document.getElementById("import_document_link");
  if(inspEl) inspEl.value = doc.inspection_no || "";
  if(linkEl) linkEl.value = doc.document_link || "";
  // import_status 已移除
  document.getElementById("import_remark").value = doc.remark || "";

  // 只拉明細（報單主檔已用快取或 getOne）；產品名稱由產品主檔解析
  const [allItems, products] = await Promise.all([getAll("import_item"), getAll("product").catch(() => [])]);
  const items = (allItems || []).filter(it => String(it.import_doc_id || "").trim().toUpperCase() === id);
  const prodList = Array.isArray(products) ? products : [];
  importProducts = prodList.filter(p => (p.status || "ACTIVE") === "ACTIVE");
  importItemsDraft = items.map((it, idx) => {
    const p = prodList.find(x => x.product_id === it.product_id);
    const product_name = (p && p.product_name) ? p.product_name : (it.product_name || it.product_id || "");
    const product_spec = (p && p.spec) ? p.spec : (it.product_spec || "");
    return {
    draft_id: it.import_item_id,
    item_no: it.item_no != null ? it.item_no : (idx + 1),
    product_id: it.product_id,
    product_name,
    product_spec,
    hs_code: it.hs_code || "",
    lot_id: it.invoice_no || it.lot_id || "",
    declared_qty: Number(it.declared_qty || 0),
    declared_unit: it.declared_unit || "",
    origin_country: it.origin_country || "",
    remark: it.remark || ""
  };
  });

  const locked = await hasImportReceipts_(id);
  setImportDocReadOnly_(locked);
  setImportItemsReadOnly_(locked);
  setImportCancelBtnState_({ editing: true, status: doc.status || "OPEN", hasReceipt: locked });
  try{
    if(window.erpDirty_){
      window.erpDirty_.bind("import", importBuildSnapshot_);
      window.erpDirty_.markSaved("import");
    }
  }catch(_eDirty){}
  importLoadedStatus_ = String(doc.status || "OPEN").toUpperCase();
  // 若舊資料/舊流程未同步狀態，載入時自動修正：有收貨→CLOSED；無收貨→OPEN（不改 CANCELLED）
  try{
    const ds = String(doc.status || "").toUpperCase();
    if(ds !== "CANCELLED"){
      const desired = locked ? "CLOSED" : "OPEN";
      if(ds !== desired){
        await updateRecord("import_document","import_doc_id",id,{
          status: desired,
          updated_by: getCurrentUser(),
          updated_at: nowIso16()
        });
        doc.status = desired;
        importLoadedStatus_ = desired;
      }
    }
  }catch(_e){}
  setImportReceiptState_(
    locked ? "收貨狀態：已載入 — 已收貨（僅可檢視）" : "收貨狀態：已載入 — 未收貨（可編輯）",
    locked ? "warn" : "ok"
  );
  if(locked){
    // 已載入提示：不代表本次操作失敗（仍可更新備註），用 warn 對齊其他單據模組
    showToast("此報單已有進口收貨紀錄：結構欄位已鎖，主檔／明細備註仍可更新。","warn", 6000);
  }

  renderImportItemsDraft();
  updateImportFlowHint_();
  try{ importSyncFormLocks_(); }catch(_eLock){}
  saveImportLocalDraft_();
  importLoading_ = false;
  try{
    if(typeof erpEndLoadWarnToast_ === "function"){
      erpEndLoadWarnToast_(importLoadWarnToken_);
    }
    importLoadWarnToken_ = "";
  }catch(_eWarnEnd){}
  updateImportButtons_();
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
  // 若載入期間又點了其他單號，完成後自動載入最後一次點選的單號
  try{
    const nextId = String(importPendingLoadId_ || "").trim().toUpperCase();
    importPendingLoadId_ = "";
    if(nextId && nextId !== id){
      setTimeout(function(){
        try{ loadImportDocument(nextId); }catch(_e){}
      }, 0);
    }
  }catch(_eNext){}
}

function resetImportReceiptForm(){
  const idEl = document.getElementById("import_receipt_id");
  if(idEl) idEl.value = generateId("IR");

  const dateEl = document.getElementById("import_receipt_date");
  if(dateEl) dateEl.value = nowIso16();

  const wh = document.getElementById("import_receipt_warehouse");
  if(wh) wh.value = "MAIN";

  const st = document.getElementById("import_receipt_status");
  if(st) st.value = "OPEN";

  impClear_("import_receipt_remark");
}

async function createImportReceiptAndLots(){
  // 舊版「進口收貨 + 建 Lot + 建 movement」流程已停用（避免分段寫入造成資料不同步/可繞過 bundle）
  // 請改用：到報單列表按「收貨」→ 進入 Receive 模組，用「產生批次」走後端 bundle 過帳。
  try{
    const docId = (document.getElementById("import_doc_id")?.value || "").trim().toUpperCase();
    if(docId){
      try{ window.__ERP_PREFILL_RCV_SOURCE_TYPE__ = "IMPORT"; }catch(_e1){}
      try{ window.__ERP_PREFILL_RCV_SOURCE_ID__ = docId; }catch(_e2){}
    }
  }catch(_e3){}
  showToast("此舊收貨流程已停用，請改用 Receive →「產生批次」進行收貨過帳。", "error");
  try{ if(typeof navigate === "function") navigate("receive"); }catch(_e4){}
  return;

  // Phase 1（交易一致性）：以下 legacy 寫入路徑會直接呼叫 createRecord(updateGeneric/createGeneric)，
  // 在後端已被視為 transactional table 而封鎖。保留程式碼僅供歷史參考，但永遠不會執行到此處。

  const import_doc_id = (document.getElementById("import_doc_id")?.value || "").trim();
  if(!import_doc_id) return showToast("請先載入或建立一張報單","error");
  if(importItemsDraft.length === 0) return showToast("請至少新增 1 筆報單品項","error");

  const doc = await getOne("import_document","import_doc_id",import_doc_id).catch(()=>null);
  if(!doc) return showToast("找不到此報單主檔，請先至明細區按「建立」寫入報單","error");
  if(String(doc.status || "").toUpperCase() === "CANCELLED"){
    return showToast("此報單已作廢（CANCELLED），不能建立收貨單","error");
  }
  const docNo = doc?.import_no || "";

  // 保底：若報單明細尚未寫入（或有人誤刪），先同步一份到 import_item
  const allItems = await getAll("import_item").catch(()=>[]);
  const savedItems = (allItems || []).filter(it => it.import_doc_id === import_doc_id);
  if(savedItems.length === 0){
    await persistImportItems(import_doc_id, importItemsDraft);
  }

  const import_receipt_id = (document.getElementById("import_receipt_id")?.value || "").trim().toUpperCase();
  document.getElementById("import_receipt_id").value = import_receipt_id;

  const receipt_date = document.getElementById("import_receipt_date")?.value || "";
  const warehouse = (document.getElementById("import_receipt_warehouse")?.value || "").trim();
  const status = document.getElementById("import_receipt_status")?.value || "OPEN";
  const remark = (document.getElementById("import_receipt_remark")?.value || "").trim();

  if(!import_receipt_id) return showToast("收貨單ID 必填","error");
  if(!receipt_date) return showToast("收貨日期 必填","error");

  // 建立收貨單
  const receipt = {
    import_receipt_id,
    import_doc_id,
    receipt_date,
    warehouse,
    status,
    remark,
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    updated_by: "",
    updated_at: ""
  };
  await createRecord("import_receipt", receipt);

  // 逐品項建立 lot（初始 PENDING）
  const products = await getAll("product");

  for(let idx=0; idx<importItemsDraft.length; idx++){
    const it = importItemsDraft[idx];
    const import_item_id = `IMPI-${import_doc_id}-${String(idx+1).padStart(3,"0")}`;

    const p = products.find(x => x.product_id === it.product_id);
    const lot_type = p?.type || "RM";

    const lot_id = generateId("LOT");

    const lot = {
      lot_id,
      product_id: it.product_id,
      warehouse_id: String(warehouse || "").trim().toUpperCase() || "MAIN",
      source_type: "IMPORT",
      source_id: import_receipt_id,
      qty: String(it.declared_qty),
      unit: it.declared_unit,
      type: lot_type,
      status: "", // 交由 service.js 自動補 PENDING
      manufacture_date: "",
      expiry_date: "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: "",
      remark: "",
      system_remark: `Import: ${import_doc_id}${docNo ? " / " + docNo : ""}`.trim()
    };

    await createRecord("lot", lot);

    // 寫入庫存帳本（IN）
    const mv = {
      movement_id: generateId("MV"),
      movement_type: "IN",
      lot_id,
      product_id: it.product_id,
      warehouse_id: String(warehouse || "").trim().toUpperCase() || "MAIN",
      qty: String(Math.abs(Number(it.declared_qty || 0))),
      unit: it.declared_unit,
      ref_type: "IMPORT_RECEIPT",
      ref_id: import_receipt_id,
      remark: "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: "",
      system_remark: `Import IN: ${import_doc_id}`,
    };
    await createRecord("inventory_movement", mv);

    const receiptItem = {
      import_receipt_item_id: `IRI-${import_receipt_id}-${String(idx+1).padStart(3,"0")}`,
      import_receipt_id,
      import_item_id,
      product_id: it.product_id,
      received_qty: String(it.declared_qty),
      unit: it.declared_unit,
      lot_id,
      remark: it.remark || "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: ""
    };

    await createRecord("import_receipt_item", receiptItem);
  }

  // 狀態同步：只要有未作廢收貨單 → 報單狀態寫回 CLOSED
  await updateRecord("import_document","import_doc_id",import_doc_id,{
    status: "CLOSED",
    updated_by: getCurrentUser(),
    updated_at: nowIso16()
  });

  showToast("收貨單已建立，已產生批次（PENDING）");
  resetImportReceiptForm();
}

async function renderImportDocuments(list=null){
  const tbody = document.getElementById("importTableBody");
  if(!tbody) return;

  // 列表狀態：對齊採購單（OPEN / PARTIAL / CLOSED / CANCELLED）
  // - PARTIAL 由「報單申報量」與「已收量」推導（未作廢收貨單）
  let allItems = null;
  let allReceipts = null;
  let allReceiptItems = null;

  let listResolved = list;
  if(!listResolved){
    setTbodyLoading_(tbody, 8);
    [listResolved, allItems, allReceipts, allReceiptItems] = await Promise.all([
      getAll("import_document"),
      getAll("import_item").catch(() => []),
      getAll("import_receipt").catch(() => []),
      getAll("import_receipt_item").catch(() => [])
    ]);
    importDocumentsCache = listResolved;
  } else {
    importDocumentsCache = listResolved;
    [allItems, allReceipts, allReceiptItems] = await Promise.all([
      getAll("import_item").catch(() => []),
      getAll("import_receipt").catch(() => []),
      getAll("import_receipt_item").catch(() => [])
    ]);
  }

  const listToShow = Array.isArray(listResolved) ? listResolved : [];
  const supMap = {};
  (importSuppliers || []).forEach(s => { if(s && s.supplier_id) supMap[s.supplier_id] = s; });

  const declaredByDoc = {};
  (allItems || []).forEach(function(it){
    const docId = String(it && it.import_doc_id || "").trim();
    if(!docId) return;
    declaredByDoc[docId] = (declaredByDoc[docId] || 0) + Number(it.declared_qty || 0);
  });
  const receiptIdsByDoc = {};
  (allReceipts || []).forEach(function(r){
    const docId = String(r && r.import_doc_id || "").trim();
    if(!docId) return;
    const st = String(r && r.status || "").trim().toUpperCase();
    if(st === "CANCELLED") return;
    const rid = String(r && r.import_receipt_id || "").trim();
    if(!rid) return;
    if(!receiptIdsByDoc[docId]) receiptIdsByDoc[docId] = [];
    receiptIdsByDoc[docId].push(rid);
  });
  const receivedByDoc = {};
  const ridToDoc = {};
  Object.keys(receiptIdsByDoc).forEach(function(docId){
    (receiptIdsByDoc[docId] || []).forEach(function(rid){
      ridToDoc[rid] = docId;
    });
  });
  (allReceiptItems || []).forEach(function(ri){
    const rid = String(ri && ri.import_receipt_id || "").trim();
    if(!rid) return;
    const docId = ridToDoc[rid];
    if(!docId) return;
    receivedByDoc[docId] = (receivedByDoc[docId] || 0) + Number(ri.received_qty || 0);
  });
  function importDocDerivedStatus_(doc){
    const raw = String(doc && doc.status || "OPEN").trim().toUpperCase() || "OPEN";
    if(raw === "CANCELLED") return "CANCELLED";
    const docId = String(doc && doc.import_doc_id || "").trim();
    const declared = Number(declaredByDoc[docId] || 0);
    const received = Number(receivedByDoc[docId] || 0);
    if(received <= 1e-9) return "OPEN";
    if(declared > 1e-9 && received + 1e-9 < declared) return "PARTIAL";
    return "CLOSED";
  }
  tbody.innerHTML = "";
  if (!listToShow.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#64748b;padding:24px;">尚無進口報單。請先至「產品」「供應商」建立主檔，再在上方建立報單。</td></tr>';
    return;
  }
  listToShow.forEach(doc => {
    const s = supMap[doc.supplier_id] || null;
    const supplierNameOnly = (s && s.supplier_name) ? s.supplier_name : (doc.supplier_id || "");
    const st = importDocDerivedStatus_(doc);
    const btn = `
      <button class="btn-edit" onclick="loadImportDocument('${doc.import_doc_id}')">Load</button>
      <button class="btn-secondary" onclick="gotoReceive('IMPORT','${doc.import_doc_id}')">收貨</button>
    `;
    const docLink = doc.document_link || "";
    const linkCell = docLink ? `<a href="${docLink}" target="_blank" rel="noopener">文件</a>` : "";
    tbody.innerHTML += `
      <tr>
        <td>${doc.import_doc_id || ""}</td>
        <td>${doc.import_no || ""}</td>
        <td>${doc.import_date || ""}</td>
        <td>${doc.release_date || ""}</td>
        <td>${supplierNameOnly}</td>
        <td>${importDocStatusZh_(st)}</td>
        <td>${linkCell}</td>
        <td>${btn}</td>
      </tr>
    `;
  });
}

async function sortImportDocuments(field){
  const list = await getAll("import_document");
  const sorted = applySorting(list, field, importSort);
  renderImportDocuments(sorted);
}

async function searchImportDocuments(){
  setTbodyLoading_("importTableBody", 8);
  const kw = (document.getElementById("search_import_keyword")?.value || "").trim().toLowerCase();
  const status = document.getElementById("search_import_status")?.value || "";

  const [list, allItems, allReceipts, allReceiptItems] = await Promise.all([
    getAll("import_document"),
    getAll("import_item").catch(()=>[]),
    getAll("import_receipt").catch(()=>[]),
    getAll("import_receipt_item").catch(()=>[])
  ]);
  const supMap = {};
  (importSuppliers || []).forEach(s => { if(s && s.supplier_id) supMap[s.supplier_id] = s; });

  const declaredByDoc = {};
  (allItems || []).forEach(function(it){
    const docId = String(it && it.import_doc_id || "").trim();
    if(!docId) return;
    declaredByDoc[docId] = (declaredByDoc[docId] || 0) + Number(it.declared_qty || 0);
  });
  const receiptIdsByDoc = {};
  (allReceipts || []).forEach(function(r){
    const docId = String(r && r.import_doc_id || "").trim();
    if(!docId) return;
    const st = String(r && r.status || "").trim().toUpperCase();
    if(st === "CANCELLED") return;
    const rid = String(r && r.import_receipt_id || "").trim();
    if(!rid) return;
    if(!receiptIdsByDoc[docId]) receiptIdsByDoc[docId] = [];
    receiptIdsByDoc[docId].push(rid);
  });
  const receivedByDoc = {};
  const ridToDoc = {};
  Object.keys(receiptIdsByDoc).forEach(function(docId){
    (receiptIdsByDoc[docId] || []).forEach(function(rid){
      ridToDoc[rid] = docId;
    });
  });
  (allReceiptItems || []).forEach(function(ri){
    const rid = String(ri && ri.import_receipt_id || "").trim();
    if(!rid) return;
    const docId = ridToDoc[rid];
    if(!docId) return;
    receivedByDoc[docId] = (receivedByDoc[docId] || 0) + Number(ri.received_qty || 0);
  });
  function importDocDerivedStatus_(doc){
    const raw = String(doc && doc.status || "OPEN").trim().toUpperCase() || "OPEN";
    if(raw === "CANCELLED") return "CANCELLED";
    const docId = String(doc && doc.import_doc_id || "").trim();
    const declared = Number(declaredByDoc[docId] || 0);
    const received = Number(receivedByDoc[docId] || 0);
    if(received <= 1e-9) return "OPEN";
    if(declared > 1e-9 && received + 1e-9 < declared) return "PARTIAL";
    return "CLOSED";
  }
  const result = list.filter(d => {
    const s = supMap[d.supplier_id] || null;
    const supName = String(s?.supplier_name || "").toLowerCase();
    const matchKw = !kw ||
      (d.import_doc_id || "").toLowerCase().includes(kw) ||
      (d.import_no || "").toLowerCase().includes(kw) ||
      (d.declaration_no || "").toLowerCase().includes(kw) ||
      (d.supplier_id || "").toLowerCase().includes(kw) ||
      (supName && supName.includes(kw));
    const st = importDocDerivedStatus_(d);
    return matchKw && (!status || st === status);
  });
  renderImportDocuments(result);
}

async function resetImportSearch(){
  impClear_(["search_import_keyword","search_import_status"]);
  await renderImportDocuments();
}