let supplierEditing = false;
let supplierLoadInFlight_ = false;
let supplierPendingLoadId_ = "";

function supSetV_(id, v){
  try{
    if(typeof window.erpSetVById_ === "function") return window.erpSetVById_(id, v);
  }catch(_e){}
  const el = document.getElementById(String(id || ""));
  if(el && "value" in el) el.value = v;
}

function supClear_(ids){
  try{
    if(typeof window.erpClearIds_ === "function") return window.erpClearIds_(ids);
  }catch(_e){}
  const list = Array.isArray(ids) ? ids : [ids];
  for(let i = 0; i < list.length; i++){
    const el = document.getElementById(String(list[i] || ""));
    if(el && "value" in el) el.value = "";
  }
}

/* ===== 企業級設定 ===== */
const SUPPLIER_RULES = {
  idRegex: /^[A-Z0-9_-]+$/,
  idMax: 30
};

/* ===== 類型/流程：逗號分隔存取 ===== */
function supplierCsvFromGroup_(groupId){
  const g = document.getElementById(groupId);
  if(!g) return "";
  const vals = Array.from(g.querySelectorAll('input[type="checkbox"]'))
    .filter(x => x && x.checked)
    .map(x => String(x.value || "").trim().toUpperCase())
    .filter(Boolean);
  // 去重 + 穩定排序（依出現順序）
  const uniq = [];
  vals.forEach(v => { if(!uniq.includes(v)) uniq.push(v); });
  return uniq.join(",");
}

function supplierGroupFromCsv_(groupId, csv){
  const g = document.getElementById(groupId);
  if(!g) return;
  const set = String(csv || "")
    .split(",")
    .map(x => String(x || "").trim().toUpperCase())
    .filter(Boolean);
  Array.from(g.querySelectorAll('input[type="checkbox"]')).forEach(cb=>{
    const v = String(cb.value || "").trim().toUpperCase();
    cb.checked = set.includes(v);
  });
}

function supplierTypeLabelZh_(code){
  const c = String(code || "").trim().toUpperCase();
  if(c === "RM") return "原料";
  if(c === "PK") return "包材";
  if(c === "WIP") return "半成品";
  if(c === "FG") return "成品";
  if(c === "PROC") return "加工廠";
  if(c === "LOG") return "物流/倉儲";
  if(c === "OTHER") return "其他";
  return c || "";
}

function supplierFlowLabelZh_(code){
  const c = String(code || "").trim().toUpperCase();
  if(c === "PO") return "採購";
  if(c === "IMPORT") return "進口";
  if(c === "OUTSOURCE") return "委外加工";
  return c || "";
}

function supplierCsvToZh_(csv, mapper){
  const arr = String(csv || "")
    .split(",")
    .map(x => String(x || "").trim().toUpperCase())
    .filter(Boolean);
  if(!arr.length) return "";
  return arr.map(x => (typeof mapper === "function" ? mapper(x) : x)).filter(Boolean).join("、");
}

/* ===== 下拉式多選（點開勾選） ===== */
function supplierMsUpdateText_(groupId, textId, mapper, placeholder){
  const g = document.getElementById(groupId);
  const t = document.getElementById(textId);
  if(!g || !t) return;
  const csv = supplierCsvFromGroup_(groupId);
  const zh = supplierCsvToZh_(csv, mapper);
  t.textContent = zh || (placeholder || "請選擇");
  t.title = zh || "";
}

function supplierBindMultiSelect_(rootMsName, groupId, btnId, textId, mapper, placeholder){
  const root = document.querySelector(`.erp-multiselect[data-ms="${rootMsName}"]`);
  const btn = document.getElementById(btnId);
  const panel = document.getElementById(groupId);
  if(!root || !btn || !panel) return;

  // toggle
  btn.addEventListener("click", function(e){
    e.preventDefault();
    e.stopPropagation();
    const open = root.classList.contains("is-open");
    document.querySelectorAll(".erp-multiselect.is-open").forEach(x=>{
      x.classList.remove("is-open");
      const b = x.querySelector(".erp-multiselect-btn");
      if(b) b.setAttribute("aria-expanded", "false");
    });
    if(!open){
      root.classList.add("is-open");
      btn.setAttribute("aria-expanded", "true");
    }
  });

  // update text on change
  panel.addEventListener("change", function(){
    supplierMsUpdateText_(groupId, textId, mapper, placeholder);
  });

  // close when clicking inside panel but not on checkbox/label
  panel.addEventListener("click", function(e){
    e.stopPropagation();
  });

  // init
  supplierMsUpdateText_(groupId, textId, mapper, placeholder);
}

