let logsCache = [];
let logsTab = "all";
let currentOpenLogId = null;
let logsLoadInFlight_ = false;
let logsPendingReload_ = false;

function logsSetV_(id, v){
  try{
    if(typeof window.erpSetVById_ === "function") return window.erpSetVById_(id, v);
  }catch(_e){}
  const el = document.getElementById(String(id || ""));
  if(el && "value" in el) el.value = v;
}

function logsClear_(ids){
  try{
    if(typeof window.erpClearIds_ === "function") return window.erpClearIds_(ids);
  }catch(_e){}
  const list = Array.isArray(ids) ? ids : [ids];
  for(let i = 0; i < list.length; i++){
    const el = document.getElementById(String(list[i] || ""));
    if(el && "value" in el) el.value = "";
  }
}

/**
 * 與左側選單區塊對齊：主檔 / 進貨 / 庫存 / 加工 / 銷售 / 出貨
 * （舊鍵 purchase→inbound、shipping→sales+shipment 已拆成兩顆）
 */
const LOG_TAB_TABLES = {
  all: null,
  master: ["product","supplier","customer","user"],
  inbound: [
    "purchase_order","purchase_order_item",
    "import_document","import_item","import_receipt","import_receipt_item",
    "goods_receipt","goods_receipt_item"
  ],
  inventory: ["lot","inventory_movement","lot_relation","lot_balance"],
  process: ["process_order","process_order_input","process_order_output"],
  sales: ["sales_order","sales_order_item"],
  shipment: ["shipment","shipment_item"]
};

/** 資料表名稱：英文（中文）供下拉與列表顯示 */
const LOG_TABLE_LABELS = {
  product: "product（產品）",
  supplier: "supplier（供應商）",
  customer: "customer（客戶）",
  user: "user（使用者）",
  purchase_order: "purchase_order（採購單）",
  purchase_order_item: "purchase_order_item（採購明細）",
  import_document: "import_document（進口報單）",
  import_item: "import_item（報單品項）",
  import_receipt: "import_receipt（進口收貨）",
  import_receipt_item: "import_receipt_item（進口收貨明細）",
  goods_receipt: "goods_receipt（收貨入庫）",
  goods_receipt_item: "goods_receipt_item（收貨明細）",
  lot: "lot（批次）",
  inventory_movement: "inventory_movement（庫存異動）",
  lot_relation: "lot_relation（批次關聯）",
  process_order: "process_order（加工單）",
  process_order_input: "process_order_input（加工投料）",
  process_order_output: "process_order_output（加工產出）",
  sales_order: "sales_order（銷售單）",
  sales_order_item: "sales_order_item（銷售明細）",
  shipment: "shipment（出貨單）",
  shipment_item: "shipment_item（出貨明細）",
  lot_balance: "lot_balance（庫存快照）",
  logs: "logs（操作紀錄）"
};

function logsDaysFromRange_(rangeVal) {
  const r = String(rangeVal || "7");
  if (r === "all") return 3650;
  const n = Number(r);
  return isNaN(n) ? 90 : n;
}

function getLogTableLabel_(tableName){
  const t = String(tableName || "").trim();
  return LOG_TABLE_LABELS[t] || t;
}

/** 相容舊分頁鍵 purchase→inbound */
function normalizeLogsTab_(tab){
  const k = String(tab || "all");
  if(k === "purchase") return "inbound";
  return k;
}

// 其他模組用：先設定條件，再跳到 Logs 頁面
// openLogs('product','P001','master')
function openLogs(tableName = "", referenceId = "", tab = "all") {
  try {
    window.__pendingOpenLogs = {
      tableName: String(tableName || ""),
      referenceId: String(referenceId || ""),
      tab: String(tab || "all"),
      at: Date.now(),
    };
  } catch (_e) {}
  if (typeof navigate === "function") navigate("logs");
}

