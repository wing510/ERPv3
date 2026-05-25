/*********************************
 * ERP Service Layer v3
 * Google Sheet Backend Edition
 * API_BASE 預設值僅定義於 js/core/config.js（請先載入 config.js）
 *********************************/

const API_BASE = (function () {
  try {
    var cfg = window.__ERP_CONFIG__;
    if (cfg && typeof cfg.API_BASE === "string" && cfg.API_BASE.trim()) {
      return cfg.API_BASE.trim();
    }
  } catch (_e) {}
  return "";
})();

function getApiBase_() {
  try {
    var cfg = window.__ERP_CONFIG__;
    if (cfg) {
      var explicit = typeof cfg.API_BASE === "string" ? String(cfg.API_BASE || "").trim() : "";
      if (explicit) return explicit;
      var dev = typeof cfg.API_BASE_DEV === "string" ? String(cfg.API_BASE_DEV || "").trim() : "";
      var prod = typeof cfg.API_BASE_PROD === "string" ? String(cfg.API_BASE_PROD || "").trim() : "";
      var origin = "";
      var host = "";
      var path = "";
      try {
        origin = String(location && location.origin || "");
        host = String(location && location.hostname || "");
        path = String(location && location.pathname || "");
      } catch (_eLoc) {}
      var looksDev =
        /(^|\.)dev(\.|$)|test|staging/i.test(host) ||
        /\/dev(\/|$)/i.test(path) ||
        /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
      return (looksDev ? dev : prod) || dev || prod || "";
    }
  } catch (_e) {}
  return API_BASE;
}

// #region agent log
function erpDbgSanitizeParams_(params) {
  try {
    const p = params && typeof params === "object" ? params : {};
    const action = String(p.action || "");
    const keys = Object.keys(p)
      .filter(k => k !== "action")
      .slice(0, 30);
    return { action, keysCount: Object.keys(p).length, keys };
  } catch (_e) {
    return { action: "", keysCount: 0, keys: [] };
  }
}

function erpDbgLog_(payload) {
  try {
    // 預設關閉本機除錯上報；需要時請在載入 service.js 前設定：
    // window.__ERP_CONFIG__ = { ... , DBG_INGEST_URL: "http://127.0.0.1:7691/ingest/..." }
    var cfg = null;
    try{ cfg = window.__ERP_CONFIG__ || null; }catch(_e2){}
    var url = cfg && typeof cfg.DBG_INGEST_URL === "string" ? String(cfg.DBG_INGEST_URL || "").trim() : "";
    if(!url) return;
    var sid = "";
    try{
      sid = String(cfg && cfg.DBG_SESSION_ID || "").trim();
      if(!sid){
        sid = String(window.__ERP_DBG_SESSION_ID__ || "").trim();
      }
      if(!sid){
        sid = "dbg-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
        window.__ERP_DBG_SESSION_ID__ = sid;
      }
    }catch(_eSid){ sid = ""; }
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(sid ? { "X-Debug-Session-Id": sid } : {})
      },
      body: JSON.stringify(
        Object.assign(
          {
            sessionId: sid,
            timestamp: Date.now()
          },
          payload || {}
        )
      )
    }).catch(function () {});
  } catch (_e) {}
}

try {
  if (!window.__ERP_DBG_HOOKED__) {
    window.__ERP_DBG_HOOKED__ = "1";
    window.addEventListener("error", function (ev) {
      erpDbgLog_({
        location: "js/core/service.js:hook:error",
        message: "window error",
        data: {
          msg: String(ev && ev.message || ""),
          file: String(ev && ev.filename || ""),
          line: Number(ev && ev.lineno || 0),
          col: Number(ev && ev.colno || 0)
        }
      });
    });
    window.addEventListener("unhandledrejection", function (ev) {
      const r = ev && ev.reason;
      erpDbgLog_({
        location: "js/core/service.js:hook:unhandledrejection",
        message: "unhandled rejection",
        data: {
          name: String(r && r.name || ""),
          msg: String(r && r.message || r || "")
        }
      });
    });
  }
} catch (_e) {}
// #endregion

/**
 * 將 callAPI 錯誤轉成繁中說明＋操作建議（供 Toast；可含換行）
 */
