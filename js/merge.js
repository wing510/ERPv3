/**
 * Merge 合批（API 版）
 * - movements: sources OUT, new lot IN
 * - lot_relation: MERGE (source -> new)
 */

let mergeLots = [];
let mergeProducts = [];
let mergeAvailByLotId_ = {};
let mergeMovementLoadFailed_ = false;
let mergeDraft = [];
let mergePickedProduct = "";
let mergePickedUnit = "";
let mergePickedType = "";
let mergePickedQA = "";
let mergePosting_ = false;
let mergeLoadInFlight_ = false;
let mergePendingReload_ = false;

function mergeSetV_(id, v){
  try{
    if(typeof window.erpSetVById_ === "function") return window.erpSetVById_(id, v);
  }catch(_e){}
  const el = document.getElementById(String(id || ""));
  if(el && "value" in el) el.value = v;
}

function mergeClear_(ids){
  try{
    if(typeof window.erpClearIds_ === "function") return window.erpClearIds_(ids);
  }catch(_e){}
  const list = Array.isArray(ids) ? ids : [ids];
  for(let i = 0; i < list.length; i++){
    const el = document.getElementById(String(list[i] || ""));
    if(el && "value" in el) el.value = "";
  }
}

async function mergeInit(){
  await loadMergeCaches();
  resetMerge();
  // UX：來源 Lot 切換時，若已有草稿/已輸入取用數量，需確認並清空
  try{
    const sel = document.getElementById("merge_source_lot");
    if(sel){
      // 移除 modules/merge.html 的 inline onchange，改由共用守衛驅動
      try{ sel.onchange = null; }catch(_e0){}
      if(typeof window.erpBindGuardedValueChangeByKey === "function"){
        window.erpBindGuardedValueChangeByKey(sel, {
          key: "mergeSourceLot",
          hasBlocking: function(){
            const hasDraft = Array.isArray(mergeDraft) && mergeDraft.length > 0;
            const hasQty = Number(document.getElementById("merge_take_qty")?.value || 0) > 0;
            return hasDraft || hasQty;
          },
          messageKey: "merge.source_lot",
          onClear: function(){
            mergeClear_(["merge_take_qty", "merge_take_remark"]);
          },
          onAfter: function(){ try{ onSelectMergeSource(); }catch(_e1){} }
        });
      }
    }
  }catch(_eUx){}
  setMergeButtons_();
}

async function loadMergeCaches(){
  if(mergeLoadInFlight_){
    mergePendingReload_ = true;
    return;
  }
  mergeLoadInFlight_ = true;
  const [lots, products, availPack] = await Promise.all([
    getAll("lot"),
    getAll("product"),
    typeof loadInventoryMovementAvailableMap_ === "function"
      ? loadInventoryMovementAvailableMap_()
      : Promise.resolve({ map: {}, failed: true })
  ]);
  mergeLots = lots || [];
  mergeProducts = products || [];
  mergeAvailByLotId_ = (availPack && availPack.map) || {};
  mergeMovementLoadFailed_ = !!(availPack && availPack.failed);

  const sel = document.getElementById("merge_source_lot");
  if(sel){
    const lots = mergeLots.filter(l => (l.inventory_status || "ACTIVE") === "ACTIVE" && (l.status || "PENDING") === "APPROVED");
    sel.innerHTML =
      `<option value="">請選擇</option>` +
      lots.map(l => {
        const av = mergeGetAvailable(l.lot_id);
        const avText = (typeof invFormatAvailableText_ === "function") ? invFormatAvailableText_(av) : String(av ?? "--");
        return `<option value="${l.lot_id}" data-product="${l.product_id}" data-unit="${l.unit}" data-type="${l.type}" data-qa="${l.status}" data-av="${av}">${l.lot_id} 可用:${avText}</option>`;
      }).join("");
  }
  mergeLoadInFlight_ = false;
  if(mergePendingReload_){
    mergePendingReload_ = false;
    setTimeout(function(){ try{ loadMergeCaches(); }catch(_e){} }, 0);
  }
}