function escapeHtml(input){
  const s = (input ?? "").toString();
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ===== 時間：針對 nowIso16() 風格（不含時區尾碼）做「純本地」顯示/排序 ===== */
function parseIsoNoTzParts_(raw){
  const s = String(raw || "").trim();
  // 只處理：YYYY-MM-DDTHH:mm(:ss(.sss))?，且不含 Z / +08:00 / -08:00
  // 例如：2026-03-25T14:38 / 2026-03-25T14:38:12 / 2026-03-25T14:38:12.123
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
  if(!m) return null;
  return {
    yyyy: m[1],
    mm: m[2],
    dd: m[3],
    hh: m[4],
    mi: m[5]
  };
}

function parseIsoNoTzAsLocalDate_(raw){
  const parts = parseIsoNoTzParts_(raw);
  if(!parts) return null;
  const yyyy = Number(parts.yyyy);
  const mm = Number(parts.mm);
  const dd = Number(parts.dd);
  const hh = Number(parts.hh);
  const mi = Number(parts.mi);
  const d = new Date(yyyy, mm-1, dd, hh, mi, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatLocalTime(dateStr){
  if(!dateStr) return "";
  const raw = String(dateStr || "").trim();
  const parts = parseIsoNoTzParts_(raw);
  if(parts){
    return `${parts.yyyy}-${parts.mm}-${parts.dd} ${parts.hh}:${parts.mi}`;
  }
  const d = new Date(raw);
  if(isNaN(d)) return raw;

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  const hh = String(d.getHours()).padStart(2,"0");
  const mi = String(d.getMinutes()).padStart(2,"0");

  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

/* ===== 分頁 ===== */
function setLogsTab(tab){
  logsTab = normalizeLogsTab_(tab || "all");
  updateLogsTabUI();
  applyLogsFilter();
}

function updateLogsTabUI(){
  const mapping = {
    all: "logs_tab_all",
    master: "logs_tab_master",
    inbound: "logs_tab_inbound",
    inventory: "logs_tab_inventory",
    process: "logs_tab_process",
    sales: "logs_tab_sales",
    shipment: "logs_tab_shipment"
  };

  Object.entries(mapping).forEach(([key, id]) => {
    const btn = document.getElementById(id);
    if(!btn) return;
    btn.classList.toggle("btn-primary", logsTab === key);
    btn.classList.toggle("btn-secondary", logsTab !== key);
  });
}

/* ===== 日期處理 ===== */
function parseLogDate(createdAt){
  if(!createdAt) return null;
  const raw = String(createdAt || "").trim();
  const local = parseIsoNoTzAsLocalDate_(raw);
  if(local) return local;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clearLogDetail_(){
  const area = document.getElementById("logsDetailArea");
  if(area) area.innerHTML = "";
  currentOpenLogId = null;
}

/* ===== 初始化 ===== */
async function logsInit(){
  await loadLogs();

  initLogsTableOptions_();

  ["logs_search_keyword","logs_search_action",
   "logs_filter_table",
   "logs_filter_range"].forEach(id=>{
     const el = document.getElementById(id);
     if(!el) return;
     el.addEventListener(id.includes("keyword") ? "input" : "change", function(){
       if(id === "logs_filter_range"){
         loadLogs().then(function(){ applyLogsFilter(); initLogsTableOptions_(); });
       }else{
         applyLogsFilter();
       }
     });
   });

  updateLogsTabUI();
  applyPendingOpenLogs_();
  applyLogsFilter();
}

/* ===== 讀取資料 ===== */
async function loadLogs(){
  if(logsLoadInFlight_){
    logsPendingReload_ = true;
    return;
  }
  logsLoadInFlight_ = true;
  setTbodyLoading_("logsTableBody", 7);
  try{
    const pending = window.__pendingOpenLogs;
    const rangeEl = document.getElementById("logs_filter_range");
    const days = logsDaysFromRange_(pending ? "all" : (rangeEl && rangeEl.value));
    let rows = null;

    if(pending && pending.referenceId){
      try{
        const r = await callAPI({
          action: "list_logs_by_ref",
          table_name: String(pending.tableName || ""),
          reference_id: String(pending.referenceId || ""),
          days: days,
          _ts: String(Date.now())
        }, { method: "POST" });
        rows = typeof erpParseArrayDataResponse_ === "function" ? erpParseArrayDataResponse_(r) : [];
      }catch(_eRef){ rows = null; }
    }

    if(!Array.isArray(rows)){
      try{
        const r = await callAPI({
          action: "list_logs_recent",
          days: days,
          limit: "2000",
          _ts: String(Date.now())
        }, { method: "POST" });
        rows = typeof erpParseArrayDataResponse_ === "function" ? erpParseArrayDataResponse_(r) : [];
      }catch(_eRecent){
        rows = await getAll("logs").catch(() => []);
      }
    }

    logsCache = Array.isArray(rows) ? rows : [];

    logsCache.sort((a,b)=>{
      const ta = parseLogDate(a.created_at)?.getTime() || 0;
      const tb = parseLogDate(b.created_at)?.getTime() || 0;
      if(tb !== ta) return tb - ta;
      return (b.log_id || "").localeCompare(a.log_id || "");
    });
  } finally {
    logsLoadInFlight_ = false;
    if(logsPendingReload_){
      logsPendingReload_ = false;
      setTimeout(function(){
        try{ loadLogs().then(()=>applyLogsFilter()); }catch(_e){}
      }, 0);
    }
  }
}

/* ===== 篩選 ===== */
function applyLogsFilter(){
  // 只要切換任一篩選條件，就收起已展開的明細
  clearLogDetail_();

  const keyword = (document.getElementById("logs_search_keyword")?.value || "").toLowerCase();
  const action = document.getElementById("logs_search_action")?.value || "";
  const table = document.getElementById("logs_filter_table")?.value || "";
  const range = document.getElementById("logs_filter_range")?.value || "7";

  const now = Date.now();
  const rangeMs = range === "all" ? null :
    Number(range) === 30 ? 30*24*60*60*1000 :
    7*24*60*60*1000;

  const filtered = logsCache.filter(l=>{
    // tab filter
    const allowTables = LOG_TAB_TABLES[logsTab] ?? null;
    if(Array.isArray(allowTables) && allowTables.length){
      if(!allowTables.includes(l.table_name)) return false;
    }

    if(action){
      if(action === "BUNDLE"){
        if(!String(l.action_type || "").startsWith("BUNDLE_")) return false;
      }else if(l.action_type !== action) return false;
    }
    if(table && l.table_name !== table) return false;

    if(rangeMs != null){
      const d = parseLogDate(l.created_at);
      if(d && now - d.getTime() > rangeMs) return false;
    }

    const text = [
      l.log_id,
      l.table_name,
      l.reference_id,
      l.action_type,
      l.created_by,
      l.old_value,
      l.new_value
    ].join(" ").toLowerCase();

    if(keyword && !text.includes(keyword)) return false;

    return true;
  });

  renderLogs(filtered);
}

/* ===== 表格渲染 ===== */
function renderLogs(list){
  const tbody = document.getElementById("logsTableBody");
  if(!tbody) return;

  tbody.innerHTML = "";

  const countEl = document.getElementById("logsCountText");
  if(countEl) countEl.textContent = `顯示 ${list.length} 筆`;

  list.forEach(l=>{
    const encoded = encodeURIComponent(JSON.stringify(l));

    const tr = document.createElement("tr");
    const act = String(l.action_type || "");
    tr.innerHTML = `
      <td>${l.log_id || ""}</td>
      <td>${escapeHtml(getLogTableLabel_(l.table_name))}</td>
      <td>${escapeHtml(l.reference_id || "")}</td>
      <td title="${escapeHtml(act)}">${escapeHtml(act)}</td>
      <td>${escapeHtml(l.created_by || "")}</td>
      <td>${formatLocalTime(l.created_at)}</td>
      <td>
        <span class="logs-view-link"
          onclick="showLogDetail('${encoded}')">
          View
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function initLogsTableOptions_() {
  const sel = document.getElementById("logs_filter_table");
  if (!sel) return;
  const tables = Array.from(new Set((logsCache || []).map(l => l.table_name).filter(Boolean))).sort();
  sel.innerHTML =
    `<option value="">全部資料表</option>` +
    tables.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(getLogTableLabel_(t))}</option>`).join("");
}

function applyPendingOpenLogs_() {
  const pending = window.__pendingOpenLogs;
  if (!pending) return;

  const tableSel = document.getElementById("logs_filter_table");
  const keywordEl = document.getElementById("logs_search_keyword");
  const rangeSel = document.getElementById("logs_filter_range");
  const actionSel = document.getElementById("logs_search_action");

  // 分頁（相容舊鍵 purchase；shipping 依資料表拆成 銷售單 / 出貨）
  const ptab = String(pending.tab || "all");
  if(ptab === "purchase") setLogsTab("inbound");
  else if(ptab === "shipping"){
    const tid = String(pending.tableName || "");
    if(tid.startsWith("shipment")) setLogsTab("shipment");
    else setLogsTab("sales");
  }else{
    setLogsTab(ptab);
  }

  // table filter
  if (tableSel && pending.tableName) tableSel.value = pending.tableName;

  // keyword：帶入 reference_id（最常用）
  if (keywordEl && pending.referenceId) keywordEl.value = pending.referenceId;

  // action：從其他頁跳入時清空，避免被舊條件（如 CREATE）卡住看不到 UPDATE
  logsClear_("logs_search_action");

  // 範圍：避免「最近 7 天」找不到，以「全部時間」更符合查看歷史紀錄
  if (rangeSel) rangeSel.value = "all";

  try { delete window.__pendingOpenLogs; } catch (_e) { window.__pendingOpenLogs = null; }
}

function resetLogsFilters(){
  const tableSel = document.getElementById("logs_filter_table");
  const rangeSel = document.getElementById("logs_filter_range");
  const actionSel = document.getElementById("logs_search_action");
  const keywordEl = document.getElementById("logs_search_keyword");

  logsClear_(["logs_filter_table", "logs_search_action", "logs_search_keyword"]);
  if(rangeSel) rangeSel.value = "7";

  setLogsTab("all");
  applyLogsFilter();
}

/* ===== 顯示 / 收合 明細 ===== */
function showLogDetail(encoded){
  const area = document.getElementById("logsDetailArea");
  if(!area) return;

  const log = JSON.parse(decodeURIComponent(encoded));

  if(currentOpenLogId === log.log_id){
    area.innerHTML = "";
    currentOpenLogId = null;
    return;
  }

  currentOpenLogId = log.log_id;

  const oldObj = safeParse(log.old_value);
  const newObj = safeParse(log.new_value);
  const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  let html = `
    <div style="margin-top:16px;">
      <div style="color:#2563eb;font-weight:600;margin-bottom:10px;">
        明細 - ${escapeHtml(log.log_id || "")}
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>欄位</th>
            <th>舊值</th>
            <th>新值</th>
          </tr>
        </thead>
        <tbody>
  `;

  if(keys.size === 0){
    html += `<tr><td colspan="3" style="text-align:center;color:#64748b;">無詳細資料</td></tr>`;
  }else{
    keys.forEach(k=>{
      html += `
        <tr>
          <td>${escapeHtml(k)}</td>
          <td style="color:#dc2626;">${escapeHtml(oldObj[k] || "")}</td>
          <td style="color:#16a34a;">${escapeHtml(newObj[k] || "")}</td>
        </tr>
      `;
    });
  }

  html += `
        </tbody>
      </table>
    </div>
  `;

  area.innerHTML = html;
  area.scrollIntoView({behavior:"smooth", block:"start"});
}

function safeParse(str){
  try{ return str ? JSON.parse(str) : {}; }
  catch{ return {}; }
}