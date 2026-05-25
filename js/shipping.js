/**
 * Shipment（API 版）
 * - 過帳時：shipment + shipment_item + inventory_movement(SHIP_OUT)
 * - 回寫 sales_order_item.shipped_qty 與 sales_order.status
 */

let shipDraft = [];
let shipLots = [];
let shipMovements = []; // legacy: 保留變數以避免其他函式引用報錯
let shipAvailableByLotId_ = {};
let shipCustomers = [];
let shipSalesOrders = [];
let shipSalesItems = [];
let shipSalesItemsBySoId_ = {};
let shipSalesItemsLoadingBySoId_ = {};
let shipProducts = [];
let shipWarehouses = [];
let shipUsers = [];
let shipEditing = false;
let shipReadOnlyDraft = false;
/** 主檔狀態由系統維護（過帳/作廢 bundle 回寫），前端僅顯示用 */
let shipLoadedStatus_ = "OPEN";
let shipGoodsReceiptIdToPoId = {};
let shipImportReceiptIdToDocId = {};
let shipImportDocIdToImportNo = {};
/** 點選明細列：草稿為 DRAFT-*；已載入出貨單為 shipment_item_id */
let shipSelectedLineId_ = "";
let shipPostInFlight_ = false;
let shipCancelInFlight_ = false;
let shipLoadInFlight_ = false;
let shipPendingLoadId_ = "";
let shipLoadToastHideTimer_ = null;
let shipLoadWarnToken_ = "";

function shipNormStatus_(raw){
  const s0 = String(raw || "").trim().toUpperCase();
  if(!s0) return "";
  // 相容舊資料/人工資料：可能寫成 "POSTED（已過帳）"、"CANCELLED (...)"。
  const m = s0.match(/^([A-Z0-9_]+)/);
  return (m && m[1]) ? m[1] : s0;
}

/** 已載入出貨單時：僅主檔備註可另存（後端 update_shipment_remark） */
function shipAllowHeaderRemarkSave_(){
  return !!(shipEditing && shipReadOnlyDraft);
}

/** 已過帳出貨單：明細備註可寫回（與後端 update_shipment_item_remark 一致） */
function shipAllowSavedLineRemarkUpdate_(){
  return !!(shipEditing && shipReadOnlyDraft && shipNormStatus_(shipLoadedStatus_) === "POSTED");
}

/**
 * 載入後鎖主檔／明細輸入（主檔備註始終可編；明細備註僅 POSTED 可編）。
 */
function shipSyncLoadedFormLock_(){
  const loaded = !!(shipEditing && shipReadOnlyDraft);
  const canItemRemark = shipAllowSavedLineRemarkUpdate_();
  ["ship_so_id", "ship_date", "ship_shipper_id"].forEach(id => {
    const el = document.getElementById(id);
    if(el) try{ el.disabled = loaded; }catch(_e){}
  });
  const idEl = document.getElementById("ship_id");
  if(idEl) try{ idEl.disabled = loaded; }catch(_eId){}
  ["ship_so_item_id", "ship_qty"].forEach(id => {
    const el = document.getElementById(id);
    if(el) try{ el.disabled = loaded; }catch(_e2){}
  });
  const itemRm = document.getElementById("ship_item_remark");
  if(itemRm){
    try{ itemRm.disabled = loaded && !canItemRemark; }catch(_eRm){}
  }
  const hdrRm = document.getElementById("ship_remark");
  if(hdrRm){
    try{ hdrRm.disabled = false; }catch(_eH){}
  }
  const aa = document.getElementById("ship_auto_alloc");
  if(aa) try{ aa.disabled = loaded; }catch(_eAa){}
  const addBtn = document.getElementById("ship_add_item_btn");
  if(addBtn) try{ addBtn.disabled = loaded; }catch(_eAdd){}
  try{ shipUpdateAllocModeUI_(); }catch(_eU){}
  try{ setShipPickLotBtnState_(); }catch(_eP){}
  setShipButtons_();
}

async function saveShipHeaderRemarkOnly_(triggerEl){
  if(!shipAllowHeaderRemarkSave_()){
    return showToast("請先載入出貨單", "error");
  }
  const shipment_id = (document.getElementById("ship_id")?.value || "").trim().toUpperCase();
  if(!shipment_id) return;
  const remark = String(document.getElementById("ship_remark")?.value || "").trim();
  showSaveHint(triggerEl || document.getElementById("ship_save_remark_btn"));
  try{
    await callAPI({
      action: "update_shipment_remark",
      shipment_id,
      remark,
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    }, { method: "POST" });
    invalidateShipCaches_();
    showToast("備註已儲存");
    await renderShipments();
  }catch(_e){
    if(!(_e && _e.erpApiToastShown)){
      showToast("儲存備註失敗：請確認後端已部署 update_shipment_remark", "error");
    }
  }finally{
    hideSaveHint();
    setShipButtons_();
  }
}

function shipBuildIdempotencyKey_(scope, payload){
  const raw = String(scope || "") + "|" + String(payload || "");
  let h = 0;
  for(let i = 0; i < raw.length; i++){
    h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
  }
  return "IDEM-" + String(scope || "SHIP") + "-" + String(Math.abs(h)).toUpperCase();
}

async function downloadShipmentPdf(){
  try{
    const shipment_id = (document.getElementById("ship_id")?.value || "").trim().toUpperCase();
    if(!shipment_id) return showToast("請先載入一張出貨單再下載 PDF", "error");
    const soId = String(document.getElementById("ship_so_id")?.value || "").trim();
    const shipDate = String(document.getElementById("ship_date")?.value || "").trim();
    const shipperId = String(document.getElementById("ship_shipper_id")?.value || "").trim();
    const remark = String(document.getElementById("ship_remark")?.value || "").trim();
    const fillDate = (function(){
      try{ return String(nowIso16() || "").slice(0,10); }catch(_e){ return ""; }
    })();

    const so = (shipSalesOrders || []).find(x => String(x?.so_id || "") === String(soId || "")) || null;
    const custId = String(so?.customer_id || document.getElementById("ship_customer_id")?.value || "").trim();
    const cust = (shipCustomers || []).find(x => String(x?.customer_id || "") === custId) || null;
    const custName = cust ? (String(cust.customer_name || "").trim() || custId) : custId;
    const contact = cust ? String(cust.contact_person || "").trim() : "";
    const phone = cust ? String(cust.phone || "").trim() : "";
    const address = cust ? String(cust.address || "").trim() : "";
    const shipper = (shipUsers || []).find(x => String(x?.user_id || "") === shipperId) || null;
    const shipperName = shipper ? (String(shipper.user_name || "").trim() || shipperId) : shipperId;

    const items = Array.isArray(shipDraft) ? shipDraft.slice() : [];
    if(items.length === 0) return showToast("此出貨單沒有明細，無法下載 PDF", "error");

    // 依銷售單明細彙總：訂貨數量 / 剩餘（避免同產品拆多列時顯示不一致）
    let soItems =
      (soId && shipSalesItemsBySoId_ && Array.isArray(shipSalesItemsBySoId_[soId])) ? shipSalesItemsBySoId_[soId] :
      (Array.isArray(shipSalesItems) ? shipSalesItems.filter(x => String(x?.so_id || "") === String(soId || "")) : []);
    // 若使用者只載入出貨單、未先載入銷售單明細，這裡補抓一次（僅缺資料時）
    if(soId && (!Array.isArray(soItems) || soItems.length === 0)){
      try{
        const all = await getAll("sales_order_item", { refresh: true });
        const rows = Array.isArray(all) ? all : [];
        soItems = rows.filter(x => String(x?.so_id || "") === String(soId || ""));
      }catch(_eSoItems){
        // fallback：維持空陣列，欄位顯示「—」
        soItems = [];
      }
    }
    const soAggByProduct = {};
    (soItems || []).forEach(it=>{
      const pid = String(it?.product_id || "").trim();
      if(!pid) return;
      if(!soAggByProduct[pid]) soAggByProduct[pid] = { order: 0, shipped: 0, unit: String(it?.unit || "").trim() };
      soAggByProduct[pid].order += Number(it?.order_qty || 0);
      soAggByProduct[pid].shipped += Number(it?.shipped_qty || 0);
      if(!soAggByProduct[pid].unit) soAggByProduct[pid].unit = String(it?.unit || "").trim();
    });

    const body = `
      <div style="display:flex; align-items:flex-end; justify-content:center; position:relative; margin:2px 0 10px;">
        <h1 style="margin:0; text-align:center; font-size:20px; letter-spacing:1px;">出貨紀錄表</h1>
        <div style="position:absolute; right:0; bottom:2px; font-size:12.5px; color:#111;">
          填寫日期：<span style="display:inline-block; min-width:110px; border-bottom:1px solid #111; padding:0 4px;">${erpEscapeHtml_(fillDate || "")}</span>
        </div>
      </div>

      <table style="font-size:13px; table-layout:fixed; width:100%;">
        <tbody>
          <tr>
            <td style="width:110px;"><b>出貨單號</b></td>
            <td style="width:260px;">${erpEscapeHtml_(shipment_id)}</td>
            <td style="width:110px;"><b>出貨日期</b></td>
            <td>${erpEscapeHtml_(shipDate || "")}</td>
          </tr>
          <tr>
            <td><b>客戶</b></td>
            <td>${erpEscapeHtml_(custName || custId || "")}</td>
            <td><b>出貨人員</b></td>
            <td>${erpEscapeHtml_(shipperName || shipperId || "")}</td>
          </tr>
          <tr>
            <td><b>聯絡人</b></td>
            <td>${erpEscapeHtml_(contact || "")}</td>
            <td><b>聯絡電話</b></td>
            <td>${erpEscapeHtml_(phone || "")}</td>
          </tr>
          <tr>
            <td><b>地址</b></td>
            <td colspan="3">${erpEscapeHtml_(address || "")}</td>
          </tr>
        </tbody>
      </table>

      <table style="margin-top:10px; font-size:13px; table-layout:fixed; width:100%;">
        <colgroup>
          <col style="width:46px;">
          <col>
          <col style="width:85px;">
          <col style="width:85px;">
          <col style="width:85px;">
          <col style="width:84px;">
        </colgroup>
        <thead>
          <tr>
            <th style="width:46px;">項次</th>
            <th>產品</th>
            <th>本次</th>
            <th>訂貨數量</th>
            <th>未出</th>
            <th>備註</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((it, idx) => {
            const u = String(it.unit || "").trim();
            const q = u ? `${it.ship_qty} ${u}` : String(it.ship_qty || "");
            const prod = formatShipProductDisplay_(it.product_id) || it.product_id || "";
            const rmk = String(it.remark || "");
            const pid = String(it.product_id || "").trim();
            const agg = soAggByProduct[pid] || null;
            const soUnit = String((agg && agg.unit) || u || "").trim();
            const orderQty = agg ? Number(agg.order || 0) : 0;
            const shippedQty = agg ? Number(agg.shipped || 0) : 0;
            const remainQty = agg ? Math.max(0, orderQty - shippedQty) : 0;
            const orderDisp = agg ? (soUnit ? `${orderQty} ${soUnit}` : String(orderQty)) : "—";
            const remainDisp = agg ? (soUnit ? `${remainQty} ${soUnit}` : String(remainQty)) : "—";
            return `<tr>
              <td>${idx+1}</td>
              <td>
                <div style="font-size:11px; color:#334155; line-height:1.1;">產品編號：${erpEscapeHtml_(String(it.product_id || ""))}</div>
                <div style="line-height:1.25; margin-top:2px;">${erpEscapeHtml_(String(prod || ""))}</div>
              </td>
              <td>${erpEscapeHtml_(q)}</td>
              <td>${erpEscapeHtml_(orderDisp)}</td>
              <td>${erpEscapeHtml_(remainDisp)}</td>
              <td>${erpEscapeHtml_(rmk)}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>

      <table style="margin-top:12px; font-size:13px;">
        <tbody>
          <tr>
            <td style="width:110px;"><b>其他備註</b></td>
            <td style="height:56px;">${erpEscapeHtml_(remark || "")}</td>
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
    erpOpenPrintWindow_(`${shipment_id}-${fillDate || ""}`, body);
  }catch(_e){
    showToast("無法產生 PDF：請確認瀏覽器未阻擋彈出視窗", "error");
  }
}

