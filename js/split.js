/**
 * Split 拆批（API 版）
 * - movements: source OUT, new lots IN
 * - lot_relation: SPLIT (source -> new)
 */

let splitLots = [];
/** lot_id -> 可用量（來自後端彙總 API，避免全表 inventory_movement） */
let splitAvailByLotId_ = {};
let splitMovementLoadFailed_ = false;
let splitDraft = [];
let splitPosting_ = false;
let splitLoadInFlight_ = false;
let splitPendingReload_ = false;

function splitSetV_(id, v){
  try{
    if(typeof window.erpSetVById_ === "function") return window.erpSetVById_(id, v);
  }catch(_e){}
  const el = document.getElementById(String(id || ""));
  if(el && "value" in el) el.value = v;
}

function splitClear_(ids){
  try{
    if(typeof window.erpClearIds_ === "function") return window.erpClearIds_(ids);
  }catch(_e){}
  const list = Array.isArray(ids) ? ids : [ids];
  for(let i = 0; i < list.length; i++){
    const el = document.getElementById(String(list[i] || ""));
    if(el && "value" in el) el.value = "";
  }
}

async function splitInit(){
  await loadSplitCaches();
  resetSplit();
  // UX：來源 Lot 切換時，若已有草稿，需確認並清空
  try{
    const sel = document.getElementById("split_source_lot");
    if(sel){
      // 移除 modules/split.html 的 inline onchange，改由共用守衛驅動
      try{ sel.onchange = null; }catch(_e0){}
      if(typeof window.erpBindGuardedValueChangeByKey === "function"){
        window.erpBindGuardedValueChangeByKey(sel, {
          key: "splitSourceLot",
          hasBlocking: function(){ return Array.isArray(splitDraft) && splitDraft.length > 0; },
          messageKey: "split.source_lot",
          onClear: function(){
            splitDraft = [];
            renderSplitDraft();
            splitClear_(["split_new_qty", "split_new_remark"]);
          },
          onAfter: function(){ try{ onSelectSplitSource(); }catch(_e1){} }
        });
      }
    }
  }catch(_eUx){}
  setSplitButtons_();
}

async function loadSplitCaches(){
  if(splitLoadInFlight_){
    splitPendingReload_ = true;
    return;
  }
  splitLoadInFlight_ = true;
  const [lots, availPack] = await Promise.all([
    getAll("lot"),
    typeof loadInventoryMovementAvailableMap_ === "function"
      ? loadInventoryMovementAvailableMap_()
      : Promise.resolve({ map: {}, failed: true })
  ]);
  splitLots = lots || [];
  splitAvailByLotId_ = (availPack && availPack.map) || {};
  splitMovementLoadFailed_ = !!(availPack && availPack.failed);

  const sel = document.getElementById("split_source_lot");
  if(sel){
    const lots = splitLots.filter(l => (l.inventory_status || "ACTIVE") === "ACTIVE" && (l.status || "PENDING") === "APPROVED");
    sel.innerHTML =
      `<option value="">請選擇</option>` +
      lots.map(l => {
        const av = splitGetAvailable(l.lot_id);
        const avText = (typeof invFormatAvailableText_ === "function") ? invFormatAvailableText_(av) : String(av ?? "--");
        return `<option value="${l.lot_id}" data-product="${l.product_id}" data-unit="${l.unit}" data-av="${av}">${l.lot_id} 可用:${avText}</option>`;
      }).join("");
  }
  splitLoadInFlight_ = false;
  if(splitPendingReload_){
    splitPendingReload_ = false;
    setTimeout(function(){ try{ loadSplitCaches(); }catch(_e){} }, 0);
  }
}

function splitGetAvailable(lotId){
  const id = String(lotId || "");
  if (!id) return null;
  const hit = splitAvailByLotId_[id];
  if (hit !== undefined) return hit;
  return null;
}

