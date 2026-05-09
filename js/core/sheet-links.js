/**
 * Sheet 連結（方案 B：DEV/PROD 不同試算表）
 * - Spreadsheet ID 由後端 `env_info` 回傳（避免正式站開到測試表）
 * - 每個按鈕仍維持「開對應分頁」：用 key→gid 組出網址
 *
 * 若你「複製」試算表建立 DEV/PROD，gid 通常會改變：
 * - 建議在各 Apps Script 專案 Script Properties 設 `SHEET_GIDS_JSON`
 * - 未設定時會使用本檔的 DEFAULT_SHEET_GIDS_（適用於目前既有那份表）
 */
let ERP_SPREADSHEET_ID_CACHE_ = "";
let ERP_SHEET_GIDS_CACHE_ = null;
let ERP_ENV_INFO_PROMISE_ = null;

function erpEnvInfoLsKey_(){
  try{
    const base = (typeof window === "object" && window && window.__ERP_CONFIG__ && window.__ERP_CONFIG__.API_BASE)
      ? String(window.__ERP_CONFIG__.API_BASE || "").trim()
      : "";
    if(!base) return "erp_env_info_cache_v1";
    // 用 API_BASE 分隔 DEV/PROD；避免同一台電腦切環境時快取互相污染
    return "erp_env_info_cache_v1@" + base;
  }catch(_e){
    return "erp_env_info_cache_v1";
  }
}
const ERP_ENV_INFO_LS_TTL_MS_ = 7 * 24 * 60 * 60 * 1000; // 7 days

