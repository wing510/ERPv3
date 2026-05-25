/**
 * ERP 前端設定（部署時主要改 API_BASE 即可）
 * 若需在「不修改本檔」下覆寫：在 index.html 於本檔之前執行
 *   window.__ERP_CONFIG__ = { API_BASE: "https://你的部署網址/exec" };
 */
(function () {
  var defaults = {
    // 方案 B（建議）：同時記錄 DEV/PROD 兩個後端
    // - 你只要填好 API_BASE_PROD / API_BASE_DEV
    // - 前端會依網址自動選擇（或用 ?env=DEV|PROD 強制）
    API_BASE_PROD:
      "https://script.google.com/macros/s/AKfycbzSyD32l9WJDUDHqdCVXz8xsihb2c9ec-CdHlh37RGuper0wWfQV5xTYtxDoJ2y0adj/exec",
    API_BASE_DEV:
      "https://script.google.com/macros/s/AKfycbytLafLy8PRVmGx3IVRCQ7j1WKj2Go4eRSevTCECDYR4IgukvLkDMQS5rZ61ex9HUTa/exec", // prev: https://script.google.com/macros/s/AKfycbzq1rWJ9Lx9agg3I6jprEpWk83TFUSc60ihWeuDIqVoBRLr7P4Sv-r1RmpEesHAU3gY/exec
    // 相容舊版：若你仍想手動指定單一 API_BASE，可在 window.__ERP_CONFIG__ 直接覆寫 API_BASE
    API_BASE: "", // prev: https://script.google.com/macros/s/AKfycbzSdWP40h38ps95laROnFNbaBm79a0o54Q6fOcWy6YRpUeaRGV1-RDOMwNFzXuR1UEb/exec
    // 可選：保護 dev_* 動作（後端 Script Properties 的 DEV_GUARD_TOKEN）
    // - 只建議放在 DEV 前端（或本機），正式版不要設定
    DEV_GUARD_TOKEN: "",
    // Google Sign-In（GIS）Client ID（Web）
    // - PROD：GitHub Pages
    // - LOCAL：本機開發（localhost/127）
    GOOGLE_CLIENT_ID_PROD:
      "165277125304-e3prg9l893f64nmne3pn6ki5agib8akm.apps.googleusercontent.com",
    GOOGLE_CLIENT_ID_LOCAL:
      "165277125304-mf5cfjntll4bt4queucub8oajrgkf1ts.apps.googleusercontent.com",
    // 安全：預設只允許 Google 登入；需要救火時才手動打開帳密登入
    ALLOW_PASSWORD_LOGIN: true,

    // UX Guards：ID 正規化規則（可選）
    // - 預設：主檔 ID 會 trim + toUpperCase；users 會 trim
    // - 若你未來想「不再強制大寫」或有其他規則，可在不改程式碼下覆寫這兩個 function
    ERP_NORMALIZE_ID_UPPER: null, // (v) => String(v||"").trim().toUpperCase()
    ERP_NORMALIZE_ID_TRIM: null,  // (v) => String(v||"").trim()

    // PDF/列印頁眉（可選）
    // - COMPANY_LOGO_URL 支援：https://... 或相對路徑（同網域）或 data:image/...（Base64）
    // 訂單/記錄表用大 Logo（含中英文）
    COMPANY_LOGO_URL: "assets/order logo.jpg",
    COMPANY_NAME_ZH: "",
    COMPANY_NAME_EN: ""
  };
  var prev = typeof window.__ERP_CONFIG__ === "object" && window.__ERP_CONFIG__ !== null ? window.__ERP_CONFIG__ : {};
  var merged = Object.assign({}, defaults, prev);

  // 自動選用 API_BASE（DEV/PROD）
  try{
    // 1) 明確指定：window.__ERP_CONFIG__.API_BASE
    var explicit = typeof merged.API_BASE === "string" ? String(merged.API_BASE || "").trim() : "";
    if(explicit){
      merged.API_BASE = explicit;
    }else{
      // 2) URL 強制：?env=DEV 或 ?env=PROD
      var envQ = "";
      try{
        var qs = new URLSearchParams(String(location && location.search || ""));
        envQ = String(qs.get("env") || "").trim().toUpperCase();
      }catch(_eQ){ envQ = ""; }

      // 3) 自動偵測：網址包含 dev/test/staging 或路徑包含 /dev/
      var origin2 = "";
      var host2 = "";
      var path2 = "";
      try{
        origin2 = String(location && location.origin || "");
        host2 = String(location && location.hostname || "");
        path2 = String(location && location.pathname || "");
      }catch(_eL){}
      var looksDev = /(^|\.)dev(\.|$)|test|staging/i.test(host2) || /\/dev(\/|$)/i.test(path2) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin2);

      var pickEnv = envQ === "DEV" || envQ === "PROD" ? envQ : (looksDev ? "DEV" : "PROD");
      var prod = String(merged.API_BASE_PROD || "").trim();
      var dev = String(merged.API_BASE_DEV || "").trim();
      merged.API_BASE = (pickEnv === "DEV" ? dev : prod) || dev || prod || "";
    }
  }catch(_ePick){
    // 退回：至少不要變成空字串（優先 DEV）
    try{
      merged.API_BASE = String(merged.API_BASE_DEV || merged.API_BASE_PROD || merged.API_BASE || "").trim();
    }catch(_ePick2){}
  }

  // 依來源自動選用 client id（避免本機/線上來回手動切換）
  try{
    var origin = "";
    try{ origin = String(location && location.origin || ""); }catch(_e0){ origin = ""; }
    var isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
    var chosen = isLocal ? merged.GOOGLE_CLIENT_ID_LOCAL : merged.GOOGLE_CLIENT_ID_PROD;
    merged.GOOGLE_CLIENT_ID = String(chosen || "").trim();
  }catch(_eSel){
    merged.GOOGLE_CLIENT_ID = String(merged.GOOGLE_CLIENT_ID_PROD || "").trim();
  }
  // 防呆：曾出現誤貼/快取導致 client id 變成 *.apps.googleusercontentcontent.com（多了 content）→ 會造成 origin not allowed
  try{
    var cid = typeof merged.GOOGLE_CLIENT_ID === "string" ? String(merged.GOOGLE_CLIENT_ID || "").trim() : "";
    if (cid && cid.indexOf("googleusercontentcontent.com") !== -1) {
      merged.GOOGLE_CLIENT_ID = cid.replace("googleusercontentcontent.com", "googleusercontent.com");
    }
  }catch(_e){}
  window.__ERP_CONFIG__ = merged;
})();
