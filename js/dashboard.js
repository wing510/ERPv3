// =====================
// Dashboard Module — 待辦、效期、進行中單據、捷徑（非單純主檔筆數）
// =====================

function dbParseYMD_(s) {
  const m = String(s || "").trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!y || isNaN(mo) || !d) return null;
  return { y: y, mo: mo, d: d };
}

function dbEndOfExpiryDay_(ymd) {
  if (!ymd) return null;
  return new Date(ymd.y, ymd.mo, ymd.d, 23, 59, 59, 999);
}

/** true = 有效日已過（無有效日則不算過期） */
function dbIsExpired_(expiryDateStr) {
  const raw = String(expiryDateStr || "").trim();
  if (!raw) return false;
  const ymd = dbParseYMD_(raw);
  const now = new Date();
  if (ymd) {
    const end = dbEndOfExpiryDay_(ymd);
    return end ? now.getTime() > end.getTime() : false;
  }
  const d = new Date(raw);
  return !isNaN(d.getTime()) && now.getTime() > d.getTime();
}

/** 與今天 0:00 比，回傳距離有效日結束還有幾「天」（可為負）；無效日回 null */
function dbDaysFromTodayToExpiryEnd_(expiryDateStr) {
  const raw = String(expiryDateStr || "").trim();
  if (!raw) return null;
  const ymd = dbParseYMD_(raw);
  let end;
  if (ymd) end = dbEndOfExpiryDay_(ymd);
  else {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  }
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return Math.ceil((end.getTime() - startOfToday.getTime()) / 86400000);
}

// 注意：Dashboard 不再做 lot.qty fallback（避免雙來源）；可用量以 movement 彙總為準

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function dbGetAvail_(lot, availMap, movementLoadFailed){
  const id = lot && lot.lot_id ? String(lot.lot_id) : "";
  if(!id) return null;
  if(movementLoadFailed) return null;
  const hit = availMap ? availMap[id] : undefined;
  // 後端 map 只有「有 movement 的 lot」才會有鍵；缺 movement 視為 null（顯示 --）
  if(hit === undefined) return null;
  return Number(hit || 0);
}

function dbDerivedInventoryStatus_(lot, availableQty, movementLoadFailed) {
  if (movementLoadFailed) return String(lot.inventory_status || "ACTIVE").toUpperCase();
  if (dbIsExpired_(lot.expiry_date)) return "VOID";
  if (availableQty == null) return String(lot.inventory_status || "ACTIVE").toUpperCase();
  if (Number(availableQty || 0) <= 1e-9) return "CLOSED";
  return "ACTIVE";
}

async function dashboardInit() {
  if (!window.DB) window.DB = {};

  function can_(k){
    try{
      return (typeof erpIsModuleAllowed_ === "function") ? !!erpIsModuleAllowed_(k) : true;
    }catch(_e){
      return true;
    }
  }

  // 重要：避免在「無庫存權限」時仍去打 lot/movement 造成 Permission denied
  const canInventory = can_("lots") || can_("movements");
  const core = (canInventory && typeof loadInventoryCoreData_ === "function")
    ? await loadInventoryCoreData_({ needWarehouses: false, needMovementDetails: false }).catch(function(){ return { lots: [], products: [], movementAvailableByLotId: {}, movementLoadFailed: true }; })
    : { lots: [], products: [], movementAvailableByLotId: {}, movementLoadFailed: true };

  const [pos, imports, shipments, salesOrders] = await Promise.all([
    can_("purchase") ? getAll("purchase_order").catch(function () { return []; }) : Promise.resolve([]),
    can_("import") ? getAll("import_document").catch(function () { return []; }) : Promise.resolve([]),
    can_("shipping")
      ? (async function(){
          try{
            const r = await callAPI({ action: "list_shipment_recent", days: 365, _ts: String(Date.now()) }, { method: "POST" });
            return (r && r.data) ? r.data : [];
          }catch(_e){
            return await getAll("shipment").catch(function () { return []; });
          }
        })()
      : Promise.resolve([]),
    can_("sales")
      ? (async function(){
          try{
            const r = await callAPI({ action: "list_sales_order_recent", days: 365, _ts: String(Date.now()) }, { method: "POST" });
            return (r && r.data) ? r.data : [];
          }catch(_e){
            return await getAll("sales_order").catch(function () { return []; });
          }
        })()
      : Promise.resolve([])
  ]);

  window.DB.products = core.products || [];
  window.DB.lots = core.lots || [];
  window.DB.movements = []; // dashboard 不再依賴明細 movements
  window.DB.movementLoadFailed = !!core.movementLoadFailed;

  renderDashboard({
    products: core.products || [],
    lots: core.lots || [],
    availMap: core.movementAvailableByLotId || {},
    movementLoadFailed: !!core.movementLoadFailed,
    purchaseOrders: pos || [],
    importDocs: imports || [],
    shipments: shipments || [],
    salesOrders: salesOrders || []
  });
}