function shipShouldAutoReloadAfterError_(err){
  const code = String(err && err.erpErrorCode || "").trim().toUpperCase();
  if(code === "ERR_SOURCE_CHANGED" || code === "ERR_DUPLICATE_REQUEST" || code === "ERR_ALREADY_PROCESSED") return true;
  const msg = String(err && err.message != null ? err.message : err || "");
  const backendErrors = err && Array.isArray(err.backendErrors) ? err.backendErrors : [];
  const full = (msg + " " + backendErrors.join(" ")).toLowerCase();
  return (
    /(shipment|so)\s+source\s+changed/.test(full) ||
    /please\s+reload\s+and\s+try\s+again/.test(full) ||
    /duplicate\s+request\s+detected/.test(full) ||
    /already\s+(posted|cancelled|canceled)/.test(full) ||
    /狀態.*(已過帳|已作廢|不可重做)/.test(full) ||
    /此單據已被處理|狀態已變更/.test(full)
  );
}

function invalidateShipCaches_(){
  try{
    if(typeof invalidateCache !== "function") return;
    invalidateCache("shipment");
    invalidateCache("shipment_item");
    invalidateCache("inventory_movement");
    invalidateCache("lot");
    invalidateCache("sales_order_item");
    invalidateCache("sales_order");
  }catch(_e){}
}

async function shipAutoReloadAfterConflict_(shipmentId){
  try{
    // 避免網路不穩/後端短暫錯誤造成重載迴圈：同單號短時間最多自動重載 2 次
    try{
      const id = String(shipmentId || "").trim().toUpperCase() || "(unknown)";
      const now = Date.now();
      const w = (typeof window !== "undefined" && window) ? window : {};
      if(!w.__erpAutoReloadGuardShip__) w.__erpAutoReloadGuardShip__ = {};
      const g = w.__erpAutoReloadGuardShip__;
      const prev = g[id] || { at: 0, n: 0 };
      const withinMs = 15000;
      const n = (now - prev.at) < withinMs ? (prev.n + 1) : 1;
      g[id] = { at: now, n };
      if(n > 2){
        showToast("自動重新載入次數過多，請手動按 Load 再試", "error");
        return false;
      }
    }catch(_eGuard){}
    showToast("資料已更新，系統正在為你重新載入…", "warn", 6000);
    invalidateShipCaches_();
    await loadShipMasterData();
    await renderShipments();
    if(String(shipmentId || "").trim()) await loadShipment(shipmentId);
    showToast("已重新載入最新資料，請確認後再送出", "warn", 6000);
    return true;
  }catch(_eReload){
    showToast("自動重新載入失敗，請手動重新載入後再送出", "error");
    return false;
  }
}

function shipShowLoadProgressToast_(shipmentId){
  // 對齊規則：載入中進度不要用 Toast（避免覆蓋錯誤/提醒造成一閃而過）
  // 進度改用狀態列（shipStatusHint / shipInvState）顯示
  try{
    const id = String(shipmentId || "");
    const stEl = document.getElementById("shipStatusHint");
    if(stEl) stEl.textContent = `出貨流程：載入中 — ${id}`;
    const invEl = document.getElementById("shipInvState");
    if(invEl) invEl.textContent = "扣庫狀態：載入中…";
  }catch(_e){}
}

function shipShowLoadDoneToast_(shipmentId){
  // 完成提示可用一般 Toast（短暫即可，不要蓋掉 error/warn）
  try{
    showToast("已載入完成：" + String(shipmentId || ""), "success");
  }catch(_e){}
}

function shipSetV_(id, v){
  try{
    if(typeof window.erpSetVById_ === "function") return window.erpSetVById_(id, v);
  }catch(_e){}
  const el = document.getElementById(String(id || ""));
  if(el && "value" in el) el.value = v;
}

function shipClear_(ids){
  try{
    if(typeof window.erpClearIds_ === "function") return window.erpClearIds_(ids);
  }catch(_e){}
  const list = Array.isArray(ids) ? ids : [ids];
  for(let i = 0; i < list.length; i++){
    const el = document.getElementById(String(list[i] || ""));
    if(el && "value" in el) el.value = "";
  }
}

function updateShipStatusHint_(){
  const el = document.getElementById("shipStatusHint");
  const invEl = document.getElementById("shipInvState");
  if(!el) return;
  if(shipEditing && shipReadOnlyDraft){
    const st = shipNormStatus_(shipLoadedStatus_);
    const zh = shipStatusZh_(st) || st;
    const hint =
      st === "POSTED" ? ["已載入 · " + zh, "主檔／明細備註可改"] :
      st === "CANCELLED" ? ["已載入 · " + zh, "僅主檔備註可改"] :
      ["已載入 · " + zh, "整批已鎖"];
    el.textContent =
      (typeof window.erpFlowHintText_ === "function")
        ? window.erpFlowHintText_("出貨", hint[0], hint[1])
        : ("出貨：" + hint[0] + " · " + hint[1]);
    if(invEl){
      const invHint =
        st === "POSTED" ? ["已過帳", "已扣庫"] :
        st === "CANCELLED" ? ["已作廢", "已反沖"] :
        ["未過帳", "未扣庫"];
      invEl.textContent =
        (typeof window.erpFlowHintText_ === "function")
          ? window.erpFlowHintText_("扣庫", invHint[0], invHint[1])
          : ("扣庫：" + invHint[0] + " · " + invHint[1]);
      invEl.style.color =
        st === "POSTED" ? "#166534" :
        st === "CANCELLED" ? "#991b1b" :
        "#92400e";
    }
  }else{
    el.textContent =
      (typeof window.erpFlowHintText_ === "function")
        ? window.erpFlowHintText_("出貨", "新單", "填主檔與明細後按「建立並過帳出貨」扣庫")
        : "出貨：新單 · 填主檔與明細後按「建立並過帳出貨」扣庫";
    if(invEl){
      invEl.textContent =
        (typeof window.erpFlowHintText_ === "function")
          ? window.erpFlowHintText_("扣庫", "未過帳", "過帳後才扣庫")
          : "扣庫：未過帳 · 過帳後才扣庫";
      invEl.style.color = "#92400e";
    }
  }
}

