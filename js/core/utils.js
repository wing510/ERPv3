/**
 * ERP Core Utils
 * - 以「穩定可追溯」為優先：ID 由前端產生並寫入 Sheet
 * - 時間：僅保留一個共用函式 nowIso16()（台灣本地時間），各模組一律使用此函式，勿再自訂 nowTime/nowIso16
 */

/** 唯一共用：台灣本地時間 YYYY-MM-DDTHH:mm（供 datetime-local 與 created_at/updated_at 儲存用） */
function nowIso16(){
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 擷取 YYYY-MM-DD，供 `<input type="date">` 與列表顯示（相容舊資料含時間） */
function dateInputValue_(v){
  const s = String(v || "").trim();
  if(!s) return "";
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

/**
 * 產生可讀且不易撞號的 ID
 * 範例：IMP-260320-1813-9CF6
 */
function generateId(prefix){
  const d = new Date();
  const pad = (n) => String(n).padStart(2,"0");
  // YYMMDD（短版）+ HHMM（分鐘精度）+ 4 位隨機（16 進位）
  const yy = String(d.getFullYear()).slice(-2);
  const ymd = `${yy}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
  const hm = `${pad(d.getHours())}${pad(d.getMinutes())}`;
  const rnd = Math.random().toString(16).slice(2,6).toUpperCase();
  return `${prefix}-${ymd}-${hm}-${rnd}`;
}

/** 較短的主檔 ID：例如 P260411-A3（日期後僅 2 碼英數，主檔用） */
function generateShortId(prefix){
  const d = new Date();
  const pad = (n) => String(n).padStart(2,"0");
  const yy = String(d.getFullYear()).slice(-2);
  const ymd = `${yy}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
  const n = Math.floor(Math.random() * 36 * 36);
  const rnd = n.toString(36).toUpperCase().padStart(2, "0");
  return `${prefix}${ymd}-${rnd}`;
}

/**
 * 統一「表單自動產生 ID」的填入規則（收斂重複）
 *
 * - 預設：只有當欄位為空時才會填入（避免覆蓋已載入/已輸入的 ID）
 * - force=true：強制重設為新 ID（通常用在 reset/clear）
 *
 * 支援用法：
 * 1) 自訂 generator：
 *    erpInitAutoId_("so_id", { gen: () => generateId("SO") })
 * 2) 文件/事件類（generateId）：
 *    erpInitAutoId_("so_id", "doc", "SO")
 * 3) 主檔類（generateShortId）：
 *    erpInitAutoId_("c_id", "master", "C")
 */
function erpInitAutoId_(inputId, kindOrOpts, prefixOrOpts) {
  const id = String(inputId || "");
  if(!id) return "";
  const el = document.getElementById(id);
  if(!el) return "";

  let gen = null;
  let force = false;
  let upper = true;

  if(typeof kindOrOpts === "string"){
    const kind = String(kindOrOpts || "").trim().toLowerCase();
    const pref = String(prefixOrOpts || "").trim();
    if(kind === "doc"){
      gen = () => (typeof generateId === "function" ? generateId(pref) : "");
    }else if(kind === "master"){
      gen = () => (typeof generateShortId === "function" ? generateShortId(pref) : "");
    }
  }else{
    const opts = kindOrOpts && typeof kindOrOpts === "object" ? kindOrOpts : {};
    gen = typeof opts.gen === "function" ? opts.gen : null;
    force = !!opts.force;
    upper = opts.upper === false ? false : true;
  }

  if(typeof prefixOrOpts === "object" && prefixOrOpts){
    // 允許第三參數傳 opts（方便從舊呼叫漸進改）
    const o2 = prefixOrOpts;
    if(typeof o2.gen === "function") gen = o2.gen;
    if("force" in o2) force = !!o2.force;
    if("upper" in o2) upper = o2.upper === false ? false : true;
  }

  if(!gen) return String(el.value || "");

  const cur = String(el.value || "").trim();
  if(cur && !force) return cur;

  let next = "";
  try{ next = String(gen() || ""); }catch(_e){ next = ""; }
  next = String(next || "").trim();
  if(upper) next = next.toUpperCase();

  if(next){
    try{ el.value = next; }catch(_e2){}
  }
  return next || cur;
}

/**
 * 下拉與既有資料對齊：若值不在固定選項內，暫時加一筆「舊資料」避免載入後空白。
 * 適用客戶分類／國家、供應商國家、進口原產地等。
 */
function syncSelectWithLegacy_(selectId, storedValue){
  const sel = document.getElementById(selectId);
  if(!sel) return;
  sel.querySelectorAll("option[data-legacy='1']").forEach(function(o){
    o.remove();
  });
  const v = String(storedValue || "").trim();
  if(!v){
    try{
      if(typeof window.erpSetVById_ === "function") return window.erpSetVById_(selectId, "");
    }catch(_e){}
    sel.value = "";
    return;
  }
  const exists = Array.from(sel.options).some(function(o){
    return String(o.value) === v;
  });
  if(!exists){
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v + "（舊資料）";
    opt.dataset.legacy = "1";
    sel.appendChild(opt);
  }
  sel.value = v;
}

/** 數量框旁單位後綴：hidden 存值、span 顯示；無單位時空白（不顯示佔位符）。 */
function syncErpQtyUnitSuffix_(hiddenId, suffixId){
  const h = document.getElementById(hiddenId);
  const s = document.getElementById(suffixId);
  if(!s) return;
  const u = h ? String(h.value || "").trim() : "";
  s.textContent = u;
}

/* =========================================================
   主檔狀態（ACTIVE/INACTIVE）修改權限：僅 CEO/GA/ADMIN
========================================================= */

function erpCanChangeMasterStatus_(){
  try{
    var r = (typeof getCurrentUserRole === "function") ? String(getCurrentUserRole() || "").trim().toUpperCase() : "";
    return r === "CEO" || r === "GA" || r === "ADMIN";
  }catch(_e){
    return false;
  }
}

function erpLockStatusSelect_(selectId){
  var el = document.getElementById(String(selectId || ""));
  if(!el) return;
  var ok = erpCanChangeMasterStatus_();
  el.disabled = !ok;
  el.setAttribute("aria-disabled", ok ? "false" : "true");
  if(!ok){
    el.setAttribute("title","僅 CEO／GA／ADMIN 可修改狀態（ACTIVE/INACTIVE）");
  }else{
    try{ el.removeAttribute("title"); }catch(_e2){}
  }
}

/* =========================================================
   QA / 批次 / 異動 名詞：雙語或白話（新手友善）
========================================================= */
var TERM_LABELS = {
  PENDING: "PENDING（待QA）",
  APPROVED: "APPROVED（QA已放行）",
  REJECTED: "REJECTED（QA已退回）",
  ACTIVE: "ACTIVE（使用中）",
  INACTIVE: "INACTIVE（停用）",
  CLOSED: "CLOSED（已收完）",
  VOID: "VOID（作廢不可用）",
  OPEN: "OPEN（未出貨）",
  PARTIAL: "PARTIAL（部分出貨）",
  CANCELLED: "CANCELLED（已作廢）",
  SHIPPED: "SHIPPED（全數出貨）",
  POSTED: "POSTED（已過帳）",
  PROCESS_OUT: "PROCESS_OUT（加工扣庫）",
  PROCESS_IN: "PROCESS_IN（加工入庫）",
  SHIP_OUT: "SHIP_OUT（出貨扣庫）",
  IN: "IN（入庫）",
  OUT: "OUT（手動扣庫）",
  ADJUST: "ADJUST（調整）",
  PASSED: "PASSED（已通過）",
  FAILED: "FAILED（未通過）",
  INTERNAL_USE: "INTERNAL_USE（內部領用）",
  SAMPLE: "SAMPLE（樣品）",
  NORMAL: "NORMAL（正常訂單）",
  GIFT: "GIFT（贈品）",
  PR: "PR（公關）",
  RESHIP: "RESHIP（補寄）",
  SCRAP: "SCRAP（報廢）",
  OTHER: "OTHER（其他）"
  ,AMBIENT: "AMBIENT（常溫）"
  ,CHILLED: "CHILLED（冷藏）"
  ,FROZEN: "FROZEN（冷凍）"
};

function termLabel(code) {
  if (code == null || code === "") return "";
  var s = String(code).trim().toUpperCase();
  return TERM_LABELS[s] || code;
}

/** 列表等僅顯示中文：termLabel 為「CODE（說明）」時取括號內，否則沿用原字串。 */
function termLabelZhOnly(code) {
  if (code == null || code === "") return "";
  var full = (typeof termLabel === "function" ? termLabel(code) : String(code)) || "";
  var m = String(full).match(/^([A-Z0-9_]+)（([^）]+)）$/);
  if (m) return m[2];
  return full;
}

/**
 * 狀態徽章內文：英文碼一行、（中文說明）下一行（對齊 termLabel「CODE（說明）」）
 */
function termStatusBadgeInnerHtml(code){
  var full = (typeof termLabel === "function" ? termLabel(code) : String(code || "")) || "";
  var esc = function(t){
    return String(t || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  };
  var m = String(full).match(/^([A-Z0-9_]+)（([^）]+)）$/);
  if(m){
    return '<span class="badge-line badge-line-en">' + esc(m[1]) + '</span>' +
      '<span class="badge-line badge-line-zh">（' + esc(m[2]) + '）</span>';
  }
  return esc(full);
}

/**
 * 主檔列表狀態：僅燈號（hover 可看完整說明，與表單旁燈號同色）
 */
function termStatusLampHtml(code){
  var raw = String(code == null ? "" : code).trim();
  var st = raw.toUpperCase();
  var active = st === "ACTIVE";
  var inactive = st === "INACTIVE";
  var esc = function(t){
    return String(t || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  };
  var normCode = active ? "ACTIVE" : (inactive ? "INACTIVE" : (raw || "INACTIVE"));
  var labelFull = (typeof termLabelZhOnly === "function" ? termLabelZhOnly(normCode) : ((typeof termLabel === "function" ? termLabel(normCode) : normCode) || normCode)) || normCode;
  var modClass = active ? "status-lamp--active" : (inactive ? "status-lamp--inactive" : "status-lamp--unknown");
  return (
    '<span class="status-lamp status-lamp--solo ' + modClass + '" title="' + esc(labelFull) + '" aria-label="' + esc(labelFull) + '" role="img">' +
    '<span class="status-lamp-dot" aria-hidden="true"></span></span>'
  );
}

/**
 * 主檔表單：依狀態下拉目前值更新旁邊燈號（lamp 預設 id = selectId + "_lamp"）
 */
function syncStatusSelectLamp_(selectId, lampId){
  var sel = document.getElementById(selectId);
  var lamp = document.getElementById(lampId || (selectId + "_lamp"));
  if(!sel || !lamp) return;
  var raw = String(sel.value || "").trim();
  var st = raw.toUpperCase();
  var active = st === "ACTIVE";
  var inactive = st === "INACTIVE";
  var normCode = active ? "ACTIVE" : (inactive ? "INACTIVE" : (raw || "INACTIVE"));
  var labelFull = (typeof termLabel === "function" ? termLabel(normCode) : normCode) || normCode;
  var modClass = active ? "status-lamp--active" : (inactive ? "status-lamp--inactive" : "status-lamp--unknown");
  lamp.className = "status-lamp status-lamp--solo " + modClass;
  lamp.setAttribute("title", labelFull);
  lamp.setAttribute("aria-label", labelFull);
  lamp.setAttribute("role", "img");
  lamp.innerHTML = '<span class="status-lamp-dot" aria-hidden="true"></span>';
}

function bindStatusSelectLamp_(selectId, lampId){
  var sel = document.getElementById(selectId);
  if(!sel || sel.dataset.statusLampBound) return;
  sel.dataset.statusLampBound = "1";
  var lid = lampId || (selectId + "_lamp");
  sel.addEventListener("change", function(){
    syncStatusSelectLamp_(selectId, lid);
  });
  syncStatusSelectLamp_(selectId, lid);
}

/**
 * 取「短中文」標籤（常用於下拉/列表的倉別等）
 * - 若 termLabel(term) 形如 "AMBIENT（常溫）" → 回傳 "常溫"
 * - 否則回傳 termLabel(term)（或原字串）
 */
function termShortZh_(term){
  var full = (typeof termLabel === "function" ? termLabel(term) : String(term || "")) || "";
  var m = String(full).match(/（([^）]+)）/);
  return m ? m[1] : String(full || "");
}

/* =========================================================
   UI 基礎：Toast / Uppercase Input
========================================================= */

function showToast(message, type="success", durationMsOverride){
  const toast = document.getElementById("toast");
  if(!toast) return alert(message);

  toast.innerText = String(message || "");
  toast.className = "toast show " + type;
  const t = String(type || "").toLowerCase();
  // 對齊：success/warn/error 預設皆 6 秒
  const durationMsDefault = 6000;
  const durationMs = Number(durationMsOverride) > 0 ? Number(durationMsOverride) : durationMsDefault;
  setTimeout(()=>{ toast.className = "toast"; }, durationMs);
}

/**
 * 載入中提示（橘色 warn）：不固定秒數，會跟著流程結束關閉
 * - 回傳 token，結束時用 token 關閉，避免「後續訊息」被誤關掉
 */
function erpBeginLoadWarnToast_(message){
  try{
    const toast = document.getElementById("toast");
    if(!toast) return "";
    const token = "loadwarn-" + Date.now() + "-" + Math.floor(Math.random()*100000);
    const w = (typeof window !== "undefined" && window) ? window : {};
    w.__ERP_LOADWARN_TOAST_TOKEN__ = token;
    toast.innerText = String(message || "載入中…");
    toast.className = "toast show warn";
    // 不讓它自動消失：給一個極長時間（真正關閉由 end 來做）
    setTimeout(function(){
      try{
        if(w.__ERP_LOADWARN_TOAST_TOKEN__ === token){
          toast.className = "toast";
        }
      }catch(_e){}
    }, 10 * 60 * 1000);
    return token;
  }catch(_e){
    return "";
  }
}

function erpEndLoadWarnToast_(token){
  try{
    const toast = document.getElementById("toast");
    if(!toast) return;
    const w = (typeof window !== "undefined" && window) ? window : {};
    if(!token) return;
    if(String(w.__ERP_LOADWARN_TOAST_TOKEN__ || "") !== String(token)) return;
    w.__ERP_LOADWARN_TOAST_TOKEN__ = "";
    toast.className = "toast";
  }catch(_e){}
}

function bindUppercaseInput(elementId){
  const el = document.getElementById(elementId);
  if(!el) return;
  if(el.dataset.uppercaseBound) return;
  el.dataset.uppercaseBound = "1";

  el.addEventListener("input", () => {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const upper = (el.value || "").toUpperCase();
    if(el.value !== upper){
      el.value = upper;
      if(start != null && end != null){
        el.setSelectionRange(start, end);
      }
    }
  });
}

/* =========================================================
   UX：列表按 Load 後捲到上方編輯區
========================================================= */

function scrollToEditorTop(){
  try{
    // 這個專案的滾動容器是 #content（不是整個 window）
    const content = document.getElementById("content");
    if(content && typeof content.scrollTo === "function"){
      content.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }catch(_e){
    try{
      const content = document.getElementById("content");
      if(content) content.scrollTop = 0;
      window.scrollTo(0,0);
    }catch(_e2){}
  }
}

/* =========================================================
   UX：資料表 tbody 載入中（與收貨「已收列表」同風格）
========================================================= */

function setTbodyLoading_(tbodyOrId, colspan, message){
  const tbody = typeof tbodyOrId === "string" ? document.getElementById(tbodyOrId) : tbodyOrId;
  if(!tbody) return;
  const n = Math.max(1, Number(colspan) || 1);
  const msg = message == null || message === "" ? "載入中…" : String(message);
  const esc = msg.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  tbody.innerHTML =
    `<tr><td colspan="${n}" style="text-align:center;color:#64748b;padding:18px;">${esc}</td></tr>`;
}

/* =========================================================
   參考關聯檢查（停用策略用）
========================================================= */

async function isIdUsedInAny(idValue, refs){
  const id = String(idValue || "");
  const list = Array.isArray(refs) ? refs : [];
  if(!id || list.length === 0) return false;

  // 簡單快取：避免同一輪重複打 API
  const cache = {};

  for(const r of list){
    const type = r?.type;
    const field = r?.field;
    if(!type || !field) continue;

    if(!cache[type]){
      // 這是「停用前的提醒用檢查」：若因權限不足/網路等原因讀不到，不應噴錯干擾主流程
      cache[type] = await getAll(type, { silent: true }).catch(()=>[]);
    }
    const rows = cache[type] || [];
    if(rows.some(x => String(x[field] || "") === id)){
      return true;
    }
  }
  return false;
}

/* =========================================================
   搜尋列：輸入／下拉變更即篩選（比照 Logs，不必再按「搜尋」）
========================================================= */

/**
 * @param {Array<[string, "input"|"change"]>} controls - [元素 id, 事件名稱]
 * @param {Function} callback - 例如 searchProducts 或 () => renderShipments()
 */
function bindAutoSearchToolbar_(controls, callback){
  if(!Array.isArray(controls) || typeof callback !== "function") return;
  controls.forEach(function(pair){
    const id = pair[0];
    const ev = pair[1] || "input";
    const el = document.getElementById(id);
    if(!el) return;
    if(el.dataset.erpAutoSearchBound) return;
    el.dataset.erpAutoSearchBound = "1";
    el.addEventListener(ev, function(){
      try{
        const ret = callback();
        if(ret && typeof ret.then === "function"){
          ret.catch(function(){});
        }
      }catch(_e){}
    });
  });
}

/* =========================================================
  單位換算（主檔規則）
========================================================= */

function normalizeUnit(unit){
  return String(unit || "").trim().toUpperCase();
}

function parseUnitRatioToBaseMap(raw){
  if(raw == null || raw === "") return {};
  let obj = raw;
  if(typeof raw === "string"){
    try{
      obj = JSON.parse(raw);
    }catch(_e){
      return null;
    }
  }
  if(!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const out = {};
  Object.keys(obj).forEach(k => {
    const key = normalizeUnit(k);
    const val = Number(obj[k]);
    if(!key) return;
    if(!(val > 0)) return;
    out[key] = val;
  });
  return out;
}

function parseProductUomConfigFromRemark_(remark){
  const text = String(remark || "");
  const m = text.match(/@UOM:\s*(\{[\s\S]*?\})\s*(?:\n|$)/);
  if(!m) return null;
  try{
    const obj = JSON.parse(m[1]);
    if(!obj || typeof obj !== "object") return null;
    const base = normalizeUnit(obj.base_unit || "");
    const map = parseUnitRatioToBaseMap(obj.map || {});
    if(!base) return null;
    if(map === null) return null;
    return { base_unit: base, map: map || {} };
  }catch(_e){
    return null;
  }
}

/** 從 product.uom_config 欄位解析（與 @UOM JSON 相同結構） */
function parseProductUomConfigFromField_(uomRaw){
  const text = String(uomRaw || "").trim();
  if(!text) return null;
  try{
    const obj = JSON.parse(text);
    if(!obj || typeof obj !== "object") return null;
    const base = normalizeUnit(obj.base_unit || "");
    const map = parseUnitRatioToBaseMap(obj.map || {});
    if(!base) return null;
    if(map === null) return null;
    return { base_unit: base, map: map || {} };
  }catch(_e){
    return null;
  }
}

/**
 * 讀取產品多單位設定：優先 uom_config，其次備註內舊版 @UOM:
 */
function getProductUomConfig(product){
  const p = product || {};
  const fromField = parseProductUomConfigFromField_(p.uom_config);
  if(fromField) return fromField;
  return parseProductUomConfigFromRemark_(p.remark);
}

function upsertProductUomRemark(remark, cfg){
  const raw = String(remark || "");
  const cleaned = raw.replace(/\n?@UOM:\s*\{[\s\S]*?\}\s*(?:\n|$)/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if(!cfg) return cleaned;
  const base = normalizeUnit(cfg.base_unit || "");
  const map = cfg.map && typeof cfg.map === "object" ? cfg.map : {};
  const json = JSON.stringify({ base_unit: base, map }, null, 0);
  return (cleaned ? (cleaned + "\n") : "") + `@UOM:${json}`;
}

function stripProductUomRemark(remark){
  const raw = String(remark || "");
  return raw.replace(/\n?@UOM:\s*\{[\s\S]*?\}\s*(?:\n|$)/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 將 qty + unit 轉為產品基準單位數量
 * 規則：
 * - unit === base_unit 時直接回傳 qty
 * - 否則查 product.unit_ratio_to_base_json[unit]
 * - 找不到或格式錯誤時回傳 null
 */
function convertToBase(product, qty, unit){
  const q = Number(qty);
  if(!Number.isFinite(q)) return null;
  const p = product || {};
  const cfg = getProductUomConfig(p);
  const baseUnit = normalizeUnit(cfg?.base_unit || p.unit || "");
  const srcUnit = normalizeUnit(unit || p.unit || "");
  if(!baseUnit || !srcUnit) return null;
  if(srcUnit === baseUnit) return q;

  const map = cfg ? (cfg.map || {}) : {};
  if(!map) return null;
  const rate = Number(map[srcUnit] || 0);
  if(!(rate > 0)) return null;
  return q * rate;
}

/* =========================================================
  PDF/列印（前端：另存為 PDF）
========================================================= */

function erpEscapeHtml_(s){
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function erpOpenPrintWindow_(title, bodyHtml){
  const t = String(title || "ERP");
  const w = window.open("", "_blank");
  if(!w) throw new Error("popup blocked");
  const cfg = (typeof window === "object" && window && window.__ERP_CONFIG__) ? window.__ERP_CONFIG__ : {};
  const logoUrlRaw = String(cfg && (cfg.COMPANY_LOGO_URL || "") || "").trim();
  const logoUrl = (function(){
    const u = String(logoUrlRaw || "").trim();
    if(!u) return "";
    if(/^data:/i.test(u)) return u;
    if(/^https?:\/\//i.test(u)) return u;
    // print window 是 about:blank，相對路徑會失效；這裡統一轉成絕對 URL
    try{ return new URL(u, String(location && location.href || "")).href; }catch(_e){ return u; }
  })();
  const nameZh = String(cfg && (cfg.COMPANY_NAME_ZH || "") || "").trim();
  const nameEn = String(cfg && (cfg.COMPANY_NAME_EN || "") || "").trim();
  const headerHtml = (function(){
    if(!logoUrl && !nameZh && !nameEn) return "";
    const logo = logoUrl ? `<img class="brand-logo" src="${erpEscapeHtml_(logoUrl)}" alt="logo">` : "";
    const zh = nameZh ? `<div class="brand-zh">${erpEscapeHtml_(nameZh)}</div>` : "";
    const en = nameEn ? `<div class="brand-en">${erpEscapeHtml_(nameEn)}</div>` : "";
    const names = (zh || en) ? `<div class="brand-names">${zh}${en}</div>` : "";
    // 若沒有文字，就只顯示大 Logo（置中）
    return `<div class="brand ${names ? "has-names" : "logo-only"}">${logo}${names}</div>`;
  })();
  const css = `
    :root{ --fg:#0f172a; --muted:#475569; --line:#e2e8f0; }
    *{ box-sizing:border-box; }
    body{ font-family: system-ui, -apple-system, "Segoe UI", Arial, "Noto Sans TC", sans-serif; color:var(--fg); margin:18px; }
    .brand{ display:flex; align-items:center; justify-content:center; gap:12px; padding-bottom:8px; margin-bottom:10px; }
    .brand.logo-only{ padding-bottom:12px; }
    .brand-logo{ width:auto; height:75px; max-width:900px; object-fit:contain; }
    .brand-names{ display:flex; flex-direction:column; gap:2px; }
    .brand-zh{ font-size:16px; font-weight:700; line-height:1.2; }
    .brand-en{ font-size:12.5px; color:var(--muted); line-height:1.2; margin-top:2px; }
    h1{ font-size:18px; margin:0 0 8px 0; }
    .meta{ color:var(--muted); font-size:12px; margin-bottom:12px; line-height:1.5; }
    .grid{ display:grid; grid-template-columns: 1fr 1fr; gap:8px 18px; margin:10px 0 14px; }
    .kv{ font-size:12.5px; }
    .k{ color:var(--muted); margin-right:6px; }
    table{ width:100%; border-collapse:collapse; font-size:12px; }
    th,td{ border:1px solid var(--line); padding:6px 8px; vertical-align:middle; }
    th{ background:#eef2f7; text-align:left; }
    .foot{ margin-top:16px; font-size:12px; color:var(--muted); }
    .foot.right{ text-align:right; }
    @media print{
      *{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body{ margin:10mm; }
      a{ color:inherit; text-decoration:none; }
    }
  `;
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${erpEscapeHtml_(t)}</title><style>${css}</style></head><body>${headerHtml}${bodyHtml || ""}</body></html>`);
  w.document.close();
  try{ w.focus(); }catch(_e){}
  setTimeout(function(){
    try{ w.print(); }catch(_e){}
  }, 50);
  return w;
}

