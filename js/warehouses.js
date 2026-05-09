/**
 * Warehouses（API 版）
 */

let whEditing = false;
let whLoadedStatus_ = "";
let whLoadInFlight_ = false;
let whPendingLoadId_ = "";

function whSetV_(id, v){
  try{
    if(typeof window.erpSetVById_ === "function") return window.erpSetVById_(id, v);
  }catch(_e){}
  const el = document.getElementById(String(id || ""));
  if(el && "value" in el) el.value = v;
}

function whClear_(ids){
  try{
    if(typeof window.erpClearIds_ === "function") return window.erpClearIds_(ids);
  }catch(_e){}
  const list = Array.isArray(ids) ? ids : [ids];
  for(let i = 0; i < list.length; i++){
    const el = document.getElementById(String(list[i] || ""));
    if(el && "value" in el) el.value = "";
  }
}

const WAREHOUSE_RULES = {
  idRegex: /^[A-Z0-9_-]+$/,
  idMax: 30
};

async function warehousesInit(){
  bindUppercaseInput("wh_id");
  clearWarehouseForm();
  bindAutoSearchToolbar_([
    ["search_wh_keyword", "input"],
    ["search_wh_category", "change"],
    ["search_wh_status", "change"]
  ], () => searchWarehouses());
  await renderWarehouses();
  if(typeof bindStatusSelectLamp_ === "function") bindStatusSelectLamp_("wh_status");
  if(typeof erpLockStatusSelect_ === "function") erpLockStatusSelect_("wh_status");
}

function setWarehouseButtons_(){
  const createBtn = document.getElementById("wh_create_btn");
  const updateBtn = document.getElementById("wh_update_btn");
  if(createBtn){
    createBtn.disabled = !!whEditing;
    createBtn.title = whEditing ? "已載入倉庫，請用更新" : "建立新倉庫";
  }
  if(updateBtn){
    updateBtn.disabled = !whEditing;
    updateBtn.title = whEditing ? "更新此倉庫" : "請先載入倉庫";
  }
}

function clearWarehouseForm(){
  whEditing = false;
  whLoadedStatus_ = "";
  try{ if(window.erpDirty_) window.erpDirty_.setLoaded("warehouse", ""); }catch(_eDirty){}
  const idEl = document.getElementById("wh_id");
  if(idEl){ erpInitAutoId_("wh_id", "master", "WH"); idEl.disabled = false; }
  whClear_(["wh_name","wh_category","wh_address","wh_remark"]);
  const stEl = document.getElementById("wh_status");
  if(stEl) stEl.value = "ACTIVE";
  if(typeof syncStatusSelectLamp_ === "function") syncStatusSelectLamp_("wh_status");
  if(typeof erpLockStatusSelect_ === "function") erpLockStatusSelect_("wh_status");
  setWarehouseButtons_();
}

async function createWarehouse(triggerEl){
  const idEl = document.getElementById("wh_id");
  let warehouse_id = (idEl?.value || "").trim().toUpperCase();
  // ID 預設自動產生：若被清空，直接補回，不用跳「缺少必填：ID」
  if(!warehouse_id){
    warehouse_id = erpInitAutoId_("wh_id", "master", "WH");
  }else{
    if(idEl) idEl.value = warehouse_id;
  }
  const warehouse_name = (document.getElementById("wh_name")?.value || "").trim();
  const category = (document.getElementById("wh_category")?.value || "").trim().toUpperCase();
  const address = (document.getElementById("wh_address")?.value || "").trim();
  const status = document.getElementById("wh_status")?.value || "ACTIVE";
  const remark = (document.getElementById("wh_remark")?.value || "").trim();

  // 主檔一致化：ID 多為自動產生，缺漏時仍提示；但一般必填以「名稱/類別」為主
  if(!warehouse_name) return showToast("缺少必填：倉庫名稱", "error");
  if(!category) return showToast("請選擇類別", "error");
  if(!warehouse_id) return showToast("倉庫ID 產生失敗，請重新整理後再試", "error");
  if(warehouse_id.length > WAREHOUSE_RULES.idMax) return showToast("倉庫ID 長度過長", "error");
  if(!WAREHOUSE_RULES.idRegex.test(warehouse_id)) return showToast("倉庫ID 只能使用 A-Z 0-9 _ -", "error");

  showSaveHint(triggerEl);
  try{
    const exists = await getOne("warehouse","warehouse_id",warehouse_id).catch(()=>null);
    if(exists) return showToast("倉庫ID 已存在", "error");
    try{
      await createRecord("warehouse", {
        warehouse_id,
        warehouse_name,
        category,
        address,
        status,
        remark,
        created_by: getCurrentUser(),
        created_at: nowIso16(),
        updated_by: "",
        updated_at: ""
      });
    }catch(err){
      // callAPI 會自己 toast（含 Permission denied）；這裡避免未捕捉 Promise 造成 Console 紅字
      return;
    }
    showToast("倉庫建立成功");
    clearWarehouseForm();
    await renderWarehouses();
  }finally{
    hideSaveHint();
  }
  setWarehouseButtons_();
}

