/*********************************
 * Customers Module - Enterprise v3 (API 版)
 *********************************/

let customerEditing = false;
let customerLoadInFlight_ = false;
let customerPendingLoadId_ = "";

function custSetV_(id, v){
  try{
    if(typeof window.erpSetVById_ === "function") return window.erpSetVById_(id, v);
  }catch(_e){}
  const el = document.getElementById(String(id || ""));
  if(el && "value" in el) el.value = v;
}

function custClear_(ids){
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
const CUSTOMER_RULES = {
  idRegex: /^[A-Z0-9_-]+$/,
  idMax: 30
};

// `bindUppercaseInput`、`syncSelectWithLegacy_` 已移至 `js/core/utils.js`

/* ===== 初始化 ===== */
async function customersInit(){
  bindUppercaseInput("c_id");
  bindAutoSearchToolbar_([
    ["search_customer_keyword", "input"],
    ["search_customer_category", "change"],
    ["search_customer_status", "change"]
  ], () => searchCustomers());
  await renderCustomers();
  clearCustomerForm();
  if(typeof bindStatusSelectLamp_ === "function") bindStatusSelectLamp_("c_status");
  if(typeof erpLockStatusSelect_ === "function") erpLockStatusSelect_("c_status");
}

function setCustomerButtons_(){
  const createBtn = document.getElementById("c_create_btn");
  const updateBtn = document.getElementById("c_update_btn");
  if(createBtn){
    createBtn.disabled = !!customerEditing;
    createBtn.title = customerEditing ? "已載入客戶，請用更新" : "建立新客戶";
  }
  if(updateBtn){
    updateBtn.disabled = !customerEditing;
    updateBtn.title = customerEditing ? "更新此客戶" : "請先載入客戶";
  }
}

/* ===== 建立 ===== */
async function createCustomer(triggerEl){

  let customer_id = c_id.value.trim().toUpperCase();
  // ID 預設自動產生：若被清空，直接補回，不用跳「缺少必填：ID」
  if(!customer_id){
    customer_id = erpInitAutoId_("c_id", "master", "C");
  }else{
    c_id.value = customer_id;
  }
  const customer_name = c_name.value.trim();
  const category = (document.getElementById("c_category")?.value || "").trim();
  const country = c_country.value.trim();
  const remark = c_remark.value.trim();

  // 主檔一致化：ID 多為自動產生，缺漏時仍提示；但一般必填以「名稱/分類」為主
  if(!customer_name) return showToast("缺少必填：客戶名稱","error");
  if(!category)
    return showToast("缺少必填：分類","error");
  if(!customer_id) return showToast("客戶ID 產生失敗，請重新整理後再試","error");
  if((category === "其他" || country === "其他") && !remark)
    return showToast("分類/國家 選「其他」時，請填寫備註/原因","error");

  if(customer_id.length > CUSTOMER_RULES.idMax)
    return showToast("ID 長度過長（最多 30 字元）","error");

  if(!CUSTOMER_RULES.idRegex.test(customer_id))
    return showToast("ID 只能使用 A-Z 0-9 _ -","error");

  showSaveHint(triggerEl);
  try {
  const list = await getAll("customer");
  if(list.some(c=>c.customer_id===customer_id))
    return showToast("客戶ID 已存在","error");

  const customer = {
    customer_id,
    customer_name,
    category,
    contact_person: c_contact.value.trim(),
    phone: c_phone.value.trim(),
    email: c_email.value.trim(),
    address: c_address.value.trim(),
    country,
    status: c_status.value,
    remark,
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    updated_by: "",
    updated_at: ""
  };

  await createRecord("customer", customer);

  await renderCustomers();
  clearCustomerForm();

  showToast("客戶建立成功");
  } finally { hideSaveHint(); }
  setCustomerButtons_();
}

/* ===== 更新 ===== */
async function updateCustomer(triggerEl){

  if(!customerEditing)
    return showToast("請先選擇客戶","error");

  showSaveHint(triggerEl);
  try {
  const customer_id = c_id.value.trim();
  const customer = await getOne("customer","customer_id",customer_id);

  if(!customer)
    return showToast("找不到客戶","error");

  const newStatus = c_status.value;
  // 狀態（ACTIVE/INACTIVE）僅 CEO/GA/ADMIN 可改（主檔）
  if(String(customer.status||"") !== String(newStatus||"")){
    if(typeof erpCanChangeMasterStatus_ === "function" && !erpCanChangeMasterStatus_()){
      return showToast("僅 CEO／GA／ADMIN 可修改客戶狀態（ACTIVE/INACTIVE）。", "error");
    }
  }
  const category = (document.getElementById("c_category")?.value || "").trim();
  const country = c_country.value.trim();
  const remark = c_remark.value.trim();
  if(!category)
    return showToast("缺少必填：分類","error");
  if((category === "其他" || country === "其他") && !remark)
    return showToast("分類/國家 選「其他」時，請填寫備註/原因","error");

  // 停用策略建議：允許停用，但若已被使用則提醒確認（不再硬性阻擋）
  if(customer.status==="ACTIVE" && newStatus==="INACTIVE"){
    const isUsed = await isIdUsedInAny(customer_id, [
      { type:"sales_order", field:"customer_id" },
      { type:"shipment", field:"customer_id" }
    ]);

    if(isUsed){
      const ok = window.erpConfirmActionKey_("confirm.master.deactivate.used", {
        name: "此客戶",
        usedHint: "可能已有出貨紀錄",
        fallback: "此客戶已被使用（可能已有出貨紀錄）。\n\n仍要停用嗎？停用後將不能在新單據被選用，但歷史紀錄會保留。"
      });
      if(!ok) return;
    }else{
      const ok = window.erpConfirmActionKey_("confirm.master.deactivate.basic", {
        name: "此客戶",
        fallback: "確定要將此客戶停用（INACTIVE）嗎？"
      });
      if(!ok) return;
    }
  }

  const newData = {
    customer_name: c_name.value.trim(),
    category,
    contact_person: c_contact.value.trim(),
    phone: c_phone.value.trim(),
    email: c_email.value.trim(),
    address: c_address.value.trim(),
    country,
    status: newStatus,
    remark,
    updated_by: getCurrentUser(),
    updated_at: nowIso16()
  };
  // 主檔一致化：更新也做必填檢核（避免更新成空值）
  if(!newData.customer_name)
    return showToast("缺少必填：客戶名稱","error");

  await updateRecord("customer", "customer_id", customer_id, newData);

  await renderCustomers();
  clearCustomerForm();

  showToast("客戶更新成功");
  } finally { hideSaveHint(); }
  setCustomerButtons_();
}

/* ===== 清除表單 ===== */
function clearCustomerForm(){
  customerEditing=false;
  c_id.disabled=false;

  custClear_(["c_id","c_name","c_contact","c_phone","c_email","c_address","c_remark"]);

  syncSelectWithLegacy_("c_category", "");
  syncSelectWithLegacy_("c_country", "");

  c_status.value="ACTIVE";
  erpInitAutoId_("c_id", "master", "C");
  if(typeof syncStatusSelectLamp_ === "function") syncStatusSelectLamp_("c_status");
  if(typeof erpLockStatusSelect_ === "function") erpLockStatusSelect_("c_status");
  setCustomerButtons_();
}

function customerSnapshotFromForm_(){
  try{
    const v = (id) => (typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_(id) : String(document.getElementById(id)?.value || "").trim();
    const vU = (id) => (typeof window.erpVTrimUpperById_ === "function") ? window.erpVTrimUpperById_(id) : String(document.getElementById(id)?.value || "").trim().toUpperCase();
    return JSON.stringify({
      customer_id: vU("c_id"),
      customer_name: v("c_name"),
      category: v("c_category"),
      contact_person: v("c_contact"),
      phone: v("c_phone"),
      email: v("c_email"),
      address: v("c_address"),
      country: v("c_country"),
      status: v("c_status"),
      remark: v("c_remark")
    });
  }catch(_e){
    return "";
  }
}

/* ===== 載入 ===== */
async function loadCustomer(id){
  const nextId = String(id || "").trim();
  if(!nextId) return;
  if(customerLoadInFlight_){
    customerPendingLoadId_ = nextId;
    showToast(`載入中：已排隊 ${nextId}（完成後自動載入）`, "warn", 6000);
    return;
  }
  try{
    const curId = String(c_id?.value || "").trim();
    const ok = (typeof window.erpGuardMasterLoad_ === "function")
      ? window.erpGuardMasterLoad_({
        nextId,
        curId,
        key: "customer",
        isEditing: !!customerEditing,
        getCurrentSnapshot: () => customerSnapshotFromForm_(),
        getLoadedSnapshot: () => (window.erpDirty_ ? window.erpDirty_.getLoaded("customer") : ""),
        normalizeId: window.erpNormalizeIdUpper_
      })
      : true;
    if(!ok) return;
  }catch(_e0){}
  customerLoadInFlight_ = true;
  try{
    if(typeof scrollToEditorTop === "function") scrollToEditorTop();
    const c = await getOne("customer","customer_id",nextId);
    if(!c) return;

    customerEditing=true;

    c_id.value = c.customer_id;
    c_name.value = c.customer_name;
    syncSelectWithLegacy_("c_category", c.category);
    c_contact.value = c.contact_person;
    c_phone.value = c.phone;
    c_email.value = c.email;
    c_address.value = c.address;
    syncSelectWithLegacy_("c_country", c.country);
    c_status.value = c.status;
    c_remark.value = c.remark;
    if(typeof syncStatusSelectLamp_ === "function") syncStatusSelectLamp_("c_status");
    if(typeof erpLockStatusSelect_ === "function") erpLockStatusSelect_("c_status");

    c_id.disabled=true;
    if(typeof scrollToEditorTop === "function") scrollToEditorTop();
    try{
      if(window.erpDirty_){
        window.erpDirty_.bind("customer", customerSnapshotFromForm_);
        window.erpDirty_.markSaved("customer");
      }
    }catch(_eS){}
    setCustomerButtons_();
  } finally {
    customerLoadInFlight_ = false;
    try{
      const next = String(customerPendingLoadId_ || "").trim();
      customerPendingLoadId_ = "";
      if(next && next !== nextId){
        setTimeout(function(){ try{ loadCustomer(next); }catch(_e){} }, 0);
      }
    }catch(_eNext){}
  }
}

/* ===== 搜尋 ===== */
async function searchCustomers(){
  setTbodyLoading_("customerTableBody", 7);

  const kw = (document.getElementById("search_customer_keyword")?.value || "").trim().toLowerCase();
  const cat = (document.getElementById("search_customer_category")?.value || "").trim();
  const status = document.getElementById("search_customer_status")?.value || "";

  const result = (await getAll("customer")).filter(c=>{
    if(cat && String(c.category || "") !== cat) return false;
    const matchKw = !kw ||
      c.customer_id.toLowerCase().includes(kw) ||
      c.customer_name.toLowerCase().includes(kw) ||
      String(c.category || "").toLowerCase().includes(kw) ||
      String(c.contact_person || "").toLowerCase().includes(kw) ||
      String(c.phone || "").toLowerCase().includes(kw) ||
      String(c.email || "").toLowerCase().includes(kw) ||
      String(c.remark || "").toLowerCase().includes(kw);
    return matchKw && (!status || c.status === status);
  });

  renderCustomers(result);
}

async function resetCustomerSearch(){
  custClear_(["search_customer_keyword","search_customer_category","search_customer_status"]);
  await renderCustomers();
}

/* ===== 排序 ===== */
let customerSort = { field:"", asc:true };

async function sortCustomers(field){
  setTbodyLoading_("customerTableBody", 7);
  const list = [...(await getAll("customer"))];

  if(customerSort.field===field){
    customerSort.asc=!customerSort.asc;
  }else{
    customerSort.field=field;
    customerSort.asc=true;
  }

  list.sort((a,b)=>{
    let valA=a[field]??"";
    let valB=b[field]??"";

    if(typeof valA==="string") valA=valA.toLowerCase();
    if(typeof valB==="string") valB=valB.toLowerCase();

    if(valA>valB) return customerSort.asc?1:-1;
    if(valA<valB) return customerSort.asc?-1:1;
    return 0;
  });

  renderCustomers(list);
}

/* ===== Render ===== */
async function renderCustomers(list=null){

  const tbody=document.getElementById("customerTableBody");
  if(!tbody) return;

  if(!list){
    setTbodyLoading_(tbody, 7);
    list = await getAll("customer");
  }

  tbody.innerHTML="";
  if(!list.length){
    tbody.innerHTML='<tr><td colspan="7" style="text-align:center;color:#64748b;padding:24px;">尚無客戶。請在上方表單填寫後按「建立」新增第一筆客戶。</td></tr>';
    return;
  }

  list.forEach(c=>{

    const badge = termStatusLampHtml(c.status);

    tbody.innerHTML+=`
      <tr>
        <td>${c.customer_id}</td>
        <td>${c.customer_name}</td>
        <td>${c.category||""}</td>
        <td>${c.contact_person||""}</td>
        <td>${c.phone||""}</td>
        <td class="col-status">${badge}</td>
        <td>
          <button class="btn-edit" onclick="loadCustomer('${c.customer_id}')">Load</button>
        </td>
      </tr>
    `;
  });
}