function setShipButtons_(){
  const postBtn = document.getElementById("ship_post_btn");
  const cancelBtn = document.getElementById("ship_cancel_btn");
  const saveHdr = document.getElementById("ship_save_remark_btn");
  const saveLine = document.getElementById("ship_save_line_remark_btn");
  const st = shipNormStatus_(shipLoadedStatus_ || "OPEN");

  if(postBtn){
    // 建單（並過帳）只在「新單草稿」可用
    postBtn.disabled = !!shipEditing;
    postBtn.title = shipEditing ? "請先清除回到新單，才能建立並過帳" : "建立並過帳出貨（扣庫）";
  }
  if(cancelBtn){
    if(!shipEditing){
      cancelBtn.disabled = true;
      cancelBtn.title = "請先載入出貨單";
    }else if(st === "CANCELLED"){
      cancelBtn.disabled = true;
      cancelBtn.title = "此出貨單已作廢";
    }else if(st !== "POSTED"){
      cancelBtn.disabled = true;
      cancelBtn.title = "僅 POSTED 出貨單可作廢";
    }else{
      cancelBtn.disabled = false;
      cancelBtn.title = "作廢此出貨單（將反沖庫存並回寫 SO）";
    }
  }
  if(saveHdr){
    saveHdr.disabled = !shipAllowHeaderRemarkSave_();
    saveHdr.title = shipAllowHeaderRemarkSave_()
      ? "只更新主檔備註（不變更銷售單／日期／出貨人員等）"
      : "請先載入出貨單";
  }
  if(saveLine){
    const ro = !!shipReadOnlyDraft;
    const canPostedLine = ro && st === "POSTED";
    saveLine.disabled = ro && !canPostedLine;
    saveLine.title = !ro
      ? "更新草稿列備註（請先點選草稿列）"
      : canPostedLine
        ? "寫回已出貨明細備註（請先點選明細列）"
        : "僅「已出貨」可儲存明細備註；已作廢僅可改主檔備註";
  }
}

function formatShipProductDisplay_(productId){
  const p = (shipProducts || []).find(x => x.product_id === productId) || {};
  const name = p.product_name || productId || "";
  const spec = p.spec || "";
  return spec ? `${name}（${spec}）` : name;
}

function shipFindProduct_(productId){
  const id = String(productId || "").trim();
  if(!id) return null;
  return (shipProducts || []).find(p => String(p.product_id || "").trim() === id) || null;
}

async function shippingInit(){
  await loadShipMasterData();
  const lotKw = document.getElementById("ship_lot_picker_keyword");
  if(lotKw && !lotKw.dataset.bound){
    lotKw.dataset.bound = "1";
    lotKw.addEventListener("input", () => renderShipLotPicker_(getShipLotsForPicker_()));
  }
  const lotView = document.getElementById("ship_lot_picker_viewmode");
  if(lotView && !lotView.dataset.bound){
    lotView.dataset.bound = "1";
    lotView.addEventListener("change", () => renderShipLotPicker_(getShipLotsForPicker_()));
  }
  const showInel = document.getElementById("ship_show_ineligible_lots");
  if(showInel && !showInel.dataset.bound){
    showInel.dataset.bound = "1";
    showInel.addEventListener("change", () => renderShipLotPicker_(getShipLotsForPicker_()));
  }
  resetShipForm();
  setShipButtons_();
  try{ shipUpdateAllocModeUI_(); }catch(_e){}
  // 從銷售單跳轉：預先選擇銷售單
  try{
    const preSo = window.__ERP_PREFILL_SHIP_SO_ID__;
    if(preSo){
      const soSel = document.getElementById("ship_so_id");
      if(soSel){
        soSel.value = String(preSo || "");
        onSelectShipSO();
      }
      delete window.__ERP_PREFILL_SHIP_SO_ID__;
    }
  }catch(_e){}
  bindAutoSearchToolbar_([
    ["ship_search_keyword", "input"],
    ["ship_search_status", "change"]
  ], () => renderShipments());
  await renderShipments();
}

function shipIsAutoAlloc_(){
  return !!document.getElementById("ship_auto_alloc")?.checked;
}

function shipUpdateAllocModeUI_(){
  const auto = shipIsAutoAlloc_();
  const pickBtn = document.getElementById("ship_pick_lot_btn");
  const lotDisp = document.getElementById("ship_lot_display");
  const lotId = document.getElementById("ship_lot_id");
  if(pickBtn){
    pickBtn.disabled = !!shipReadOnlyDraft || auto;
    pickBtn.title =
      shipReadOnlyDraft ? "此出貨單已結束（POSTED/CANCELLED），不可再選擇 Lot" :
      auto ? "已勾選自動分配（依效期 FEFO），不需手動選擇 Lot" :
      "選擇要出貨的 Lot";
  }
  if(lotDisp){
    lotDisp.placeholder = auto ? "自動分配（依效期 FEFO）" : "請在下方按「選擇 Lot」帶入";
    lotDisp.style.background = auto ? "#f8fafc" : "";
  }
  if(auto){
    shipClear_(["ship_lot_id","ship_lot_display"]);
  }
}