function loadEnvInfoFromLocal_(){
  try{
    if(typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(erpEnvInfoLsKey_());
    if(!raw) return;
    const obj = JSON.parse(raw);
    const ts = Number(obj && obj.ts || 0);
    if(!ts || (Date.now() - ts) > ERP_ENV_INFO_LS_TTL_MS_) return;
    const sid = String(obj && obj.spreadsheet_id || "").trim();
    const gids = obj && obj.sheet_gids && typeof obj.sheet_gids === "object" ? obj.sheet_gids : null;
    if(sid) ERP_SPREADSHEET_ID_CACHE_ = sid;
    if(gids) ERP_SHEET_GIDS_CACHE_ = gids;
  }catch(_e){}
}

function saveEnvInfoToLocal_(sid, gids){
  try{
    if(typeof localStorage === "undefined") return;
    const spreadsheet_id = String(sid || "").trim();
    const sheet_gids = (gids && typeof gids === "object") ? gids : null;
    if(!spreadsheet_id) return;
    localStorage.setItem(erpEnvInfoLsKey_(), JSON.stringify({
      ts: Date.now(),
      spreadsheet_id,
      sheet_gids
    }));
  }catch(_e){}
}

const DEFAULT_SHEET_GIDS_ = {
  product: 1114076682,
  supplier: 99221118,
  customer: 1601673747,
  warehouse: 267971627,
  user: 1751545572,

  purchase_order: 1975679446,
  purchase_order_item: 1592901409,

  import_document: 1372231910,
  import_item: 1501371837,

  goods_receipt: 280711382,
  goods_receipt_item: 2022541079,

  import_receipt: 1725385985,
  import_receipt_item: 478887238,

  lot: 11316360,
  lot_relation: 783277553,

  process_order: 356318207,
  process_order_input: 37876354,
  process_order_output: 1313935145,

  sales_order: 1520633879,
  sales_order_item: 1113223744,

  shipment: 1147399524,
  shipment_item: 1610733267,

  inventory_movement: 88937962,
  logs: 475164289
};

async function getSpreadsheetIdFromBackend_(){
  if(ERP_SPREADSHEET_ID_CACHE_) return ERP_SPREADSHEET_ID_CACHE_;
  const info = await getEnvInfoFromBackend_();
  return ERP_SPREADSHEET_ID_CACHE_ || String(info?.spreadsheet_id || "").trim() || "";
}

async function getSheetGidsFromBackend_(){
  if(ERP_SHEET_GIDS_CACHE_) return ERP_SHEET_GIDS_CACHE_;
  const info = await getEnvInfoFromBackend_();
  return ERP_SHEET_GIDS_CACHE_ || info?.sheet_gids || null;
}

async function getEnvInfoFromBackend_(){
  if(ERP_SPREADSHEET_ID_CACHE_ && ERP_SHEET_GIDS_CACHE_) return { spreadsheet_id: ERP_SPREADSHEET_ID_CACHE_, sheet_gids: ERP_SHEET_GIDS_CACHE_ };
  if(typeof callAPI !== "function") return null;

  if(!ERP_ENV_INFO_PROMISE_){
    ERP_ENV_INFO_PROMISE_ = (async function(){
      try{
        const res = await callAPI({ action: "env_info" }, { method: "GET", silent: true });
        const sid = String(res?.spreadsheet_id || res?.data?.spreadsheet_id || "").trim();
        const g = res?.sheet_gids || res?.data?.sheet_gids || null;
        if(sid) ERP_SPREADSHEET_ID_CACHE_ = sid;
        if(g && typeof g === "object") ERP_SHEET_GIDS_CACHE_ = g;
        if(sid) saveEnvInfoToLocal_(sid, (g && typeof g === "object") ? g : null);
        return { spreadsheet_id: sid, sheet_gids: g };
      }catch(_e){
        return null;
      }finally{
        // 失敗也清掉，避免卡死在 rejected promise
        ERP_ENV_INFO_PROMISE_ = null;
      }
    })();
  }
  return await ERP_ENV_INFO_PROMISE_;
}

function buildSheetUrl_(spreadsheetId, key, gids){
  const sid = String(spreadsheetId || "").trim();
  if(!sid) return "";
  const k = String(key || "").trim();
  const gidRaw = gids && k ? gids[k] : null;
  const gid = gidRaw === 0 ? 0 : Number(gidRaw || "");
  if(Number.isFinite(gid)){
    return `https://docs.google.com/spreadsheets/d/${sid}/edit?gid=${gid}#gid=${gid}`;
  }
  return `https://docs.google.com/spreadsheets/d/${sid}/edit`;
}

function erpCanOpenSheet_(){
  try{
    const r = (typeof getCurrentUserRole === "function" ? String(getCurrentUserRole() || "") : "").trim().toUpperCase();
    return r === "CEO" || r === "GA" || r === "ADMIN";
  }catch(_e){
    return false;
  }
}

function erpApplySheetPermissions(){
  try{
    const ok = erpCanOpenSheet_();
    document.querySelectorAll("button.btn-sheet").forEach(btn=>{
      btn.style.display = ok ? "" : "none";
      btn.setAttribute("aria-hidden", ok ? "false" : "true");
    });
  }catch(_e){}
}
try{ window.erpApplySheetPermissions = erpApplySheetPermissions; }catch(_e0){}

/**
 * @param {keyof typeof SHEET_LINKS} key
 */
async function openSheetLink(key) {
  // Sheet 連結視為「管理/維運」入口：預設僅 CEO/GA/ADMIN 可開
  try{
    const ok = erpCanOpenSheet_();
    if(!ok){
      if (typeof showToast === "function") showToast("僅 CEO/總務/ADMIN 可開啟 Sheet。", "error");
      return;
    }
  }catch(_e0){}

  // 先用本機快取/記憶體快取秒開；同時背景更新 env_info
  const sidFast = ERP_SPREADSHEET_ID_CACHE_;
  const gidsFast = ERP_SHEET_GIDS_CACHE_ || DEFAULT_SHEET_GIDS_;
  const fastUrl = buildSheetUrl_(sidFast, key, gidsFast);
  if(fastUrl){
    try{ getEnvInfoFromBackend_(); }catch(_eBg){}
    window.open(fastUrl, "_blank", "noopener,noreferrer");
    return;
  }

  const sid = await getSpreadsheetIdFromBackend_();
  const gids = (await getSheetGidsFromBackend_()) || DEFAULT_SHEET_GIDS_;
  const url = buildSheetUrl_(sid, key, gids);
  if(!url){
    if (typeof showToast === "function") showToast("取得試算表連結失敗（請確認後端 env_info 與權限）", "error");
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * 兼容：部分環境可能擋 inline onclick，導致 Sheet 按鈕無反應。
 * 這裡用事件委派把 `.btn-sheet` 點擊導向 openSheetLink。
 */
function bindSheetButtons_(){
  try{
    if(document.documentElement && document.documentElement.getAttribute("data-erp-sheetbind") === "1") return;
    if(document.documentElement) document.documentElement.setAttribute("data-erp-sheetbind","1");
  }catch(_e){}

  document.addEventListener("click", function(ev){
    const t = ev && ev.target;
    if(!t) return;
    const btn = (typeof t.closest === "function") ? t.closest("button.btn-sheet") : null;
    if(!btn) return;

    // 支援：HTML 仍用 onclick="openSheetLink('xxx')"
    const raw = String(btn.getAttribute("onclick") || "");
    const m = raw.match(/openSheetLink\(\s*['"]([^'"]+)['"]\s*\)/i);
    const key = m && m[1] ? String(m[1]).trim() : "";
    if(!key) return;

    try{
      ev.preventDefault();
      ev.stopPropagation();
    }catch(_e2){}

    try{
      openSheetLink(key);
    }catch(_e3){
      if(typeof showToast === "function") showToast("開啟 Sheet 失敗", "error");
    }
  }, true);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", function(){
    // 讀取本機快取：讓重開頁面也能秒開 Sheet
    loadEnvInfoFromLocal_();
    bindSheetButtons_();
    erpApplySheetPermissions();
    // 預熱：避免使用者第一次點 Sheet 等後端 env_info
    try{ getEnvInfoFromBackend_(); }catch(_eW){}
  });
}else{
  loadEnvInfoFromLocal_();
  bindSheetButtons_();
  erpApplySheetPermissions();
  try{ getEnvInfoFromBackend_(); }catch(_eW2){}
}