function supplierBindMultiSelectGlobalClose_(){
  if(document.body && document.body.dataset && document.body.dataset.supplierMsBound) return;
  if(document.body && document.body.dataset) document.body.dataset.supplierMsBound = "1";
  document.addEventListener("click", function(){
    document.querySelectorAll(".erp-multiselect.is-open").forEach(x=>{
      x.classList.remove("is-open");
      const b = x.querySelector(".erp-multiselect-btn");
      if(b) b.setAttribute("aria-expanded", "false");
    });
  });
  document.addEventListener("keydown", function(e){
    if(e.key === "Escape"){
      document.querySelectorAll(".erp-multiselect.is-open").forEach(x=>{
        x.classList.remove("is-open");
        const b = x.querySelector(".erp-multiselect-btn");
        if(b) b.setAttribute("aria-expanded", "false");
      });
    }
  });
}

// `bindUppercaseInput` 已移至 `js/core/utils.js`

/* ===== 初始化 ===== */
async function suppliersInit(){
  bindUppercaseInput("s_id");
  supplierBindMultiSelectGlobalClose_();
  supplierBindMultiSelect_("s_type", "s_type_group", "s_type_btn", "s_type_text", supplierTypeLabelZh_, "請選擇");
  supplierBindMultiSelect_("s_flow", "s_flow_group", "s_flow_btn", "s_flow_text", supplierFlowLabelZh_, "請選擇");
  bindAutoSearchToolbar_([
    ["search_supplier_keyword", "input"],
    ["search_supplier_status", "change"]
  ], () => searchSuppliers());
  await renderSuppliers();
  clearSupplierForm();
  if(typeof bindStatusSelectLamp_ === "function") bindStatusSelectLamp_("s_status");
  if(typeof erpLockStatusSelect_ === "function") erpLockStatusSelect_("s_status");
}

function setSupplierButtons_(){
  const createBtn = document.getElementById("s_create_btn");
  const updateBtn = document.getElementById("s_update_btn");
  if(createBtn){
    createBtn.disabled = !!supplierEditing;
    createBtn.title = supplierEditing ? "已載入供應商，請用更新" : "建立新供應商";
  }
  if(updateBtn){
    updateBtn.disabled = !supplierEditing;
    updateBtn.title = supplierEditing ? "更新此供應商" : "請先載入供應商";
  }
}

/* ===== 建立 ===== */
async function createSupplier(triggerEl){

  let supplier_id = s_id.value.trim().toUpperCase();
  // ID 預設自動產生：若被清空，直接補回，不用跳「缺少必填：ID」
  if(!supplier_id){
    supplier_id = erpInitAutoId_("s_id", "master", "S");
  }else{
    s_id.value = supplier_id;
  }
  const supplier_name = s_name.value.trim();
  const country = s_country.value.trim();
  const supplier_type = supplierCsvFromGroup_("s_type_group");
  const supplier_flow = supplierCsvFromGroup_("s_flow_group");
  const remark = s_remark.value.trim();

  // 主檔一致化：ID 多為自動產生，缺漏時仍提示；但一般必填以「名稱/類型/流程」為主
  if(!supplier_name) return showToast("缺少必填：供應商名稱","error");
  if(!supplier_type)
    return showToast("缺少必填：供應商類型","error");
  if(!supplier_flow)
    return showToast("缺少必填：可用流程","error");
  if(!supplier_id) return showToast("供應商ID 產生失敗，請重新整理後再試","error");
  if((country === "其他" || String(supplier_type || "").split(",").map(x=>x.trim().toUpperCase()).includes("OTHER")) && !remark)
    return showToast("國家/供應商類型 選「其他」時，請填寫備註/原因","error");

  if(supplier_id.length > SUPPLIER_RULES.idMax)
    return showToast("ID 長度過長（最多 30 字元）","error");

  if(!SUPPLIER_RULES.idRegex.test(supplier_id))
    return showToast("ID 只能使用 A-Z 0-9 _ -","error");

  showSaveHint(triggerEl);
  try {
  const list = await getAll("supplier");
  if(list.some(s=>s.supplier_id===supplier_id))
    return showToast("供應商ID 已存在","error");

  const supplier = {
    supplier_id,
    supplier_name,
    contact_person: s_contact.value.trim(),
    phone: s_phone.value.trim(),
    email: s_email.value.trim(),
    address: s_address.value.trim(),
    country,
    supplier_type,
    supplier_flow,
    status: s_status.value,
    remark,
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    updated_by: "",
    updated_at: ""
  };

  await createRecord("supplier", supplier);

  await renderSuppliers();
  clearSupplierForm();

  showToast("供應商建立成功");
  } finally { hideSaveHint(); }
  setSupplierButtons_();
}