function renderDashboard(ctx) {
  const products = ctx.products || [];
  const lots = ctx.lots || [];
  const movementLoadFailed = !!ctx.movementLoadFailed;
  const availMap = ctx.availMap || {};

  let pendingQa = 0;
  let shippable = 0;
  let expired = 0;
  let expiring30 = 0;

  lots.forEach(function (l) {
    const av = dbGetAvail_(l, availMap, movementLoadFailed);
    const inv = dbDerivedInventoryStatus_(l, av, movementLoadFailed);
    const qa = (l.status || "PENDING").toUpperCase();

    const exp = l.expiry_date;
    const isExpired = dbIsExpired_(exp);
    if (isExpired) {
      // 已過期批次：只計入「仍有庫存」才符合待辦/風險語意（否則歷史資料會長期佔住指標）
      if (av != null && av > 0) expired += 1;
      return;
    }

    // 效期 30 天內：只計入「仍可用且有庫存」的批次，才符合「建議優先出貨」的語意
    // - inv === ACTIVE：未過期、可用量 > 0
    // - av > 0：避免無庫存批次佔住指標
    if (inv === "ACTIVE" && av != null && av > 0) {
      const days = dbDaysFromTodayToExpiryEnd_(exp);
      if (days != null && days >= 0 && days <= 30) expiring30 += 1;
    }

    // 待 QA：只計入仍可用的批次，避免「無庫存/作廢」長期佔住指標
    if (qa === "PENDING" && inv === "ACTIVE" && av != null && av > 0) pendingQa += 1;
    if (qa === "APPROVED" && inv === "ACTIVE" && av != null && av > 0) shippable += 1;
  });

  setText("db_pending_qa", String(pendingQa));
  setText("db_shippable_lots", String(shippable));
  setText("db_expired_lots", String(expired));
  setText("db_expiring_soon", String(expiring30));

  const noteEl = document.getElementById("db_movement_note");
  if (noteEl) noteEl.style.display = movementLoadFailed ? "block" : "none";

  // 缺 movement 的 lot（map 沒有該 lot_id key）
  let missingMovement = 0;
  if(!movementLoadFailed){
    for(const l of (lots || [])){
      const id = l && l.lot_id ? String(l.lot_id) : "";
      if(!id) continue;
      if(availMap && Object.prototype.hasOwnProperty.call(availMap, id)) continue;
      missingMovement += 1;
    }
  }
  const missEl = document.getElementById("db_missing_movement_note");
  const missCnt = document.getElementById("db_missing_movement_count");
  if(missCnt) missCnt.textContent = movementLoadFailed ? "—" : String(missingMovement);
  if(missEl) missEl.style.display = (!movementLoadFailed && missingMovement > 0) ? "block" : "none";

  const pos = ctx.purchaseOrders || [];
  let poOpen = 0;
  let poClosed = 0;
  pos.forEach(function (p) {
    const s = (p.status || "").toUpperCase();
    if (s === "OPEN" || s === "PARTIAL") poOpen += 1;
    else if (s === "CLOSED" || s === "CANCELLED") poClosed += 1;
  });
  setText("db_po_open", String(poOpen));
  setText("db_po_closed", String(poClosed));

  const imps = ctx.importDocs || [];
  let impOpen = 0;
  let impDone = 0;
  imps.forEach(function (d) {
    const s = (d.status || "").toUpperCase();
    if (s === "OPEN") impOpen += 1;
    else if (s === "CLOSED" || s === "CANCELLED") impDone += 1;
  });
  setText("db_imp_open", String(impOpen));
  setText("db_imp_done", String(impDone));

  const sos = ctx.salesOrders || [];
  let soOpen = 0;
  let soDone = 0;
  sos.forEach(function (so) {
    const s = (so.status || "").toUpperCase();
    if (s === "OPEN" || s === "PARTIAL") soOpen += 1;
    else if (s === "SHIPPED" || s === "CANCELLED") soDone += 1;
  });
  setText("db_so_open", String(soOpen));
  setText("db_so_done", String(soDone));

  const ships = ctx.shipments || [];
  let shipOpen = 0;
  let shipPosted = 0;
  ships.forEach(function (sh) {
    const s = (sh.status || "").toUpperCase();
    if (s === "OPEN") shipOpen += 1;
    else if (s === "POSTED" || s === "CANCELLED") shipPosted += 1;
  });
  setText("db_ship_open", String(shipOpen));
  setText("db_ship_posted", String(shipPosted));

  var guide = document.getElementById("dashboardFirstTimeGuide");
  if (guide) guide.style.display = products.length === 0 ? "block" : "none";

  syncDashboardDevClearVisibility_();
}