function formatCallApiUserMessage_(err) {
  const msg = String(err && err.message != null ? err.message : err || "");
  const name = String(err && err.name ? err.name : "");
  const httpStatus = err && err.httpStatus != null ? err.httpStatus : null;
  const backendErrors = err && Array.isArray(err.backendErrors) ? err.backendErrors : null;
  const fullText = (
    msg +
    " " +
    (backendErrors && backendErrors.length ? backendErrors.join(" ") : "")
  ).toLowerCase();

  if (
    /session_token\s+required/i.test(msg) ||
    (backendErrors && backendErrors.some(e => /session_token\s+required/i.test(String(e || ""))))
  ) {
    return (
      "登入狀態已過期或尚未完成登入。\n\n" +
      "建議：請重新登入（或重新整理頁面後再試）；若仍持續出現，請回報管理員檢查後端 session 設定。"
    );
  }

  if (
    /permission\s+denied/i.test(msg) ||
    (backendErrors && backendErrors.some(e => /permission\s+denied/i.test(String(e || ""))))
  ) {
    return (
      "權限不足：您目前的帳號無法存取此資料。\n\n" +
      "可能原因：未被分配該模組權限（allowed_modules）或角色限制。\n\n" +
      "建議：請聯絡管理員於 Users 設定可用模組，或改用有權限的帳號登入。"
    );
  }

  if (
    /(po|import)\s+source\s+changed/i.test(fullText) ||
    /please\s+reload\s+and\s+try\s+again/i.test(fullText) ||
    /來源.*(已被更新|已更新)|請重新載入再試/i.test(fullText) ||
    /already\s+(posted|cancelled|canceled)/i.test(fullText) ||
    /狀態.*(已過帳|已作廢|不可重做)/i.test(fullText) ||
    /duplicate|idempotent|重複送出|重覆送出|重送|重複過帳/i.test(fullText)
  ) {
    return (
      "資料已被其他人或其他分頁更新，系統已安全擋下這次送出。\n\n" +
      "請先按「Load」重新載入最新狀態，再重新確認數量後送出。"
    );
  }

  if (/forbidden\s*\(transactional\s+table\)\s*:\s*use\s+bundle\/command/i.test(fullText)) {
    return (
      "此資料屬於「交易型資料」，為避免庫存/追溯不一致，系統已禁止直接新增/修改/刪除。\n\n" +
      "建議：請改走該流程的「過帳/作廢」或對應的命令（bundle/command）操作；若你是在做特殊作業（如合批/拆批/加工回沖），請回報管理員補齊對應命令後再開放。"
    );
  }

  if (
    /has\s+receipts\.\s+only\s+remark\/document_link\s+is\s+allowed/i.test(fullText) ||
    /already\s+received\.\s+only\s+remark\s+is\s+allowed/i.test(fullText) ||
    /import\s+document\s+has\s+receipts\.\s+only\s+remark\/document_link\s+is\s+allowed/i.test(fullText) ||
    /import\s+item\s+already\s+received\.\s+only\s+remark\s+is\s+allowed/i.test(fullText) ||
    /already\s+shipped\.\s+only\s+remark\s+is\s+allowed/i.test(fullText) ||
    /item\s+already\s+shipped\.\s+only\s+remark\s+is\s+allowed/i.test(fullText)
  ) {
    return (
      "此單據已產生下游紀錄（已收貨/已出貨），為避免追溯不一致，系統僅允許更新「備註」（與少數非結構欄位）。\n\n" +
      "建議：若要改數量/品項，請改走對應的更正/作廢流程，或先確認是否需要新開單據。"
    );
  }

  if (
    /has\s+receipts\.\s+creating\s+new\s+items\s+is\s+not\s+allowed/i.test(fullText) ||
    /import\s+document\s+has\s+receipts\.\s+creating\s+new\s+items\s+is\s+not\s+allowed/i.test(fullText) ||
    /already\s+shipped\.\s+creating\s+new\s+items\s+is\s+not\s+allowed/i.test(fullText) ||
    /\bis\s+(cancelled|closed|posted|shipped)\.\s+creating\s+new\s+items\s+is\s+not\s+allowed/i.test(fullText)
  ) {
    return (
      "此單據已產生下游紀錄（已收貨/已出貨），因此禁止再新增明細，避免追溯不一致。\n\n" +
      "建議：如需新增品項，請改用新單據或走更正流程；若不確定，請先向管理員確認作業規範。"
    );
  }

  if (/\bis\s+(cancelled|closed|posted|shipped)\.\s+only\s+remark/i.test(fullText)) {
    return (
      "此單據目前已是終態（已關閉/已作廢/已過帳），因此僅允許更新「備註」（與少數非結構欄位）。\n\n" +
      "建議：若要更正數量/品項，請改走作廢/沖銷/更正流程，或開新單據。"
    );
  }

  if (err && err.apiBaseMissing) {
    return (
      "未設定 API 網址（API_BASE）。\n\n" +
      "建議：確認 index.html 已載入 js/core/config.js，且順序在 service.js 之前；或於載入 config 前設定 window.__ERP_CONFIG__.API_BASE。"
    );
  }

  if (backendErrors && backendErrors.length) {
    // Apps Script Web App：直接打 /exec（或參數遺失）會回 Unknown or missing action
    if (backendErrors.some(e => /unknown\s+or\s+missing\s+action/i.test(String(e || "")))) {
      return (
        "系統無法判斷要執行的操作（後端沒有收到 action 指令）。\n\n" +
        "建議：請先重新整理頁面（Ctrl+F5）；若仍發生，請確認目前連線的 API 端點（/exec）是否已重新部署並更新到正確環境。"
      );
    }
    return (
      "後端回報：" +
      backendErrors.join("；") +
      "\n\n建議：依訊息修正資料或必填欄位後再試；若為權限或規則問題請聯絡管理員。"
    );
  }

  if (name === "TypeError" && /fetch|Failed to fetch|Load failed|NetworkError/i.test(msg)) {
    return (
      "無法連線至後端。\n\n" +
      "建議：請確認網路連線正常。"
    );
  }

  if (name === "SyntaxError" || /JSON|Unexpected token/i.test(msg)) {
    return (
      "無法解讀伺服器回傳內容（可能不是預期的 JSON）。\n\n" +
      "建議：稍後再試；若持續發生請聯絡管理員檢查 Apps Script 部署與執行記錄。"
    );
  }

  if (httpStatus === 404) {
    return (
      "找不到 API 部署網址（HTTP 404）。\n\n" +
      "建議：至 js/core/config.js 確認 API_BASE 與 Google Apps Script「部署」取得的網址一致（含 /exec）。"
    );
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return (
      "無權限存取 API（HTTP " +
      httpStatus +
      "）。\n\n" +
      "建議：確認部署為「具有連結的使用者」或依貴司政策調整存取權；必要時重新部署 Web App。"
    );
  }
  if (httpStatus != null && httpStatus >= 500) {
    return (
      "伺服器暫時無法處理（HTTP " +
      httpStatus +
      "）。\n\n" +
      "建議：稍後再試；Apps Script 冷啟動時可能需多等幾秒。"
    );
  }
  if (httpStatus != null && httpStatus >= 400) {
    return (
      "無法完成請求（HTTP " +
      httpStatus +
      "）。\n\n" +
      "建議：重新整理頁面後再操作；若仍失敗請聯絡管理員。"
    );
  }

  if (/^HTTP\s+\d+/i.test(msg)) {
    return "無法與後端通訊。\n\n建議：重新整理頁面或稍後再試；並以 F12 主控台查看細節。";
  }

  if (msg && msg.length <= 200) {
    return msg + "\n\n建議：若為欄位或資料問題請修正後重試；否則請聯絡管理員並保留此訊息。";
  }

  return "操作失敗。\n\n建議：按 F12 開啟主控台查看錯誤細節，或稍後重試。";
}

