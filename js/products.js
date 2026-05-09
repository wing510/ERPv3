let editingMode = false;
let productLoadInFlight_ = false;
let productPendingLoadId_ = "";

/* ===== 企業級設定 ===== */
const PRODUCT_RULES = {
  idRegex: /^[A-Z0-9_-]+$/,
  idMax: 30,
  nameMax: 100,
  specMax: 200,
  remarkMax: 500
};

/* ===== 排序狀態（給 applySorting 用） ===== */
let productSort = { field:"", asc:true };

// `showToast`、`bindUppercaseInput` 已移至 `js/core/utils.js`

function prodSetV_(id, v){
  try{
    if(typeof window.erpSetVById_ === "function") return window.erpSetVById_(id, v);
  }catch(_e){}
  const el = document.getElementById(String(id || ""));
  if(el && "value" in el) el.value = v;
}

function prodClear_(ids){
  try{
    if(typeof window.erpClearIds_ === "function") return window.erpClearIds_(ids);
  }catch(_e){}
  const list = Array.isArray(ids) ? ids : [ids];
  for(let i = 0; i < list.length; i++){
    const el = document.getElementById(String(list[i] || ""));
    if(el && "value" in el) el.value = "";
  }
}

/* ===== 初始化 ===== */
async function productsInit(){
  bindUppercaseInput("p_id");
  bindAutoSearchToolbar_([
    ["search_product_keyword", "input"],
    ["search_type", "change"],
    ["search_status", "change"]
  ], () => searchProducts());
  const baseUnitEl = document.getElementById("p_base_unit");
  if(baseUnitEl && !baseUnitEl.dataset.bound){
    baseUnitEl.dataset.bound = "1";
    baseUnitEl.addEventListener("change", refreshProductUnitRatioHints_);
  }
  const unitEl = document.getElementById("p_unit");
  if(unitEl && !unitEl.dataset.bound){
    unitEl.dataset.bound = "1";
    unitEl.addEventListener("change", function(){
      syncProductBaseUnitFromUnit_();
      refreshProductUnitRatioHints_();
    });
  }
  const detailsEl = document.getElementById("p_multi_unit_details");
  if(detailsEl && !detailsEl.dataset.bound){
    detailsEl.dataset.bound = "1";
    detailsEl.addEventListener("toggle", function(){
      applyProductMultiUnitMode_();
    });
  }
  applyProductMultiUnitMode_();
  ensureProductUnitRatioRows_();
  await renderProducts();
  clearForm();
  if(typeof bindStatusSelectLamp_ === "function") bindStatusSelectLamp_("p_status");
  if(typeof erpLockStatusSelect_ === "function") erpLockStatusSelect_("p_status");
}

function setProductButtons_(){
  const createBtn = document.getElementById("p_create_btn");
  const updateBtn = document.getElementById("p_update_btn");
  if(createBtn){
    createBtn.disabled = !!editingMode;
    createBtn.title = editingMode ? "已載入產品，請用更新" : "建立新產品";
  }
  if(updateBtn){
    updateBtn.disabled = !editingMode;
    updateBtn.title = editingMode ? "更新此產品" : "請先載入產品";
  }
}

function isProductMultiUnitEnabled_(){
  return !!document.getElementById("p_multi_unit_details")?.open;
}

function applyProductMultiUnitMode_(){
  const enabled = isProductMultiUnitEnabled_();
  if(!enabled){
    syncProductBaseUnitFromUnit_();
  }
  refreshProductUnitRatioHints_();
  syncProductUnitRatioJson_();
}

function syncProductBaseUnitFromUnit_(){
  if(isProductMultiUnitEnabled_()) return;
  const unit = normalizeUnit(document.getElementById("p_unit")?.value || "");
  const baseEl = document.getElementById("p_base_unit");
  if(baseEl) baseEl.value = unit;
}

function productUnitOptionsHtml_(){
  return `
    <option value="">回收單位</option>
    <option value="L">L（公升）</option>
    <option value="KG">KG（公斤）</option>
    <option value="PCS">PCS（件）</option>
    <option value="PC">PC（顆）</option>
    <option value="BOX">BOX（盒）</option>
    <option value="BOTTLE">BOTTLE（瓶）</option>
    <option value="BAG">BAG（袋）</option>
  `;
}