function warehouseSnapshotFromForm_(){
  try{
    const curId = (typeof window.erpVTrimUpperById_ === "function")
      ? window.erpVTrimUpperById_("wh_id")
      : String(document.getElementById("wh_id")?.value || "").trim().toUpperCase();
    return JSON.stringify({
      warehouse_id: curId,
      warehouse_name: (typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_("wh_name") : String(document.getElementById("wh_name")?.value || "").trim(),
      category: (typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_("wh_category") : String(document.getElementById("wh_category")?.value || "").trim(),
      address: (typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_("wh_address") : String(document.getElementById("wh_address")?.value || "").trim(),
      status: (typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_("wh_status") : String(document.getElementById("wh_status")?.value || "").trim(),
      remark: (typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_("wh_remark") : String(document.getElementById("wh_remark")?.value || "").trim()
    });
  }catch(_e){
    return "";
  }
}

async function loadWarehouse(id){
  const nextId = String(id || "").trim();
  if(!nextId) return;
  if(whLoadInFlight_){
    whPendingLoadId_ = nextId;
    showToast(`載入中：已排隊 ${nextId}（完成後自動載入）`, "warn", 6000);
    return;
  }
  try{
    const curId = String(document.getElementById("wh_id")?.value || "").trim();
    const ok = (typeof window.erpGuardMasterLoad_ === "function")
      ? window.erpGuardMasterLoad_({
        nextId,
        curId,
        key: "warehouse",
        isEditing: !!whEditing,
        getCurrentSnapshot: () => warehouseSnapshotFromForm_(),
        getLoadedSnapshot: () => (window.erpDirty_ ? window.erpDirty_.getLoaded("warehouse") : ""),
        normalizeId: window.erpNormalizeIdUpper_
      })
      : true;
    if(!ok) return;
  }catch(_e0){}
  whLoadInFlight_ = true;
  try{
    const row = await getOne("warehouse","warehouse_id",nextId).catch(()=>null);
    if(!row) return;
    whEditing = true;
    whLoadedStatus_ = String(row.status || "ACTIVE");
    const idEl = document.getElementById("wh_id");
    if(idEl){ idEl.value = row.warehouse_id || nextId; idEl.disabled = true; }
    const nameEl = document.getElementById("wh_name");
    if(nameEl) nameEl.value = row.warehouse_name || "";
    const catEl = document.getElementById("wh_category");
    if(catEl) catEl.value = (row.category || "AMBIENT");
    const stEl = document.getElementById("wh_status");
    if(stEl) stEl.value = row.status || "ACTIVE";
    if(typeof syncStatusSelectLamp_ === "function") syncStatusSelectLamp_("wh_status");
    if(typeof erpLockStatusSelect_ === "function") erpLockStatusSelect_("wh_status");
    const addrEl = document.getElementById("wh_address");
    if(addrEl) addrEl.value = row.address || "";
    const rmEl = document.getElementById("wh_remark");
    if(rmEl) rmEl.value = row.remark || "";
    if(typeof scrollToEditorTop === "function") scrollToEditorTop();
    try{
      if(window.erpDirty_){
        window.erpDirty_.bind("warehouse", warehouseSnapshotFromForm_);
        window.erpDirty_.markSaved("warehouse");
      }
    }catch(_eS){}
    setWarehouseButtons_();
  } finally {
    whLoadInFlight_ = false;
    try{
      const next = String(whPendingLoadId_ || "").trim();
      whPendingLoadId_ = "";
      if(next && next !== nextId){
        setTimeout(function(){ try{ loadWarehouse(next); }catch(_e){} }, 0);
      }
    }catch(_eNext){}
  }
}

async function updateWarehouse(triggerEl){
  if(!whEditing) return showToast("請先載入倉庫再更新", "error");
  const warehouse_id = (document.getElementById("wh_id")?.value || "").trim().toUpperCase();
  const warehouse_name = (document.getElementById("wh_name")?.value || "").trim();
  const category = (document.getElementById("wh_category")?.value || "").trim().toUpperCase();
  const address = (document.getElementById("wh_address")?.value || "").trim();
  const status = document.getElementById("wh_status")?.value || "ACTIVE";
  const remark = (document.getElementById("wh_remark")?.value || "").trim();
  if(!warehouse_id) return showToast("缺少必填：倉庫ID", "error");
  if(!warehouse_name) return showToast("缺少必填：倉庫名稱", "error");
  if(!category) return showToast("請選擇類別", "error");
  if(warehouse_id.length > WAREHOUSE_RULES.idMax) return showToast("倉庫ID 長度過長", "error");
  if(!WAREHOUSE_RULES.idRegex.test(warehouse_id)) return showToast("倉庫ID 只能使用 A-Z 0-9 _ -", "error");

  // 狀態（ACTIVE/INACTIVE）僅 CEO/GA/ADMIN 可改（主檔）
  if(String(whLoadedStatus_||"") !== String(status||"")){
    if(typeof erpCanChangeMasterStatus_ === "function" && !erpCanChangeMasterStatus_()){
      return showToast("僅 CEO／GA／ADMIN 可修改倉庫狀態（ACTIVE/INACTIVE）。", "error");
    }
  }

  // 停用策略：允許停用，但若已被使用則提醒確認（不再硬性阻擋）
  if(String(whLoadedStatus_||"") === "ACTIVE" && String(status||"") === "INACTIVE"){
    const isUsed = await isIdUsedInAny(warehouse_id, [
      { type:"lot", field:"warehouse_id" },
      { type:"inventory_movement", field:"warehouse_id" },
      { type:"goods_receipt", field:"warehouse" },
      { type:"import_receipt", field:"warehouse" }
    ]);
    if(isUsed){
      const ok = window.erpConfirmActionKey_("confirm.master.deactivate.used", {
        name: "此倉庫",
        usedHint: "可能已有批次/異動/收貨紀錄",
        fallback: "此倉庫已被使用（可能已有批次/異動/收貨紀錄）。\n\n仍要停用嗎？停用後將不能在新單據被選用，但歷史紀錄會保留。"
      });
      if(!ok) return;
    }
  }

  showSaveHint(triggerEl);
  try{
    try{
      await updateRecord("warehouse","warehouse_id",warehouse_id,{
        warehouse_name,
        category,
        address,
        status,
        remark,
        updated_by: getCurrentUser(),
        updated_at: nowIso16()
      });
    }catch(err){
      // callAPI 會自己 toast（含 Permission denied）；這裡避免未捕捉 Promise 造成 Console 紅字
      return;
    }
    whLoadedStatus_ = String(status || "");
    showToast("倉庫更新成功");
    await renderWarehouses();
  }finally{
    hideSaveHint();
  }
  setWarehouseButtons_();
}

async function renderWarehouses(list=null){
  const tbody = document.getElementById("whTableBody");
  if(!tbody) return;
  let rows = list;
  if(rows == null){
    setTbodyLoading_(tbody, 4);
    rows = await getAll("warehouse").catch(()=>[]);
  }
  const sorted = [...(rows || [])].sort((a,b)=>String(b.updated_at||"").localeCompare(String(a.updated_at||"")));
  tbody.innerHTML = "";
  if(sorted.length === 0){
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:24px;">尚無倉庫。請先在上方建立倉庫（例如 MAIN）。</td></tr>';
    return;
  }
  sorted.forEach(w=>{
    const catLabel = (typeof termShortZh_ === "function" ? termShortZh_(w.category) : (termLabel(w.category) || w.category || ""));
    const badge = termStatusLampHtml(w.status);
    tbody.innerHTML += `
      <tr>
        <td>${w.warehouse_id || ""}</td>
        <td>${w.warehouse_name || ""}</td>
        <td>${catLabel || (w.category || "")}</td>
        <td class="col-status">${badge}</td>
        <td><button class="btn-edit" onclick="loadWarehouse('${String(w.warehouse_id||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'")}')">Load</button></td>
      </tr>
    `;
  });
}

async function searchWarehouses(){
  setTbodyLoading_("whTableBody", 4);
  const kw = (document.getElementById("search_wh_keyword")?.value || "").trim().toLowerCase();
  const cat = (document.getElementById("search_wh_category")?.value || "").trim().toUpperCase();
  const status = (document.getElementById("search_wh_status")?.value || "").trim().toUpperCase();
  const list = await getAll("warehouse").catch(()=>[]);
  const result = (list || []).filter(w=>{
    if(cat && String(w.category||"").trim().toUpperCase() !== cat) return false;
    const stOk = !status || String(w.status||"").toUpperCase() === status;
    if(!stOk) return false;
    if(!kw) return true;
    return String(w.warehouse_id||"").toLowerCase().includes(kw) ||
      String(w.warehouse_name||"").toLowerCase().includes(kw) ||
      String(w.remark||"").toLowerCase().includes(kw);
  });
  renderWarehouses(result);
}

async function resetWarehouseSearch(){
  whClear_(["search_wh_keyword","search_wh_category","search_wh_status"]);
  await renderWarehouses();
}

