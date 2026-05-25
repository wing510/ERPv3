/*********************************
 * Movements Module（API 版）
 * - 實際扣庫/入庫都寫入 inventory_movement
 * - 後端會阻擋負庫存，且 OUT 類型只允許 APPROVED lot
 *********************************/

let mvLots = [];
let mvProducts = [];
let mvMovements = [];
/** 與 Lots 相同：後端全量彙總 lot_id -> sum(qty)，供下拉「可用」與扣庫上限（不依賴近 N 天 movements） */
let mvAvailByLotId_ = {};
let mvAvailMapOk_ = false;
let mvUsers = [];
let mvCustomers = [];
let mvWarehouses = [];
/** 與 Lots 相同：IR→報單、GR→PO，方便辨識來源 */
let mvImportReceiptIdToDocId = {};
let mvGoodsReceiptIdToPoId = {};
let mvImportDocIdToImportNo = {};
let mvLoadInFlight_ = false;
let mvPendingReload_ = false;

function mvSetV_(id, v){
  try{
    if(typeof window.erpSetVById_ === "function") return window.erpSetVById_(id, v);
  }catch(_e){}
  const el = document.getElementById(String(id || ""));
  if(el && "value" in el) el.value = v;
}

function mvClear_(ids){
  try{
    if(typeof window.erpClearIds_ === "function") return window.erpClearIds_(ids);
  }catch(_e){}
  const list = Array.isArray(ids) ? ids : [ids];
  for(let i = 0; i < list.length; i++){
    const el = document.getElementById(String(list[i] || ""));
    if(el && "value" in el) el.value = "";
  }
}