/* =========================================================
   PERF（前端載入耗時統計，預設關閉）
   - enable: localStorage.erp_perf = "1" 或呼叫 enableErpPerf(true)
========================================================= */
const ERP_PERF = {
  enabled: false,
  max: 80,
  events: [] // { t, action, ms, ok }
};
try{
  ERP_PERF.enabled = (localStorage.getItem("erp_perf") === "1");
}catch(_e){}

function enableErpPerf(on){
  ERP_PERF.enabled = !!on;
  try{ localStorage.setItem("erp_perf", ERP_PERF.enabled ? "1" : "0"); }catch(_e){}
  if(typeof showToast === "function"){
    showToast(ERP_PERF.enabled ? "已開啟：載入耗時統計（請開 Console 查看）" : "已關閉：載入耗時統計");
  }
}

function erpPerfDump(){
  try{
    const rows = (ERP_PERF.events || []).slice(-ERP_PERF.max).map(e => ({
      time: e.t,
      action: e.action,
      ms: e.ms,
      ok: e.ok
    }));
    console.table(rows);
    return rows;
  }catch(_e){
    return [];
  }
}
try{
  window.enableErpPerf = enableErpPerf;
  window.erpPerfDump = erpPerfDump;
}catch(_e){}

/* =========================================================
   SESSION TOKEN（伺服器通行證；與「保持登入」同層級儲存策略）
========================================================= */

const ERP_SESSION_TOKEN_KEY = "erp_session_token";

function clearSessionToken() {
  try {
    sessionStorage.removeItem(ERP_SESSION_TOKEN_KEY);
  } catch (_e) {}
  try {
    localStorage.removeItem(ERP_SESSION_TOKEN_KEY);
  } catch (_e2) {}
}