function onSelectSplitSource(){
  const sel = document.getElementById("split_source_lot");
  const opt = sel?.selectedOptions?.[0];
  const hasLot = !!(opt && String(opt.value || "").trim());
  if(!hasLot){
    splitClear_(["split_product", "split_unit", "split_available", "split_new_unit"]);
    syncErpQtyUnitSuffix_("split_new_unit", "split_new_unit_suffix");
    erpInitAutoId_("split_new_lot_id", "doc", "LOT");
    setSplitButtons_();
    return;
  }
  splitSetV_("split_product", opt.getAttribute("data-product") || "");
  splitSetV_("split_unit", opt.getAttribute("data-unit") || "");
  splitSetV_("split_available", opt.getAttribute("data-av") || "");
  splitSetV_("split_new_unit", opt.getAttribute("data-unit") || "");
  syncErpQtyUnitSuffix_("split_new_unit", "split_new_unit_suffix");
  erpInitAutoId_("split_new_lot_id", "doc", "LOT");
  setSplitButtons_();
}

function resetSplit(){
  splitDraft = [];
  renderSplitDraft();

  splitClear_("split_source_lot");
  splitClear_(["split_product", "split_unit", "split_available", "split_new_qty", "split_new_unit", "split_new_remark"]);
  // 清除：強制產生新 Lot ID（避免沿用剛輸入/剛載入的值）
  erpInitAutoId_("split_new_lot_id", { gen: () => (typeof generateId === "function" ? generateId("LOT") : ""), force: true });
  syncErpQtyUnitSuffix_("split_new_unit", "split_new_unit_suffix");
  setSplitButtons_();
}

function addSplitDraft(){
  const source = document.getElementById("split_source_lot")?.value || "";
  const newLotId = (document.getElementById("split_new_lot_id")?.value || "").trim().toUpperCase();
  document.getElementById("split_new_lot_id").value = newLotId;
  const qty = Number(document.getElementById("split_new_qty")?.value || 0);
  const unit = document.getElementById("split_new_unit")?.value || "";
  const remark = (document.getElementById("split_new_remark")?.value || "").trim();

  if(!source) return showToast("請先選擇來源 Lot","error");
  if(!newLotId) return showToast("新 Lot ID 必填","error");
  if(!qty || qty <= 0) return showToast("數量需大於 0","error");
  if(!unit) return showToast("單位缺失","error");
  if(splitDraft.some(x => x.new_lot_id === newLotId)) return showToast("新 Lot ID 重複","error");

  splitDraft.push({
    draft_id: "DRAFT-" + Date.now() + "-" + Math.floor(Math.random()*1000),
    source_lot_id: source,
    new_lot_id: newLotId,
    qty,
    unit,
    remark
  });

  splitClear_(["split_new_qty", "split_new_remark"]);
  erpInitAutoId_("split_new_lot_id", "doc", "LOT");

  renderSplitDraft();
  setSplitButtons_();
}

function removeSplitDraft(draftId){
  splitDraft = splitDraft.filter(x => x.draft_id !== draftId);
  renderSplitDraft();
  setSplitButtons_();
}

function renderSplitDraft(){
  const tbody = document.getElementById("splitBody");
  if(!tbody) return;
  tbody.innerHTML = "";
  splitDraft.forEach((it, idx) => {
    const su = String(it.unit || "").trim();
    const sqCell = su ? `${it.qty} ${su.replace(/</g, "")}` : String(it.qty);
    tbody.innerHTML += `
      <tr>
        <td>${idx+1}</td>
        <td>${it.new_lot_id}</td>
        <td>${sqCell}</td>
        <td>${it.remark || ""}</td>
        <td><button class="btn-secondary" onclick="removeSplitDraft('${it.draft_id}')">刪除</button></td>
      </tr>
    `;
  });
  setSplitButtons_();
}

function setSplitButtons_(){
  const addBtn = document.getElementById("split_add_btn");
  const postBtn = document.getElementById("split_post_btn");
  const hasSource = !!(document.getElementById("split_source_lot")?.value || "");
  const hasLines = (splitDraft || []).length > 0;
  if(addBtn){
    addBtn.disabled = splitPosting_;
    addBtn.title = splitPosting_ ? "過帳中…" : "新增拆出批次";
  }
  if(postBtn){
    const can = !splitPosting_ && hasSource && hasLines;
    postBtn.disabled = !can;
    postBtn.title =
      splitPosting_ ? "過帳中…" :
      (!hasSource ? "請先選擇來源 Lot" :
      (!hasLines ? "請至少新增 1 筆新批次" :
      "確認拆批（過帳）"));
  }
}