function escapeMvHtml_(s){
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function escapeMvAttr_(s){
  return String(s ?? "").replace(/\\/g,"\\\\").replace(/"/g,"&quot;");
}

function mvRoleLabel_(role){
  const r = String(role || "").trim().toUpperCase();
  if(r === "ADMIN") return "管理員";
  if(r === "QA") return "品保";
  if(r === "OP") return "作業";
  if(r === "SL" || r === "SALES") return "業務";
  if(r === "WH" || r === "WAREHOUSE") return "倉管";
  if(r === "FN" || r === "FINANCE") return "財務";
  if(r === "GA" || r === "GENERAL_AFFAIRS") return "總務";
  if(r === "CEO") return "CEO";
  return r || "未指定";
}

function setMvHeaderHint_(text, tone){
  const el = document.getElementById("mvHeaderHint");
  if(!el) return;
  // Phase 3：統一句型（若 utils 尚未載入，fallback 原字串）
  try{
    const raw = String(text || "");
    if(typeof window.erpFlowHintText_ === "function"){
      // 允許呼叫端直接傳 "狀態｜提示"；沒有就只當狀態
      const parts = raw.split("｜");
      const state = String(parts[0] || "").trim();
      const hint = String(parts[1] || "").trim();
      el.textContent = window.erpFlowHintText_("庫存異動", state, hint);
    }else{
      el.textContent = raw;
    }
  }catch(_e){
    el.textContent = String(text || "");
  }
  const t = String(tone || "").toLowerCase();
  el.style.color =
    t === "error" ? "#b91c1c" :
    t === "warn" ? "#b45309" :
    t === "ok" ? "#0f766e" :
    "#64748b";
}

function setMvLotHint_(text, tone){
  const el = document.getElementById("mvLotHint");
  if(!el) return;
  try{
    const raw = String(text || "");
    if(typeof window.erpFlowHintText_ === "function"){
      const parts = raw.split("｜");
      const state = String(parts[0] || "").trim();
      const hint = String(parts[1] || "").trim();
      el.textContent = window.erpFlowHintText_("Lot 下拉", state, hint);
    }else{
      el.textContent = raw;
    }
  }catch(_e){
    el.textContent = String(text || "");
  }
  const t = String(tone || "").toLowerCase();
  el.style.color =
    t === "error" ? "#b91c1c" :
    t === "warn" ? "#b45309" :
    t === "ok" ? "#0f766e" :
    "#64748b";
}

async function movementsInit(){
  // 統一句型：模組：狀態 · 提示（使用 "｜" 分隔狀態與提示）
  setMvHeaderHint_("載入中…｜請稍候", "warn");
  setMvLotHint_("載入中…｜請稍候", "warn");
  await refreshMovementData();
  await initMovementLotDropdown();
  await mvInitWarehouseDropdown_();
  mvInitIssuedToDropdown_();
  // 用途切換：轉倉/扣庫模式互鎖（避免切換後欄位仍維持 disabled）
  try{
    const p = document.getElementById("mv_purpose");
    if(p && !p.dataset.mvBound){
      p.dataset.mvBound = "1";
      p.addEventListener("change", function(){ mvUpdateActionMode_(); });
    }
  }catch(_e){}
  // 轉倉模式切換（checkbox）
  try{
    const cb = document.getElementById("mv_is_transfer");
    if(cb && !cb.dataset.mvBound){
      cb.dataset.mvBound = "1";
      cb.addEventListener("change", function(){ mvOnTransferToggleChange_(); });
    }
  }catch(_e){}
  bindAutoSearchToolbar_([
    ["mv_search_keyword", "input"],
    ["mv_filter_movement_type", "change"]
  ], () => renderMovementTable());
  renderMovementTable();
  try{ mvUpdateActionMode_(); }catch(_e){}
}

function resetMvListSearch(){
  mvClear_(["mv_search_keyword", "mv_filter_movement_type"]);
  renderMovementTable();
}

/** 只清上方輸入區（不影響列表/資料） */
function clearMovementForm(){
  try{
    mvClear_(["mv_lot","mv_purpose","mv_issued_to","mv_qty","mv_transfer_wh","mv_remark"]);
  }catch(_e){}
  try{ mvUpdateMvQtyState_(); }catch(_e2){}
  try{ mvUpdateActionMode_(); }catch(_e3){}
  try{
    const sel = document.getElementById("mv_lot");
    if(sel) sel.focus();
  }catch(_e4){}
}

function mvGetMovementSearchKw_(){
  return (document.getElementById("mv_search_keyword")?.value || "").trim().toLowerCase();
}

function mvMovementRowMatchesKeyword_(m, kw){
  if(!kw) return true;
  const lot = mvFindLot_(m.lot_id);
  const p = lot ? mvFindProduct_(lot.product_id) : mvFindProduct_(m.product_id);
  const pid = String(m.product_id || lot?.product_id || "").toLowerCase();
  const pname = String(p?.product_name || "").toLowerCase();
  const pspec = String(p?.spec || "").toLowerCase();
  const whText = String(mvWarehouseLabelById_(m.warehouse_id) || m.warehouse_id || "").toLowerCase();
  const mtCode = String(m.movement_type || "").toLowerCase();
  const mtLabel = String(typeof termLabel === "function" ? termLabel(m.movement_type) : "").toLowerCase();
  const mtLabelZh = String(typeof termLabelZhOnly === "function" ? termLabelZhOnly(m.movement_type) : "").toLowerCase();
  const hay = [
    m.lot_id,
    m.movement_id,
    m.movement_type,
    mtLabel,
    mtLabelZh,
    m.ref_type,
    m.ref_id,
    m.issued_to,
    m.remark,
    m.system_remark,
    m.unit,
    m.warehouse_id,
    whText,
    pid,
    pname,
    pspec,
    lot?.source_id,
    lot?.source_type,
    lot?.remark
  ].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(kw);
}

function mvIsTransferMode_(){
  const cb = document.getElementById("mv_is_transfer");
  if(cb) return !!cb.checked;
  const purpose = String(document.getElementById("mv_purpose")?.value || "").trim().toUpperCase();
  return purpose === "TRANSFER";
}

function mvOnTransferToggleChange_(){
  const cb = document.getElementById("mv_is_transfer");
  const isTransfer = !!cb?.checked;
  const purposeEl = document.getElementById("mv_purpose");
  if(purposeEl){
    if(isTransfer){
      // 用途下拉不顯示「轉倉」選項，但系統仍用 TRANSFER 值運作；缺 option 時補一個 hidden option
      try{
        let hasOpt = false;
        for(let i=0;i<purposeEl.options.length;i++){
          if(String(purposeEl.options[i].value || "").toUpperCase() === "TRANSFER"){ hasOpt = true; break; }
        }
        if(!hasOpt){
          const opt = document.createElement("option");
          opt.value = "TRANSFER";
          opt.textContent = "轉倉";
          opt.hidden = true;
          purposeEl.appendChild(opt);
        }
      }catch(_e){}
      purposeEl.value = "TRANSFER";
      purposeEl.disabled = true;
    }else{
      if(String(purposeEl.value || "").trim().toUpperCase() === "TRANSFER"){
        purposeEl.value = "";
      }
      purposeEl.disabled = false;
    }
  }

  // 模式切換：重建 Lot 下拉（扣庫 vs 轉倉）
  try{
    const sel = document.getElementById("mv_lot");
    if(sel){
      const seq = (window.__ERP_MV_LOT_INIT_SEQ__ = (Number(window.__ERP_MV_LOT_INIT_SEQ__ || 0) + 1));
      if(isTransfer){
        sel.disabled = true;
        sel.innerHTML = `<option value="">載入中…</option>`;
        setMvLotHint_("載入中…｜請稍候", "warn");
      }
      setTimeout(function(){
        initMovementLotDropdown()
          .catch(()=>{})
          .finally(function(){
            if(Number(window.__ERP_MV_LOT_INIT_SEQ__ || 0) !== seq) return;
            if(isTransfer){
              try{ sel.disabled = false; }catch(_e){}
            }
            try{ mvUpdateActionMode_(); }catch(_e2){}
          });
      }, 0);
    }else{
      initMovementLotDropdown().catch(()=>{});
    }
  }catch(_e){
    initMovementLotDropdown().catch(()=>{});
  }

  try{ mvUpdateActionMode_(); }catch(_e3){}
  try{ renderMovementTable(); }catch(_e4){}
}

function mvFillTransferAllQty_(){
  // 轉倉修正用：一鍵帶入目前 Lot 的「全部可用量」
  if(!mvIsTransferMode_()){
    return showToast("請先將用途選為「轉倉」才可使用『轉全部』", "error");
  }
  const lotId = String(document.getElementById("mv_lot")?.value || "").trim();
  if(!lotId) return showToast("請先選擇 Lot（可從下方列表點選）", "error");
  const qtyEl = document.getElementById("mv_qty");
  if(!qtyEl) return;
  const av = getMovementAvailableByLotId(lotId);
  qtyEl.value = String(Math.max(0, Number(av || 0)));
}

async function refreshMovementData(){
  if(mvLoadInFlight_){
    mvPendingReload_ = true;
    setMvHeaderHint_("載入中…｜已排隊更新", "warn");
    return;
  }
  mvLoadInFlight_ = true;
  setMvHeaderHint_("載入中…｜請稍候", "warn");
  const mvTb = document.getElementById("movementTableBody");
  if(mvTb) setTbodyLoading_(mvTb, 6);
  try{
    const [
      lots,
      products,
      warehouses,
      importReceipts,
      goodsReceipts,
      importDocs,
      users,
      customers,
      availPack,
      movements
    ] = await Promise.all([
      getAll("lot"),
      getAll("product").catch(() => []),
      getAll("warehouse").catch(() => []),
      getAll("import_receipt").catch(() => []),
      getAll("goods_receipt").catch(() => []),
      getAll("import_document").catch(() => []),
      getAll("user").catch(() => []),
      getAll("customer").catch(() => []),
      typeof loadInventoryMovementAvailableMap_ === "function"
        ? loadInventoryMovementAvailableMap_().catch(() => ({ map: {}, failed: true }))
        : Promise.resolve({ map: {}, failed: true }),
      (async ()=>{
        // Movements 清單：優先只取近 N 天，避免 inventory_movement 全表下載造成卡頓
        try{
          const r = await callAPI({ action: "list_inventory_movement_recent", days: 90, _ts: String(Date.now()) }, { method: "POST" });
          const rows = typeof erpParseArrayDataResponse_ === "function" ? erpParseArrayDataResponse_(r) : [];
          if(Array.isArray(rows) && rows.length) return rows;
          return [];
        }catch(_e){
          return await getAll("inventory_movement").catch(() => []);
        }
      })()
    ]);
  mvLots = lots || [];
  mvProducts = products || [];
  mvWarehouses = (warehouses || []).filter(w => String(w.status || "ACTIVE").toUpperCase() === "ACTIVE");
  mvUsers = users || [];
  mvCustomers = customers || [];
  mvImportReceiptIdToDocId = {};
  (importReceipts || []).forEach(r => {
    if(r && r.import_receipt_id){
      mvImportReceiptIdToDocId[r.import_receipt_id] = r.import_doc_id || "";
    }
  });
  mvGoodsReceiptIdToPoId = {};
  (goodsReceipts || []).forEach(r => {
    if(r && r.gr_id){
      mvGoodsReceiptIdToPoId[r.gr_id] = r.po_id || "";
    }
  });
  mvImportDocIdToImportNo = {};
  (importDocs || []).forEach(d => {
    if(d && d.import_doc_id){
      mvImportDocIdToImportNo[d.import_doc_id] = d.import_no || "";
    }
  });

  mvAvailByLotId_ = (availPack && availPack.map) || {};
  mvAvailMapOk_ = !!(availPack && !availPack.failed);

  // Movements 列表：預設近 90 天清單（後端支援）；若 fallback 則可能是全量
  mvMovements = Array.isArray(movements) ? movements : [];

  const nLots = Array.isArray(mvLots) ? mvLots.length : 0;
  const nMv = Array.isArray(mvMovements) ? mvMovements.length : 0;
  const availText = mvAvailMapOk_ ? "可用量：已載入" : "可用量：fallback（可能較慢）";
  setMvHeaderHint_(`已載入｜Lot ${nLots} 筆／異動 ${nMv} 筆（${availText}）`, mvAvailMapOk_ ? "ok" : "warn");
  }catch(err){
    // 失敗也要收尾，避免永遠停在「載入中」
    mvLots = [];
    mvProducts = [];
    mvWarehouses = [];
    mvUsers = [];
    mvCustomers = [];
    mvMovements = [];
    mvAvailByLotId_ = {};
    mvAvailMapOk_ = false;
    try{
      setMvHeaderHint_("載入失敗｜請確認網路連線正常，或重新登入後再試", "error");
      setMvLotHint_("載入失敗｜請稍後重試", "error");
    }catch(_eHint){}
    try{
      if(!(err && err.erpApiToastShown)){
        showToast("載入失敗：請確認網路連線正常，或重新登入後再試", "error");
      }
    }catch(_eToast){}
  }finally{
    mvLoadInFlight_ = false;
    if(mvPendingReload_){
      mvPendingReload_ = false;
      setTimeout(function(){
        try{ refreshMovementData(); }catch(_e){}
      }, 0);
    }
  }
}

function mvMergeMovements_(rows){
  const add = Array.isArray(rows) ? rows : [];
  if(!add.length) return;
  mvMovements = Array.isArray(mvMovements) ? mvMovements : [];
  const seen = new Set(mvMovements.map(r => String(r?.movement_id || "")));
  add.forEach(r=>{
    const id = String(r?.movement_id || "");
    if(!id || seen.has(id)) return;
    mvMovements.unshift(r);
    seen.add(id);
  });
}

function mvWarehouseLabelById_(warehouseId){
  const id = String(warehouseId || "").trim().toUpperCase();
  if(!id) return "";
  const w = (mvWarehouses || []).find(x => String(x.warehouse_id || "").toUpperCase() === id) || null;
  if(!w) return id;
  const name = String(w.warehouse_name || "").trim();
  const cat = String(w.category || "").trim().toUpperCase();
  const catLabel = (typeof termShortZh_ === "function" ? termShortZh_(cat) : ((typeof termLabel === "function" ? termLabel(cat) : "") || cat));
  const namePart = name || id;
  return catLabel ? `${namePart}-${catLabel}` : namePart;
}

async function mvInitWarehouseDropdown_(){
  const sel = document.getElementById("mv_transfer_wh");
  if(!sel) return;
  const list = (mvWarehouses || []).slice();
  list.sort((a,b)=>String(a.warehouse_id||"").localeCompare(String(b.warehouse_id||"")));
  sel.innerHTML =
    `<option value="">請選擇</option>` +
    list.map(w=>{
      const id = String(w.warehouse_id || "").trim().toUpperCase();
      const label = mvWarehouseLabelById_(id) || id;
      return `<option value="${escapeMvAttr_(id)}">${escapeMvHtml_(label)}</option>`;
    }).join("");
  sel.onchange = function(){ mvUpdateActionMode_(); };
  mvUpdateActionMode_();
}

function mvInitIssuedToDropdown_(){
  const sel = document.getElementById("mv_issued_to");
  if(!sel) return;
  const users = (mvUsers || []).filter(u => String(u.status || "").toUpperCase() === "ACTIVE");
  users.sort((a,b)=>String(a.user_name||"").localeCompare(String(b.user_name||"")));

  const userOpts = users.map(u => {
    const name = String(u.user_name || "").trim();
    const role = mvRoleLabel_(u.role);
    const id = String(u.user_id || "").trim();
    const label = name ? `${role}-${name}(${id})` : `${role}(${id})`;
    return `<option value="U:${u.user_id}">${escapeMvHtml_(label)}</option>`;
  }).join("");

  sel.innerHTML =
    `<option value="">請選擇</option>` +
    userOpts;
}

function mvFindLot_(lotId){
  const id = String(lotId || "").trim();
  if(!id) return null;
  return (mvLots || []).find(l => String(l.lot_id || "").trim() === id) || null;
}

function mvFindProduct_(productId){
  const id = String(productId || "").trim();
  if(!id) return null;
  return (mvProducts || []).find(p => String(p.product_id || "").trim() === id) || null;
}

function mvQaText_(qa){
  const s = String(qa || "PENDING").toUpperCase();
  if(s === "APPROVED") return "QA已放行";
  if(s === "REJECTED") return "QA已退回";
  return "待QA";
}

function mvFormatLotOptionText_(lot, available){
  const lotId = String(lot?.lot_id || "");
  const p = mvFindProduct_(lot?.product_id || "");
  const pname = p ? (p.product_name || lot?.product_id || "") : (lot?.product_id || "");
  const spec = p && String(p.spec || "").trim() ? String(p.spec).trim() : "";
  const prodText = spec ? `${pname}（${spec}）` : pname;
  const whText = mvWarehouseLabelById_(lot?.warehouse_id || "") || (lot?.warehouse_id || "");
  const qaText = mvQaText_(lot?.status || "PENDING");
  const avText = `可用：${Math.round(Number(available || 0) * 10000) / 10000}`;
  return [lotId, prodText, whText, qaText, avText].filter(Boolean).join("│");
}

/** 顯示「產品名稱（規格）」；無主檔時退回 product_id */
function mvFormatProductSpec_(lot, movement){
  const pid = (lot && lot.product_id) || (movement && movement.product_id) || "";
  if(!pid) return "—";
  const p = mvFindProduct_(pid);
  const name = p ? (p.product_name || pid) : pid;
  const spec = p && String(p.spec || "").trim() ? String(p.spec).trim() : "";
  if(spec) return `${name}（${spec}）`;
  return name;
}

/** 列表列排序：先時間（新→舊），再 Lot ID，最後 movement_id（避免不同 Lot 交錯造成視覺混亂） */
function mvCompareMovementRows_(a, b){
  const tb = (b.m.created_at || "");
  const ta = (a.m.created_at || "");
  if(tb !== ta) return tb.localeCompare(ta);
  const la = a.m.lot_id || "";
  const lb = b.m.lot_id || "";
  if(la !== lb) return la.localeCompare(lb);
  return (b.m.movement_id || "").localeCompare(a.m.movement_id || "");
}

function mvGetLotImportDocId_(lot){
  if(String(lot.source_type || "").toUpperCase() !== "IMPORT") return "";
  return mvImportReceiptIdToDocId[lot.source_id || ""] || "";
}

function mvGetLotPoId_(lot){
  if(String(lot.source_type || "").toUpperCase() !== "PURCHASE") return "";
  return mvGoodsReceiptIdToPoId[lot.source_id || ""] || "";
}

/** 與 Lots 相同：依報單ID／採購單分組 */
function mvGetLotBusinessGroupKey_(lot){
  const st = String(lot.source_type || "").toUpperCase();
  if(st === "IMPORT"){
    const doc = mvGetLotImportDocId_(lot);
    return doc ? `IMP_DOC:${doc}` : `IR:${lot.source_id || ""}`;
  }
  if(st === "PURCHASE"){
    const po = mvGetLotPoId_(lot);
    return po ? `PO:${po}` : `GR:${lot.source_id || ""}`;
  }
  return `${st}:${lot.source_id || ""}`;
}

function mvSourceTypeLabel_(sourceType){
  const t = String(sourceType || "").toUpperCase();
  if(t === "PURCHASE") return "採購入庫";
  if(t === "IMPORT") return "進口收貨";
  if(t === "PROCESS") return "加工產出";
  return t || "未知來源";
}

/** 與 Lots 批次QA管理群組標題同一套文案 */
function formatMvGroupHeaderFromLot_(lot){
  const st = String(lot.source_type || "").toUpperCase();
  const sid = lot.source_id || "";
  if(st === "IMPORT"){
    const docId = mvGetLotImportDocId_(lot);
    const impNo = docId ? (mvImportDocIdToImportNo[docId] || "") : "";
    if(docId){
      const noPart = impNo ? impNo : "—";
      return `進口報單：報單號 ${noPart}｜報單ID ${docId}`;
    }
    return `進口：收貨單 ${sid}（尚未對應到報單，請檢查 import_receipt）`;
  }
  if(st === "PURCHASE"){
    const po = mvGetLotPoId_(lot);
    if(po) return `採購單：${po}`;
    return `採購：收貨單 ${sid}（尚未對應到 PO，請檢查 goods_receipt）`;
  }
  return `${mvSourceTypeLabel_(lot.source_type)}：${sid}`;
}

function mvGroupKeyForMovement_(m){
  const lot = mvFindLot_(m.lot_id);
  if(!lot) return `__NO_LOT__:${m.lot_id || ""}`;
  return mvGetLotBusinessGroupKey_(lot);
}

function getMovementAvailableByLotId(lotId){
  const lid = typeof invNormalizeId_ === "function" ? invNormalizeId_(lotId) : String(lotId || "").trim().toUpperCase();
  if(!lid) return null;
  if(mvAvailMapOk_ && mvAvailByLotId_ && Object.prototype.hasOwnProperty.call(mvAvailByLotId_, lid)){
    return mvAvailByLotId_[lid];
  }
  const rawKey = String(lotId || "").trim();
  if(mvAvailMapOk_ && rawKey && mvAvailByLotId_ && Object.prototype.hasOwnProperty.call(mvAvailByLotId_, rawKey)){
    return mvAvailByLotId_[rawKey];
  }
  return invAvailableByLotId_(lotId, mvLots, mvMovements);
}

/** 僅 APPROVED + 庫存 ACTIVE 可手動扣庫（與下拉預設清單一致） */
function mvCanManualOut_(lot){
  if(!lot) return false;
  if((lot.status || "PENDING") !== "APPROVED") return false;
  if((lot.inventory_status || "ACTIVE") !== "ACTIVE") return false;
  // 過期 Lot 不可手動扣庫
  if(typeof invIsExpired_ === "function" && invIsExpired_(lot.expiry_date)) return false;
  return true;
}

/** 依目前選擇的 Lot：啟用／停用扣庫數量 */
function mvUpdateMvQtyState_(){
  const sel = document.getElementById("mv_lot");
  const qtyEl = document.getElementById("mv_qty");
  if(!qtyEl) return;
  const lotId = sel?.value || "";
  if(!lotId){
    qtyEl.disabled = false;
    const uHid0 = document.getElementById("mv_lot_unit");
    mvClear_("mv_lot_unit");
    syncErpQtyUnitSuffix_("mv_lot_unit", "mv_qty_unit_suffix");
    return;
  }
  const lot = mvFindLot_(lotId);
  const isTransfer = mvIsTransferMode_();
  let ok = false;
  if(isTransfer){
    if(lot){
      const invOk = String(lot.inventory_status || "ACTIVE").toUpperCase() === "ACTIVE";
      const st = String(lot.status || "PENDING").toUpperCase();
      ok = invOk && st !== "REJECTED";
    }
  }else{
    ok = mvCanManualOut_(lot);
  }
  qtyEl.disabled = !ok;
  if(!ok){
    mvClear_("mv_qty");
  }
  const uHid = document.getElementById("mv_lot_unit");
  if(uHid){
    uHid.value = lotId && lot ? String(lot.unit || "").trim() : "";
  }
  syncErpQtyUnitSuffix_("mv_lot_unit", "mv_qty_unit_suffix");
}

function mvUpdateActionMode_(){
  const toWh = String(document.getElementById("mv_transfer_wh")?.value || "").trim();
  const createBtn = document.getElementById("mv_create_btn");
  const transferBtn = document.getElementById("mv_transfer_btn");
  const purposeEl = document.getElementById("mv_purpose");
  const issuedToEl = document.getElementById("mv_issued_to");
  const transferAllBtn = document.getElementById("mv_transfer_all_btn");
  const lotId = String(document.getElementById("mv_lot")?.value || "").trim();
  const qty = Number(document.getElementById("mv_qty")?.value || 0);

  const purpose = String(purposeEl?.value || "").trim().toUpperCase();
  const isTransfer = mvIsTransferMode_();
  // 非轉倉：清空目標倉（避免資料打架）
  if(!isTransfer){
    const whEl = document.getElementById("mv_transfer_wh");
    if(whEl && whEl.value){
      mvClear_("mv_transfer_wh");
    }
  }
  // 轉倉模式：用途固定 TRANSFER（避免誤切）
  if(isTransfer && purposeEl){
    try{
      let hasOpt = false;
      for(let i=0;i<purposeEl.options.length;i++){
        if(String(purposeEl.options[i].value || "").toUpperCase() === "TRANSFER"){ hasOpt = true; break; }
      }
      if(!hasOpt){
        const opt = document.createElement("option");
        opt.value = "TRANSFER";
        opt.textContent = "轉倉";
        opt.hidden = true;
        purposeEl.appendChild(opt);
      }
    }catch(_e){}
    purposeEl.value = "TRANSFER";
    purposeEl.disabled = true;
  }else if(!isTransfer && purposeEl){
    purposeEl.disabled = false;
  }
  if(createBtn){
    createBtn.disabled = isTransfer;
    createBtn.title = isTransfer
      ? "目前為轉倉模式，請用「轉倉」"
      : (!lotId ? "請先選擇 Lot" : (!(qty > 0) ? "請先輸入數量（>0）" : "確認扣庫"));
  }
  if(transferBtn){
    transferBtn.disabled = !isTransfer || !toWh;
    transferBtn.title = !isTransfer
      ? "目前為手動扣庫模式，請用「確認扣庫」"
      : (!lotId ? "請先選擇 Lot" : (!(qty > 0) ? "請先輸入數量（>0）" : (!toWh ? "請選擇 轉倉到 哪個倉別" : "轉倉")));
  }
  // 轉倉：給誰不適用；扣庫：轉倉到不適用
  if(issuedToEl){
    issuedToEl.disabled = isTransfer;
    if(isTransfer) mvClear_("mv_issued_to");
  }
  const whEl2 = document.getElementById("mv_transfer_wh");
  if(whEl2){
    whEl2.disabled = !isTransfer;
    if(!isTransfer) mvClear_("mv_transfer_wh");
  }
  if(transferAllBtn){
    transferAllBtn.disabled = !isTransfer || !lotId;
    transferAllBtn.title = !isTransfer ? "僅轉倉模式可用" : (!lotId ? "請先選擇 Lot" : "一鍵帶入全部可用量");
  }
  // 同時重畫列表（游標/禁止狀態會依模式改變）
  try{ renderMovementTable(); }catch(_e){}
}

/** 點列表列：帶入上方「選擇 Lot」（已退回等不可扣庫者不帶入） */
function mvSelectLotFromRow(el){
  const lotId = el && el.getAttribute ? el.getAttribute("data-mv-lot-id") : "";
  if(!lotId) return;
  const lot = mvFindLot_(lotId);
  if(!lot){
    if(typeof showToast === "function") showToast("找不到 Lot 主檔", "error");
    return;
  }
  const isTransfer = mvIsTransferMode_();
  if(typeof invIsExpired_ === "function" && invIsExpired_(lot.expiry_date)){
    if(typeof showToast === "function") showToast("此批次已過期（VOID），不可操作。", "error");
    return;
  }
  if(isTransfer){
    if(String(lot.inventory_status || "ACTIVE").toUpperCase() !== "ACTIVE"){
      if(typeof showToast === "function") showToast("僅庫存狀態為 ACTIVE 的批次可轉倉。", "error");
      return;
    }
    if((lot.status || "PENDING") === "REJECTED"){
      if(typeof showToast === "function") showToast("此批次已退回（REJECTED），不建議轉倉；請改用報廢或其他處置。", "error");
      return;
    }
  }else{
    if((lot.status || "PENDING") === "REJECTED"){
      if(typeof showToast === "function"){
        showToast("此批次已退回（REJECTED），不可手動扣庫。", "error");
      }
      return;
    }
    if(!mvCanManualOut_(lot)){
      if(typeof showToast === "function"){
        showToast("僅 QA已放行 且庫存為使用中（ACTIVE）的批次可手動扣庫。", "error");
      }
      return;
    }
  }

  const sel = document.getElementById("mv_lot");
  if(!sel) return;
  let found = false;
  for(let i = 0; i < sel.options.length; i++){
    if(sel.options[i].value === lotId){ found = true; break; }
  }
  if(!found){
    const opt = document.createElement("option");
    opt.value = lotId;
    const av = getMovementAvailableByLotId(lotId);
    opt.textContent = mvFormatLotOptionText_(lot, av) + "（未QA不可手動扣庫，請重選Lot）";
    sel.appendChild(opt);
  }
  sel.value = lotId;
  mvUpdateMvQtyState_();
  if(typeof showToast === "function"){
    showToast("已帶入 Lot：" + lotId);
  }
  try{
    sel.focus();
    sel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }catch(_e){}
}

function mvIsManualOutMovement_(m){
  const mt = String(m?.movement_type || "").trim().toUpperCase();
  if(mt !== "OUT") return false;
  const sys = String(m?.system_remark || "");
  if(sys.toLowerCase().includes("manual out")) return true;
  const rt = String(m?.ref_type || "").trim().toUpperCase();
  // 本頁 createMovement 會把 ref_type 設為用途（INTERNAL_USE/SAMPLE/...）；視為手動扣庫
  if(["MANUAL","INTERNAL_USE","SAMPLE","SCRAP","OTHER"].includes(rt)) return true;
  return false;
}

function mvReversalKey_(movementId){
  return `REVERSAL:${String(movementId || "").trim()}`;
}

/**
 * Movements 列表「異動類型」的人話分類
 * - 盡量不改資料結構：用 movement_type + ref_type + system_remark 推導顯示
 */
function mvMovementHumanLabel_(m){
  const mt = String(m?.movement_type || "").trim().toUpperCase();
  const rt = String(m?.ref_type || "").trim().toUpperCase();
  const sys = String(m?.system_remark || "").trim();

  // 轉倉：ref_type=TRANSFER（OUT/IN）
  if(rt === "TRANSFER"){
    if(mt === "OUT") return "轉倉-轉出";
    if(mt === "IN") return "轉倉-轉入";
    return "轉倉";
  }

  // 收貨入庫/作廢回沖
  if(rt === "GOODS_RECEIPT") return "採購收貨-入庫";
  if(rt === "IMPORT_RECEIPT") return "進口收貨-入庫";
  if(rt === "GOODS_RECEIPT_CANCEL") return "採購收貨-作廢回沖";
  if(rt === "IMPORT_RECEIPT_CANCEL") return "進口收貨-作廢回沖";

  // 出貨扣庫/作廢回沖
  if(mt === "SHIP_OUT" || rt === "SHIPMENT") return "出貨-扣庫";
  if(rt === "SHIPMENT_CANCEL") return "出貨-作廢回沖";

  // 加工投料/產出
  if(mt === "PROCESS_OUT" || rt === "PROCESS_ORDER") return "加工-投料扣庫";
  if(mt === "PROCESS_IN") return "加工-產出入庫";

  // 手動扣庫與回沖
  if(rt === "REVERSAL") return "手動扣庫-回沖";
  if(mt === "OUT"){
    if(rt === "INTERNAL_USE") return "手動扣庫-內部領用";
    if(rt === "SAMPLE") return "手動扣庫-樣品";
    if(rt === "SCRAP") return "手動扣庫-報廢";
    if(rt === "OTHER") return "手動扣庫-其他";
    if(sys.toLowerCase().includes("manual out")) return "手動扣庫";
  }

  // 其他 ADJUST
  if(mt === "ADJUST") return "調整";

  // fallback：仍保留原始代碼對照
  const base = (typeof termLabelZhOnly === "function" ? termLabelZhOnly(mt) : mt) || mt;
  return base || mt || "—";
}

function mvHasReversal_(movementId){
  const id = String(movementId || "").trim();
  if(!id) return false;
  const key = mvReversalKey_(id);
  return (mvMovements || []).some(x => {
    const mt = String(x?.movement_type || "").trim().toUpperCase();
    const rt = String(x?.ref_type || "").trim().toUpperCase();
    const rid = String(x?.ref_id || "").trim();
    return mt === "ADJUST" && rt === "REVERSAL" && rid === key;
  });
}

async function mvReverseManualOutFromList_(movementId, triggerEl){
  const id = String(movementId || "").trim();
  if(!id) return;
  const m = (mvMovements || []).find(x => String(x?.movement_id || "").trim() === id) || null;
  if(!m) return showToast("找不到異動紀錄", "error");
  if(!mvIsManualOutMovement_(m)) return showToast("此筆非手動扣庫，請勿用回沖（請走對應流程作廢/回沖）", "error");
  if(mvHasReversal_(id)) return showToast("此筆已回沖過", "warn");

  const lotId = String(m.lot_id || "").trim();
  const qtyNum = Number(m.qty || 0);
  const unit = String(m.unit || "").trim();
  const delta = Math.abs(qtyNum); // 原本 OUT 為負數；回沖 ADJUST 補回正數
  if(!(delta > 0)) return showToast("此筆異動數量不正確，無法回沖", "error");

  const reason = (prompt("回沖原因（會寫入備註，可供追查）") || "").trim();
  if(!reason) return showToast("請先填寫回沖原因", "error");

  showSaveHint(triggerEl || null);
  try{
    const actor = getCurrentUser();
    const now = nowIso16();
    const revKey = mvReversalKey_(id);
    const remark = `回沖原因：${reason}（對應 ${id}）`;
    const systemRemark = `Reverse Manual OUT: ${id}`;
    await createRecord("inventory_movement", {
      movement_id: generateId("MV"),
      movement_type: "ADJUST",
      lot_id: lotId,
      product_id: String(m.product_id || "").trim(),
      warehouse_id: String(m.warehouse_id || "").trim().toUpperCase(),
      transaction_id: String(m.transaction_id || "") || ((typeof generateId === "function") ? generateId("TXMV") : ("TXMV-" + Date.now())),
      parent_ref_type: String(m.parent_ref_type || "") || "LOT",
      parent_ref_id: String(m.parent_ref_id || "") || lotId,
      qty: String(delta),
      unit: unit,
      ref_type: "REVERSAL",
      ref_id: revKey,
      issued_to: String(m.issued_to || "").trim(),
      remark: remark,
      created_by: actor,
      created_at: now,
      updated_by: "",
      updated_at: "",
      system_remark: systemRemark
    });
    try{ localStorage.setItem("erp_inventory_dirty_at", String(Date.now())); }catch(_e){}

    await refreshMovementData();
    await initMovementLotDropdown();
    mvInitIssuedToDropdown_();
    renderMovementTable();
    showToast("已回沖（ADJUST）");
  }finally{
    hideSaveHint();
  }
}

async function initMovementLotDropdown(){
  const sel = document.getElementById("mv_lot");
  if(!sel) return;
  const prevSelected = String(sel.value || "").trim();
  setMvLotHint_("Lot 下拉：載入中…", "warn");

  const isTransfer = mvIsTransferMode_();
  // 扣庫模式：只顯示 ACTIVE + APPROVED
  // 轉倉模式：顯示 ACTIVE + (PENDING/APPROVED)，仍排除 REJECTED
  const lots = (mvLots || []).filter(l => {
    if(String(l.inventory_status || "ACTIVE").toUpperCase() !== "ACTIVE") return false;
    if(typeof invIsExpired_ === "function" && invIsExpired_(l.expiry_date)) return false;
    const st = String(l.status || "PENDING").toUpperCase();
    if(isTransfer) return st !== "REJECTED";
    return st === "APPROVED";
  });

  sel.innerHTML =
    `<option value="">請選擇</option>` +
    lots.map(l => {
      const available = getMovementAvailableByLotId(l.lot_id);
      const text = mvFormatLotOptionText_(l, available);
      return `<option value="${l.lot_id}">${escapeMvHtml_(text)}</option>`;
    }).join("");

  // 保留先前已選的 Lot（避免模式切換/重畫下拉時跳回「請選擇 Lot」）
  if(prevSelected){
    let found = false;
    for(let i = 0; i < sel.options.length; i++){
      if(String(sel.options[i].value || "").trim() === prevSelected){ found = true; break; }
    }
    if(!found){
      const lot = mvFindLot_(prevSelected);
      const opt = document.createElement("option");
      opt.value = prevSelected;
      const av = lot ? getMovementAvailableByLotId(prevSelected) : 0;
      opt.textContent = (lot ? mvFormatLotOptionText_(lot, av) : prevSelected) + "（未QA不可手動扣庫，請重選Lot）";
      sel.appendChild(opt);
    }
    sel.value = prevSelected;
  }
  sel.onchange = function(){
    // UX：Lot 切換時清空數量/原因/對象/轉倉倉別，避免殘留上一筆
    try{
      mvClear_(["mv_qty","mv_remark","mv_issued_to","mv_transfer_wh"]);
    }catch(_e){}
    mvUpdateMvQtyState_();
  };
  mvUpdateMvQtyState_();
  setMvLotHint_(lots.length ? `Lot 下拉：已載入 — ${lots.length} 筆` : "Lot 下拉：已載入 — 0 筆", "ok");
}

async function createMovement(triggerEl){
  const lot_id = document.getElementById("mv_lot")?.value || "";
  const qty = Number(document.getElementById("mv_qty")?.value || 0);
  const purpose = (document.getElementById("mv_purpose")?.value || "").trim().toUpperCase();
  const userRemark = (document.getElementById("mv_remark")?.value || "").trim();
  const issuedTo = (document.getElementById("mv_issued_to")?.value || "").trim();

  if(!lot_id) return showToast("請選擇 Lot","error");
  if(!purpose) return showToast("請先選擇 用途", "error");
  if(purpose === "TRANSFER") return showToast("用途為轉倉時，請改按「轉倉」", "error");
  if(!issuedTo) return showToast("請先選擇 給誰（領用/交付）", "error");
  if(!userRemark) return showToast("請先填寫原因", "error");
  if(!qty || qty <= 0) return showToast("數量需大於 0","error");

  const lot = (mvLots || []).find(l => l.lot_id === lot_id);
  if(!lot) return showToast("找不到 Lot","error");

  // 僅允許 QA APPROVED 的批次做 Manual OUT
  if((lot.status || "PENDING") !== "APPROVED"){
    return showToast("僅 APPROVED 批次可手動扣庫", "error");
  }
  if(typeof invIsExpired_ === "function" && invIsExpired_(lot.expiry_date)){
    return showToast("此批次已過期（VOID），不可手動扣庫。", "error");
  }

  const available = getMovementAvailableByLotId(lot_id);
  if(typeof invIsMissingMovement_ === "function" && invIsMissingMovement_(available)){
    return showToast("此 Lot 缺 movement（請先補齊入庫/異動紀錄）", "error");
  }
  if(qty > available){
    return showToast("扣庫數量不可超過可用量", "error");
  }

  showSaveHint(triggerEl);
  try {
  // 這個頁面先提供最常用的「扣庫」：OUT（存負數）
  const purposeLabel = (typeof termLabel === "function" ? termLabel(purpose) : "") || purpose;
  const systemRemark = purposeLabel ? `Manual OUT: ${purposeLabel}` : "Manual OUT";
  const txId = (typeof generateId === "function") ? generateId("TXMV") : ("TXMV-" + Date.now());
  const movement = {
    movement_id: generateId("MV"),
    movement_type: "OUT",
    lot_id,
    product_id: lot.product_id,
    warehouse_id: String(lot.warehouse_id || "MAIN").trim().toUpperCase() || "MAIN",
    transaction_id: txId,
    parent_ref_type: "LOT",
    parent_ref_id: lot_id,
    qty: String(-Math.abs(qty)),
    unit: lot.unit || "",
    ref_type: purpose || "MANUAL",
    ref_id: lot_id,
    issued_to: issuedTo,
    remark: userRemark,
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    updated_by: "",
    updated_at: "",
    system_remark: systemRemark,
  };

  await createRecord("inventory_movement", movement);
  try{ localStorage.setItem("erp_inventory_dirty_at", String(Date.now())); }catch(_e){}

  await refreshMovementData();
  await initMovementLotDropdown();
  mvInitIssuedToDropdown_();
  renderMovementTable();
  showToast("異動已建立");
  mvClear_(["mv_qty","mv_remark","mv_issued_to"]);
  } finally { hideSaveHint(); }
}

async function transferMovement(triggerEl){
  const lot_id = document.getElementById("mv_lot")?.value || "";
  const qty = Number(document.getElementById("mv_qty")?.value || 0);
  const toWh = String(document.getElementById("mv_transfer_wh")?.value || "").trim().toUpperCase();
  const userRemark = (document.getElementById("mv_remark")?.value || "").trim();

  if(!lot_id) return showToast("請選擇 Lot","error");
  const purpose = String(document.getElementById("mv_purpose")?.value || "").trim().toUpperCase();
  if(purpose !== "TRANSFER") return showToast("請先將 用途 選為「轉倉」", "error");
  if(!userRemark) return showToast("請先填寫原因", "error");
  if(!qty || qty <= 0) return showToast("數量需大於 0","error");
  if(!toWh) return showToast("請選擇 轉倉到 哪個倉別","error");

  const lot = (mvLots || []).find(l => l.lot_id === lot_id);
  if(!lot) return showToast("找不到 Lot","error");

  if(String(lot.inventory_status || "ACTIVE").toUpperCase() !== "ACTIVE"){
    return showToast("僅庫存狀態為 ACTIVE 的批次可轉倉", "error");
  }
  if(typeof invIsExpired_ === "function" && invIsExpired_(lot.expiry_date)){
    return showToast("此批次已過期（VOID），不可轉倉。", "error");
  }

  const fromWh = String(lot.warehouse_id || "").trim().toUpperCase();
  if(fromWh && fromWh === toWh){
    return showToast("目標倉別不可與目前倉別相同", "error");
  }

  const available = getMovementAvailableByLotId(lot_id);
  if(qty > available){
    return showToast("轉倉數量不可超過可用量", "error");
  }
  // QA gate（你確認的新規則）：
  // - 待QA：僅允許「全部轉」（qty == available）
  // - 部分轉：必須 QA 放行（APPROVED）
  const qa = String(lot.status || "PENDING").toUpperCase();
  if(qa !== "APPROVED"){
    const isAll = Math.abs(Number(qty || 0) - Number(available || 0)) <= 1e-9;
    if(!isAll){
      return showToast("部分轉倉需先 QA 放行（APPROVED）。待QA僅允許全部轉倉。", "error");
    }
  }

  const newLotId = generateId("LOT");
  const now = nowIso16();
  const today = String(now || "").slice(0, 10);
  const fromWhLabel = mvWarehouseLabelById_(fromWh) || (fromWh || "—");
  const toWhLabel = mvWarehouseLabelById_(toWh) || toWh;

  showSaveHint(triggerEl);
  try{
    // Phase 1（交易一致性）：轉倉改走後端 bundle，一次完成新 Lot + IN/OUT movements，避免分段寫入造成不同步
    const res = await callAPI({
      action: "post_transfer_bundle",
      from_lot_id: lot_id,
      to_warehouse_id: toWh,
      qty: String(qty),
      remark: userRemark,
      idempotency_key: `TRANSFER:${lot_id}:${toWh}:${String(qty)}:${userRemark}`
    }, { method: "POST" });
    const newLotId =
      (res && res.new_lot_id) ||
      (res && res.data && res.data.new_lot_id) ||
      "";

    // 轉倉後：強制讓其他頁面下次刷新時拿到最新可用量（避免快取造成兩邊都像有量）
    try{
      if(typeof invalidateCache === "function"){
        invalidateCache("inventory_movement");
        invalidateCache("lot");
      }
      try{
        localStorage.setItem("erp_inventory_dirty_at", String(Date.now()));
      }catch(_e){}
    }catch(_e){}

    await refreshMovementData();
    await initMovementLotDropdown();
    await mvInitWarehouseDropdown_();
    mvInitIssuedToDropdown_();
    renderMovementTable();

    mvClear_(["mv_qty","mv_remark","mv_transfer_wh"]);
    const allBtn = document.getElementById("mv_transfer_all_btn");
    if(allBtn){
      allBtn.disabled = true;
      allBtn.title = "請先選擇 Lot（轉倉模式）";
    }
    showToast(newLotId ? `已轉倉並產生新 Lot：${newLotId}` : "已轉倉完成");
  }finally{
    hideSaveHint();
  }
}

function renderMovementTable(){
  const tbody = document.getElementById("movementTableBody");
  if(!tbody) return;

  tbody.innerHTML = "";

  const kw = mvGetMovementSearchKw_();
  const qMt = (document.getElementById("mv_filter_movement_type")?.value || "").trim().toUpperCase();
  const raw = [...(mvMovements || [])];
  const rawFiltered = raw.filter(m => {
    if(qMt && String(m.movement_type || "").toUpperCase() !== qMt) return false;
    return mvMovementRowMatchesKeyword_(m, kw);
  });

  if(!rawFiltered.length){
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:24px;">${
      kw || qMt ? "沒有符合條件的異動紀錄。" : "尚無庫存異動紀錄。"
    }</td></tr>`;
    return;
  }

  const enriched = rawFiltered.map(m => {
    const lot = mvFindLot_(m.lot_id);
    const key = mvGroupKeyForMovement_(m);
    return { m, lot, key };
  });

  const countByKey = {};
  enriched.forEach(x => {
    countByKey[x.key] = (countByKey[x.key] || 0) + 1;
  });

  // 分組排序：依該分組「最新異動時間」新→舊（避免不同分組穿插造成視覺混亂）
  const latestAtByKey = {};
  enriched.forEach(x => {
    const k = x.key;
    const t = String(x.m?.created_at || "");
    if(!t) return;
    const prev = String(latestAtByKey[k] || "");
    if(!prev || t > prev) latestAtByKey[k] = t;
  });
  const groupKeys = [...new Set(enriched.map(x => x.key))].sort((a, b) => {
    const ta = String(latestAtByKey[a] || "");
    const tb = String(latestAtByKey[b] || "");
    if(ta !== tb) return tb.localeCompare(ta); // 新→舊
    return a.localeCompare(b);
  });

  function renderDataRow(m, lot){
    const productSpec = mvFormatProductSpec_(lot, m);
    const refHint = [m.ref_type, m.ref_id, m.issued_to].filter(Boolean).join(" ");
    const isTransfer = mvIsTransferMode_();
    const canClick = (function(){
      if(!lot) return false;
      if(isTransfer){
        if(String(lot.inventory_status || "ACTIVE").toUpperCase() !== "ACTIVE") return false;
        const st = String(lot.status || "PENDING").toUpperCase();
        return st !== "REJECTED";
      }
      return mvCanManualOut_(lot);
    })();
    const titleLot = (function(){
      const base = `${m.lot_id || ""}${refHint ? "｜參考：" + refHint : ""}`;
      if(canClick) return escapeMvAttr_(`${base}｜點列可帶入 Lot`);
      if(isTransfer){
        if(!lot) return escapeMvAttr_(`${base}｜找不到 Lot 主檔`);
        if(String(lot.inventory_status || "ACTIVE").toUpperCase() !== "ACTIVE") return escapeMvAttr_(`${base}｜不可轉倉（須為庫存 ACTIVE）`);
        if(String(lot.status || "PENDING").toUpperCase() === "REJECTED") return escapeMvAttr_(`${base}｜不可轉倉（已退回 REJECTED）`);
        return escapeMvAttr_(`${base}｜不可轉倉`);
      }
      return escapeMvAttr_(
        `${base}｜不可手動扣庫` +
        (lot && String(lot.status || "").toUpperCase() === "REJECTED" ? "（已退回 REJECTED）" : "（須為 APPROVED 且庫存 ACTIVE）")
      );
    })();
    const rowCursor = canClick ? "pointer" : "not-allowed";
    const rowOp = canClick ? "1" : "0.75";
    const lotIdRaw = m.lot_id || "";
    const lidAttr = escapeMvAttr_(lotIdRaw);
    const lidCell = escapeMvHtml_(lotIdRaw);
    const clickAttr = canClick ? `onclick="mvSelectLotFromRow(this)"` : "";
    const whText = mvWarehouseLabelById_(m.warehouse_id) || (m.warehouse_id ? String(m.warehouse_id) : "");
    const mid = String(m.movement_id || "").trim();
    const isManualOut = mvIsManualOutMovement_(m) && !!mid;
    const canReverse = isManualOut && !mvHasReversal_(mid);
    const reverseTitle = (function(){
      if(!isManualOut) return "";
      if(mvHasReversal_(mid)) return "已回沖過";
      return "回沖：建立一筆反向 ADJUST（需填原因）";
    })();
    const reverseBtn = isManualOut
      ? `<button type="button" class="btn-secondary" ${canReverse ? "" : "disabled"} title="${escapeMvAttr_(reverseTitle)}" onclick="event.stopPropagation();mvReverseManualOutFromList_('${escapeMvAttr_(mid)}', this)">回沖</button>`
      : "";
    const mtHuman = mvMovementHumanLabel_(m);
    const lotIdText = escapeMvHtml_(String(m.lot_id || ""));
    tbody.innerHTML += `
      <tr data-mv-lot-id="${lidAttr}" ${clickAttr} style="border-bottom:1px solid #eee;cursor:${rowCursor};opacity:${rowOp};" title="${titleLot}">
        <td title="${escapeMvAttr_(String(m.lot_id || ""))}">
          <div style="font-size:12px;color:#64748b;line-height:1.2;">${lotIdText}</div>
          <div style="line-height:1.25;">${escapeMvHtml_(productSpec)}</div>
        </td>
        <td>${escapeMvHtml_(whText || "—")}</td>
        <td>${escapeMvHtml_(mtHuman)}</td>
        <td>${(function(){
          const mq = String(m.qty ?? "").trim();
          const mu = String(m.unit || "").trim();
          if(!mu) return escapeMvHtml_(mq);
          return escapeMvHtml_(mq) + " " + escapeMvHtml_(mu);
        })()}</td>
        <td>${escapeMvHtml_(m.created_at || "")}</td>
        <td style="white-space:nowrap;">${reverseBtn}</td>
      </tr>
    `;
  }

  groupKeys.forEach(key => {
    const bucket = enriched.filter(x => x.key === key);
    bucket.sort(mvCompareMovementRows_);

    const cnt = countByKey[key] || 0;
    const first = bucket[0];
    let headerL1;
    if(key.startsWith("__NO_LOT__:")){
      headerL1 = `無 Lot 主檔：${escapeMvHtml_(first.m.lot_id || "—")}`;
    }else{
      headerL1 = escapeMvHtml_(formatMvGroupHeaderFromLot_(first.lot));
    }
    tbody.innerHTML += `
      <tr style="background:#f8fafc;">
        <td colspan="6" style="font-weight:600;color:#334155;padding:10px 12px;">
          ${headerL1}（共 ${cnt} 筆異動）
        </td>
      </tr>
    `;

    if(key.startsWith("__NO_LOT__:")){
      bucket.forEach(({ m, lot }) => renderDataRow(m, lot));
      return;
    }

    const byReceipt = {};
    bucket.forEach(x => {
      const rid = x.lot && x.lot.source_id ? String(x.lot.source_id) : "__EMPTY__";
      if(!byReceipt[rid]) byReceipt[rid] = [];
      byReceipt[rid].push(x);
    });
    // 子分組排序：依各收貨單ID分組「最新異動時間」新→舊
    const latestAtByReceipt = {};
    Object.keys(byReceipt).forEach(rid => {
      const rows = byReceipt[rid] || [];
      let maxT = "";
      rows.forEach(x => {
        const t = String(x?.m?.created_at || "");
        if(t && (!maxT || t > maxT)) maxT = t;
      });
      latestAtByReceipt[rid] = maxT;
    });
    const rkeys = Object.keys(byReceipt).sort((a, b) => {
      if(a === "__EMPTY__") return 1;
      if(b === "__EMPTY__") return -1;
      const ta = String(latestAtByReceipt[a] || "");
      const tb = String(latestAtByReceipt[b] || "");
      if(ta !== tb) return tb.localeCompare(ta); // 新→舊
      return a.localeCompare(b);
    });

    rkeys.forEach(rk => {
      const sub = byReceipt[rk];
      const subCnt = sub.length;
      const label = rk === "__EMPTY__" ? "—" : rk;
      // 子分組（收貨單ID）內排序：依異動時間 新→舊
      try{ sub.sort(mvCompareMovementRows_); }catch(_e){}
      tbody.innerHTML += `
        <tr style="background:#f1f5f9;">
          <td colspan="6" style="font-weight:600;color:#475569;padding:8px 12px;font-size:13px;">
            收貨單ID：${escapeMvHtml_(label)}（共 ${subCnt} 筆）
          </td>
        </tr>
      `;
      sub.forEach(({ m, lot }) => renderDataRow(m, lot));
    });
  });
}