function getSessionToken() {
  try {
    const t = sessionStorage.getItem(ERP_SESSION_TOKEN_KEY);
    if (t) return String(t).trim();
    return String(localStorage.getItem(ERP_SESSION_TOKEN_KEY) || "").trim();
  } catch (_e3) {
    return "";
  }
}

/** @param {string} token @param {boolean} remember true → localStorage（保持登入） */
function setSessionToken(token, remember) {
  clearSessionToken();
  const t = String(token || "").trim();
  if (!t) return;
  if (remember) {
    try {
      localStorage.setItem(ERP_SESSION_TOKEN_KEY, t);
    } catch (_e) {}
  } else {
    try {
      sessionStorage.setItem(ERP_SESSION_TOKEN_KEY, t);
    } catch (_e2) {}
  }
}

/* =========================================================
   CURRENT USER + ROLE（登入後寫入；供前端顯示／按鈕顯藏）
========================================================= */

function erpClearUserSessionStorage_(){
  clearSessionToken();
  try{ sessionStorage.removeItem("erp_current_user"); }catch(_e2){}
  try{ localStorage.removeItem("erp_current_user"); }catch(_e3){}
  try{ sessionStorage.removeItem("erp_current_role"); }catch(_e4){}
  try{ localStorage.removeItem("erp_current_role"); }catch(_e5){}
  try{ sessionStorage.removeItem("erp_current_name"); }catch(_e6){}
  try{ localStorage.removeItem("erp_current_name"); }catch(_e7){}
  try{ sessionStorage.removeItem("erp_allowed_modules"); }catch(_e6){}
  try{ localStorage.removeItem("erp_allowed_modules"); }catch(_e7){}
}

function getCurrentUser(){
  try{
    return (sessionStorage.getItem("erp_current_user") || localStorage.getItem("erp_current_user") || "");
  }catch(_e){
    return "";
  }
}

/** 與 getCurrentUser 相同儲存策略（remember me → localStorage） */
function getCurrentUserRole(){
  try{
    return (sessionStorage.getItem("erp_current_role") || localStorage.getItem("erp_current_role") || "");
  }catch(_e){
    return "";
  }
}

/** 與 getCurrentUser 相同儲存策略（remember me → localStorage） */
function getCurrentUserName(){
  try{
    return (sessionStorage.getItem("erp_current_name") || localStorage.getItem("erp_current_name") || "");
  }catch(_e){
    return "";
  }
}

function getCurrentUserAllowedModules(){
  try{
    return (sessionStorage.getItem("erp_allowed_modules") || localStorage.getItem("erp_allowed_modules") || "");
  }catch(_e){
    return "";
  }
}

/**
 * @param {string} userId
 * @param {{ remember?: boolean, role?: string, user_name?: string, allowed_modules?: string }} [options] role：後端 login 回傳之 role（如 ADMIN）
 */
function setCurrentUser(userId, options){
  try{
    if(userId == null || String(userId).trim() === ""){
      erpClearUserSessionStorage_();
      return;
    }
    const uid = String(userId).trim();
    const remember = options && options.remember === false ? false : true;
    const role = options && options.role != null ? String(options.role).trim() : "";
    const userName = options && options.user_name != null ? String(options.user_name).trim() : "";
    const allowedModules = options && options.allowed_modules != null ? String(options.allowed_modules).trim() : "";
    if(remember){
      try{ sessionStorage.removeItem("erp_current_user"); }catch(_e3){}
      localStorage.setItem("erp_current_user", uid);
      try{ sessionStorage.removeItem("erp_current_role"); }catch(_eR){}
      if(role) localStorage.setItem("erp_current_role", role);
      else try{ localStorage.removeItem("erp_current_role"); }catch(_eR2){}
      try{ sessionStorage.removeItem("erp_current_name"); }catch(_eN0){}
      if(userName) localStorage.setItem("erp_current_name", userName);
      else try{ localStorage.removeItem("erp_current_name"); }catch(_eN1){}
      try{ sessionStorage.removeItem("erp_allowed_modules"); }catch(_eAM0){}
      if(allowedModules) localStorage.setItem("erp_allowed_modules", allowedModules);
      else try{ localStorage.removeItem("erp_allowed_modules"); }catch(_eAM1){}
    }else{
      localStorage.removeItem("erp_current_user");
      try{ sessionStorage.setItem("erp_current_user", uid); }catch(_e4){}
      try{ localStorage.removeItem("erp_current_role"); }catch(_eR3){}
      if(role) try{ sessionStorage.setItem("erp_current_role", role); }catch(_eR4){}
      else try{ sessionStorage.removeItem("erp_current_role"); }catch(_eR5){}
      try{ localStorage.removeItem("erp_current_name"); }catch(_eN2){}
      if(userName) try{ sessionStorage.setItem("erp_current_name", userName); }catch(_eN3){}
      else try{ sessionStorage.removeItem("erp_current_name"); }catch(_eN4){}
      try{ localStorage.removeItem("erp_allowed_modules"); }catch(_eAM2){}
      if(allowedModules) try{ sessionStorage.setItem("erp_allowed_modules", allowedModules); }catch(_eAM3){}
      else try{ sessionStorage.removeItem("erp_allowed_modules"); }catch(_eAM4){}
    }
    try{
      if(typeof window.erpApplyModulePermissions === "function"){
        window.erpApplyModulePermissions();
      }
    }catch(_ePerm){}
    try{
      if(typeof window.erpApplySheetPermissions === "function"){
        window.erpApplySheetPermissions();
      }
    }catch(_eSheet){}
  }catch(_e){}
}

