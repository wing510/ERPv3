/*********************************
 * Lots Module（API 版）
 * - QA：PENDING → APPROVED / REJECTED
 * - 庫存：以 inventory_movement 加總計算（不再直接改 lot.available）
 *********************************/

let lotsCache = [];
let movementsCache = []; // legacy: 保留變數以避免其他函式引用報錯
/** 產品主檔完整列，供列表「產品(規格)」與搜尋規格 */
let productsCache = [];
/** product_id -> product_name，供列表與 Modal 顯示 */
let productNameMap = {};
let movementLoadFailed = false;
/** import_receipt_id -> import_doc_id */
let importReceiptIdToDocId = {};
/** gr_id -> po_id */
let goodsReceiptIdToPoId = {};
/** import_doc_id -> import_no（報單號） */
let importDocIdToImportNo = {};
let lotsQaTriggerEl_ = null;
let lotsWarehouses_ = [];
let lotsAvailableByLotId_ = {};
let lotsLoadInFlight_ = false;
let lotsPendingReload_ = false;

function lotsSetV_(id, v){
  try{
    if(typeof window.erpSetVById_ === "function") return window.erpSetVById_(id, v);
  }catch(_e){}
  const el = document.getElementById(String(id || ""));
  if(el && "value" in el) el.value = v;
}

function lotsClear_(ids){
  try{
    if(typeof window.erpClearIds_ === "function") return window.erpClearIds_(ids);
  }catch(_e){}
  const list = Array.isArray(ids) ? ids : [ids];
  for(let i = 0; i < list.length; i++){
    const el = document.getElementById(String(list[i] || ""));
    if(el && "value" in el) el.value = "";
  }
}

function setLotsHeaderHint_(text, type = ""){
  const el = document.getElementById("lotsHeaderHint");
  if(!el) return;
  el.textContent = text || "";
  el.style.color =
    type === "ok" ? "#166534" :
    type === "warn" ? "#92400e" :
    type === "error" ? "#991b1b" :
    "#64748b";
}

function setLotsQaHint_(text, type = ""){
  const el = document.getElementById("lotsQaHint");
  if(!el) return;
  el.textContent = text || "";
  el.style.color =
    type === "ok" ? "#166534" :
    type === "warn" ? "#92400e" :
    type === "error" ? "#991b1b" :
    "#64748b";
}