/** 「一鍵刪除」僅 ADMIN 可看見（角色來自登入回傳，存於 erp_current_role） */
function syncDashboardDevClearVisibility_() {
  var grp = document.getElementById("dev_clear_button_group");
  if (!grp) return;
  var role =
    typeof getCurrentUserRole === "function"
      ? String(getCurrentUserRole() || "").trim()
      : "";
  var isAdmin = role.toUpperCase() === "ADMIN";
  grp.style.display = isAdmin ? "" : "none";
  grp.setAttribute("aria-hidden", isAdmin ? "false" : "true");
}

function devClearNonMasterClick() {
  if (
    typeof getCurrentUserRole !== "function" ||
    String(getCurrentUserRole() || "").trim().toUpperCase() !== "ADMIN"
  ) {
    if (typeof showToast === "function") {
      showToast("僅管理員（ADMIN）可使用此功能。", "error");
    }
    return;
  }
  if(
    !window.erpConfirmActionKey_("confirm.action.generic", {
      fallback: "確定要刪除「除主檔外」所有工作表的資料嗎？\n主檔（產品、供應商、客戶、倉庫、使用者）會保留。"
    })
  ) return;
  showSaveHint();
  var actor =
    typeof getCurrentUser === "function" ? String(getCurrentUser() || "").trim() : "";
  callAPI({
    action: "dev_clear_non_master",
    created_by: actor,
    updated_by: actor
  })
    .then(function (res) {
      if (typeof invalidateCache === "function") invalidateCache();
      if (typeof showToast === "function")
        showToast(
          "已清除非主檔資料：" +
            (res.cleared && res.cleared.length ? res.cleared.join(", ") : "完成")
        );
      return dashboardInit();
    })
    .catch(function (err) {
      if (typeof showToast === "function" && !(err && err.erpApiToastShown)) {
        showToast(
          (err && (err.erpUserMessage || err.message)) || "清除失敗",
          "error"
        );
      }
    })
    .finally(function () {
      hideSaveHint();
    });
}