/* =========================================================
   API Helper
========================================================= */

/** 寫入時在「按鈕列右側」顯示「儲存中，請稍等…」並鎖住同組按鈕，避免重複送出 */
const SAVE_HINT_ID = "erp-save-hint-inline";

/**
 * @param {string|Element} [target] 可傳入 `.button-group` 或其子元素／#id 選擇器；省略則用 #content 內第一個 .button-group（向後相容）
 */
function showSaveHint(target) {
  hideSaveHint();
  const content = document.getElementById("content");
  if (!content) return;
  let btnGroup = null;
  if (target) {
    let el = null;
    if (typeof target === "string") {
      el = target.charAt(0) === "#" ? document.getElementById(target.slice(1)) : content.querySelector(target);
    } else {
      el = target;
    }
    if (el) {
      btnGroup = el.classList && el.classList.contains("button-group") ? el : el.closest(".button-group");
    }
  }
  if (!btnGroup) {
    btnGroup = content.querySelector(".button-group");
  }
  if (!btnGroup) return;
  const buttons = btnGroup.querySelectorAll("button");
  buttons.forEach(function (btn) {
    // 記錄原狀態，避免 hideSaveHint() 把「本來就 disabled」的按鈕誤打開
    if (btn.dataset && btn.dataset.saveHintPrevDisabled == null) {
      btn.dataset.saveHintPrevDisabled = btn.disabled ? "1" : "0";
    }
    if (btn.dataset && btn.dataset.saveHintPrevTitle == null) {
      btn.dataset.saveHintPrevTitle = btn.getAttribute("title") || "";
    }
    if (btn.dataset) btn.dataset.saveHintDisabled = "1";
    btn.disabled = true;
    // disabled 必須有 title：避免使用者不知道原因
    if (!btn.getAttribute("title")) {
      btn.setAttribute("title", "儲存中，請稍等…");
    }
  });
  const span = document.createElement("span");
  span.id = SAVE_HINT_ID;
  span.className = "save-hint-inline";
  span.textContent = "儲存中，請稍等…";
  btnGroup.appendChild(span);
}

function hideSaveHint() {
  const content = document.getElementById("content");
  if (content) {
    const groups = content.querySelectorAll(".button-group");
    groups.forEach(function (grp) {
      grp.querySelectorAll("button").forEach(function (btn) {
        const ds = btn.dataset || {};
        if (ds.saveHintDisabled === "1") {
          btn.disabled = ds.saveHintPrevDisabled === "1";
          // 還原 title（只還原 showSaveHint 暫存的）
          if (ds.saveHintPrevTitle != null) {
            const t = String(ds.saveHintPrevTitle || "");
            if (t) btn.setAttribute("title", t);
            else btn.removeAttribute("title");
          }
          try { delete ds.saveHintDisabled; } catch (_e) {}
          try { delete ds.saveHintPrevDisabled; } catch (_e2) {}
          try { delete ds.saveHintPrevTitle; } catch (_e3) {}
        }
      });
    });
  }
  const el = document.getElementById(SAVE_HINT_ID);
  if (el && el.parentNode) el.remove();
}

/* =========================================================
   UX：偵測 disabled 按鈕缺少 title（全站檢查）
========================================================= */

function warnDisabledButtonsMissingTitle_(root){
  const container = root || document.getElementById("content") || document;
  if(!container || !container.querySelectorAll) return;
  const btns = container.querySelectorAll("button");
  btns.forEach(function(btn){
    if(!btn) return;
    if(btn.disabled && !btn.getAttribute("title")){
      try{
        const id = btn.id ? ("#" + btn.id) : "(no id)";
        const text = String(btn.textContent || "").trim().slice(0, 40);
        console.warn("[ERP] disabled button missing title:", id, text);
      }catch(_e){}
    }
  });
}