/* ===== 更新 ===== */
async function updateSupplier(triggerEl){

  if(!supplierEditing)
    return showToast("請先選擇供應商","error");

  showSaveHint(triggerEl);
  try {
  const supplier_id = s_id.value.trim();
  const supplier = await getOne("supplier","supplier_id",supplier_id);

  if(!supplier)
    return showToast("找不到供應商","error");

  const newStatus = s_status.value;
  // 狀態（ACTIVE/INACTIVE）僅 CEO/GA/ADMIN 可改（主檔）
  if(String(supplier.status||"") !== String(newStatus||"")){
    if(typeof erpCanChangeMasterStatus_ === "function" && !erpCanChangeMasterStatus_()){
      return showToast("僅 CEO／GA／ADMIN 可修改供應商狀態（ACTIVE/INACTIVE）。", "error");
    }
  }
  const country = s_country.value.trim();
  const supplier_type = supplierCsvFromGroup_("s_type_group");
  const supplier_flow = supplierCsvFromGroup_("s_flow_group");
  const remark = s_remark.value.trim();
  if(!supplier_type)
    return showToast("缺少必填：供應商類型","error");
  if(!supplier_flow)
    return showToast("缺少必填：可用流程","error");
  if((country === "其他" || String(supplier_type || "").split(",").map(x=>x.trim().toUpperCase()).includes("OTHER")) && !remark)
    return showToast("國家/供應商類型 選「其他」時，請填寫備註/原因","error");

  // 停用策略建議：允許停用，但若已被使用則提醒確認（不再硬性阻擋）
  if(supplier.status==="ACTIVE" && newStatus==="INACTIVE"){
    const isUsed = await isIdUsedInAny(supplier_id, [
      { type:"purchase_order", field:"supplier_id" },
      { type:"import_document", field:"supplier_id" },
      { type:"process_order", field:"supplier_id" }
    ]);

    if(isUsed){
      const ok = window.erpConfirmActionKey_("confirm.master.deactivate.used", {
        name: "此供應商",
        usedHint: "可能已有採購/加工紀錄",
        fallback: "此供應商已被使用（可能已有採購/加工紀錄）。\n\n仍要停用嗎？停用後將不能在新單據被選用，但歷史紀錄會保留。"
      });
      if(!ok) return;
    }else{
      // 若無法判定是否被使用，仍給一次基本確認，避免誤停用
      const ok = window.erpConfirmActionKey_("confirm.master.deactivate.basic", {
        name: "此供應商",
        fallback: "確定要將此供應商停用（INACTIVE）嗎？"
      });
      if(!ok) return;
    }
  }

  const newData = {
    supplier_name: s_name.value.trim(),
    contact_person: s_contact.value.trim(),
    phone: s_phone.value.trim(),
    email: s_email.value.trim(),
    address: s_address.value.trim(),
    country,
    supplier_type,
    supplier_flow,
    status: newStatus,
    remark,
    updated_by: getCurrentUser(),
    updated_at: nowIso16()
  };
  // 主檔一致化：更新也做必填檢核（避免更新成空值）
  if(!newData.supplier_name)
    return showToast("缺少必填：供應商名稱","error");

  await updateRecord("supplier", "supplier_id", supplier_id, newData);

  await renderSuppliers();
  clearSupplierForm();

  showToast("供應商更新成功");
  } finally { hideSaveHint(); }
  setSupplierButtons_();
}