function syncProductUnitRatioJson_(){
  const host = document.getElementById("p_unit_ratio_rows");
  const hidden = document.getElementById("p_unit_ratio_to_base_json");
  if(!hidden) return;
  if(!host){
    hidden.value = "{}";
    return;
  }
  const rows = Array.from(host.querySelectorAll('[data-role="ratio-row"]'));
  const map = {};
  rows.forEach(row => {
    const unit = normalizeUnit(row.querySelector('[data-role="unit"]')?.value || "");
    const perBase = Number(row.querySelector('[data-role="per_base"]')?.value || 0);
    // 使用者輸入：1 基準單位可做出 perBase 單位
    // 內部儲存：1 單位 = ? 基準單位（rate）
    if(unit && perBase > 0) map[unit] = 1 / perBase;
  });
  hidden.value = JSON.stringify(map);
}

function refreshProductUnitRatioHints_(){
  const baseUnit = normalizeUnit(document.getElementById("p_base_unit")?.value || document.getElementById("p_unit")?.value || "");
  const host = document.getElementById("p_unit_ratio_rows");
  if(!host) return;
  Array.from(host.querySelectorAll('[data-role="ratio-row"]')).forEach(row => {
    const eqEl = row.querySelector('[data-role="eq_hint"]');
    const unit = normalizeUnit(row.querySelector('[data-role="unit"]')?.value || "");
    const perBase = Number(row.querySelector('[data-role="per_base"]')?.value || 0);
    if(eqEl){
      if(baseUnit && unit && perBase > 0){
        const rate = 1 / perBase;
        eqEl.textContent = "（對照：1 " + unit + " = " + rate.toFixed(6).replace(/\.?0+$/, "") + " " + baseUnit + "）";
      }else{
        eqEl.textContent = "";
      }
    }
  });
}

function addProductUnitRatioRow(unit="", rate=""){
  const host = document.getElementById("p_unit_ratio_rows");
  if(!host) return;
  const line = document.createElement("div");
  line.className = "p-unit-ratio-matrix-line";
  line.setAttribute("data-role", "ratio-row");
  line.innerHTML =
    '<div class="p-unit-ratio-matrix-line-main">' +
    '<span class="p-unit-ratio-matrix-row-arrow" aria-hidden="true">⇒</span>' +
    '<input data-role="per_base" type="number" min="0" step="0.000001">' +
    '<select data-role="unit">' + productUnitOptionsHtml_() + "</select>" +
    '<button type="button" class="btn-secondary" data-role="remove">刪除</button>' +
    "</div>" +
    '<span class="p-unit-ratio-matrix-line-hint" data-role="eq_hint"></span>';
  const unitSel = line.querySelector('[data-role="unit"]');
  const perBaseInput = line.querySelector('[data-role="per_base"]');
  const removeBtn = line.querySelector('[data-role="remove"]');
  if(unitSel) unitSel.value = normalizeUnit(unit || "");
  if(perBaseInput) perBaseInput.value = rate || "";
  if(unitSel && !unitSel.dataset.bound){
    unitSel.dataset.bound = "1";
    unitSel.addEventListener("change", function(){
      refreshProductUnitRatioHints_();
      syncProductUnitRatioJson_();
    });
  }
  if(perBaseInput && !perBaseInput.dataset.bound){
    perBaseInput.dataset.bound = "1";
    perBaseInput.addEventListener("input", function(){
      refreshProductUnitRatioHints_();
      syncProductUnitRatioJson_();
    });
  }
  if(removeBtn){
    removeBtn.addEventListener("click", function(){
      line.remove();
      ensureProductUnitRatioRows_();
      syncProductUnitRatioJson_();
    });
  }
  host.appendChild(line);
  refreshProductUnitRatioHints_();
  syncProductUnitRatioJson_();
}

function ensureProductUnitRatioRows_(){
  const host = document.getElementById("p_unit_ratio_rows");
  if(!host) return;
  if(host.querySelectorAll('[data-role="ratio-row"]').length === 0){
    addProductUnitRatioRow();
    return;
  }
  refreshProductUnitRatioHints_();
  syncProductUnitRatioJson_();
}

function setProductUnitRatioRowsFromMap_(map){
  const host = document.getElementById("p_unit_ratio_rows");
  if(!host) return;
  host.innerHTML = "";
  const obj = map && typeof map === "object" ? map : {};
  const keys = Object.keys(obj);
  if(keys.length === 0){
    addProductUnitRatioRow();
    return;
  }
  keys.forEach(k => {
    const rate = Number(obj[k] || 0);
    const perBase = rate > 0 ? (1 / rate) : "";
    addProductUnitRatioRow(k, perBase);
  });
  refreshProductUnitRatioHints_();
  syncProductUnitRatioJson_();
}