async function postSplit(triggerEl){
  const source = document.getElementById("split_source_lot")?.value || "";
  if(!source) return showToast("請選擇來源 Lot","error");
  if(splitDraft.length === 0) return showToast("請至少新增 1 筆新批次","error");

  await loadSplitCaches();
  const srcLot = splitLots.find(l => l.lot_id === source);
  if(!srcLot) return showToast("找不到來源 Lot","error");
  const av = splitGetAvailable(source);
  if(typeof invIsMissingMovement_ === "function" && invIsMissingMovement_(av)){
    return showToast("來源 Lot 缺 movement（請先補齊入庫/異動紀錄）", "error");
  }
  const total = splitDraft.reduce((sum, x) => sum + Number(x.qty||0), 0);
  if(total > av) return showToast("拆出總量不可超過可用量","error");

  const refId = generateId("SPLIT");

  showSaveHint(triggerEl || document.getElementById("splitPostButtonGroup"));
  splitPosting_ = true;
  setSplitButtons_();
  try {
  // Phase 1（交易一致性）：拆批改走後端 bundle，一次完成 movement/lot/relation，避免前端分段寫入造成不同步
  await callAPI({
    action: "post_split_bundle",
    source_lot_id: source,
    ref_id: refId,
    lines_json: JSON.stringify((splitDraft || []).map((it) => ({
      new_lot_id: it.new_lot_id,
      qty: String(it.qty),
      unit: it.unit,
      remark: it.remark || ""
    }))),
    idempotency_key: `SPLIT:${source}:${refId}`
  }, { method: "POST" });

  showToast("拆批完成");
  await loadSplitCaches();
  resetSplit();
  } finally {
    hideSaveHint();
    splitPosting_ = false;
    setSplitButtons_();
  }
}

// =====================
// Split Module (Manufacturing Core)
// =====================

function splitInitLegacy_() {
    populateSplitLotDropdown();
    renderSplitHistory();
}

// =====================
// 填入可拆批次
// =====================

window.populateSplitLotDropdown = function () {

    const dropdown = document.getElementById("sp_lot");
    if (!dropdown) return;

    dropdown.innerHTML = "";

    window.DB.lots.forEach((l, index) => {

        if (l.status === "APPROVED" && l.available > 0) {

            const option = document.createElement("option");
            option.value = index;
            option.textContent = `${l.lot_id} (可用:${l.available})`;
            dropdown.appendChild(option);
        }
    });
};

// =====================
// 執行拆批
// =====================

window.createSplit = function () {

    const lotIndex = document.getElementById("sp_lot").value;
    const qty = parseInt(document.getElementById("sp_qty").value);

    if (lotIndex === "" || isNaN(qty) || qty <= 0) {
        alert("請輸入正確數量");
        return;
    }

    const sourceLot = window.DB.lots[lotIndex];

    if (qty > sourceLot.available) {
        alert("庫存不足");
        return;
    }

    // 扣來源批次
    sourceLot.available -= qty;

    // 若扣完自動關閉
    if (sourceLot.available === 0) {
        sourceLot.status = "CLOSED";
    }

    // 建立新批次
    const newLotId = sourceLot.lot_id + "-S" + (Math.floor(Math.random() * 1000));

    window.DB.lots.push({
        lot_id: newLotId,
        product_id: sourceLot.product_id,
        product_name: sourceLot.product_name,
        type: sourceLot.type,
        total: qty,
        available: qty,
        status: "APPROVED",
        parent_lot: sourceLot.lot_id
    });

    // 記錄 Split 歷史
    if (!window.DB.splits) window.DB.splits = [];

    window.DB.splits.push({
        source: sourceLot.lot_id,
        new_lot: newLotId,
        qty: qty,
        date: new Date().toLocaleString()
    });

    renderSplitHistory();
    populateSplitLotDropdown();
};

// =====================
// 顯示 Split 歷史
// =====================

function renderSplitHistory() {

    const tbody = document.getElementById("splitTableBody");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (!window.DB.splits) return;

    window.DB.splits.forEach(s => {

        const tr = document.createElement("tr");

        tr.innerHTML = `
            <td>${s.source}</td>
            <td>${s.new_lot}</td>
            <td>${s.qty}</td>
            <td>${s.date}</td>
        `;

        tbody.appendChild(tr);
    });
}