function initDisabledButtonTitleGuard_(){
  const content = document.getElementById("content");
  if(!content) return;
  warnDisabledButtonsMissingTitle_(content);
  if(typeof MutationObserver === "undefined") return;
  try{
    const obs = new MutationObserver(function(muts){
      for(const m of muts){
        if(m.type === "attributes" && m.attributeName === "disabled"){
          const el = m.target;
          if(el && el.tagName === "BUTTON" && el.disabled && !el.getAttribute("title")){
            try{
              const id = el.id ? ("#" + el.id) : "(no id)";
              const text = String(el.textContent || "").trim().slice(0, 40);
              console.warn("[ERP] disabled button missing title:", id, text);
            }catch(_e){}
          }
        }else if(m.type === "childList"){
          (m.addedNodes || []).forEach(function(n){
            if(n && n.nodeType === 1){
              if(n.tagName === "BUTTON"){
                if(n.disabled && !n.getAttribute("title")){
                  try{
                    const id = n.id ? ("#" + n.id) : "(no id)";
                    const text = String(n.textContent || "").trim().slice(0, 40);
                    console.warn("[ERP] disabled button missing title:", id, text);
                  }catch(_e){}
                }
              }else{
                warnDisabledButtonsMissingTitle_(n);
              }
            }
          });
        }
      }
    });
    obs.observe(content, { subtree:true, childList:true, attributes:true, attributeFilter:["disabled"] });
  }catch(_e){}
}

try{
  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", initDisabledButtonTitleGuard_);
  }else{
    initDisabledButtonTitleGuard_();
  }
}catch(_e){}

/**
 * 解析後端「陣列在 data」的 JSON；相容舊版 jsonSuccess 誤把陣列展開成 0,1,2… 頂層鍵（前端讀不到 r.data）。
 */
function erpParseArrayDataResponse_(r) {
  if (!r || typeof r !== "object") return [];
  if (Array.isArray(r.data)) return r.data;
  if (Array.isArray(r)) return r;
  const keys = Object.keys(r)
    .filter(function (k) {
      return /^\d+$/.test(k);
    })
    .sort(function (a, b) {
      return Number(a) - Number(b);
    });
  if (keys.length) {
    return keys
      .map(function (k) {
        return r[k];
      })
      .filter(Boolean);
  }
  return [];
}