/* ===== 建立 ===== */
async function createProduct(triggerEl){

  const id = p_id.value.trim().toUpperCase();
  p_id.value = id;
  const name = p_name.value.trim();
  const spec = p_spec.value.trim();
  const remark = p_remark.value.trim();
  const type = p_type.value;
  const unit = String(p_unit.value || "").trim().toUpperCase();
  const baseUnit = normalizeUnit(document.getElementById("p_base_unit")?.value || p_unit.value || "");
  syncProductUnitRatioJson_();
  const ratioRaw = (document.getElementById("p_unit_ratio_to_base_json")?.value || "").trim();
  const ratioMap = parseUnitRatioToBaseMap(ratioRaw || "{}");
  const multiUnitEnabled = isProductMultiUnitEnabled_();
  const saveRemark = stripProductUomRemark(remark);
  const uom_config =
    multiUnitEnabled && baseUnit && ratioMap !== null
      ? JSON.stringify({ base_unit: baseUnit, map: ratioMap || {} })
      : "";

  // 主檔一致化：ID 多為自動產生，缺漏時仍提示；但一般必填以「名稱/單位/類型」為主
  if(!name) return showToast("缺少必填：產品名稱","error");
  if(!unit) return showToast("缺少必填：單位","error");
  if(!id) return showToast("缺少必填：產品ID","error");

  if(id.length > PRODUCT_RULES.idMax)
    return showToast("ID 長度過長","error");

  if(!PRODUCT_RULES.idRegex.test(id))
    return showToast("ID 只能使用 A-Z 0-9 _ -","error");

  if(name.length > PRODUCT_RULES.nameMax)
    return showToast("名稱長度過長","error");

  if(spec.length > PRODUCT_RULES.specMax)
    return showToast("規格過長","error");

  if(remark.length > PRODUCT_RULES.remarkMax)
    return showToast("備註過長","error");

  // 產品類型必填，且僅限 RM / WIP / FG
  if(!type)
    return showToast("缺少必填：產品類型（RM／WIP／FG）","error");

  if(!["RM","WIP","FG"].includes(type))
    return showToast("產品類型只能是 RM（原料）／WIP（半成品）／FG（成品）","error");

  if(ratioMap === null)
    return showToast("單位轉基準倍率(JSON) 格式錯誤","error");

  showSaveHint(triggerEl);
  try {
  const list = await getAll("product");

  if(list.some(p => p.product_id === id))
    return showToast("產品ID 已存在","error");

  const product = {
    product_id: id,
    product_name: name,
    type,
    spec,
    unit,
    uom_config,
    remark: saveRemark,
    status: p_status.value,
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    updated_by: "",
    updated_at: ""
  };

  await createRecord("product", product);

  await renderProducts();
  clearForm();

  showToast("產品建立成功");
  } finally { hideSaveHint(); }
  setProductButtons_();
}

