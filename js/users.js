/**
 * Users（API 版）
 */

let userEditing = false;
let userLoadedStatus_ = "";
let userLoadInFlight_ = false;
let userPendingLoadId_ = "";

function userSetV_(id, v){
  try{
    if(typeof window.erpSetVById_ === "function") return window.erpSetVById_(id, v);
  }catch(_e){}
  const el = document.getElementById(String(id || ""));
  if(el && "value" in el) el.value = v;
}

function userClear_(ids){
  try{
    if(typeof window.erpClearIds_ === "function") return window.erpClearIds_(ids);
  }catch(_e){}
  const list = Array.isArray(ids) ? ids : [ids];
  for(let i = 0; i < list.length; i++){
    const el = document.getElementById(String(list[i] || ""));
    if(el && "value" in el) el.value = "";
  }
}

function syncUserPasswordVisibility_(){
  // 密碼欄位已移除（Google 登入為主）；此函式保留避免舊呼叫造成錯誤
}

function escHtml_(s){
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr_(s){
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

const USER_MODULE_OPTIONS_ = [
  // 注意：Dashboard / Trace / Logs 為預設權限，不在可設定清單內
  ["products", "Products 產品"],
  ["suppliers", "Suppliers 供應商"],
  ["customers", "Customers 客戶"],
  ["warehouses", "Warehouses 倉庫"],
  ["purchase", "Purchase Orders 採購單"],
  ["import", "Import Doc(s) 進口報單"],
  ["receive", "Goods Receipt 收貨入庫"],
  ["lots", "Lots 批次QA管理"],
  ["movements", "Movements 庫存異動"],
  ["warehouse_stock", "Warehouse 倉庫庫存"],
  ["outsource", "Outsource 委外加工單"],
  ["sales", "Sales Orders 銷售單"],
  ["shipping", "Shipment 出貨管理"]
];

const USER_MODULE_GROUPS_ = [
  { key: "MASTER", label: "MASTER DATA 主檔", modules: ["products","suppliers","customers","warehouses"] },
  { key: "INBOUND", label: "INBOUND 進貨", modules: ["purchase","import","receive"] },
  { key: "INV", label: "INVENTORY 庫存", modules: ["lots","movements","warehouse_stock"] },
  { key: "PROC", label: "PROCESS 加工", modules: ["outsource"] },
  { key: "SALES", label: "SALES 銷售", modules: ["sales","shipping"] }
];

function canEditAllowedModules_(){
  try{
    const r = (typeof getCurrentUserRole === "function" ? String(getCurrentUserRole() || "") : "").trim().toUpperCase();
    return r === "CEO" || r === "GA" || r === "ADMIN";
  }catch(_e){
    return false;
  }
}

function bindAllowedModulesUi_(){
  const row = document.getElementById("u_allowed_modules_row");
  const btn = document.getElementById("u_allowed_modules_toggle");
  const wrap = document.getElementById("u_allowed_modules_wrap");
  if(!row || !btn || !wrap) return;

  const ok = canEditAllowedModules_();
  row.style.display = ok ? "" : "none";
  btn.style.display = ok ? "" : "none";
  if(!ok){
    wrap.style.display = "none";
    return;
  }

  if(btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", function(){
    const open = wrap.style.display !== "none";
    wrap.style.display = open ? "none" : "block";
    btn.textContent = open ? "設定" : "收起";
  });
}

function updateGroupCheckboxStates_(){
  const box = document.getElementById("u_allowed_modules");
  if(!box) return;
  USER_MODULE_GROUPS_.forEach(g=>{
    const el = box.querySelector(`input[type=checkbox][data-group="${g.key}"]`);
    if(!el) return;
    const total = g.modules.length;
    let checked = 0;
    g.modules.forEach(m=>{
      const cb = box.querySelector(`input[type=checkbox][data-mod="${m}"]`);
      if(cb && cb.checked) checked += 1;
    });
    el.indeterminate = checked > 0 && checked < total;
    el.checked = checked === total && total > 0;
  });
}

function renderUserModuleOptions_(){
  const wrap = document.getElementById("u_allowed_modules");
  if(!wrap) return;
  if(wrap.dataset.inited === "1") return;
  wrap.dataset.inited = "1";
  function cbHtml(id, attrs, text){
    return `<label style="display:flex;align-items:center;gap:5px;margin:0 8px 0 0;white-space:nowrap;">
      <input type="checkbox" id="${escAttr_(id)}" ${attrs}>
      <span>${escHtml_(text)}</span>
    </label>`;
  }

  const line1 = [
    cbHtml("u_grp_MASTER", 'data-group="MASTER"', "MASTER DATA 主檔"),
    cbHtml("u_mod_products", 'data-mod="products"', "Products 產品"),
    cbHtml("u_mod_suppliers", 'data-mod="suppliers"', "Suppliers 供應商"),
    cbHtml("u_mod_customers", 'data-mod="customers"', "Customers 客戶"),
    cbHtml("u_mod_warehouses", 'data-mod="warehouses"', "Warehouses 倉庫")
  ].join("");
  const line2 = [
    cbHtml("u_grp_INBOUND", 'data-group="INBOUND"', "INBOUND 進貨"),
    cbHtml("u_mod_purchase", 'data-mod="purchase"', "Purchase 採購單"),
    cbHtml("u_mod_import", 'data-mod="import"', "Import 進口報單"),
    cbHtml("u_mod_receive", 'data-mod="receive"', "Receipt 收貨入庫")
  ].join("");
  const line3 = [
    cbHtml("u_grp_INV", 'data-group="INV"', "INVENTORY 庫存"),
    cbHtml("u_mod_lots", 'data-mod="lots"', "Lots 批次QA"),
    cbHtml("u_mod_movements", 'data-mod="movements"', "Movements 異動"),
    cbHtml("u_mod_warehouse_stock", 'data-mod="warehouse_stock"', "倉庫庫存")
  ].join("");
  const line4 = [
    cbHtml("u_grp_PROC", 'data-group="PROC"', "PROCESS 加工"),
    cbHtml("u_mod_outsource", 'data-mod="outsource"', "Outsource 委外加工")
  ].join("");
  const line5 = [
    cbHtml("u_grp_SALES", 'data-group="SALES"', "SALES 銷售"),
    cbHtml("u_mod_sales", 'data-mod="sales"', "Sales 銷售單"),
    cbHtml("u_mod_shipping", 'data-mod="shipping"', "Shipment 出貨")
  ].join("");

  wrap.innerHTML = [
    `<div style="flex:0 0 100%;max-width:100%;display:flex;flex-wrap:wrap;gap:2px 8px;font-size:12px;line-height:1.05;">${line1}</div>`,
    `<div style="flex:0 0 100%;max-width:100%;display:flex;flex-wrap:wrap;gap:2px 8px;font-size:12px;line-height:1.05;">${line2}</div>`,
    `<div style="flex:0 0 100%;max-width:100%;display:flex;flex-wrap:wrap;gap:2px 8px;font-size:12px;line-height:1.05;">${line3}</div>`,
    `<div style="flex:0 0 100%;max-width:100%;display:flex;flex-wrap:wrap;gap:2px 8px;font-size:12px;line-height:1.05;">${line4}</div>`,
    `<div style="flex:0 0 100%;max-width:100%;display:flex;flex-wrap:wrap;gap:2px 8px;font-size:12px;line-height:1.05;">${line5}</div>`
  ].join("");

  // 綁定事件：群組勾選 → 勾全部；單一勾選 → 回填群組狀態
  wrap.addEventListener("change", function(e){
    const t = e && e.target ? e.target : null;
    if(!t) return;
    const g = t.getAttribute && t.getAttribute("data-group");
    const m = t.getAttribute && t.getAttribute("data-mod");
    if(g){
      const grp = USER_MODULE_GROUPS_.find(x=>x.key===g);
      if(!grp) return;
      grp.modules.forEach(mod=>{
        const cb = wrap.querySelector(`input[type=checkbox][data-mod="${mod}"]`);
        if(cb) cb.checked = !!t.checked;
      });
      updateGroupCheckboxStates_();
      return;
    }
    if(m){
      updateGroupCheckboxStates_();
    }
  });
}

function getUserAllowedModules_(){
  const wrap = document.getElementById("u_allowed_modules");
  if(!wrap) return "";
  const picked = [];
  wrap.querySelectorAll("input[type=checkbox][data-mod]").forEach(cb=>{
    if(cb && cb.checked){
      picked.push(String(cb.getAttribute("data-mod") || "").trim());
    }
  });
  return picked.join(",");
}

function setUserAllowedModules_(csv){
  const wrap = document.getElementById("u_allowed_modules");
  if(!wrap) return;
  let raw = String(csv || "").trim();
  // 相容舊資料：ALL / * 視為「全開可設定模組」（不含 Dashboard/Trace/Logs）
  if(raw.toUpperCase() === "ALL" || raw === "*"){
    raw = USER_MODULE_OPTIONS_.map(x=>x[0]).join(",");
  }
  const set = {};
  raw.split(",").map(s=>String(s||"").trim()).filter(Boolean).forEach(k=>{ set[k]=true; });
  wrap.querySelectorAll("input[type=checkbox][data-mod]").forEach(cb=>{
    const k = String(cb.getAttribute("data-mod") || "").trim();
    cb.checked = !!set[k];
  });
  updateGroupCheckboxStates_();
}

/** 列表顯示用（與表單選項中文一致）；未知代碼則原樣顯示 */
function userRoleLabelZh_(role){
  const r = String(role || "").trim().toUpperCase();
  const map = {
    CEO: "CEO",
    // 新代碼（兩字母縮寫）
    FN: "財務",
    GA: "總務",
    SL: "業務",
    WH: "倉管",
    AS: "助理",
    // 舊代碼（相容歷史資料）
    FINANCE: "財務",
    GENERAL_AFFAIRS: "總務",
    SALES: "業務",
    WAREHOUSE: "倉管",
    QA: "品保",
    OP: "作業",
    // 仍保留 ADMIN/CEO/QA/OP
  };
  return map[r] || String(role || "").trim() || "—";
}

async function usersInit(){
  resetUserForm();
  renderUserModuleOptions_();
  bindAllowedModulesUi_();
  try{
    const roleSel = document.getElementById("u_role");
    if(roleSel && !roleSel.dataset.boundPwVis){
      roleSel.dataset.boundPwVis = "1";
      roleSel.addEventListener("change", function(){ syncUserPasswordVisibility_(); });
    }
  }catch(_e){}
  bindAutoSearchToolbar_([
    ["u_search_keyword", "input"],
    ["u_search_role", "change"],
    ["u_search_status", "change"]
  ], () => renderUsers());
  await renderUsers();
  if(typeof bindStatusSelectLamp_ === "function") bindStatusSelectLamp_("u_status");
  if(typeof erpLockStatusSelect_ === "function") erpLockStatusSelect_("u_status");
}

function setUserButtons_(){
  const createBtn = document.getElementById("u_create_btn");
  const updateBtn = document.getElementById("u_update_btn");
  if(createBtn){
    createBtn.disabled = !!userEditing;
    createBtn.title = userEditing ? "已載入使用者，請用更新" : "建立新使用者";
  }
  if(updateBtn){
    updateBtn.disabled = !userEditing;
    updateBtn.title = userEditing ? "更新此使用者" : "請先載入使用者";
  }
}

function resetUserForm(){
  userEditing = false;
  userLoadedStatus_ = "";
  try{ if(window.erpDirty_) window.erpDirty_.setLoaded("user", ""); }catch(_eDirty){}
  const id = document.getElementById("u_id");
  userClear_(["u_id","u_name","u_email","u_role","u_remark"]);
  if(id) id.disabled = false;
  const st = document.getElementById("u_status");
  if(st) st.value = "ACTIVE";
  if(typeof syncStatusSelectLamp_ === "function") syncStatusSelectLamp_("u_status");
  if(typeof erpLockStatusSelect_ === "function") erpLockStatusSelect_("u_status");
  try{ setUserAllowedModules_(""); }catch(_e){}
  try{
    const w = document.getElementById("u_allowed_modules_wrap");
    const b = document.getElementById("u_allowed_modules_toggle");
    if(w) w.style.display = "none";
    if(b) b.textContent = "設定";
  }catch(_e2){}
  syncUserPasswordVisibility_();
  setUserButtons_();
}

async function createUser(triggerEl){
  const user_id = (document.getElementById("u_id")?.value || "").trim();
  const user_name = (document.getElementById("u_name")?.value || "").trim();
  const emailRaw = (document.getElementById("u_email")?.value || "");
  const email = String(emailRaw || "").trim().toLowerCase();
  const role = (document.getElementById("u_role")?.value || "").trim();
  const status = document.getElementById("u_status")?.value || "ACTIVE";
  const remark = (document.getElementById("u_remark")?.value || "").trim();
  const allowed_modules = (canEditAllowedModules_() && (document.getElementById("u_allowed_modules_wrap")?.style.display !== "none"))
    ? getUserAllowedModules_()
    : null;

  if(!user_id) return showToast("缺少必填：User ID","error");
  if(!user_name) return showToast("缺少必填：姓名","error");
  if(!email) return showToast("缺少必填：Email","error");
  if(!role) return showToast("缺少必填：角色","error");
  if(String(role || "").trim().toUpperCase() === "ADMIN") return showToast("不可建立 ADMIN（請改由後端/主檔維護）","error");

  showSaveHint(triggerEl);
  try {
  const exists = await getOne("user","user_id",user_id).catch(()=>null);
  if(exists) return showToast("User ID 已存在","error");

  const payload = {
    user_id,
    user_name,
    email,
    role,
    status,
    remark,
    created_at: nowIso16(),
    updated_at: nowIso16()
  };
  if(allowed_modules != null) payload.allowed_modules = allowed_modules;
  await createRecord("user", payload);

  showToast("使用者建立成功");
  await renderUsers();
  resetUserForm();
  } finally { hideSaveHint(); }
  setUserButtons_();
}

function userSnapshotFromForm_(){
  try{
    const curId = (typeof window.erpVTrimById_ === "function")
      ? window.erpVTrimById_("u_id")
      : String(document.getElementById("u_id")?.value || "").trim();
    return JSON.stringify({
      user_id: curId,
      user_name: (typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_("u_name") : String(document.getElementById("u_name")?.value || "").trim(),
      email: String((typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_("u_email") : String(document.getElementById("u_email")?.value || "").trim()).toLowerCase(),
      role: (typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_("u_role") : String(document.getElementById("u_role")?.value || "").trim(),
      status: (typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_("u_status") : String(document.getElementById("u_status")?.value || "").trim(),
      remark: (typeof window.erpVTrimById_ === "function") ? window.erpVTrimById_("u_remark") : String(document.getElementById("u_remark")?.value || "").trim(),
      allowed_modules: (typeof canEditAllowedModules_ === "function" && canEditAllowedModules_())
        ? String(getUserAllowedModules_() || "")
        : ""
    });
  }catch(_e){
    return "";
  }
}

async function loadUser(userId){
  const nextId = String(userId || "").trim();
  if(!nextId) return;
  if(userLoadInFlight_){
    userPendingLoadId_ = nextId;
    showToast(`載入中：已排隊 ${nextId}（完成後自動載入）`, "warn", 6000);
    return;
  }
  try{
    const curId = String(document.getElementById("u_id")?.value || "").trim();
    const ok = (typeof window.erpGuardMasterLoad_ === "function")
      ? window.erpGuardMasterLoad_({
        nextId,
        curId,
        key: "user",
        isEditing: !!userEditing,
        getCurrentSnapshot: () => userSnapshotFromForm_(),
        getLoadedSnapshot: () => (window.erpDirty_ ? window.erpDirty_.getLoaded("user") : ""),
        normalizeId: window.erpNormalizeIdTrim_
      })
      : true;
    if(!ok) return;
  }catch(_e0){}
  userLoadInFlight_ = true;
  try{
    if(typeof scrollToEditorTop === "function") scrollToEditorTop();
    const u = await getOne("user","user_id",nextId);
    if(!u) return;
    userEditing = true;
    userLoadedStatus_ = String(u.status || "ACTIVE");
    const id = document.getElementById("u_id");
    id.value = u.user_id;
    id.disabled = true;
    document.getElementById("u_name").value = u.user_name || "";
    try{ const em = document.getElementById("u_email"); if(em) em.value = u.email || ""; }catch(_eEm){}
    try{
      if(canEditAllowedModules_()){
        // 仍預設收起；需要看才按「設定」
        setUserAllowedModules_(u.allowed_modules || "");
      }
    }catch(_eAm){}
    document.getElementById("u_role").value = u.role || "OP";
    syncUserPasswordVisibility_();
    document.getElementById("u_status").value = u.status || "ACTIVE";
    if(typeof syncStatusSelectLamp_ === "function") syncStatusSelectLamp_("u_status");
    if(typeof erpLockStatusSelect_ === "function") erpLockStatusSelect_("u_status");
    document.getElementById("u_remark").value = u.remark || "";
    if(typeof scrollToEditorTop === "function") scrollToEditorTop();
    try{
      if(window.erpDirty_){
        window.erpDirty_.bind("user", userSnapshotFromForm_);
        window.erpDirty_.markSaved("user");
      }
    }catch(_eS){}
    setUserButtons_();
  } finally {
    userLoadInFlight_ = false;
    try{
      const next = String(userPendingLoadId_ || "").trim();
      userPendingLoadId_ = "";
      if(next && next !== nextId){
        setTimeout(function(){ try{ loadUser(next); }catch(_e){} }, 0);
      }
    }catch(_eNext){}
  }
}

async function updateUser(triggerEl){
  if(!userEditing) return showToast("請先載入使用者再更新","error");
  const user_id = (document.getElementById("u_id")?.value || "").trim();
  const user_name = (document.getElementById("u_name")?.value || "").trim();
  const emailRaw = (document.getElementById("u_email")?.value || "");
  const email = String(emailRaw || "").trim().toLowerCase();
  const role = (document.getElementById("u_role")?.value || "").trim();
  const status = document.getElementById("u_status")?.value || "ACTIVE";
  const remark = (document.getElementById("u_remark")?.value || "").trim();
  const allowed_modules = (canEditAllowedModules_() && (document.getElementById("u_allowed_modules_wrap")?.style.display !== "none"))
    ? getUserAllowedModules_()
    : null;

  if(!user_id) return showToast("缺少必填：User ID","error");
  if(!user_name) return showToast("缺少必填：姓名","error");
  if(!email) return showToast("缺少必填：Email","error");
  if(!role) return showToast("缺少必填：角色","error");
  if(String(role || "").trim().toUpperCase() === "ADMIN") return showToast("不可改成 ADMIN（請改由後端/主檔維護）","error");

  // 狀態（ACTIVE/INACTIVE）僅 CEO/GA/ADMIN 可改（主檔）
  if(String(userLoadedStatus_||"") !== String(status||"")){
    if(typeof erpCanChangeMasterStatus_ === "function" && !erpCanChangeMasterStatus_()){
      return showToast("僅 CEO／GA／ADMIN 可修改使用者狀態（ACTIVE/INACTIVE）。", "error");
    }
  }

  // 停用策略：停用前至少二次確認（停用後不得再登入；歷史紀錄保留）
  if(String(userLoadedStatus_||"") === "ACTIVE" && String(status||"") === "INACTIVE"){
    const isUsed = await isIdUsedInAny(user_id, [
      { type:"logs", field:"created_by" },
      { type:"inventory_movement", field:"created_by" }
    ]);
    const ok = window.erpConfirmActionKey_(isUsed ? "confirm.user.deactivate.used" : "confirm.user.deactivate.basic", {
      fallback: (isUsed
        ? "此使用者可能已有歷史操作紀錄。\n\n仍要停用嗎？停用後不得再登入，但歷史紀錄會保留。"
        : "確定要將此使用者停用（INACTIVE）嗎？停用後不得再登入，但歷史紀錄會保留。")
    });
    if(!ok) return;
  }

  showSaveHint(triggerEl);
  try {
  const patch = {
    user_name,
    ...(email ? { email } : { email: "" }),
    role,
    status,
    remark,
    updated_at: nowIso16()
  };
  if(allowed_modules != null) patch.allowed_modules = allowed_modules;
  await updateRecord("user","user_id",user_id, patch);

  showToast("使用者更新成功");
  await renderUsers();
  userLoadedStatus_ = String(status || "");
  } finally { hideSaveHint(); }
  setUserButtons_();
}

function resetUserListSearch(){
  userClear_(["u_search_keyword","u_search_role","u_search_status"]);
  renderUsers();
}

async function renderUsers(){
  const tbody = document.getElementById("uTableBody");
  if(!tbody) return;
  setTbodyLoading_(tbody, 6);
  const list = await getAll("user").catch(()=>[]);
  const kw = (document.getElementById("u_search_keyword")?.value || "").trim().toLowerCase();
  const qRole = (document.getElementById("u_search_role")?.value || "").trim().toUpperCase();
  const qSt = (document.getElementById("u_search_status")?.value || "").trim().toUpperCase();
  const filtered = (list || []).filter(u => {
    // UI 不顯示 ADMIN（仍保留在主檔供後端救火使用）
    if(String(u && u.role || "").trim().toUpperCase() === "ADMIN") return false;
    if(qRole && String(u.role || "").trim().toUpperCase() !== qRole) return false;
    if(qSt && String(u.status || "").toUpperCase() !== qSt) return false;
    if(!kw) return true;
    const roleZh = userRoleLabelZh_(u.role);
    const hay = [
      u.user_id,
      u.user_name,
      u.email,
      u.role,
      roleZh,
      u.remark
    ].map(x => String(x || "").toLowerCase()).join(" ");
    return hay.includes(kw);
  });
  const sorted = [...filtered].sort((a,b)=>(b.updated_at||"").localeCompare(a.updated_at||""));
  tbody.innerHTML = "";
  if(!sorted.length){
    const emptyMsg = kw || qRole || qSt
      ? '<tr><td colspan="6" style="text-align:center;color:#64748b;padding:24px;">沒有符合條件的使用者。</td></tr>'
      : '<tr><td colspan="6" style="text-align:center;color:#64748b;padding:24px;">尚無使用者。請在上方表單建立。</td></tr>';
    tbody.innerHTML = emptyMsg;
    return;
  }
  sorted.forEach(u => {
    const badge = termStatusLampHtml(u.status);
    const roleCode = String(u.role || "").trim();
    const email = String(u.email || "").trim();
    tbody.innerHTML += `
      <tr>
        <td>${u.user_id || ""}</td>
        <td>${u.user_name || ""}</td>
        <td${email ? ` title="${escAttr_(email)}"` : ""}>${escHtml_(email || "—")}</td>
        <td${roleCode ? ` title="${escAttr_(roleCode)}"` : ""}>${escHtml_(userRoleLabelZh_(u.role))}</td>
        <td class="col-status">${badge}</td>
        <td><button class="btn-edit" onclick="loadUser('${u.user_id}')">Load</button></td>
      </tr>
    `;
  });
}