function formatMergeProductDisplay_(productId){
  const p = (mergeProducts || []).find(x => x.product_id === productId) || {};
  const name = String(p.product_name || productId || "").trim();
  const spec = String(p.spec || "").trim();
  return spec ? `${name}（${spec}）` : name;
}

function mergeGetAvailable(lotId){
  const id = String(lotId || "");
  if (!id) return null;
  const hit = mergeAvailByLotId_[id];
  if (hit !== undefined) return hit;
  return null;
}

function resetMerge(){
  mergeDraft = [];
  mergePickedProduct = "";
  mergePickedUnit = "";
  mergePickedType = "";
  mergePickedQA = "";
  renderMergeDraft();

  // 清除：強制產生新 Lot ID（避免沿用剛輸入/剛載入的值）
  erpInitAutoId_("merge_new_lot_id", { gen: () => (typeof generateId === "function" ? generateId("LOT") : ""), force: true });
  mergeClear_(["merge_product", "merge_unit", "merge_total", "merge_remark", "merge_available", "merge_take_qty", "merge_take_unit", "merge_take_remark"]);

  mergeClear_("merge_source_lot");
  syncErpQtyUnitSuffix_("merge_take_unit", "merge_take_unit_suffix");
  setMergeButtons_();
}

function onSelectMergeSource(){
  const sel = document.getElementById("merge_source_lot");
  const opt = sel?.selectedOptions?.[0];
  const hasLot = !!(opt && String(opt.value || "").trim());
  mergeSetV_("merge_available", hasLot ? (opt.getAttribute("data-av") || "") : "");
  mergeSetV_("merge_take_unit", hasLot ? (opt.getAttribute("data-unit") || "") : "");
  syncErpQtyUnitSuffix_("merge_take_unit", "merge_take_unit_suffix");
  setMergeButtons_();
}

function addMergeDraft(){
  const lotId = document.getElementById("merge_source_lot")?.value || "";
  const qty = Number(document.getElementById("merge_take_qty")?.value || 0);
  const unit = document.getElementById("merge_take_unit")?.value || "";
  const remark = (document.getElementById("merge_take_remark")?.value || "").trim();

  if(!lotId) return showToast("請選擇來源 Lot","error");
  if(!qty || qty <= 0) return showToast("取用數量需大於 0","error");
  if(!unit) return showToast("單位缺失","error");
  if(mergeDraft.some(x => x.lot_id === lotId)) return showToast("同一 Lot 不可重複加入","error");

  const lot = mergeLots.find(l => l.lot_id === lotId);
  if(!lot) return showToast("找不到 Lot","error");
  const av = mergeGetAvailable(lotId);
  if(typeof invIsMissingMovement_ === "function" && invIsMissingMovement_(av)){
    return showToast("此 Lot 缺 movement（請先補齊入庫/異動紀錄）", "error");
  }
  if(qty > av) return showToast("取用不可超過可用量","error");

  // 強制同產品同單位
  if(!mergePickedProduct){
    mergePickedProduct = lot.product_id;
    mergePickedUnit = lot.unit;
    mergePickedType = lot.type;
    mergePickedQA = lot.status;
    mergeSetV_("merge_product", formatMergeProductDisplay_(mergePickedProduct));
    mergeSetV_("merge_unit", mergePickedUnit);
  }else{
    if(lot.product_id !== mergePickedProduct) return showToast("合批必須同一產品","error");
    if(lot.unit !== mergePickedUnit) return showToast("合批必須同一單位","error");
  }

  mergeDraft.push({
    draft_id: "DRAFT-" + Date.now() + "-" + Math.floor(Math.random()*1000),
    lot_id: lotId,
    product_id: lot.product_id,
    qty,
    unit,
    remark
  });

  mergeClear_(["merge_source_lot", "merge_available", "merge_take_qty", "merge_take_unit", "merge_take_remark"]);
  syncErpQtyUnitSuffix_("merge_take_unit", "merge_take_unit_suffix");

  renderMergeDraft();
  updateMergeTotal();
  setMergeButtons_();
}