/* ===== 更新 ===== */
async function updateProduct(triggerEl){

  if(!editingMode)
    return showToast("請先選擇產品","error");

  showSaveHint(triggerEl);
  try {
  const id = p_id.value.trim();
  const product = await getOne("product", "product_id", id);

  if(!product)
    return showToast("找不到產品","error");

  const newStatus = p_status.value;
  // 狀態（ACTIVE/INACTIVE）僅 CEO/GA/ADMIN 可改（主檔）
  if(String(product.status||"") !== String(newStatus||"")){
    if(typeof erpCanChangeMasterStatus_ === "function" && !erpCanChangeMasterStatus_()){
      return showToast("僅 CEO／GA／ADMIN 可修改產品狀態（ACTIVE/INACTIVE）。", "error");
    }
  }

  // 停用策略：允許停用，但若已被使用則提醒確認（不再硬性阻擋）
  if(product.status === "ACTIVE" && newStatus === "INACTIVE"){
    const isUsed = await isIdUsedInAny(id, [
      { type:"lot", field:"product_id" },
      { type:"inventory_movement", field:"product_id" },
      { type:"purchase_order_item", field:"product_id" },
      { type:"import_item", field:"product_id" },
      { type:"process_order_input", field:"product_id" },
      { type:"process_order_output", field:"product_id" },
      { type:"sales_order_item", field:"product_id" },
      { type:"shipment_item", field:"product_id" }
    ]);

    if(isUsed){
      const ok = window.erpConfirmActionKey_("confirm.master.deactivate.used", {
        name: "此產品",
        usedHint: "可能已有批次/異動/加工/出貨紀錄",
        fallback: "此產品已被使用（可能已有批次/異動/加工/出貨紀錄）。\n\n仍要停用嗎？停用後將不能在新單據被選用，但歷史紀錄會保留。"
      });
      if(!ok) return;
    }
  }

  const oldData = {...product};

  const newData = {
    product_name: p_name.value.trim(),
    type: p_type.value,
    spec: p_spec.value.trim(),
    unit: String(p_unit.value || "").trim().toUpperCase(),
    remark: "",
    uom_config: "",
    status: newStatus,
    updated_by: getCurrentUser(),
    updated_at: nowIso16()
  };
  // 主檔一致化：更新也做必填/長度檢核（避免更新成空值或超長）
  if(!newData.product_name)
    return showToast("缺少必填：產品名稱","error");
  if(!newData.unit)
    return showToast("缺少必填：單位","error");
  if(!newData.type)
    return showToast("缺少必填：產品類型（RM／WIP／FG）","error");
  if(newData.product_name.length > PRODUCT_RULES.nameMax)
    return showToast("名稱長度過長","error");
  if(newData.spec.length > PRODUCT_RULES.specMax)
    return showToast("規格過長","error");
  syncProductUnitRatioJson_();
  const ratioRaw = (document.getElementById("p_unit_ratio_to_base_json")?.value || "").trim();
  const ratioMap = parseUnitRatioToBaseMap(ratioRaw || "{}");
  const multiUnitEnabled = isProductMultiUnitEnabled_();
  if(ratioMap === null){
    return showToast("單位轉基準倍率(JSON) 格式錯誤","error");
  }
  const baseUnit = normalizeUnit(document.getElementById("p_base_unit")?.value || p_unit.value || "");
  const remark = p_remark.value.trim();
  newData.remark = stripProductUomRemark(remark);
  newData.uom_config =
    multiUnitEnabled && baseUnit && ratioMap !== null
      ? JSON.stringify({ base_unit: baseUnit, map: ratioMap || {} })
      : "";

  await updateRecord("product", "product_id", id, newData);

  await renderProducts();
  clearForm();

  showToast("產品更新成功");
  } finally { hideSaveHint(); }
  setProductButtons_();
}

/* ===== 清除表單 ===== */
function clearForm(){
  editingMode = false;
  p_id.disabled = false;

  prodClear_(["p_id","p_name","p_spec","p_remark","p_base_unit"]);
  const detailsEl = document.getElementById("p_multi_unit_details");
  if(detailsEl) detailsEl.open = false;
  setProductUnitRatioRowsFromMap_({});
  applyProductMultiUnitMode_();

  p_status.value = "ACTIVE";
  prodClear_(["p_type","p_unit"]);
  erpInitAutoId_("p_id", "master", "P");
  if(typeof syncStatusSelectLamp_ === "function") syncStatusSelectLamp_("p_status");
  if(typeof erpLockStatusSelect_ === "function") erpLockStatusSelect_("p_status");
  setProductButtons_();
}