async function callAPI(params, options = {}){

  const method = String(options?.method || "GET").toUpperCase();
  const silent = options && (options.silent === true || options.quiet === true);
  const actionName = String(params?.action || "");
  const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  const timeoutMs = Number(options?.timeout_ms || 60000);
  const ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
  const timer = (ctrl && timeoutMs > 0)
    ? setTimeout(function(){ try{ ctrl.abort(); }catch(_e){} }, timeoutMs)
    : null;
  try{
    // #region agent log
    erpDbgLog_({
      location: "js/core/service.js:callAPI:enter",
      message: "callAPI enter",
      data: {
        method,
        apiBaseSet: !!getApiBase_(),
        timeoutMs,
        params: erpDbgSanitizeParams_(params)
      }
    });
    // #endregion

    const apiBase = getApiBase_();
    if (!apiBase) {
      const e = new Error("API_BASE missing");
      e.apiBaseMissing = true;
      throw e;
    }

    // URLSearchParams 會把 undefined 變成字串 "undefined" 送出，導致試算表寫入錯誤
    const clean = {};
    Object.keys(params || {}).forEach(function (k) {
      const v = params[k];
      if (v !== undefined) clean[k] = v;
    });
    // 後端 doGet/doPost 統一驗人：除 login/google_login 外須帶有效操作者（與 getCurrentUser 一致）
    const act = String(clean.action || "").trim();
    if (act !== "login" && act !== "google_login") {
      const st =
        typeof getSessionToken === "function" ? String(getSessionToken() || "").trim() : "";
      if (st && !String(clean.session_token || "").trim()) {
        clean.session_token = st;
      }
    }
    // dev_* 可選：多一層 token 防誤觸（只建議 DEV 前端設定）
    try{
      if (String(act || "").toLowerCase().indexOf("dev_") === 0) {
        const cfg = (typeof window === "object" && window && window.__ERP_CONFIG__) ? window.__ERP_CONFIG__ : null;
        const tok = cfg && typeof cfg.DEV_GUARD_TOKEN === "string" ? String(cfg.DEV_GUARD_TOKEN || "").trim() : "";
        if (tok && !String(clean.dev_token || "").trim()) clean.dev_token = tok;
      }
    }catch(_eEnv){}
    if (act !== "login" && act !== "google_login" && act !== "session_resume" && act !== "session_logout") {
      const uid =
        typeof getCurrentUser === "function" ? String(getCurrentUser() || "").trim() : "";
      if (uid) {
        if (!String(clean.created_by || "").trim()) clean.created_by = uid;
        if (!String(clean.updated_by || "").trim()) clean.updated_by = uid;
      }
    }
    const payload = new URLSearchParams(clean);

    const response =
      method === "POST"
        ? await fetch(apiBase, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
            },
            body: payload,
            ...(ctrl ? { signal: ctrl.signal } : {})
          })
        : await fetch(`${apiBase}?${payload.toString()}`, ctrl ? { signal: ctrl.signal } : undefined);

    if(!response.ok){
      const e = new Error("HTTP " + response.status);
      e.httpStatus = response.status;
      throw e;
    }

    let result;
    try {
      result = await response.json();
    } catch (parseErr) {
      const e = new Error(parseErr && parseErr.message ? parseErr.message : "JSON parse error");
      e.name = (parseErr && parseErr.name) || "SyntaxError";
      throw e;
    }

    if(!result.success){
      const raw = result.errors;
      const backendErrors = Array.isArray(raw)
        ? raw.filter(function (x) {
            return x != null && String(x).trim() !== "";
          }).map(function (x) {
            return String(x);
          })
        : raw != null && String(raw).trim() !== ""
          ? [String(raw)]
          : [];
      const e = new Error(backendErrors.length ? backendErrors.join(", ") : "API error");
      e.backendErrors = backendErrors;
      try{
        const code = String(result && result.error_code || "").trim().toUpperCase();
        if(code) e.erpErrorCode = code;
      }catch(_eCode){}
      throw e;
    }

    // #region agent log
    try{
      const t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      erpDbgLog_({
        location: "js/core/service.js:callAPI:ok",
        message: "callAPI ok",
        data: {
          method,
          action: actionName,
          ms: Math.round((t1 - t0) * 10) / 10,
          hasDataArray: !!(result && Array.isArray(result.data)),
          dataLen: (result && Array.isArray(result.data)) ? result.data.length : null
        }
      });
    }catch(_e){}
    // #endregion

    return result;

  } catch(err){
    console.error("API ERROR:", err);
    // session 過期/缺失：清除 token 並喚起登入（避免整站一直噴 session_token required）
    try{
      const backendErrors = Array.isArray(err && err.backendErrors) ? err.backendErrors : null;
      const msg = String(err && err.message != null ? err.message : err || "");
      const hasSessionRequired =
        (backendErrors && backendErrors.some(e => /session_token\s+required/i.test(String(e || "")))) ||
        /session_token\s+required/i.test(msg);
      if(hasSessionRequired){
        try{ if(typeof clearSessionToken === "function") clearSessionToken(); }catch(_e0){}
        try{ invalidateCache(); }catch(_e1){}
        // 讓 login overlay 接手（login.js 會綁在 window.erpEnsureLoggedIn）
        try{
          if(typeof window !== "undefined" && typeof window.erpEnsureLoggedIn === "function"){
            setTimeout(function(){ try{ window.erpEnsureLoggedIn(); }catch(_e2){} }, 0);
          }
        }catch(_e3){}
      }
    }catch(_eSessGuard){}
    // #region agent log
    try{
      const t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      erpDbgLog_({
        location: "js/core/service.js:callAPI:err",
        message: "callAPI error",
        data: {
          method,
          action: actionName,
          ms: Math.round((t1 - t0) * 10) / 10,
          name: String(err && err.name || ""),
          msg: String(err && err.message || err || ""),
          httpStatus: err && err.httpStatus != null ? err.httpStatus : null,
          backendErrors: Array.isArray(err && err.backendErrors) ? err.backendErrors.slice(0, 5) : null
        }
      });
    }catch(_e){}
    // #endregion
    if(ERP_PERF.enabled){
      const t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      const ms = Math.round((t1 - t0) * 10) / 10;
      const evt = { t: nowIso16(), action: actionName || "(no action)", ms, ok: false };
      ERP_PERF.events.push(evt);
      if(ERP_PERF.events.length > ERP_PERF.max) ERP_PERF.events.splice(0, ERP_PERF.events.length - ERP_PERF.max);
      try{ console.warn("[ERP PERF] failed", evt); }catch(_e){}
    }
    try{
      if(typeof showToast === "function"){
        const userMsg = formatCallApiUserMessage_(err);
        try {
          err.erpUserMessage = userMsg;
          err.erpApiToastShown = true;
        } catch (_e2) {}
        if(!silent) showToast(userMsg, "error");
      }
    }catch(_e){}
    throw err;
  } finally {
    try{ if(timer) clearTimeout(timer); }catch(_e3){}
    // 成功情況：寫入 perf event
    if(ERP_PERF.enabled){
      const last = ERP_PERF.events[ERP_PERF.events.length - 1] || null;
      // 若 catch 已記錄失敗事件，就不要再記一筆成功事件
      if(!(last && last.action === (actionName || "(no action)") && last.ok === false && String(last.t || "") === nowIso16())){
        const t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        const ms = Math.round((t1 - t0) * 10) / 10;
        const evt = { t: nowIso16(), action: actionName || "(no action)", ms, ok: true };
        ERP_PERF.events.push(evt);
        if(ERP_PERF.events.length > ERP_PERF.max) ERP_PERF.events.splice(0, ERP_PERF.events.length - ERP_PERF.max);
        try{
          if(ms >= 1200) console.warn("[ERP PERF] slow", evt);
        }catch(_e){}
      }
    }
  }
}