/* ===== 清除 ===== */
function clearSupplierForm(){
  supplierEditing=false;
  s_id.disabled=false;

  supClear_(["s_id","s_name","s_contact","s_phone","s_email","s_address","s_remark"]);

  syncSelectWithLegacy_("s_country", "");
  supplierGroupFromCsv_("s_type_group", "");
  supplierGroupFromCsv_("s_flow_group", "");
  supplierMsUpdateText_("s_type_group", "s_type_text", supplierTypeLabelZh_, "請選擇");
  supplierMsUpdateText_("s_flow_group", "s_flow_text", supplierFlowLabelZh_, "請選擇");

  s_status.value="ACTIVE";
  erpInitAutoId_("s_id", "master", "S");
  if(typeof syncStatusSelectLamp_ === "function") syncStatusSelectLamp_("s_status");
  if(typeof erpLockStatusSelect_ === "function") erpLockStatusSelect_("s_status");
  setSupplierButtons_();
}

function supplierSnapshotFromForm_(){
  try{
    const v = (id) => (typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_(id) : String(document.getElementById(id)?.value || "").trim();
    const vU = (id) => (typeof window.erpVTrimUpperById_ === "function") ? window.erpVTrimUpperById_(id) : String(document.getElementById(id)?.value || "").trim().toUpperCase();
    return JSON.stringify({
      supplier_id: vU("s_id"),
      supplier_name: v("s_name"),
      contact_person: v("s_contact"),
      phone: v("s_phone"),
      email: v("s_email"),
      address: v("s_address"),
      country: v("s_country"),
      supplier_type: v("s_type_text"),
      supplier_flow: v("s_flow_text"),
      status: v("s_status"),
      remark: v("s_remark")
    });
  }catch(_e){
    return "";
  }
}

/* ===== 載入 ===== */
async function loadSupplier(id){
  const nextId = String(id || "").trim();
  if(!nextId) return;
  if(supplierLoadInFlight_){
    supplierPendingLoadId_ = nextId;
    showToast(`載入中：已排隊 ${nextId}（完成後自動載入）`, "warn", 6000);
    return;
  }
  try{
    const curId = String(s_id?.value || "").trim();
    const ok = (typeof window.erpGuardMasterLoad_ === "function")
      ? window.erpGuardMasterLoad_({
        nextId,
        curId,
        key: "supplier",
        isEditing: !!supplierEditing,
        getCurrentSnapshot: () => supplierSnapshotFromForm_(),
        getLoadedSnapshot: () => (window.erpDirty_ ? window.erpDirty_.getLoaded("supplier") : ""),
        normalizeId: window.erpNormalizeIdUpper_
      })
      : true;
    if(!ok) return;
  }catch(_e0){}
  supplierLoadInFlight_ = true;
  try{
    if(typeof scrollToEditorTop === "function") scrollToEditorTop();
    const s = await getOne("supplier","supplier_id",nextId);
    if(!s) return;

    supplierEditing=true;

  s_id.value = s.supplier_id;
  s_name.value = s.supplier_name;
  s_contact.value = s.contact_person;
  s_phone.value = s.phone;
  s_email.value = s.email;
  s_address.value = s.address;
  syncSelectWithLegacy_("s_country", s.country);
  supplierGroupFromCsv_("s_type_group", s.supplier_type || "");
  supplierGroupFromCsv_("s_flow_group", s.supplier_flow || "");
  supplierMsUpdateText_("s_type_group", "s_type_text", supplierTypeLabelZh_, "請選擇");
  supplierMsUpdateText_("s_flow_group", "s_flow_text", supplierFlowLabelZh_, "請選擇");
  s_status.value = s.status;
  s_remark.value = s.remark;
  if(typeof syncStatusSelectLamp_ === "function") syncStatusSelectLamp_("s_status");
  if(typeof erpLockStatusSelect_ === "function") erpLockStatusSelect_("s_status");

  s_id.disabled=true;
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
  try{
    if(window.erpDirty_){
      window.erpDirty_.bind("supplier", supplierSnapshotFromForm_);
      window.erpDirty_.markSaved("supplier");
    }
  }catch(_eS){}
    setSupplierButtons_();
  } finally {
    supplierLoadInFlight_ = false;
    try{
      const next = String(supplierPendingLoadId_ || "").trim();
      supplierPendingLoadId_ = "";
      if(next && next !== nextId){
        setTimeout(function(){ try{ loadSupplier(next); }catch(_e){} }, 0);
      }
    }catch(_eNext){}
  }
}

/* ===== Render ===== */
async function renderSuppliers(list=null){

  const tbody=document.getElementById("supplierTableBody");
  if(!tbody) return;

  if(!list){
    setTbodyLoading_(tbody, 6);
    list = await getAll("supplier");
  }

  tbody.innerHTML="";
  if(!list.length){
    tbody.innerHTML='<tr><td colspan="6" style="text-align:center;color:#64748b;padding:24px;">尚無供應商。請在上方表單填寫後按「建立」新增第一筆供應商。</td></tr>';
    return;
  }

  list.forEach(s=>{

    const badge = termStatusLampHtml(s.status);
    const typeZh = supplierCsvToZh_(s.supplier_type, supplierTypeLabelZh_);
    const flowZh = supplierCsvToZh_(s.supplier_flow, supplierFlowLabelZh_);

    tbody.innerHTML+=`
      <tr>
        <td>${s.supplier_id}</td>
        <td>${s.supplier_name}</td>
        <td>${typeZh || ""}</td>
        <td>${flowZh || ""}</td>
        <td>${s.contact_person||""}</td>
        <td>${s.phone||""}</td>
        <td class="col-status">${badge}</td>
        <td>
          <button class="btn-edit" onclick="loadSupplier('${s.supplier_id}')">Load</button>
        </td>
      </tr>
    `;
  });
}

/*********************************
 * Sort (內建穩定排序)
 *********************************/

let supplierSort = { field:"", asc:true };

async function sortSuppliers(field){
  setTbodyLoading_("supplierTableBody", 6);
  const list = [...(await getAll("supplier"))];

  if(supplierSort.field===field){
    supplierSort.asc=!supplierSort.asc;
  }else{
    supplierSort.field=field;
    supplierSort.asc=true;
  }

  list.sort((a,b)=>{
    let valA=a[field]??"";
    let valB=b[field]??"";

    if(typeof valA==="string") valA=valA.toLowerCase();
    if(typeof valB==="string") valB=valB.toLowerCase();

    if(valA>valB) return supplierSort.asc?1:-1;
    if(valA<valB) return supplierSort.asc?-1:1;
    return 0;
  });

  renderSuppliers(list);
}

/* ===== 搜尋 ===== */
async function searchSuppliers(){
  setTbodyLoading_("supplierTableBody", 6);

  const kw = (document.getElementById("search_supplier_keyword")?.value || "").trim().toLowerCase();
  const status = document.getElementById("search_supplier_status")?.value || "";

  const result = (await getAll("supplier")).filter(s=>{
    const matchKw = !kw ||
      s.supplier_id.toLowerCase().includes(kw) ||
      s.supplier_name.toLowerCase().includes(kw) ||
      String(s.contact_person || "").toLowerCase().includes(kw) ||
      String(s.phone || "").toLowerCase().includes(kw) ||
      String(s.email || "").toLowerCase().includes(kw) ||
      String(s.supplier_type || "").toLowerCase().includes(kw) ||
      String(s.supplier_flow || "").toLowerCase().includes(kw) ||
      String(s.remark || "").toLowerCase().includes(kw);
    return matchKw && (!status || s.status === status);
  });

  renderSuppliers(result);
}

/* ===== 重設 ===== */
async function resetSupplierSearch(){
  supClear_(["search_supplier_keyword","search_supplier_status"]);
  await renderSuppliers();
}