function productSnapshotFromForm_(){
  try{
    const baseUnitEl = document.getElementById("p_base_unit");
    const ratioRaw = (document.getElementById("p_unit_ratio_to_base_json")?.value || "").trim();
    const detailsEl = document.getElementById("p_multi_unit_details");
    const v = (id) => (typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_(id) : String(document.getElementById(id)?.value || "").trim();
    const vU = (id) => (typeof window.erpVTrimUpperById_ === "function") ? window.erpVTrimUpperById_(id) : String(document.getElementById(id)?.value || "").trim().toUpperCase();
    return JSON.stringify({
      product_id: vU("p_id"),
      product_name: v("p_name"),
      type: v("p_type"),
      spec: v("p_spec"),
      unit: v("p_unit"),
      base_unit: String(baseUnitEl?.value || "").trim(),
      ratio_json: ratioRaw,
      details_open: !!(detailsEl && detailsEl.open),
      status: v("p_status"),
      remark: v("p_remark")
    });
  }catch(_e){
    return "";
  }
}

/* ===== 載入產品 ===== */
async function loadProduct(id){
  const nextId = String(id || "").trim();
  if(!nextId) return;
  if(productLoadInFlight_){
    productPendingLoadId_ = nextId;
    showToast(`載入中：已排隊 ${nextId}（完成後自動載入）`, "warn", 6000);
    return;
  }
  try{
    const curId = String(p_id?.value || "").trim();
    const ok = (typeof window.erpGuardMasterLoad_ === "function")
      ? window.erpGuardMasterLoad_({
        nextId,
        curId,
        key: "product",
        isEditing: !!editingMode,
        getCurrentSnapshot: () => productSnapshotFromForm_(),
        getLoadedSnapshot: () => (window.erpDirty_ ? window.erpDirty_.getLoaded("product") : ""),
        normalizeId: window.erpNormalizeIdUpper_
      })
      : true;
    if(!ok) return;
  }catch(_e0){}
  productLoadInFlight_ = true;
  try{
    if(typeof scrollToEditorTop === "function") scrollToEditorTop();
    const p = await getOne("product","product_id",nextId);
    if(!p) return;

    editingMode = true;

    p_id.value = p.product_id;
    p_name.value = p.product_name;
    p_type.value = p.type;
    p_spec.value = p.spec;
    p_unit.value = p.unit;
    const baseUnitEl = document.getElementById("p_base_unit");
    const cfg = typeof getProductUomConfig === "function" ? getProductUomConfig(p) : parseProductUomConfigFromRemark_(p.remark);
    if(baseUnitEl) baseUnitEl.value = (cfg?.base_unit || p.unit || "");
    const parsed = cfg?.map || {};
    const detailsEl = document.getElementById("p_multi_unit_details");
    if(detailsEl) detailsEl.open = !!(parsed && Object.keys(parsed).length);
    applyProductMultiUnitMode_();
    setProductUnitRatioRowsFromMap_(parsed && typeof parsed === "object" ? parsed : {});
    p_remark.value = stripProductUomRemark(p.remark);
    p_status.value = p.status;
    if(typeof syncStatusSelectLamp_ === "function") syncStatusSelectLamp_("p_status");
    if(typeof erpLockStatusSelect_ === "function") erpLockStatusSelect_("p_status");

    p_id.disabled = true;
    if(typeof scrollToEditorTop === "function") scrollToEditorTop();
    try{
      if(window.erpDirty_){
        window.erpDirty_.bind("product", productSnapshotFromForm_);
        window.erpDirty_.markSaved("product");
      }
    }catch(_eS){}
    setProductButtons_();
  } finally {
    productLoadInFlight_ = false;
    try{
      const next = String(productPendingLoadId_ || "").trim();
      productPendingLoadId_ = "";
      if(next && next !== nextId){
        setTimeout(function(){ try{ loadProduct(next); }catch(_e){} }, 0);
      }
    }catch(_eNext){}
  }
}

/* ===== 搜尋 ===== */
async function searchProducts(){
  setTbodyLoading_("productTableBody", 7);

  const kw = (document.getElementById("search_product_keyword")?.value || "").trim().toLowerCase();
  const type = document.getElementById("search_type")?.value || "";
  const status = document.getElementById("search_status")?.value || "";

  const list = await getAll("product");

  const result = list.filter(p => {
    const matchKw = !kw ||
      p.product_id.toLowerCase().includes(kw) ||
      p.product_name.toLowerCase().includes(kw) ||
      String(p.spec || "").toLowerCase().includes(kw) ||
      String(p.remark || "").toLowerCase().includes(kw);
    return matchKw && (!type || p.type === type) && (!status || p.status === status);
  });

  renderProducts(result);
}

/* ===== 重設搜尋 ===== */
async function resetSearch(){
  prodClear_(["search_product_keyword","search_type","search_status"]);

  await renderProducts();
}

/* ===== 排序 ===== */
async function sortProducts(field){
  setTbodyLoading_("productTableBody", 7);
  const list = await getAll("product");
  const sorted = applySorting(list, field, productSort);
  renderProducts(sorted);
}

/* ===== Render ===== */
async function renderProducts(list=null){

  const tbody=document.getElementById("productTableBody");
  if(!tbody) return;

  if(!list){
    setTbodyLoading_(tbody, 7);
    list = await getAll("product");
  }

  tbody.innerHTML="";
  if(!list.length){
    tbody.innerHTML='<tr><td colspan="7" style="text-align:center;color:#64748b;padding:24px;">尚無產品。請在上方表單填寫後按「建立」新增第一筆產品。</td></tr>';
    return;
  }
  list.forEach(p=>{

    const badge = termStatusLampHtml(p.status);

    tbody.innerHTML+=`
      <tr>
        <td>${p.product_id}</td>
        <td>${p.product_name}</td>
        <td>${p.spec||""}</td>
        <td>${p.unit}</td>
        <td>${p.type}</td>
        <td class="col-status">${badge}</td>
        <td>
          <button class="btn-edit" onclick="loadProduct('${p.product_id}')">Load</button>
        </td>
      </tr>
    `;
  });
}