function removeMergeDraft(draftId){
  mergeDraft = mergeDraft.filter(x => x.draft_id !== draftId);
  renderMergeDraft();
  updateMergeTotal();
  if(mergeDraft.length === 0){
    mergePickedProduct = "";
    mergePickedUnit = "";
    mergePickedType = "";
    mergePickedQA = "";
    mergeClear_(["merge_product", "merge_unit", "merge_total"]);
  }
  setMergeButtons_();
}

function renderMergeDraft(){
  const tbody = document.getElementById("mergeBody");
  if(!tbody) return;
  tbody.innerHTML = "";
  mergeDraft.forEach((it, idx) => {
    const mu = String(it.unit || "").trim();
    const mqCell = mu ? `${it.qty} ${mu.replace(/</g, "")}` : String(it.qty);
    tbody.innerHTML += `
      <tr>
        <td>${idx+1}</td>
        <td>${it.lot_id}</td>
        <td>${formatMergeProductDisplay_(it.product_id)}</td>
        <td>${mqCell}</td>
        <td>${it.remark || ""}</td>
        <td><button class="btn-secondary" onclick="removeMergeDraft('${it.draft_id}')">刪除</button></td>
      </tr>
    `;
  });
  setMergeButtons_();
}

function updateMergeTotal(){
  const total = mergeDraft.reduce((sum, x) => sum + Number(x.qty||0), 0);
  mergeSetV_("merge_total", total ? total.toFixed(2) : "");
  setMergeButtons_();
}

function setMergeButtons_(){
  const addBtn = document.getElementById("merge_add_btn");
  const postBtn = document.getElementById("merge_post_btn");
  const newId = String(document.getElementById("merge_new_lot_id")?.value || "").trim();
  const hasEnough = (mergeDraft || []).length >= 2;
  const readyMeta = !!mergePickedProduct && !!mergePickedUnit;
  if(addBtn){
    addBtn.disabled = mergePosting_;
    addBtn.title = mergePosting_ ? "過帳中…" : "新增來源 Lot";
  }
  if(postBtn){
    const canPost = !mergePosting_ && newId && hasEnough && readyMeta;
    postBtn.disabled = !canPost;
    postBtn.title =
      mergePosting_ ? "過帳中…" :
      (!newId ? "新 Lot ID 必填" :
      (!hasEnough ? "合批至少需要 2 個來源 Lot" :
      (!readyMeta ? "請先加入來源 Lot（以確定產品/單位）" :
      "確認合批（過帳）")));
  }
}