/* =========================================================
   GET ALL（分層 TTL 快取，寫入時 invalidate；可強制 refresh）
========================================================= */

const API_CACHE = {};
/** 未列出的表使用預設 TTL */
const API_CACHE_DEFAULT_TTL_MS = 3 * 60 * 1000; // 3 分鐘
/** 主檔變動少、可較久快取（仍會在 create/update/delete 時失效） */
const API_CACHE_TTL_BY_TYPE = {
  product: 10 * 60 * 1000,
  supplier: 10 * 60 * 1000,
  customer: 10 * 60 * 1000,
  warehouse: 10 * 60 * 1000,
  user: 10 * 60 * 1000,
  /** 量大且部分流程可能繞過 invalidate，縮短 TTL */
  inventory_movement: 90 * 1000,
  logs: 60 * 1000
};

function getCacheTtlMs_(typeKey) {
  const k = String(typeKey || "").toLowerCase();
  const t = API_CACHE_TTL_BY_TYPE[k];
  return typeof t === "number" && t > 0 ? t : API_CACHE_DEFAULT_TTL_MS;
}

function invalidateCache(type) {
  if (type) delete API_CACHE[type];
  else Object.keys(API_CACHE).forEach(k => delete API_CACHE[k]);
}

/**
 * @param {string} type
 * @param {{ refresh?: boolean }} [options] refresh=true 時略過快取並重新請求
 */
async function getAll(type, options) {
  const key = String(type || "").toLowerCase();
  const refresh = options && options.refresh === true;
  const silent = options && (options.silent === true || options.quiet === true);
  const ttl = getCacheTtlMs_(key);
  const now = Date.now();
  if (refresh) delete API_CACHE[key];

  const hit = API_CACHE[key];
  if (!refresh && hit && hit.data && (now - hit.at) < ttl) return hit.data;
  if (!refresh && hit && hit.promise) return await hit.promise;

  const fetchId = Symbol();
  const p = (async () => {
    const result = await callAPI({ action: `list_${type}` }, silent ? { silent: true } : undefined);
    const data = result.data;
    const cur = API_CACHE[key];
    if (!cur || cur.fetchId !== fetchId) return data;
    API_CACHE[key] = { data, at: Date.now(), fetchId };
    return data;
  })();
  API_CACHE[key] = { promise: p, at: now, fetchId };
  try {
    return await p;
  } finally {
    const cur = API_CACHE[key];
    if (cur && cur.promise === p && !cur.data) delete API_CACHE[key];
  }
}

/* =========================================================
   GET ONE
========================================================= */

async function getOne(type, idField, idValue) {

  const list = await getAll(type);

  return list.find(r => r[idField] === idValue);
}

/* =========================================================
   CREATE
========================================================= */

async function createRecord(type, record) {

  // Lot 預設狀態：PENDING（若未明確指定）
  if (type === "lot" && (record.status == null || record.status === "")) {
    record = {
      ...record,
      status: LOT_DEFAULT_STATUS
    };
  }

  validateSchema(type, record);

  const result = await callAPI({
    action: `create_${type}`,
    ...record
  });

  invalidateCache(type);
  return result;
}

/* =========================================================
   UPDATE
========================================================= */

async function updateRecord(type, idField, idValue, newData) {

  validateSchema(type, newData);

  const result = await callAPI({
    action: `update_${type}`,
    [idField]: idValue,
    ...newData
  });

  invalidateCache(type);
  return result;
}

/* =========================================================
   DELETE
========================================================= */

async function deleteRecord(type, idField, idValue) {

  const result = await callAPI({
    action: `delete_${type}`,
    [idField]: idValue,
    updated_by: getCurrentUser()
  });

  invalidateCache(type);
  return result;
}