function escapeLotsHtml_(s){
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function lotsHasOpenModal_(){
  try{
    const qa = document.getElementById("lotsQaConfirmModal");
    const dt = document.getElementById("lotsDateModal");
    const qaOpen = !!(qa && qa.style && qa.style.display && qa.style.display !== "none");
    const dtOpen = !!(dt && dt.style && dt.style.display && dt.style.display !== "none");
    return qaOpen || dtOpen;
  }catch(_e){
    return false;
  }
}

function lotsCloseAnyModal_(){
  try{ closeLotsQaConfirm(); }catch(_e){}
  try{ closeLotDateModal(); }catch(_e2){}
}

async function lotsRenderGuarded_(){
  if(lotsHasOpenModal_()){
    const ok = window.erpConfirmDiscardKey_("confirm.lots.close_modal", {
      fallback: "你正在操作 Lots 的 QA/日期視窗。\n切換篩選條件會關閉視窗並清空目前操作內容，避免誤操作。\n\n是否繼續？"
    });
    if(!ok) return;
    lotsCloseAnyModal_();
  }
  await renderLots();
}

function syncLotsRebuildBalanceVisibility_(){
  const btn = document.getElementById("lotsRebuildBalanceBtn");
  if(!btn) return;
  const role = typeof getCurrentUserRole === "function"
    ? String(getCurrentUserRole() || "").trim().toUpperCase()
    : "";
  const show = role === "ADMIN";
  btn.style.display = show ? "" : "none";
  btn.setAttribute("aria-hidden", show ? "false" : "true");
}

async function lotsRebuildBalanceClick(){
  if(
    typeof getCurrentUserRole !== "function" ||
    String(getCurrentUserRole() || "").trim().toUpperCase() !== "ADMIN"
  ){
    if(typeof showToast === "function") showToast("僅 ADMIN 可重建庫存快照。", "error");
    return;
  }
  const ok = typeof erpConfirmActionKey_ === "function"
    ? erpConfirmActionKey_("confirm.action.generic", {
      fallback: "將依 inventory_movement 全表重算 lot_balance 快照（查詢加速用）。\n日常有異動會自動更新；僅在懷疑快照不一致時才需要。\n\n確定要重建嗎？"
    })
    : window.confirm("將重算 lot_balance 快照。確定要重建嗎？");
  if(!ok) return;

  const btn = document.getElementById("lotsRebuildBalanceBtn");
  if(btn) btn.disabled = true;
  if(typeof showSaveHint === "function") showSaveHint();
  try{
    const actor = typeof getCurrentUser === "function" ? String(getCurrentUser() || "").trim() : "";
    const r = await callAPI({
      action: "admin_rebuild_lot_balance",
      created_by: actor,
      updated_by: actor
    }, { method: "POST" });
    if(!r || !r.success){
      const msg = (r && r.errors && r.errors.length) ? r.errors.join("; ") : "重建失敗";
      if(typeof showToast === "function") showToast(msg, "error");
      return;
    }
    const n = Number(r.rebuilt || 0);
    if(typeof showToast === "function"){
      showToast("庫存快照已重建（" + n + " 筆 lot）", "success");
    }
    await loadLotsAndMovements();
    await lotsRenderGuarded_();
  }catch(e){
    if(typeof showToast === "function") showToast(String(e && e.message ? e.message : e), "error");
  }finally{
    if(btn) btn.disabled = false;
    if(typeof hideSaveHint === "function") hideSaveHint();
  }
}

async function lotsInit(){
  setLotsHeaderHint_("批次狀態：載入中…", "warn");
  setLotsQaHint_("QA概況：載入中…", "warn");
  syncLotsRebuildBalanceVisibility_();
  await loadLotsAndMovements();
  bindAutoSearchToolbar_([
    ["search_lots_keyword", "input"],
    ["search_inventory_status", "change"],
    ["search_inspection_status", "change"]
  ], () => lotsRenderGuarded_());
  // 其他模組跳轉帶入關鍵字（例如：收貨入庫建立批次後帶入收貨單ID）
  try{
    const kw = window.__ERP_PREFILL_LOTS_KEYWORD__;
    if(kw){
      const el = document.getElementById("search_lots_keyword");
      if(el) el.value = String(kw);
      delete window.__ERP_PREFILL_LOTS_KEYWORD__;
    }
  }catch(_e){}
  await lotsRenderGuarded_();
}

async function refreshLotsData(){
  showSaveHint();
  try{
    await loadLotsAndMovements();
    await lotsRenderGuarded_();
    if(!movementLoadFailed){
      showToast("Lots 資料已更新");
    }
  }finally{
    hideSaveHint();
  }
}

async function loadLotsAndMovements(){
  if(lotsLoadInFlight_){
    lotsPendingReload_ = true;
    setLotsHeaderHint_("批次狀態：載入中…（已排隊更新）", "warn");
    return;
  }
  lotsLoadInFlight_ = true;
  try{
    const lotsTb = document.getElementById("lotsTableBody");
    // Lots 列表目前為 9 欄（合併 Lot ID/產品，且已移除「類型」欄）
    if(lotsTb) setTbodyLoading_(lotsTb, 9);

    try{
      const [lots, products, warehouses, importReceipts, goodsReceipts, importDocs] = await Promise.all([
        getAll("lot"),
        getAll("product").catch(() => []),
        getAll("warehouse").catch(() => []),
        getAll("import_receipt").catch(() => []),
        getAll("goods_receipt").catch(() => []),
        getAll("import_document").catch(() => [])
      ]);
      lotsCache = lots || [];
      productsCache = products || [];
      lotsWarehouses_ = (warehouses || []).filter(w => String(w.status || "ACTIVE").toUpperCase() === "ACTIVE");
      productNameMap = {};
      (products || []).forEach(p => {
        if (p && p.product_id) productNameMap[p.product_id] = p.product_name || p.product_id;
      });

      importReceiptIdToDocId = {};
      (importReceipts || []).forEach(r => {
        if(r && r.import_receipt_id){
          importReceiptIdToDocId[r.import_receipt_id] = r.import_doc_id || "";
        }
      });
      goodsReceiptIdToPoId = {};
      (goodsReceipts || []).forEach(r => {
        if(r && r.gr_id){
          goodsReceiptIdToPoId[r.gr_id] = r.po_id || "";
        }
      });
      importDocIdToImportNo = {};
      (importDocs || []).forEach(d => {
        if(d && d.import_doc_id){
          importDocIdToImportNo[d.import_doc_id] = d.import_no || "";
        }
      });

      const core = await loadInventoryCoreData_({ needWarehouses: false, needMovementDetails: false });
      lotsAvailableByLotId_ = core.movementAvailableByLotId || {};
      movementLoadFailed = !!core.movementLoadFailed;
      if(movementLoadFailed){
        if(typeof showToast === "function"){
          showToast("讀取庫存異動失敗，可用量顯示 --。請重新整理頁面或稍後再試。", "error");
        }
        setLotsHeaderHint_("批次狀態：讀取庫存異動失敗（可用量顯示 --）", "error");
      }else{
        setLotsHeaderHint_(lotsCache.length ? `批次狀態：已載入 — ${lotsCache.length} 筆` : "批次狀態：已載入 — 0 筆", "ok");
      }
    }catch(_e){
      movementLoadFailed = true;
      // 讀取異動失敗時顯示「--」，避免誤判為 0
      if(typeof showToast === "function"){
        showToast("讀取庫存異動失敗，可用量顯示 --。請重新整理頁面或稍後再試。", "error");
      }
      lotsAvailableByLotId_ = {};
      setLotsHeaderHint_("批次狀態：讀取庫存異動失敗（可用量顯示 --）", "error");
    }

    // QA 概況：以目前快取清單為基礎
    {
      const rows = Array.isArray(lotsCache) ? lotsCache : [];
      const c = { PENDING: 0, APPROVED: 0, REJECTED: 0, OTHER: 0 };
      rows.forEach(l => {
        const s = String(l?.status || "PENDING").toUpperCase();
        if(s === "PENDING") c.PENDING++;
        else if(s === "APPROVED") c.APPROVED++;
        else if(s === "REJECTED") c.REJECTED++;
        else c.OTHER++;
      });
      const base = `QA概況：待QA ${c.PENDING}｜QA已放行 ${c.APPROVED}｜QA已退回 ${c.REJECTED}`;
      setLotsQaHint_(rows.length ? (c.OTHER ? `${base}｜其他 ${c.OTHER}` : base) : "QA概況：0 筆", "ok");
    }
  } finally {
    lotsLoadInFlight_ = false;
    if(lotsPendingReload_){
      lotsPendingReload_ = false;
      // 讓事件迴圈先跑完，避免同步遞迴造成 UI 卡住
      setTimeout(function(){
        try{ loadLotsAndMovements(); }catch(_e){}
      }, 0);
    }
  }
}

function getLotsAvailableByLotId(lotId){
  const id = String(lotId || "");
  if(!id) return null;
  const hit = lotsAvailableByLotId_?.[id];
  if(hit !== undefined) return hit;
  return null;
}

function lotsWarehouseLabelById_(warehouseId){
  const id = String(warehouseId || "").trim().toUpperCase();
  if(!id) return "";
  const w = (lotsWarehouses_ || []).find(x => String(x.warehouse_id || "").toUpperCase() === id) || null;
  if(!w) return id;
  const name = String(w.warehouse_name || "").trim();
  const cat = String(w.category || "").trim().toUpperCase();
  const catLabel = (typeof termShortZh_ === "function" ? termShortZh_(cat) : ((typeof termLabel === "function" ? termLabel(cat) : "") || cat));
  const namePart = name || id;
  return catLabel ? `${namePart}-${catLabel}` : namePart;
}

/** 與後端 desiredInventoryStatusForLot_ 一致，避免試算表 inventory_status 未同步仍顯示 ACTIVE */
function isLotExpiredClient_(expiryDateStr){
  return invIsExpired_(expiryDateStr);
}

function getLotInventoryStatusDerived_(lot){
  if(movementLoadFailed) return lot.inventory_status || "ACTIVE";
  // 若批次已被明確標記為 VOID（例如作廢回收的產出批次），一律視為不可用
  if(String(lot.inventory_status || "").toUpperCase() === "VOID") return "VOID";
  const av = getLotsAvailableByLotId(lot.lot_id);
  if(av === null || av === undefined) return String(lot.inventory_status || "ACTIVE").toUpperCase();
  if(isLotExpiredClient_(lot.expiry_date)) return "VOID";
  if(Number(av || 0) <= 1e-9) return "CLOSED";
  return "ACTIVE";
}

function closeLotsQaConfirm(){
  const el = document.getElementById("lotsQaConfirmModal");
  if(el){ el.style.display = "none"; delete el.dataset.lotId; delete el.dataset.action; }
  lotsQaTriggerEl_ = null;
}

function getLotById(lotId){
  return (lotsCache || []).find(l => (l.lot_id || "") === lotId) || null;
}

function isTransferDerivedLot_(lot){
  const sr = String(lot?.system_remark || "");
  // 轉倉時 system_remark 會寫「轉倉自 XXX（A → B）」
  return sr.includes("轉倉自 ");
}

function getTransferSourceLotId_(lot){
  const sr = String(lot?.system_remark || "");
  // 例：轉倉自 LOT-XXXX（A → B）
  const m = sr.match(/轉倉自\s*([^\s（]+)\s*（/);
  return m ? String(m[1] || "").trim() : "";
}

function getTransferChildrenLots_(sourceLotId){
  const id = String(sourceLotId || "").trim();
  if(!id) return [];
  return (lotsCache || []).filter(l => {
    if(!l) return false;
    if(!isTransferDerivedLot_(l)) return false;
    return String(l.system_remark || "").includes(`轉倉自 ${id}`);
  });
}

/** 列表顯示「產品名稱（規格）」；無主檔時退回 product_id */
function lotsFormatProductSpec_(lot){
  const pid = lot.product_id || "";
  if(!pid) return "—";
  const p = (productsCache || []).find(x => (x.product_id || "") === pid);
  const name = p ? (p.product_name || pid) : pid;
  const spec = p && String(p.spec || "").trim() ? String(p.spec).trim() : "";
  if(spec) return `${name}（${spec}）`;
  return name;
}

function showQaApproveConfirm(lotId){
  const lot = getLotById(lotId);
  if(!lot){ showToast("找不到此批次","error"); return; }
  const productName = productNameMap[lot.product_id] || lot.product_id || "";
  const modal = document.getElementById("lotsQaConfirmModal");
  const title = document.getElementById("qaConfirmTitle");
  const batch = document.getElementById("qaConfirmBatchInfo");
  const impact = document.getElementById("qaConfirmImpact");
  const primary = document.getElementById("qaConfirmPrimary");
  if(!modal || !title || !batch || !impact || !primary) return;
  title.textContent = "確定放行此批次？";
  batch.innerHTML = "批號：<strong>" + String(lot.lot_id || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") + "</strong><br>產品：" + String(productName || lot.product_id || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") + "<br>數量：" + (lot.qty != null ? lot.qty : "") + (lot.unit ? " " + lot.unit : "");
  impact.innerHTML = "√ 可以出貨<br>√ 可以進行加工<br>√ 可以銷售";
  primary.textContent = "確認放行";
  primary.onclick = function(){ doApproveLot(lotId, lotsQaTriggerEl_ || primary); };
  modal.dataset.lotId = lotId;
  modal.dataset.action = "approve";
  modal.style.display = "flex";
}

function showQaRejectConfirm(lotId){
  const lot = getLotById(lotId);
  if(!lot){ showToast("找不到此批次","error"); return; }
  const productName = productNameMap[lot.product_id] || lot.product_id || "";
  const modal = document.getElementById("lotsQaConfirmModal");
  const title = document.getElementById("qaConfirmTitle");
  const batch = document.getElementById("qaConfirmBatchInfo");
  const impact = document.getElementById("qaConfirmImpact");
  const primary = document.getElementById("qaConfirmPrimary");
  if(!modal || !title || !batch || !impact || !primary) return;
  title.textContent = "確定退回此批次？";
  batch.innerHTML = "批號：<strong>" + String(lot.lot_id || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") + "</strong><br>產品：" + String(productName || lot.product_id || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") + "<br>數量：" + (lot.qty != null ? lot.qty : "") + (lot.unit ? " " + lot.unit : "");
  impact.textContent = "此批次將不可用於出貨、加工、銷售。";
  primary.textContent = "確認退回";
  primary.onclick = function(){ doRejectLot(lotId, lotsQaTriggerEl_ || primary); };
  modal.dataset.lotId = lotId;
  modal.dataset.action = "reject";
  modal.style.display = "flex";
}

async function doApproveLot(lotId, triggerEl){
  const note = prompt("QA 放行備註（可留空）") ?? "";
  showSaveHint(triggerEl || document.getElementById("qaConfirmPrimary"));
  let ok = false;
  try {
  const lot0 = getLotById(lotId) || null;
  await updateRecord("lot","lot_id",lotId,{
    status: "APPROVED",
    updated_by: getCurrentUser(),
    updated_at: nowIso16(),
    ...(note ? { remark: note } : {})
  });

  // 轉倉衍生 Lot：QA 狀態需一致（可從來源放行；也允許從衍生 Lot 放行）
  const sourceId = (lot0 && isTransferDerivedLot_(lot0)) ? getTransferSourceLotId_(lot0) : "";
  const rootId = sourceId || lotId;
  if(sourceId){
    await updateRecord("lot","lot_id",sourceId,{
      status: "APPROVED",
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
  }
  const children = getTransferChildrenLots_(rootId);
  for(const c of children){
    if(!c?.lot_id) continue;
    await updateRecord("lot","lot_id",c.lot_id,{
      status: "APPROVED",
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
  }

  await loadLotsAndMovements();
  await renderLots();
  showToast("已放行（APPROVED）");
  ok = true;
  } finally {
    hideSaveHint();
    if(ok) closeLotsQaConfirm();
  }
}

async function doRejectLot(lotId, triggerEl){
  const note = prompt("QA 退回備註（可留空）") ?? "";
  showSaveHint(triggerEl || document.getElementById("qaConfirmPrimary"));
  let ok = false;
  try {
  const lot0 = getLotById(lotId) || null;
  await updateRecord("lot","lot_id",lotId,{
    status: "REJECTED",
    updated_by: getCurrentUser(),
    updated_at: nowIso16(),
    ...(note ? { remark: note } : {})
  });

  // 轉倉衍生 Lot：QA 狀態需一致（可從來源退回；也允許從衍生 Lot 退回）
  const sourceId = (lot0 && isTransferDerivedLot_(lot0)) ? getTransferSourceLotId_(lot0) : "";
  const rootId = sourceId || lotId;
  if(sourceId){
    await updateRecord("lot","lot_id",sourceId,{
      status: "REJECTED",
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
  }
  const children = getTransferChildrenLots_(rootId);
  for(const c of children){
    if(!c?.lot_id) continue;
    await updateRecord("lot","lot_id",c.lot_id,{
      status: "REJECTED",
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
  }

  await loadLotsAndMovements();
  await renderLots();
  showToast("已退回（REJECTED）");
  ok = true;
  } finally {
    hideSaveHint();
    if(ok) closeLotsQaConfirm();
  }
}

function approveLot(lotId, triggerEl){ lotsQaTriggerEl_ = triggerEl || null; showQaApproveConfirm(lotId); }
function rejectLot(lotId, triggerEl){ lotsQaTriggerEl_ = triggerEl || null; showQaRejectConfirm(lotId); }

async function editLotDates(lotId){
  const lot = getLotById(lotId);
  if(!lot){
    return showToast("找不到此批次","error");
  }
  showLotDateModal(lot);
}

function showLotDateModal(lot){
  const modal = document.getElementById("lotsDateModal");
  const info = document.getElementById("lotDateBatchInfo");
  const mfgEl = document.getElementById("lotDateManufacture");
  const expEl = document.getElementById("lotDateExpiry");
  if(!modal || !info || !mfgEl || !expEl) return;
  modal.dataset.lotId = lot.lot_id || "";
  info.innerHTML = "批號：<strong>" + escapeLotsHtml_(lot.lot_id || "") + "</strong><br>產品：" + escapeLotsHtml_(productNameMap[lot.product_id] || lot.product_id || "");
  mfgEl.value = String(lot.manufacture_date || "");
  expEl.value = String(lot.expiry_date || "");
  modal.style.display = "flex";
}

function closeLotDateModal(){
  const modal = document.getElementById("lotsDateModal");
  if(!modal) return;
  modal.style.display = "none";
  delete modal.dataset.lotId;
}

async function saveLotDatesFromModal(triggerEl){
  const modal = document.getElementById("lotsDateModal");
  const mfgEl = document.getElementById("lotDateManufacture");
  const expEl = document.getElementById("lotDateExpiry");
  if(!modal || !mfgEl || !expEl) return;
  const lotId = String(modal.dataset.lotId || "");
  if(!lotId) return;
  const mfgVal = String(mfgEl.value || "").trim();
  const expVal = String(expEl.value || "").trim();
  if(mfgVal && expVal && expVal < mfgVal){
    return showToast("有效期不可早於製造日", "error");
  }

  showSaveHint(triggerEl || document.getElementById("lotDateSaveBtn"));
  try{
    await updateRecord("lot", "lot_id", lotId, {
      manufacture_date: mfgVal,
      expiry_date: expVal,
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
    closeLotDateModal();
    await loadLotsAndMovements();
    await renderLots();
    showToast("批次日期已更新");
  } finally { hideSaveHint(); }
}

function sourceTypeLabel_(sourceType){
  const t = String(sourceType || "").toUpperCase();
  if(t === "PURCHASE") return "採購入庫";
  if(t === "IMPORT") return "進口收貨";
  if(t === "PROCESS") return "加工產出";
  return t || "未知來源";
}

function lotInventoryStatusLabel_(status){
  const s = String(status || "").toUpperCase();
  if(s === "ACTIVE") return "可使用";
  if(s === "CLOSED") return "無庫存";
  if(s === "VOID") return "已過期";
  return (typeof termLabelZhOnly === "function" ? termLabelZhOnly(s || "") : termLabel(s || ""));
}

function lotInventoryStatusBadge_(status){
  const s = String(status || "").toUpperCase();
  const label = lotInventoryStatusLabel_(s);
  const cls =
    s === "ACTIVE" ? "lots-status-light lots-status-light-active" :
    s === "CLOSED" ? "lots-status-light lots-status-light-closed" :
    s === "VOID" ? "lots-status-light lots-status-light-void" :
    "lots-status-light";
  return `<span class="${cls}">${escapeLotsHtml_(label)}</span>`;
}

function lotQaStatusLabel_(status){
  const s = String(status || "").toUpperCase();
  if(s === "PENDING") return "待QA";
  if(s === "APPROVED") return "QA已放行";
  if(s === "REJECTED") return "QA已退回";
  return (typeof termLabelZhOnly === "function" ? termLabelZhOnly(s || "") : termLabel(s || ""));
}

function getLotImportDocId_(lot){
  if(String(lot.source_type || "").toUpperCase() !== "IMPORT") return "";
  const ir = lot.source_id || "";
  return importReceiptIdToDocId[ir] || "";
}

function getLotPoId_(lot){
  if(String(lot.source_type || "").toUpperCase() !== "PURCHASE") return "";
  const gr = lot.source_id || "";
  return goodsReceiptIdToPoId[gr] || "";
}

/** 同一張報單／採購單集中：以業務主檔為群組鍵 */
function getLotBusinessGroupKey_(lot){
  const st = String(lot.source_type || "").toUpperCase();
  if(st === "IMPORT"){
    const doc = getLotImportDocId_(lot);
    return doc ? `IMP_DOC:${doc}` : `IR:${lot.source_id || ""}`;
  }
  if(st === "PURCHASE"){
    const po = getLotPoId_(lot);
    return po ? `PO:${po}` : `GR:${lot.source_id || ""}`;
  }
  return `${st}:${lot.source_id || ""}`;
}

function formatLotGroupHeader_(lot){
  const st = String(lot.source_type || "").toUpperCase();
  const sid = lot.source_id || "";
  if(st === "IMPORT"){
    const docId = getLotImportDocId_(lot);
    const impNo = docId ? (importDocIdToImportNo[docId] || "") : "";
    if(docId){
      const noPart = impNo ? `${impNo}` : "—";
      return `進口報單：報單號 ${noPart}｜報單ID ${docId}`;
    }
    return `進口：收貨單 ${sid}（尚未對應到報單，請檢查 import_receipt）`;
  }
  if(st === "PURCHASE"){
    const po = getLotPoId_(lot);
    if(po){
      return `採購單：${po}`;
    }
    return `採購：收貨單 ${sid}（尚未對應到 PO，請檢查 goods_receipt）`;
  }
  return `${sourceTypeLabel_(lot.source_type)}：${sid}`;
}

async function renderLots(){
  const container = document.getElementById("lotsTableBody");
  if (!container) return;

  const qKw = (document.getElementById("search_lots_keyword")?.value || "").trim().toLowerCase();
  const qInv = document.getElementById("search_inventory_status")?.value || "";
  const qQa = document.getElementById("search_inspection_status")?.value || "";

  container.innerHTML = "";

  const list = (lotsCache || []).filter(l => {
    if(qKw){
      const docId = getLotImportDocId_(l);
      const poId = getLotPoId_(l);
      const impNo = docId ? String(importDocIdToImportNo[docId] || "").toLowerCase() : "";
      const pid = (l.product_id || "").toLowerCase();
      const pname = (productNameMap[l.product_id] || "").toLowerCase();
      const pObj = (productsCache || []).find(x => (x.product_id || "") === l.product_id);
      const pspec = pObj ? String(pObj.spec || "").toLowerCase() : "";
      const ptype = pObj ? String(pObj.type || "").toLowerCase() : "";
      const whId = String(l.warehouse_id || "").toLowerCase();
      const whLabel = String(lotsWarehouseLabelById_(l.warehouse_id) || "").toLowerCase();
      const srcId = String(l.source_id || "").trim().toUpperCase();
      const srcType = String(l.source_type || "").trim().toUpperCase();
      const hay = [
        l.lot_id,
        l.remark,
        pid,
        pname,
        pspec,
        ptype,
        l.source_id,
        l.source_type,
        docId,
        poId,
        impNo,
        whId,
        whLabel
      ].filter(Boolean).join(" ").toLowerCase();
      // 關鍵字若為收貨單/報單類單號：除了全文 hay.includes 外，也允許直接比對 lot.source_id
      //（避免使用者輸入 GR-xxxx 但 hay 沒把 GR 單獨切出 token 導致永遠找不到）
      const kw = String(qKw || "").trim();
      const kwU = kw.toUpperCase();
      const hitReceiptId =
        (kwU.startsWith("GR-") || kwU.startsWith("IR-")) &&
        srcId &&
        srcId === kwU &&
        (srcType === "PURCHASE" || srcType === "IMPORT");
      if(!hitReceiptId && !hay.includes(qKw)) return false;
    }
    if(qInv && getLotInventoryStatusDerived_(l) !== qInv) return false;
    if(qQa && (l.status || "PENDING") !== qQa) return false;
    return true;
  });

  // 最新在上：群組鍵 / 收貨單ID / Lot ID 皆採「由新到舊」
  //（Lot ID 與多數單據 ID 皆含日期時間，字串排序即可反映新舊）
  const sorted = [...list].sort((a,b)=>{
    const ak = getLotBusinessGroupKey_(a);
    const bk = getLotBusinessGroupKey_(b);
    if(ak !== bk) return bk.localeCompare(ak);
    const aIr = String(a.source_id || "");
    const bIr = String(b.source_id || "");
    if(aIr !== bIr) return bIr.localeCompare(aIr);
    return String(b.lot_id || "").localeCompare(String(a.lot_id || ""));
  });

  const byBiz = {};
  sorted.forEach(lot => {
    const k = getLotBusinessGroupKey_(lot);
    if(!byBiz[k]) byBiz[k] = [];
    byBiz[k].push(lot);
  });
  const bizKeyOrder = [];
  sorted.forEach(lot => {
    const k = getLotBusinessGroupKey_(lot);
    if(!bizKeyOrder.includes(k)) bizKeyOrder.push(k);
  });

  bizKeyOrder.forEach(bk => {
    const bucket = byBiz[bk];
    const count = bucket.length;
    const headerLot = bucket[0];
    const headerText = formatLotGroupHeader_(headerLot);
    container.innerHTML += `
      <tr style="background:#f8fafc;">
        <td colspan="9" style="font-weight:600;color:#334155;padding:10px 12px;">
          ${escapeLotsHtml_(headerText)}（共 ${count} 批）
        </td>
      </tr>
    `;

    const byReceipt = {};
    bucket.forEach(lot => {
      const rid = lot.source_id ? String(lot.source_id) : "__EMPTY__";
      if(!byReceipt[rid]) byReceipt[rid] = [];
      byReceipt[rid].push(lot);
    });
    const rkeys = Object.keys(byReceipt).sort((a, b) => {
      if(a === "__EMPTY__") return 1;
      if(b === "__EMPTY__") return -1;
      return b.localeCompare(a);
    });

    rkeys.forEach(rk => {
      const sub = byReceipt[rk];
      const subCnt = sub.length;
      const label = rk === "__EMPTY__" ? "—" : rk;
      container.innerHTML += `
        <tr style="background:#f1f5f9;">
          <td colspan="9" style="font-weight:600;color:#475569;padding:8px 12px;font-size:13px;">
            收貨單ID：${escapeLotsHtml_(label)}（共 ${subCnt} 批）
          </td>
        </tr>
      `;

      sub.forEach(lot => {
        const available = movementLoadFailed ? "--" : getLotsAvailableByLotId(lot.lot_id);
        const invStatus = getLotInventoryStatusDerived_(lot);
        const qaStatus = lot.status || "PENDING";
        const whText = lotsWarehouseLabelById_(lot.warehouse_id) || (lot.warehouse_id ? String(lot.warehouse_id) : "");

        const safeLotId = (lot.lot_id || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        const allowQa = String(invStatus || "").toUpperCase() === "ACTIVE";
        const action =
          (qaStatus === "PENDING" && allowQa)
            ? `<button type="button" class="btn-secondary btn-lots-action" onclick="approveLot('${safeLotId}', this)">QA<br>放行</button>
               <button type="button" class="btn-secondary btn-lots-action" onclick="rejectLot('${safeLotId}', this)">QA<br>退回</button>
               <button type="button" class="btn-secondary btn-lots-action" onclick="editLotDates('${safeLotId}')">補登<br>日期</button>`
            : `<button type="button" class="btn-secondary btn-lots-action" onclick="openLogs('lot','${safeLotId}','inventory')">Log</button>
               <button type="button" class="btn-secondary btn-lots-action" onclick="window.__pendingTraceLotId='${safeLotId}';if(typeof navigate==='function')navigate('trace')">追溯</button>
               <button type="button" class="btn-secondary btn-lots-action" onclick="editLotDates('${safeLotId}')">補登<br>日期</button>`;

        const productDisplay = lotsFormatProductSpec_(lot);
        const pidAttr = escapeLotsHtml_(lot.product_id || "");
        const lotIdText = escapeLotsHtml_(lot.lot_id || "");
        const prodText = escapeLotsHtml_(productDisplay);

        container.innerHTML += `
      <tr>
        <td title="${lotIdText}">
          <div style="font-size:12px;color:#64748b;line-height:1.2;">${lotIdText}</div>
          <div title="${pidAttr}" style="line-height:1.25;">${prodText}</div>
        </td>
        <td>${escapeLotsHtml_(whText || "—")}</td>
        <td>${escapeLotsHtml_(lot.qty != null ? String(lot.qty) : "")}</td>
        <td>${escapeLotsHtml_(String(available))}</td>
        <td>${escapeLotsHtml_(lot.manufacture_date || "")}</td>
        <td>${escapeLotsHtml_(lot.expiry_date || "")}</td>
        <td>${lotInventoryStatusBadge_(invStatus)}</td>
        <td>${lotQaStatusLabel_(qaStatus)}</td>
        <td>${action}</td>
      </tr>
    `;
      });
    });
  });
}

function resetLotsSearch(){
  const kw = document.getElementById("search_lots_keyword");
  const inv = document.getElementById("search_inventory_status");
  const qa = document.getElementById("search_inspection_status");
  lotsClear_(["search_lots_keyword", "search_inventory_status", "search_inspection_status"]);
  renderLots();
}