function shipParseYMD_(s){
  const raw = String(s || "").trim();
  if(!raw) return null;
  const m = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if(!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if(!y || !mo || !d) return null;
  return { y, mo, d };
}

function shipExpirySortKey_(lot){
  const ymd = shipParseYMD_(lot?.expiry_date);
  if(!ymd) return "9999-12-31";
  const pad2 = (n)=>String(n).padStart(2,"0");
  return `${ymd.y}-${pad2(ymd.mo)}-${pad2(ymd.d)}`;
}

function shipIsLotEligibleForShip_(lot){
  if(!lot) return false;
  const whitelist = shipGetProductWhitelistForPicker_();
  const pid = String(lot?.product_id || "").trim();
  if(whitelist && !whitelist.has(pid)) return false;
  if(String(lot.inventory_status || "ACTIVE").toUpperCase() !== "ACTIVE") return false;
  if(String(lot.status || "PENDING").toUpperCase() !== "APPROVED") return false;
  try{
    if(typeof invIsExpired_ === "function" && invIsExpired_(lot.expiry_date)) return false;
  }catch(_e){}
  const av = shipGetAvailable(lot.lot_id);
  if(typeof invIsMissingMovement_ === "function" && invIsMissingMovement_(av)) return false;
  return Number(av || 0) > 1e-9;
}

function shipAutoAllocateLots_(productId, qtyNeeded){
  const pid = String(productId || "").trim();
  let need = Number(qtyNeeded || 0);
  if(!pid || !(need > 0)) return { lines: [], shortage: need };

  const candidates = (shipLots || [])
    .filter(l => String(l?.product_id || "").trim() === pid)
    .filter(l => shipIsLotEligibleForShip_(l));

  candidates.sort((a,b)=>{
    const ea = shipExpirySortKey_(a);
    const eb = shipExpirySortKey_(b);
    if(ea !== eb) return ea.localeCompare(eb);
    const ca = String(a?.created_at || "");
    const cb = String(b?.created_at || "");
    if(ca !== cb) return ca.localeCompare(cb);
    return String(a?.lot_id || "").localeCompare(String(b?.lot_id || ""));
  });

  const lines = [];
  for(const lot of candidates){
    if(!(need > 1e-9)) break;
    const raw = shipGetAvailable(lot.lot_id);
    if(typeof invIsMissingMovement_ === "function" && invIsMissingMovement_(raw)) continue;
    const av = Number(raw || 0);
    if(!(av > 1e-9)) continue;
    const take = Math.min(av, need);
    lines.push({ lot, qty: take });
    need -= take;
  }
  return { lines, shortage: need };
}

async function loadShipMasterData(){
  const [lots, avail, customersRaw, salesOrders, products, warehouses, usersRaw, importReceipts, goodsReceipts, importDocs] = await Promise.all([
    getAll("lot"),
    loadInventoryMovementAvailableMap_().catch(() => ({ map:{}, failed:true })),
    getAll("customer"),
    getAll("sales_order").catch(() => []),
    getAll("product").catch(() => []),
    getAll("warehouse").catch(() => []),
    getAll("user").catch(() => []),
    getAll("import_receipt").catch(() => []),
    getAll("goods_receipt").catch(() => []),
    getAll("import_document").catch(() => [])
  ]);
  shipLots = lots || [];
  shipAvailableByLotId_ = avail?.map || {};
  shipCustomers = (customersRaw || []).filter(c => c.status === "ACTIVE");
  shipSalesOrders = salesOrders || [];
  shipSalesItems = [];
  shipSalesItemsBySoId_ = {};
  shipSalesItemsLoadingBySoId_ = {};
  shipProducts = products || [];
  shipWarehouses = (warehouses || []).filter(w => String(w.status || "ACTIVE").toUpperCase() === "ACTIVE");
  shipUsers = usersRaw || [];

  shipImportReceiptIdToDocId = {};
  (importReceipts || []).forEach(r => {
    if(r && r.import_receipt_id){
      shipImportReceiptIdToDocId[r.import_receipt_id] = r.import_doc_id || "";
    }
  });
  shipGoodsReceiptIdToPoId = {};
  (goodsReceipts || []).forEach(r => {
    if(r && r.gr_id){
      shipGoodsReceiptIdToPoId[r.gr_id] = r.po_id || "";
    }
  });
  shipImportDocIdToImportNo = {};
  (importDocs || []).forEach(d => {
    if(d && d.import_doc_id){
      shipImportDocIdToImportNo[d.import_doc_id] = d.import_no || "";
    }
  });

  initShipDropdowns();
}

async function shipLoadSalesItemsBySo_(soId){
  const id = String(soId || "").trim().toUpperCase();
  if(!id) return [];
  if(Array.isArray(shipSalesItemsBySoId_?.[id])) return shipSalesItemsBySoId_[id];
  if(shipSalesItemsLoadingBySoId_?.[id]) return await shipSalesItemsLoadingBySoId_[id];

  const p = (async ()=>{
    try{
      const r = await callAPI({ action: "list_sales_order_item_by_so", so_id: id }, { method: "GET" });
      const rows = (r && r.data) ? r.data : [];
      shipSalesItemsBySoId_[id] = Array.isArray(rows) ? rows : [];
      return shipSalesItemsBySoId_[id];
    }catch(_e){
      // fallback：舊版後端未支援時才退回全表
      const all = await getAll("sales_order_item").catch(() => []);
      const rows = (all || []).filter(it => String(it.so_id || "").trim().toUpperCase() === id);
      shipSalesItemsBySoId_[id] = rows;
      return rows;
    }finally{
      try{ delete shipSalesItemsLoadingBySoId_[id]; }catch(_e2){}
    }
  })();
  shipSalesItemsLoadingBySoId_[id] = p;
  return await p;
}

async function shipRefreshSoItemDropdown_(soId){
  const id = String(soId || "").trim().toUpperCase();
  const soiSel = document.getElementById("ship_so_item_id");
  if(!soiSel) return;
  if(!id){
    soiSel.innerHTML = `<option value="">請先選擇銷售單</option>`;
    try{ shipUpdateAllocModeUI_(); }catch(_e){}
    return;
  }

  const items = await shipLoadSalesItemsBySo_(id);
  shipSalesItems = Array.isArray(items) ? items : [];

  soiSel.innerHTML =
    `<option value="">請選擇</option>` +
    (shipSalesItems || []).map(it => {
      const ordered = Number(it.order_qty || 0);
      const shipped = Number(it.shipped_qty || 0);
      const remain = Math.max(0, ordered - shipped);
      const p = shipFindProduct_(it.product_id);
      const name = String(p?.product_name || it.product_id || "").trim();
      const spec = String(p?.spec || "").trim();
      const prodText = spec ? `${name}（${spec}）` : name;
      const unit = String(it.unit || "").trim();
      const u = unit ? unit.replace(/</g, "") : "";
      const ordText = u ? `訂購${ordered}${u}` : `訂購${ordered}`;
      const shipText = u ? `已出${shipped}` : `已出${shipped}`;
      const remText = u ? `未出${remain}` : `未出${remain}`;
      const label = `${prodText}│${ordText}│${shipText}│${remText}`;
      return `<option value="${it.so_item_id}" data-product="${it.product_id}" data-unit="${it.unit}" data-remain="${remain}">${escapeHtml_(label)}</option>`;
    }).join("");
  // 若目前明細表已有列，補上 訂購/已出/未出 的即時顯示
  try{
    const cur = String(document.getElementById("ship_so_id")?.value || "").trim().toUpperCase();
    if(cur && cur === id && Array.isArray(shipDraft) && shipDraft.length){
      renderShipDraft();
    }
  }catch(_eRe){}
  try{ shipUpdateAllocModeUI_(); }catch(_e2){}
}

function shipWarehouseLabelById_(warehouseId){
  const id = String(warehouseId || "").trim().toUpperCase();
  if(!id) return "";
  const w = (shipWarehouses || []).find(x => String(x.warehouse_id || "").toUpperCase() === id) || null;
  if(!w) return id;
  const name = String(w.warehouse_name || "").trim();
  const cat = String(w.category || "").trim().toUpperCase();
  const catLabel = (typeof termShortZh_ === "function" ? termShortZh_(cat) : ((typeof termLabel === "function" ? termLabel(cat) : "") || cat));
  const namePart = name || id;
  return catLabel ? `${namePart}-${catLabel}` : namePart;
}

function shipWarehouseLabelByLot_(lot){
  return shipWarehouseLabelById_(lot?.warehouse_id || "");
}

function shipGetAvailable(lotId){
  const id = String(lotId || "");
  if(!id) return null;
  const hit = shipAvailableByLotId_?.[id];
  // 缺 movement：map 會是 null（顯示 --，且禁止用於扣庫/出貨）
  if(hit !== undefined) return hit;
  return null;
}

function formatShipLotOptionLabel_(lot, available){
  const lotId = String(lot?.lot_id || "");
  const productText = formatShipProductDisplay_(lot?.product_id || "") || "";
  const prodPart = productText ? ` ${productText}` : "";
  const avText = (typeof invFormatAvailableText_ === "function") ? invFormatAvailableText_(available) : String(available ?? "--");
  return `${lotId}${prodPart} 可用:${avText}`;
}

function formatShipLotSourceText_(lot){
  const sourceType = String(lot?.source_type || "").toUpperCase();
  const sourceId = String(lot?.source_id || "");
  if(sourceType === "PURCHASE"){
    const poId = shipGoodsReceiptIdToPoId[sourceId] || "";
    return poId ? `採購單:${poId}（收貨:${sourceId}）` : `採購:${sourceId}`;
  }
  if(sourceType === "IMPORT"){
    const docId = shipImportReceiptIdToDocId[sourceId] || "";
    const impNo = docId ? (shipImportDocIdToImportNo[docId] || "") : "";
    if(impNo || docId){
      return `報單:${impNo || "—"}（ID:${docId || "—"} / 收貨:${sourceId}）`;
    }
    return `進口:${sourceId}`;
  }
  if(sourceType === "PROCESS") return `加工:${sourceId}`;
  return sourceType ? `${sourceType}:${sourceId}` : sourceId;
}

/** 有選銷售單／品項時：限制 Lot 產品；未選則 null 表示不限制 */
function shipGetProductWhitelistForPicker_(){
  const soId = String(document.getElementById("ship_so_id")?.value || "").trim();
  const soItemId = String(document.getElementById("ship_so_item_id")?.value || "").trim();
  const soItems = (shipSalesItems || []);
  if(soItemId){
    const soi = soItems.find(x => String(x.so_item_id || "").trim() === soItemId) || null;
    const pid = String(soi?.product_id || "").trim();
    return pid ? new Set([pid]) : null;
  }
  if(soId){
    const pids = new Set();
    soItems.filter(x => String(x.so_id || "").trim() === soId).forEach(x=>{
      const pid = String(x?.product_id || "").trim();
      if(pid) pids.add(pid);
    });
    return pids.size ? pids : null;
  }
  return null;
}

function getShipEligibleLots_(){
  return (shipLots || []).filter(l => shipIsLotEligibleForShip_(l));
}

/** 手動選 Lot：顯示白名單內全部（含不可選與原因）；FEFO：僅可出貨批次 */
function getShipLotsForPicker_(){
  if(shipIsAutoAlloc_()) return getShipEligibleLots_();
  const showInel = !!document.getElementById("ship_show_ineligible_lots")?.checked;
  if(!showInel) return getShipEligibleLots_();
  const productWhitelist = shipGetProductWhitelistForPicker_();
  return (shipLots || []).filter(l => {
    if(productWhitelist && !productWhitelist.has(String(l?.product_id || "").trim())) return false;
    return true;
  });
}

/** 空字串 = 可出貨；否則為不可選原因（給手動模式列示） */
function shipIneligibleReasonForShip_(lot){
  if(!lot) return "無 Lot 資料";
  const whitelist = shipGetProductWhitelistForPicker_();
  const pid = String(lot?.product_id || "").trim();
  if(whitelist && !whitelist.has(pid)) return "非銷售單指定品項";
  if(String(lot.inventory_status || "ACTIVE").toUpperCase() !== "ACTIVE"){
    return "庫存非使用中（非 ACTIVE）";
  }
  const qa = String(lot.status || "PENDING").toUpperCase();
  if(qa === "REJECTED") return "QA已退回";
  if(qa !== "APPROVED") return "待QA（須先放行）";
  try{
    if(typeof invIsExpired_ === "function" && invIsExpired_(lot.expiry_date)) return "已過期";
  }catch(_e){}
  const av = shipGetAvailable(lot.lot_id);
  if(typeof invIsMissingMovement_ === "function" && invIsMissingMovement_(av)) return "缺 movement（需先補齊入庫/異動紀錄）";
  if(!(Number(av || 0) > 1e-9)) return "可用量為 0";
  return "";
}

function renderShipLotPicker_(lots){
  const tbody = document.getElementById("shipLotPickBody");
  if(!tbody) return;
  const kw = (document.getElementById("ship_lot_picker_keyword")?.value || "").trim().toLowerCase();
  const viewMode = document.getElementById("ship_lot_picker_viewmode")?.value || "flat";
  const source = Array.isArray(lots) ? lots : [];
  const list = source.filter(l => {
    if(!kw) return true;
    const lotId = String(l.lot_id || "").toLowerCase();
    const pname = String(formatShipProductDisplay_(l.product_id || "") || "").toLowerCase();
    const src = String(formatShipLotSourceText_(l) || "").toLowerCase();
    const wh = String(shipWarehouseLabelByLot_(l) || "").toLowerCase();
    return lotId.includes(kw) || pname.includes(kw) || src.includes(kw) || wh.includes(kw);
  });

  // 排序：可出貨在上；同類內依效期 ASC、Lot ID ASC
  function shipSortLotsForPicker_(arr){
    const a = Array.isArray(arr) ? arr.slice() : [];
    a.sort((x, y) => {
      const rx = shipIneligibleReasonForShip_(x);
      const ry = shipIneligibleReasonForShip_(y);
      const okx = !rx;
      const oky = !ry;
      if(okx !== oky) return okx ? -1 : 1;
      const ex = shipExpirySortKey_(x);
      const ey = shipExpirySortKey_(y);
      if(ex !== ey) return ex.localeCompare(ey);
      return String(x?.lot_id || "").localeCompare(String(y?.lot_id || ""));
    });
    return a;
  }
  tbody.innerHTML = "";
  if(!list.length){
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#64748b;">目前無符合的 Lot（請調整銷售單／品項或關鍵字）</td></tr>`;
    return;
  }

  function renderLotRow_(l){
    const av = shipGetAvailable(l.lot_id);
    const lotId = String(l.lot_id || "");
    const productText = formatShipProductDisplay_(l.product_id || "");
    const whText = shipWarehouseLabelByLot_(l) || (l.warehouse_id ? String(l.warehouse_id) : "");
    const expiry = String(l.expiry_date || "") || "—";
    const safeId = lotId.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const reason = shipIneligibleReasonForShip_(l);
    const ok = !reason;
    const hint = ok ? "可出貨" : reason;
    const rowStyle = ok ? "cursor:pointer;" : "cursor:default;opacity:0.72;background:#f8fafc;";
    const onRow = ok ? `onclick="pickShipLineLot('${safeId}')"` : "";
    const btnDisabled = ok ? "" : " disabled";
    tbody.innerHTML += `
      <tr style="${rowStyle}" ${onRow}>
        <td>${lotId}</td>
        <td>${productText}</td>
        <td>${whText || "—"}</td>
        <td>${av}</td>
        <td>${expiry}</td>
        <td style="font-size:12px;color:${ok ? "#166534" : "#92400e"};max-width:200px;">${hint}</td>
        <td><button type="button" class="btn-secondary"${btnDisabled} ${ok ? `onclick="event.stopPropagation();pickShipLineLot('${safeId}')"` : ""}>帶入</button></td>
      </tr>
    `;
  }
  if(viewMode === "group_source"){
    const groups = {};
    list.forEach(l => {
      const key = formatShipLotSourceText_(l) || "未分類來源";
      if(!groups[key]) groups[key] = [];
      groups[key].push(l);
    });
    Object.keys(groups).sort().forEach(k => {
      tbody.innerHTML += `
        <tr style="background:#f8fafc;">
          <td colspan="7" style="font-weight:600;color:#334155;padding:8px 10px;">來源：${k}（${groups[k].length}）</td>
        </tr>
      `;
      shipSortLotsForPicker_(groups[k]).forEach(renderLotRow_);
    });
  }else{
    shipSortLotsForPicker_(list).forEach(renderLotRow_);
  }
}

function openShipLotPicker(){
  if(shipReadOnlyDraft) return;
  const modal = document.getElementById("shipLotPickerModal");
  if(!modal) return;
  const titleEl = document.getElementById("ship_lot_picker_title");
  const showInel = document.getElementById("ship_show_ineligible_lots");
  if(showInel) showInel.checked = false; // 預設隱藏不可選 Lot
  if(titleEl){
    titleEl.textContent = shipIsAutoAlloc_()
      ? "選擇 Lot（FEFO：僅顯示可出貨批次）"
      : "選擇 Lot（手動：僅顯示可出貨批次）";
  }
  modal.style.display = "flex";
  const kw = document.getElementById("ship_lot_picker_keyword");
  if(kw){
    shipClear_("ship_lot_picker_keyword");
    kw.focus();
  }
  renderShipLotPicker_(getShipLotsForPicker_());
}

function closeShipLotPicker(){
  const modal = document.getElementById("shipLotPickerModal");
  if(modal) modal.style.display = "none";
}

function pickShipLineLot(lotId){
  const lot = (shipLots || []).find(l => String(l.lot_id || "") === String(lotId || ""));
  if(!shipIsLotEligibleForShip_(lot)){
    const r = shipIneligibleReasonForShip_(lot) || "不符合出貨條件";
    if(typeof showToast === "function") showToast("無法選擇此 Lot：" + r, "error");
    return;
  }
  const input = document.getElementById("ship_lot_id");
  const display = document.getElementById("ship_lot_display");
  if(!input) return;
  input.value = lotId || "";
  if(display){
    const av = lot ? shipGetAvailable(lot.lot_id) : "";
    const whText = lot ? (shipWarehouseLabelByLot_(lot) || "") : "";
    display.value = lot ? (formatShipLotOptionLabel_(lot, av) + (whText ? ` | ${whText}` : "")) : (lotId || "");
  }
  const uHid = document.getElementById("ship_line_unit");
  if(uHid) uHid.value = lot ? String(lot.unit || "").trim() : "";
  syncErpQtyUnitSuffix_("ship_line_unit", "ship_qty_unit_suffix");
  onSelectShipLot();
  closeShipLotPicker();
}

function setShipPickLotBtnState_(){
  const btn = document.getElementById("ship_pick_lot_btn");
  if(btn) btn.disabled = !!shipReadOnlyDraft || shipIsAutoAlloc_();
}

function initShipDropdowns(){
  const soSel = document.getElementById("ship_so_id");
  if(soSel){
    const open = shipSalesOrders.filter(so => ["OPEN","PARTIAL"].includes(so.status));
    const customerMap = {};
    (shipCustomers || []).forEach(c => { if(c && c.customer_id) customerMap[c.customer_id] = c; });
    function soOptLabel_(so){
      const sid = String(so?.so_id || "").trim();
      const cid = String(so?.customer_id || "").trim();
      const cn = String(customerMap[cid]?.customer_name || "").trim();
      const custText = cn || cid;
      const sp = String(so?.salesperson_id || "").trim();
      const useText = (typeof termLabelZhOnly === "function" ? termLabelZhOnly(so?.so_type || "NORMAL") : String(so?.so_type || "NORMAL")) || String(so?.so_type || "NORMAL");
      const od = String(so?.order_date || "").trim();
      const st = (typeof termLabelZhOnly === "function" ? termLabelZhOnly(so?.status || "") : String(so?.status || "")) || String(so?.status || "");
      return [sid, custText, sp, useText, od, st].filter(Boolean).join("│");
    }
    soSel.innerHTML =
      `<option value="">請選擇</option>` +
      open.map(so => `<option value="${so.so_id}">${escapeHtml_(soOptLabel_(so))}</option>`).join("");
  }

  // 客戶欄位已改為 hidden（由選擇 SO 自動帶出）；保留此處不再渲染下拉

  const soiSel = document.getElementById("ship_so_item_id");
  if(soiSel){
    soiSel.innerHTML = `<option value="">請先選擇銷售單</option>`;
  }

  const shipperSel = document.getElementById("ship_shipper_id");
  if(shipperSel){
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
    const act = (shipUsers || []).filter(u => String(u.status || "").toUpperCase() === "ACTIVE");
    act.sort((a,b)=>{
      const an = String(a.user_name || "").trim();
      const bn = String(b.user_name || "").trim();
      if(an && bn && an !== bn) return an.localeCompare(bn);
      return String(a.user_id || "").localeCompare(String(b.user_id || ""));
    });
    shipperSel.innerHTML =
      `<option value="">請選擇</option>` +
      act.map(u => {
        const name = String(u.user_name || "").trim();
        const rz = roleZh(u.role);
        const id = String(u.user_id || "").trim();
        const label = name ? `${rz}-${name}(${id})` : `${rz}(${id})`;
        return `<option value="${u.user_id}">${escapeHtml_(label)}</option>`;
      }).join("");
  }
}

function resetShipForm(){
  shipEditing = false;
  shipReadOnlyDraft = false;
  shipDraft = [];
  shipLoadedStatus_ = "OPEN";
  renderShipDraft();

  const idEl = document.getElementById("ship_id");
  if(idEl){
    // reset/清除：強制產生新單號（避免沿用剛載入的 shipment_id）
    erpInitAutoId_("ship_id", { gen: () => (typeof generateId === "function" ? generateId("SHIP") : ""), force: true });
    idEl.disabled = false;
  }

  const dateEl = document.getElementById("ship_date");
  if(dateEl) dateEl.value = nowIso16().slice(0, 10);

  shipClear_(["ship_remark", "ship_so_id", "ship_customer_id", "ship_shipper_id"]);
  try{
    const shipperSel = document.getElementById("ship_shipper_id");
    const me = typeof getCurrentUser === "function" ? String(getCurrentUser() || "").trim() : "";
    if(shipperSel && me) shipperSel.value = me;
  }catch(_eShipper){}

  onSelectShipSO();
  clearShipItemEntry();
  syncErpQtyUnitSuffix_("ship_line_unit", "ship_qty_unit_suffix");
  updateShipStatusHint_();
  shipSyncLoadedFormLock_();
}

function clearShipItemEntry(){
  shipSelectedLineId_ = "";
  shipClear_([
    "ship_so_item_id",
    "ship_lot_id",
    "ship_lot_display",
    "ship_qty",
    "ship_line_unit",
    "ship_item_remark"
  ]);
  syncErpQtyUnitSuffix_("ship_line_unit", "ship_qty_unit_suffix");
}

function isShipDraftLineRow_(it){
  return String(it?.draft_id || "").startsWith("DRAFT-");
}

/** 明細列表「狀態」欄：對齊銷售／投料（草稿 vs 已過帳） */
function formatShipLineStatus_(it){
  if(isShipDraftLineRow_(it)) return "草稿";
  return "已過帳";
}

function selectShipDraftRow_(draftId){
  if(shipReadOnlyDraft) return;
  const id = String(draftId || "");
  const it = shipDraft.find(x => x.draft_id === id);
  if(!it) return;
  shipSelectedLineId_ = id;
  const soSel = document.getElementById("ship_so_id");
  if(soSel) soSel.value = it.so_id || "";
  onSelectShipSO();
  const soiSel = document.getElementById("ship_so_item_id");
  if(soiSel) soiSel.value = it.so_item_id || "";
  pickShipLineLot(it.lot_id);
  const qEl = document.getElementById("ship_qty");
  if(qEl) qEl.value = String(it.ship_qty ?? "");
  const rm = document.getElementById("ship_item_remark");
  if(rm) rm.value = String(it.remark || "");
  const hint =
    (typeof window.erpHintPickedLineText_ === "function")
      ? window.erpHintPickedLineText_({
          canEditStructure: true,
          needsEditItemsFirst: false,
          extraStructureHint: "改數量／Lot 請用「編輯」"
        })
      : "已帶入明細（僅改備註請按「儲存備註」；改數量／Lot 請用「編輯」）";
  showToast(hint);
}

function selectShipSavedRow_(shipmentItemId){
  if(!shipReadOnlyDraft) return;
  const id = String(shipmentItemId || "");
  const it = shipDraft.find(x => x.draft_id === id);
  if(!it) return;
  shipSelectedLineId_ = id;
  const rm = document.getElementById("ship_item_remark");
  if(rm) rm.value = String(it.remark || "");
  const pst = shipNormStatus_(shipLoadedStatus_) === "POSTED";
  if(pst){
    const hint2 =
      (typeof window.erpHintPickedLineText_ === "function")
        ? window.erpHintPickedLineText_({ canEditStructure: false })
        : "已帶入明細（僅改備註請按「儲存備註」）";
    showToast(hint2);
  }else{
    showToast("已帶入備註（此單非已出貨狀態，明細備註無法寫回；可改主檔備註）");
  }
}

function beginEditShipDraft_(draftId){
  if(shipReadOnlyDraft) return;
  const id = String(draftId || "");
  const it = shipDraft.find(x => x.draft_id === id);
  if(!it || !isShipDraftLineRow_(it)) return;
  shipDraft = shipDraft.filter(x => x.draft_id !== id);
  shipSelectedLineId_ = "";
  const soSel = document.getElementById("ship_so_id");
  if(soSel) soSel.value = it.so_id || "";
  onSelectShipSO();
  const soiSel = document.getElementById("ship_so_item_id");
  if(soiSel) soiSel.value = it.so_item_id || "";
  pickShipLineLot(it.lot_id);
  const qEl = document.getElementById("ship_qty");
  if(qEl) qEl.value = String(it.ship_qty ?? "");
  const rm = document.getElementById("ship_item_remark");
  if(rm) rm.value = String(it.remark || "");
  renderShipDraft();
}

async function updateSelectedShipItemRemark(triggerEl){
  const selId = String(shipSelectedLineId_ || "").trim();
  if(!selId) return showToast("請先點選一筆明細列", "error");
  const remark = (document.getElementById("ship_item_remark")?.value || "").trim();

  if(shipReadOnlyDraft){
    if(shipNormStatus_(shipLoadedStatus_) !== "POSTED"){
      return showToast("僅「已出貨」狀態可儲存明細備註；已作廢請僅使用主檔「儲存備註」。", "error");
    }
    showSaveHint(triggerEl || document.getElementById("shipPostButtonGroup"));
    try{
      await callAPI({
        action: "update_shipment_item_remark",
        shipment_item_id: selId,
        remark: remark,
        updated_by: getCurrentUser(),
        updated_at: nowIso16()
      }, { method: "POST" });
      const row = shipDraft.find(x => x.draft_id === selId);
      if(row) row.remark = remark;
      renderShipDraft();
      showToast("明細備註已儲存");
    }finally{
      hideSaveHint();
      setShipPickLotBtnState_();
    }
    return;
  }

  if(!isShipDraftLineRow_({ draft_id: selId })){
    return showToast("請點選草稿列（DRAFT-）", "error");
  }
  const row = shipDraft.find(x => x.draft_id === selId);
  if(!row) return showToast("找不到該筆草稿", "error");
  row.remark = remark;
  renderShipDraft();
  showToast("已更新草稿備註");
}

function clearShipLotEntryOnly_(){
  shipClear_(["ship_lot_id","ship_lot_display","ship_qty","ship_line_unit","ship_item_remark"]);
  syncErpQtyUnitSuffix_("ship_line_unit", "ship_qty_unit_suffix");
}

function onSelectShipSO(){
  const soIdRaw = document.getElementById("ship_so_id")?.value || "";
  const soId = String(soIdRaw || "").trim().toUpperCase();
  const cSel = document.getElementById("ship_customer_id");
  const soiSel = document.getElementById("ship_so_item_id");
  if(!soiSel) return;

  if(!soId){
    soiSel.innerHTML = `<option value="">請先選擇銷售單</option>`;
    // 關鍵欄位變更：SO 清空時，同步清空依賴欄位，避免殘留不相容資料
    clearShipLotEntryOnly_();
    return;
  }

  const so = shipSalesOrders.find(x => String(x?.so_id || "").trim().toUpperCase() === soId);
  if(so && cSel){
    cSel.value = so.customer_id || "";
  }

  // 關鍵欄位變更：SO 改變時，清空「品項/Lot/數量」避免殘留不相容資料
  shipClear_("ship_so_item_id");
  clearShipLotEntryOnly_();

  // 銷售品項改為按 SO 載入（非同步更新 dropdown）
  shipRefreshSoItemDropdown_(soId).catch(() => {
    soiSel.innerHTML = `<option value="">請先選擇銷售單</option>`;
  });
}

function onSelectShipSOItem(){
  const soiSel = document.getElementById("ship_so_item_id");
  const opt = soiSel?.selectedOptions?.[0];
  if(!opt) return;
  // 此處不強制鎖 Lot，因為可能多批次出貨；但可用 remain 當提示
  // 關鍵欄位變更：品項改變時，清空 Lot/數量，避免舊 Lot 與新產品不一致
  clearShipLotEntryOnly_();
  try{ shipUpdateAllocModeUI_(); }catch(_e){}
}

function onSelectShipLot(){
  const lotId = document.getElementById("ship_lot_id")?.value || "";
  const lot = (shipLots || []).find(l => String(l.lot_id || "") === String(lotId || ""));
  if(!lot){
    return;
  }
  // UX：Lot 切換時清空數量（避免殘留上一筆 qty）
  try{
    shipClear_("ship_qty");
  }catch(_e){}
}

async function addShipItemDraft(){
  if(shipReadOnlyDraft) return showToast("已載入出貨單，明細僅供檢視","error");
  const so_id = document.getElementById("ship_so_id")?.value || "";
  const so_item_id = document.getElementById("ship_so_item_id")?.value || "";
  const lot_id = document.getElementById("ship_lot_id")?.value || "";
  const qty = Number(document.getElementById("ship_qty")?.value || 0);
  const remark = (document.getElementById("ship_item_remark")?.value || "").trim();

  if(!String(so_id || "").trim()) return showToast("請選擇 銷售單", "error");
  if(!String(so_item_id || "").trim()) return showToast("請選擇 銷售品項", "error");
  if(!qty || qty <= 0) return showToast("出貨數量需大於 0","error");
  const auto = shipIsAutoAlloc_();
  if(so_id){
    try{
      await shipLoadSalesItemsBySo_(so_id);
      const id = String(so_id || "").trim().toUpperCase();
      if(Array.isArray(shipSalesItemsBySoId_?.[id])) shipSalesItems = shipSalesItemsBySoId_[id];
    }catch(_e){}
  }
  const soi = (shipSalesItems || []).find(x => x.so_item_id === so_item_id) || null;
  if(!soi) return showToast("找不到該銷售品項（請重新選擇銷售單/品項）", "error");

  if(auto){
    const pid = String(soi.product_id || "").trim();
    if(!pid) return showToast("銷售品項缺少 product_id", "error");
    const remain = Math.max(0, Number(soi.order_qty||0) - Number(soi.shipped_qty||0));
    if(qty > remain) return showToast("出貨不可超過銷售單剩餘未出貨量","error");

    const alloc = shipAutoAllocateLots_(pid, qty);
    if(alloc.shortage > 1e-9){
      return showToast(`可用量不足，尚缺 ${Math.round(Number(alloc.shortage||0)*10000)/10000}`, "error");
    }
    if(!alloc.lines.length){
      return showToast("查無可用 Lot（需 ACTIVE + QA放行 + 可用量>0，且未過期）", "error");
    }

    for(const x of alloc.lines){
      const lot = x.lot;
      shipDraft.push({
        draft_id: "DRAFT-" + Date.now() + "-" + Math.floor(Math.random()*1000),
        so_id,
        so_item_id,
        lot_id: lot.lot_id,
        product_id: lot.product_id,
        warehouse_id: String(lot.warehouse_id || "").trim().toUpperCase(),
        ship_qty: x.qty,
        unit: lot.unit || "",
        remark
      });
    }
    clearShipItemEntry();
    renderShipDraft();
    showToast(`已自動分配 ${alloc.lines.length} 筆 Lot（FEFO）`);
    return;
  }

  // 手動 override
  if(!lot_id) return showToast("請選擇 Lot","error");
  const lot = shipLots.find(l => l.lot_id === lot_id);
  if(!lot) return showToast("找不到 Lot","error");
  const av = shipGetAvailable(lot_id);
  if(typeof invIsMissingMovement_ === "function" && invIsMissingMovement_(av)){
    return showToast("此 Lot 缺 movement（請先補齊入庫/異動紀錄）", "error");
  }
  if(qty > av) return showToast("出貨不可超過可用量","error");
  if(so_id && so_item_id && soi){
    const remain = Math.max(0, Number(soi.order_qty||0) - Number(soi.shipped_qty||0));
    if(qty > remain) return showToast("出貨不可超過銷售單剩餘未出貨量","error");
    if(lot.product_id !== soi.product_id) return showToast("Lot 產品與銷售品項不一致","error");
  }
  shipDraft.push({
    draft_id: "DRAFT-" + Date.now() + "-" + Math.floor(Math.random()*1000),
    so_id,
    so_item_id,
    lot_id,
    product_id: lot.product_id,
    warehouse_id: String(lot.warehouse_id || "").trim().toUpperCase(),
    ship_qty: qty,
    unit: lot.unit || "",
    remark
  });

  clearShipItemEntry();
  renderShipDraft();
}

function removeShipDraft(draftId){
  if(shipReadOnlyDraft) return;
  shipDraft = shipDraft.filter(x => x.draft_id !== draftId);
  renderShipDraft();
}

function renderShipDraft(){
  const tbody = document.getElementById("shipItemsBody");
  if(!tbody) return;
  tbody.innerHTML = "";

  // 依銷售單明細彙總：訂購 / 已出 / 未出（草稿：出貨前；過帳：出貨後，因 shipped_qty 已回寫）
  const curSoId = String(document.getElementById("ship_so_id")?.value || "").trim().toUpperCase();
  const soItems =
    (curSoId && shipSalesItemsBySoId_ && Array.isArray(shipSalesItemsBySoId_[curSoId])) ? shipSalesItemsBySoId_[curSoId] :
    (Array.isArray(shipSalesItems) ? shipSalesItems.filter(x => String(x?.so_id || "").trim().toUpperCase() === curSoId) : []);
  const soAggByProduct = {};
  (soItems || []).forEach(it=>{
    const pid = String(it?.product_id || "").trim();
    if(!pid) return;
    if(!soAggByProduct[pid]) soAggByProduct[pid] = { order: 0, shipped: 0, unit: String(it?.unit || "").trim() };
    soAggByProduct[pid].order += Number(it?.order_qty || 0);
    soAggByProduct[pid].shipped += Number(it?.shipped_qty || 0);
    if(!soAggByProduct[pid].unit) soAggByProduct[pid].unit = String(it?.unit || "").trim();
  });

  shipDraft.forEach((it, idx) => {
    const lot = (shipLots || []).find(l => String(l?.lot_id || "") === String(it?.lot_id || "")) || null;
    const safeId = String(it.draft_id || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const isDraft = isShipDraftLineRow_(it);
    let rowClick = "";
    let actionBtn = "";
    if(shipReadOnlyDraft){
      rowClick = `onclick="selectShipSavedRow_('${safeId}')"`;
      actionBtn = "—";
    }else if(isDraft){
      rowClick = `onclick="selectShipDraftRow_('${safeId}')"`;
      actionBtn =
        `<button type="button" class="btn-secondary" onclick="event.stopPropagation(); beginEditShipDraft_('${safeId}')">編輯</button> ` +
        `<button type="button" class="btn-secondary" onclick="event.stopPropagation(); removeShipDraft('${safeId}')">刪除</button>`;
    }else{
      actionBtn = `<button type="button" class="btn-secondary" onclick="removeShipDraft('${safeId}')">刪除</button>`;
    }
    const u = String(it.unit || "").trim();
    const shipQtyCell = u ? `${it.ship_qty} ${u.replace(/</g, "")}` : String(it.ship_qty);
    const pid = String(it.product_id || "").trim();
    const agg = soAggByProduct[pid] || null;
    const soUnit = String((agg && agg.unit) || u || "").trim();
    const orderQty = agg ? Number(agg.order || 0) : 0;
    const shippedQty = agg ? Number(agg.shipped || 0) : 0;
    const remainQty = agg ? Math.max(0, orderQty - shippedQty) : 0;
    const orderDisp = agg ? (soUnit ? `${orderQty} ${soUnit}` : String(orderQty)) : "—";
    const shippedDisp = agg ? (soUnit ? `${shippedQty} ${soUnit}` : String(shippedQty)) : "—";
    const remainDisp = agg ? (soUnit ? `${remainQty} ${soUnit}` : String(remainQty)) : "—";
    tbody.innerHTML += `
      <tr style="${rowClick ? "cursor:pointer;" : ""}" ${rowClick}>
        <td>${idx+1}</td>
        <td>
          <div style="font-size:12px; font-weight:700; line-height:1.1;">${escapeHtml_(String(it.lot_id || ""))}</div>
          <div style="font-size:12px; color:#334155; line-height:1.2; margin-top:2px;">${escapeHtml_(String(formatShipProductDisplay_(it.product_id) || ""))}</div>
        </td>
        <td>${shipWarehouseLabelById_(it.warehouse_id) || "—"}</td>
        <td>${escapeHtml_(orderDisp)}</td>
        <td>${escapeHtml_(shippedDisp)}</td>
        <td>${escapeHtml_(remainDisp)}</td>
        <td>${shipQtyCell}</td>
        <td>${formatShipLineStatus_(it)}</td>
        <td>${actionBtn}</td>
      </tr>
    `;
  });
}

function resetShipmentSearch(){
  shipClear_(["ship_search_keyword","ship_search_status"]);
  renderShipments();
}

function shipStatusZh_(status){
  const s = String(status || "").trim().toUpperCase();
  if(s === "POSTED") return "已出貨";
  if(s === "CANCELLED") return "已作廢";
  return (typeof termLabelZhOnly === "function" ? termLabelZhOnly(s) : s) || s;
}

async function renderShipments(){
  const tbody = document.getElementById("shipTableBody");
  if(!tbody) return;

  setTbodyLoading_(tbody, 8);
  const qKw = (document.getElementById("ship_search_keyword")?.value || "").trim().toUpperCase();
  const qSt = (document.getElementById("ship_search_status")?.value || "").trim().toUpperCase();

  let list = [];
  try{
    const r = await callAPI({ action: "list_shipment_recent", days: 180, _ts: String(Date.now()) }, { method: "POST" });
    list = (r && r.data) ? r.data : [];
  }catch(_e){
    list = await getAll("shipment").catch(()=>[]);
  }
  const customerMap = {};
  (shipCustomers || []).forEach(c => { if(c && c.customer_id) customerMap[c.customer_id] = c; });
  const soMap = {};
  (shipSalesOrders || []).forEach(so => { if(so && so.so_id) soMap[String(so.so_id)] = so; });
  const userMap = {};
  (shipUsers || []).forEach(u => { if(u && u.user_id) userMap[String(u.user_id)] = u; });
  const filtered = (list || []).filter(s => {
    const stOk = !qSt || String(s.status||"").toUpperCase() === qSt;
    if(!stOk) return false;
    if(!qKw) return true;
    const sid = String(s.shipment_id||"").toUpperCase();
    const cid = String(s.customer_id||"").toUpperCase();
    const soid = String(s.so_id||"").toUpperCase();
    const cn = String(customerMap[s.customer_id]?.customer_name || "").toUpperCase();
    return sid.includes(qKw) || cid.includes(qKw) || (cn && cn.includes(qKw)) || soid.includes(qKw);
  }).sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")));

  tbody.innerHTML = "";
  filtered.forEach(s => {
    const c = customerMap[s.customer_id] || null;
    const customerNameOnly = (c && c.customer_name) ? c.customer_name : (s.customer_id || "");
    const so = soMap[String(s.so_id || "")] || null;
    const spId = String(so?.salesperson_id || "").trim();
    const spUser = spId ? (userMap[spId] || null) : null;
    const sp = spUser ? (String(spUser.user_name || "").trim() || spId) : (spId || "—");
    const shipperId = String(s?.shipper_id || "").trim();
    const shipperUser = shipperId ? (userMap[shipperId] || null) : null;
    const shipper = shipperUser ? (String(shipperUser.user_name || "").trim() || shipperId) : (shipperId || "—");
    tbody.innerHTML += `
      <tr>
        <td>${s.shipment_id || ""}</td>
        <td>${s.so_id || ""}</td>
        <td>${customerNameOnly}</td>
        <td>${escapeHtml_(sp)}</td>
        <td>${escapeHtml_(shipper)}</td>
        <td>${dateInputValue_(s.ship_date)}</td>
        <td>${shipStatusZh_(s.status)}</td>
        <td>
          <button class="btn-edit" onclick="loadShipment('${s.shipment_id}', this)">Load</button>
        </td>
      </tr>
    `;
  });
}

async function loadShipment(shipmentId, triggerEl){
  const id = String(shipmentId || "").trim().toUpperCase();
  if(!id) return;
  if(shipLoadInFlight_){
    shipPendingLoadId_ = id;
    // 避免 Toast 被「載入中」進度提示蓋掉造成一閃而過：改用狀態列提示
    try{
      const stEl = document.getElementById("shipStatusHint");
      if(stEl) stEl.textContent = `出貨流程：載入中 — 已排隊 ${id}（完成後自動載入）`;
    }catch(_eHint){}
    return;
  }
  shipLoadInFlight_ = true;
  try{
    if(typeof erpBeginLoadWarnToast_ === "function"){
      shipLoadWarnToken_ = erpBeginLoadWarnToast_(`載入中...請稍等（${id}）`);
    }
  }catch(_eWarn){}
  try{
    const postBtn = document.getElementById("ship_post_btn");
    const cancelBtn = document.getElementById("ship_cancel_btn");
    if(postBtn){
      postBtn.disabled = true;
      postBtn.title = "載入中，請稍候…";
    }
    if(cancelBtn){
      cancelBtn.disabled = true;
      cancelBtn.title = "載入中，請稍候…";
    }
  }catch(_eLock){}
  try{
    if(triggerEl) triggerEl.disabled = true;
    shipShowLoadProgressToast_(id);
  }catch(_e){}
  try{
    const stEl = document.getElementById("shipStatusHint");
    const invEl = document.getElementById("shipInvState");
    if(stEl) stEl.textContent = `出貨流程：載入中 — ${id}`;
    if(invEl){
      invEl.textContent = "扣庫狀態：載入中…";
      invEl.style.color = "#92400e";
    }
  }catch(_eHint){}
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
  let loadedOk_ = false;
  try{
    await loadShipMasterData();

    const sh = await getOne("shipment","shipment_id",id).catch(()=>null);
    if(!sh) return showToast("找不到出貨單","error");

  let items = [];
  try{
    const r = await callAPI({ action: "list_shipment_item_by_shipment", shipment_id: id });
    items = (r && r.data) ? r.data : [];
  }catch(_e){
    // fallback：舊版後端尚未支援時，退回全表抓取（但只取該出貨單相關資料）
    const itemsAll = await getAll("shipment_item").catch(()=>[]);
    items = (itemsAll || []).filter(x => String(x.shipment_id || "").trim().toUpperCase() === id);
  }

  shipEditing = true;
  shipReadOnlyDraft = true;
  shipLoadedStatus_ = shipNormStatus_(sh.status || "OPEN");

  const idEl = document.getElementById("ship_id");
  if(idEl){
    idEl.value = sh.shipment_id || id;
    idEl.disabled = true;
  }
  document.getElementById("ship_so_id").value = sh.so_id || "";
  onSelectShipSO();
  document.getElementById("ship_customer_id").value = sh.customer_id || "";
    document.getElementById("ship_date").value = dateInputValue_(sh.ship_date);
    shipSetV_("ship_shipper_id", sh.shipper_id || "");
  document.getElementById("ship_remark").value = sh.remark || "";

  clearShipLotEntryOnly_();
  shipSelectedLineId_ = "";
  shipDraft = items.map(it => ({
    draft_id: it.shipment_item_id,
    so_id: it.so_id || "",
    so_item_id: it.so_item_id || "",
    lot_id: it.lot_id,
    product_id: it.product_id,
    ship_qty: Number(it.ship_qty || 0),
    unit: it.unit || "",
    remark: it.remark || ""
  }));
  renderShipDraft();
  // 補抓 SO 明細（用於 訂購/已出/未出 欄位），避免只載入出貨單時顯示「—」
  try{
    const soId = String(sh.so_id || "").trim().toUpperCase();
    if(soId){
      const loaded = await shipLoadSalesItemsBySo_(soId).catch(()=>[]);
      shipSalesItems = Array.isArray(loaded) ? loaded : [];
      renderShipDraft();
    }
  }catch(_eSoItems){}
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();

    // Load 採單一進度提示（由 shipStatusHint/shipInvState 顯示），這裡不再額外跳 Toast
    updateShipStatusHint_();
    shipSyncLoadedFormLock_();
    shipShowLoadDoneToast_(id);
    loadedOk_ = true;
  } catch(err){
    try{
      shipClearToast_();
      if(!(err && err.erpApiToastShown) && typeof showToast === "function"){
        showToast("載入失敗：請稍後重試", "error");
      }
    }catch(_eToast){}
    // 失敗也要收尾，避免狀態文字卡在「載入中」
    try{
      updateShipStatusHint_();
      setShipButtons_();
    }catch(_eRecover){}
  }finally{
    try{
      if(typeof erpEndLoadWarnToast_ === "function"){
        erpEndLoadWarnToast_(shipLoadWarnToken_);
      }
      shipLoadWarnToken_ = "";
    }catch(_eWarnEnd){}
    try{ if(triggerEl) triggerEl.disabled = false; }catch(_e2){}
    // Load 不使用「儲存中」提示；最後再依目前單據狀態重算按鈕狀態
    try{ setShipButtons_(); }catch(_e3){}
    try{
      if(!loadedOk_){
        updateShipStatusHint_();
      }
    }catch(_e4){}
    shipLoadInFlight_ = false;

    // 若載入期間又點了其他單號，完成後自動載入最後一次點選的單號
    try{
      const nextId = String(shipPendingLoadId_ || "").trim().toUpperCase();
      shipPendingLoadId_ = "";
      if(nextId && nextId !== id){
        // 避免同步遞迴造成 UI 卡住，讓事件迴圈先跑完
        setTimeout(function(){
          try{ loadShipment(nextId); }catch(_e){}
        }, 0);
      }
    }catch(_eNext){}
  }
}

async function cancelShipment(triggerEl){
  if(shipLoadInFlight_){
    return showToast("單據載入中，暫時不可作廢", "error");
  }
  if(shipCancelInFlight_){
    return showToast("作廢處理中，請稍候…","error");
  }
  const shipment_id = (document.getElementById("ship_id")?.value || "").trim().toUpperCase();
  if(!shipment_id) return showToast("請先載入出貨單","error");

  const sh = await getOne("shipment","shipment_id",shipment_id).catch(()=>null);
  if(!sh) return showToast("找不到出貨單","error");

  const st = shipNormStatus_(sh.status || "");
  if(st === "CANCELLED") return showToast("此出貨單已作廢","error");
  if(st !== "POSTED") return showToast("僅 POSTED 出貨單可作廢","error");

  const ok = window.erpConfirmActionKey_("confirm.cancel.shipment", {
    fallback: "確定要作廢這張出貨單？\n\n作廢後系統會：\n- 把已扣掉的庫存加回來\n- 同步更新銷售單的「已出貨量」\n\n作廢後此出貨單會顯示為「已作廢」。"
  });
  if(!ok) return;

  shipCancelInFlight_ = true;
  showSaveHint(triggerEl || document.getElementById("shipPostButtonGroup"));
  try{
    await callAPI({
      action: "cancel_shipment_bundle",
      shipment_id: shipment_id,
      idempotency_key: shipBuildIdempotencyKey_("SHIP_CANCEL", [shipment_id]),
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    }, { method: "POST" });

    invalidateShipCaches_();

    showToast("作廢完成：這筆出貨已取消，畫面資料已同步更新", "success", 6000);
    await loadShipMasterData();
    await renderShipments();
    await loadShipment(shipment_id);
  } catch(err){
    if (shipShouldAutoReloadAfterError_(err)) {
      await shipAutoReloadAfterConflict_(shipment_id);
      return;
    }
    if(!(err && err.erpApiToastShown)){
      showToast("作廢失敗：請稍後重試；若仍失敗請重新載入後再試", "error");
    }
  } finally {
    shipCancelInFlight_ = false;
    hideSaveHint();
  }
}

async function postShipment(triggerEl){
  if(shipPostInFlight_){
    return showToast("過帳處理中，請稍候…","error");
  }
  const shipment_id = (document.getElementById("ship_id")?.value || "").trim().toUpperCase();
  document.getElementById("ship_id").value = shipment_id;

  const so_id = document.getElementById("ship_so_id")?.value || "";
  const customer_id = document.getElementById("ship_customer_id")?.value || "";
  const ship_date = document.getElementById("ship_date")?.value || "";
  const shipper_id = document.getElementById("ship_shipper_id")?.value || "";
  const remark = (document.getElementById("ship_remark")?.value || "").trim();

  const missing = [];
  if(!shipment_id) missing.push("出貨單ID");
  if(!String(so_id || "").trim()) missing.push("銷售單");
  if(!customer_id) missing.push("客戶");
  if(!ship_date) missing.push("出貨日期");
  if(!String(shipper_id || "").trim()) missing.push("出貨人員");
  if(shipDraft.length === 0) missing.push("出貨明細（至少 1 筆）");
  if(missing.length) return showToast("缺少必填：" + missing.join("、"), "error");

  shipPostInFlight_ = true;
  showSaveHint(triggerEl || document.getElementById("shipPostButtonGroup"));
  try {
  // refresh（避免用舊 lot/可用量 做前置檢查）
  await loadShipMasterData();

  const payloadItems = (shipDraft || []).map((it) => ({
    so_id: it.so_id || so_id || "",
    so_item_id: it.so_item_id || "",
    lot_id: it.lot_id,
    product_id: it.product_id,
    ship_qty: String(it.ship_qty),
    unit: it.unit,
    remark: it.remark || ""
  }));

  await callAPI({
    action: "post_shipment_bundle",
    shipment_id,
    so_id,
    customer_id,
    ship_date,
    shipper_id,
    remark,
    expected_existed_shipment_item_count: "0",
    idempotency_key: shipBuildIdempotencyKey_("SHIP_POST", [shipment_id, so_id, ship_date, shipper_id, payloadItems]),
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    items_json: JSON.stringify(payloadItems)
  }, { method: "POST" });

  // bundle 會更新：shipment/shipment_item/inventory_movement/sales_order_item/sales_order/lot.inventory_status
  invalidateShipCaches_();

  showToast("出貨完成：已建立出貨紀錄，畫面資料已同步更新", "success", 6000);
  resetShipForm();
  await loadShipMasterData();
  await renderShipments();
  } catch(err){
    if (shipShouldAutoReloadAfterError_(err)) {
      await shipAutoReloadAfterConflict_(shipment_id);
      return;
    }
    if(!(err && err.erpApiToastShown)){
      showToast("出貨失敗：請稍後重試；若仍失敗請重新載入後再試", "error");
    }
  } finally {
    shipPostInFlight_ = false;
    hideSaveHint();
  }
}