async function postMerge(triggerEl){
  const newLotId = (document.getElementById("merge_new_lot_id")?.value || "").trim().toUpperCase();
  document.getElementById("merge_new_lot_id").value = newLotId;
  const remark = (document.getElementById("merge_remark")?.value || "").trim();

  if(!newLotId) return showToast("新 Lot ID 必填","error");
  if(mergeDraft.length < 2) return showToast("合批至少需要 2 個來源 Lot","error");
  if(!mergePickedProduct || !mergePickedUnit) return showToast("合批產品/單位缺失","error");

  await loadMergeCaches();

  // check duplicate id
  const exists = mergeLots.some(l => l.lot_id === newLotId);
  if(exists) return showToast("新 Lot ID 已存在","error");

  // validate availability again
  for(const it of mergeDraft){
    const av = mergeGetAvailable(it.lot_id);
    if(it.qty > av) return showToast("取用超過可用量：" + it.lot_id, "error");
  }

  const refId = generateId("MERGE");
  const total = mergeDraft.reduce((sum, x) => sum + Number(x.qty||0), 0);

  showSaveHint(triggerEl || document.getElementById("mergePostButtonGroup"));
  mergePosting_ = true;
  setMergeButtons_();
  try {
  const firstSrcLot = (mergeLots || []).find(l => l.lot_id === (mergeDraft?.[0]?.lot_id || "")) || null;
  const whId = String(firstSrcLot?.warehouse_id || "MAIN").trim().toUpperCase() || "MAIN";

  // Phase 1（交易一致性）：合批改走後端 bundle，一次完成 lot/movement/relation，避免分段寫入造成不同步
  await callAPI({
    action: "post_merge_bundle",
    new_lot_id: newLotId,
    ref_id: refId,
    remark: remark || "",
    // 後端會再驗證可用量與一致性（產品/單位/倉別），前端只送最小資料
    lines_json: JSON.stringify((mergeDraft || []).map((it) => ({
      lot_id: it.lot_id,
      qty: String(it.qty)
    }))),
    idempotency_key: `MERGE:${newLotId}:${refId}`
  }, { method: "POST" });

  showToast("合批完成");
  await loadMergeCaches();
  resetMerge();
  } finally {
    hideSaveHint();
    mergePosting_ = false;
    setMergeButtons_();
  }
}

// =====================
// Merge Module (Multi-Source Manufacturing)
// =====================

// UX：使用者手動修改新 Lot ID 時，即時更新按鈕狀態（避免填了仍顯示 disabled）
try{
  document.addEventListener("input", function(e){
    const id = e && e.target ? String(e.target.id || "") : "";
    if(id === "merge_new_lot_id"){
      try{ setMergeButtons_(); }catch(_e){}
    }
  });
}catch(_eBind){}

function mergeInitLegacy_() {
    populateMergeLots();
    renderMergeHistory();
}

// =====================
// 填入可合批次
// =====================

window.populateMergeLots = function () {

    const container = document.getElementById("mergeLotsContainer");
    if (!container) return;

    container.innerHTML = "";

    window.DB.lots.forEach((l, index) => {

        if (l.status === "APPROVED" && l.available > 0) {

            const div = document.createElement("div");

            div.innerHTML = `
                <label>
                    <input type="checkbox" value="${index}">
                    ${l.lot_id} (可用:${l.available})
                </label>
            `;

            container.appendChild(div);
        }
    });
};

// =====================
// 執行合批
// =====================

window.createMerge = function () {

    const checkboxes = document.querySelectorAll("#mergeLotsContainer input:checked");

    if (checkboxes.length < 2) {
        alert("至少選擇兩個批次");
        return;
    }

    let totalQty = 0;
    let sourceLots = [];

    checkboxes.forEach(cb => {

        const lot = window.DB.lots[cb.value];

        totalQty += lot.available;
        sourceLots.push(lot.lot_id);

        lot.available = 0;
        lot.status = "CLOSED";
    });

    const newLotId = "MERGE-" + Date.now();

    window.DB.lots.push({
        lot_id: newLotId,
        product_id: null,
        product_name: "Merged Lot",
        type: "MERGED",
        total: totalQty,
        available: totalQty,
        status: "APPROVED",
        parent_lots: sourceLots
    });

    if (!window.DB.merges) window.DB.merges = [];

    window.DB.merges.push({
        sources: sourceLots,
        new_lot: newLotId,
        qty: totalQty,
        date: new Date().toLocaleString()
    });

    populateMergeLots();
    renderMergeHistory();
};

// =====================
// 顯示 Merge 歷史
// =====================

function renderMergeHistory() {

    const tbody = document.getElementById("mergeTableBody");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (!window.DB.merges) return;

    window.DB.merges.forEach(m => {

        const tr = document.createElement("tr");

        tr.innerHTML = `
            <td>${m.sources.join(", ")}</td>
            <td>${m.new_lot}</td>
            <td>${m.qty}</td>
            <td>${m.date}</td>
        `;

        tbody.appendChild(tr);
    });
}