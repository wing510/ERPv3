/**
 * Login Overlay（帳號 + 密碼）
 * - 後端 action: login 驗證；成功後 setCurrentUser + 同步 topbar
 */
(function(){
  /**
   * 後端 login 的 jsonSuccess 為 { success, user_id, user_name, role, status }（欄位在頂層）；
   * 若未來改為 { success, data: {...} } 亦相容。
   */
  function erpNormalizeLoginResult_(r){
    if(!r || r.success !== true) return null;
    var d = r.data;
    if(d && typeof d === "object" && !Array.isArray(d)) return d;
    return {
      user_id: r.user_id,
      user_name: r.user_name,
      role: r.role,
      status: r.status,
      allowed_modules: r.allowed_modules,
      remember: !!r.remember,
      session_token: r.session_token,
      session_expires_at: r.session_expires_at
    };
  }

  function getGoogleClientId_(){
    try{
      var cfg = window.__ERP_CONFIG__ || null;
      var id = cfg && typeof cfg.GOOGLE_CLIENT_ID === "string" ? String(cfg.GOOGLE_CLIENT_ID || "").trim() : "";
      // 防呆：曾出現誤貼/快取導致 client id 變成 *.apps.googleusercontentcontent.com（多了 content）
      if(id && id.indexOf("googleusercontentcontent.com") !== -1){
        id = id.replace("googleusercontentcontent.com","googleusercontent.com");
      }
      return id;
    }catch(_e){
      return "";
    }
  }

  function getAllowPasswordLogin_(){
    try{
      var cfg = window.__ERP_CONFIG__ || null;
      return !!(cfg && cfg.ALLOW_PASSWORD_LOGIN === true);
    }catch(_e){
      return false;
    }
  }

  var overlay = null;
  var input = null;
  var pwInput = null;
  var pwToggleBtn = null;
  var rememberCk = null;
  var adminToggle = null;
  var adminToggleWrap = null;
  var errBox = null;
  var statusBox = null;
  var btnSubmit = null;
  var btnClear = null;
  var lastAuthedUserId = "";
  var pwWrap = null;
  var pwActions = null;

  function loginSetV_(id, v){
    try{
      if(typeof window.erpSetVById_ === "function") return window.erpSetVById_(id, v);
    }catch(_e){}
    var el = document.getElementById(String(id || ""));
    try{
      if(el && "value" in el) el.value = v;
    }catch(_e2){}
  }

  function loginClear_(ids){
    try{
      if(typeof window.erpClearIds_ === "function") return window.erpClearIds_(ids);
    }catch(_e){}
    var list = Array.isArray(ids) ? ids : [ids];
    for(var i = 0; i < list.length; i++){
      var el = document.getElementById(String(list[i] || ""));
      try{
        if(el && "value" in el) el.value = "";
      }catch(_e2){}
    }
  }

  function escHtml_(s){
    return String(s ?? "")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;");
  }

  function showError(msg){
    if(!errBox) return;
    errBox.innerHTML = escHtml_(msg || "");
    errBox.classList.toggle("show", !!msg);
  }

  function showStatus(msg){
    if(!statusBox) return;
    statusBox.innerHTML = escHtml_(msg || "");
    statusBox.classList.toggle("show", !!msg);
  }

  function setLoginBusy_(busy, message){
    var on = !!busy;
    try{
      if(btnSubmit) btnSubmit.disabled = on;
      if(btnClear) btnClear.disabled = on;
    }catch(_e){}
    try{
      var gBtn = document.getElementById("googleSignInBtn");
      if(gBtn) gBtn.style.pointerEvents = on ? "none" : "";
    }catch(_e2){}
    showStatus(on ? (message || "登入中，等稍等...") : "");
  }

  function setOpen(open){
    if(!overlay) overlay = document.getElementById("loginOverlay");
    if(!overlay) return;
    overlay.classList.toggle("active", !!open);
    overlay.setAttribute("aria-hidden", open ? "false" : "true");
    document.body.style.overflow = open ? "hidden" : "";
    if(open && input){
      setTimeout(function(){ try{ input.focus(); input.select(); }catch(_e){} }, 0);
    }
  }

  function setLocked(locked){
    try{
      document.body.classList.toggle("erp-locked", !!locked);
    }catch(_e){}
  }

  function normalizeId(id){
    return String(id || "").trim();
  }

  function syncTopbarUserLabel(userId){
    try{
      var el = document.getElementById("topbarCurrentUser");
      if(!el) return;
      var uid = String(userId || "").trim();
      var role = "";
      try{
        role = (typeof getCurrentUserRole === "function") ? String(getCurrentUserRole() || "").trim() : "";
      }catch(_eRole){ role = ""; }
      var r = String(role || "").trim().toUpperCase();
      var roleZh = (function(){
        if(!r) return "";
        // 與 Users 角色選單對齊（modules/users.html）
        var map = {
          "CEO": "CEO",
          "FN": "財務",
          "GA": "總務",
          "OP": "作業",
          "QA": "品保",
          "SL": "業務",
          "AS": "助理",
          "WH": "倉管",
          "ADMIN": "管理者"
        };
        return map[r] || r;
      })();
      var label = uid ? (roleZh ? (roleZh + " - " + uid) : uid) : "—";
      el.textContent = label;
      el.title = uid ? ("目前登入：" + (roleZh ? (roleZh + " - " + uid) : uid)) : "";
    }catch(_e){}
  }

  function welcomeToast_(uid, role, uname){
    try{
      var r = String(role || "").trim().toUpperCase();
      var map = {
        "CEO": "CEO",
        "FN": "財務",
        "GA": "總務",
        "OP": "作業",
        "QA": "品保",
        "SL": "業務",
        "AS": "助理",
        "WH": "倉管",
        "ADMIN": "管理者"
      };
      var roleZh = map[r] || (r || "");
      var main = roleZh ? (roleZh + "-" + String(uid || "").trim()) : String(uid || "").trim();
      var msg = "歡迎登入 " + main + (uname ? (" " + String(uname || "").trim()) : "");
      if(typeof showToast === "function") showToast(msg, "success");
    }catch(_e){}
  }

  /** 密碼隱藏 → 斜線遮眼；密碼顯示 → 睜眼 */
  function syncPwToggleIcon_(){
    if(!pwToggleBtn || !pwInput) return;
    var hidden = (pwInput.getAttribute("type") || "password") === "password";
    pwToggleBtn.setAttribute("data-state", hidden ? "hidden" : "visible");
    pwToggleBtn.setAttribute("title", hidden ? "顯示密碼" : "隱藏密碼");
    pwToggleBtn.setAttribute("aria-label", hidden ? "顯示密碼" : "隱藏密碼");
  }

  function clearLoginForm_(){
    showError("");
    loginClear_(["loginUserId", "loginPassword"]);
    try{ if(pwInput) pwInput.setAttribute("type","password"); }catch(_e4){}
    syncPwToggleIcon_();
  }

  async function doLogin(){
    if(!getAllowPasswordLogin_()){
      showError("目前已關閉帳密登入（僅允許 Google 登入）。");
      return;
    }
    if(!input) return;
    var id = normalizeId(input.value);
    if(!id){
      showError("請輸入使用者 ID");
      return;
    }
    var pw = String(pwInput && pwInput.value != null ? pwInput.value : "").trim();
    if(!pw){
      showError("請輸入密碼");
      return;
    }
    setLoginBusy_(true, "登入中，等稍等...");
    try{
      if(typeof callAPI !== "function"){
        showError("系統尚未初始化完成，請稍後再試。");
        return;
      }
      try{
        var remember = true;
        try{ remember = rememberCk ? !!rememberCk.checked : true; }catch(_eRemember){ remember = true; }
        var r = await callAPI(
          { action: "login", user_id: id, password: pw, remember_me: remember ? "1" : "0" },
          { method: "POST", timeout_ms: 60000 }
        );
        var u = erpNormalizeLoginResult_(r);
        var uid = String(u && u.user_id ? u.user_id : id).trim();
        var st = String(u && u.status ? u.status : "ACTIVE").trim().toUpperCase();
        if(st !== "ACTIVE"){
          showError("此使用者為停用（INACTIVE），不可登入。");
          return;
        }
        lastAuthedUserId = uid;
        var roleFromServer = String(u && u.role != null ? u.role : "").trim();
        var nameFromServer = String(u && u.user_name != null ? u.user_name : "").trim();
        var tok = String(u && u.session_token ? u.session_token : "").trim();
        if(tok && typeof setSessionToken === "function") setSessionToken(tok, remember);
        var am = String(u && u.allowed_modules != null ? u.allowed_modules : "").trim();
        if(typeof setCurrentUser === "function") setCurrentUser(uid, { remember: remember, role: roleFromServer, user_name: nameFromServer, allowed_modules: am });
        syncTopbarUserLabel(uid);
        showError("");
        showStatus("");
        setOpen(false);
        setLocked(false);
        try{
          if(typeof navigate === "function") navigate("dashboard");
        }catch(_eNav){}
        welcomeToast_(uid, roleFromServer, nameFromServer);
      }catch(err){
        var msg = String(err && err.message != null ? err.message : err || "").trim();
        // 後端回傳的代碼（loginUser）：NOT_FOUND / BAD_PASSWORD / NO_PASSWORD / INACTIVE / Users sheet missing password column...
        if(msg === "NOT_FOUND"){
          showError("找不到此使用者。");
          return;
        }
        if(msg === "BAD_PASSWORD"){
          showError("密碼錯誤。");
          return;
        }
        if(msg === "USE_SESSION_RESUME"){
          showError("請重新整理頁面，或先登出再以密碼登入。");
          return;
        }
        if(msg === "NO_PASSWORD"){
          showError("此帳號尚未設定密碼，請先到 Google Sheet 的 Users 主檔設定 password 欄位。");
          return;
        }
        if(msg === "PASSWORD_LOGIN_DISABLED"){
          showError("帳密登入僅限 ADMIN 救火使用；請改用 Google 登入。");
          return;
        }
        if(msg === "INACTIVE"){
          showError("此使用者為停用（INACTIVE），不可登入。");
          return;
        }
        if(/missing password column/i.test(msg) || /password column/i.test(msg)){
          showError("Users 主檔缺少 password 欄位。請先在 Google Sheet 新增 password 欄位並重新部署後端。");
          return;
        }
        showError(msg || "登入失敗，請稍後再試。");
        return;
      }
    }finally{
      setLoginBusy_(false);
    }
  }

  async function doGoogleLogin(idToken){
    var remember = true;
    try{ remember = rememberCk ? !!rememberCk.checked : true; }catch(_eRemember){ remember = true; }
    setLoginBusy_(true, "登入中，等稍等...");
    try{
      if(typeof callAPI !== "function"){
        showError("系統尚未初始化完成，請稍後再試。");
        return;
      }
      var r = await callAPI(
        { action: "google_login", id_token: String(idToken || ""), remember_me: remember ? "1" : "0" },
        { method: "POST", timeout_ms: 60000 }
      );
      var u = erpNormalizeLoginResult_(r);
      var uid = String(u && u.user_id ? u.user_id : "").trim();
      var st = String(u && u.status ? u.status : "ACTIVE").trim().toUpperCase();
      if(!uid || st !== "ACTIVE"){
        showError("此帳號不可登入（未授權或停用）。");
        return;
      }
      lastAuthedUserId = uid;
      var roleFromServer = String(u && u.role != null ? u.role : "").trim();
      var nameFromServer = String(u && u.user_name != null ? u.user_name : "").trim();
      var tok = String(u && u.session_token ? u.session_token : "").trim();
      if(tok && typeof setSessionToken === "function") setSessionToken(tok, remember);
      var am = String(u && u.allowed_modules != null ? u.allowed_modules : "").trim();
      if(typeof setCurrentUser === "function") setCurrentUser(uid, { remember: remember, role: roleFromServer, user_name: nameFromServer, allowed_modules: am });
      syncTopbarUserLabel(uid);
      showError("");
      showStatus("");
      setOpen(false);
      setLocked(false);
      try{ if(typeof navigate === "function") navigate("dashboard"); }catch(_eNav){}
      welcomeToast_(uid, roleFromServer, nameFromServer);
    }catch(err){
      var msg = String(err && err.message != null ? err.message : err || "").trim();
      if(msg === "NOT_ALLOWED"){
        showError("此 Google 帳號不在允許名單內。");
        return;
      }
      if(msg === "BAD_ID_TOKEN" || msg === "BAD_AUD"){
        showError("Google 登入驗證失敗（ID Token 無效或 Client ID 不匹配）。請重新整理後再試；若仍失敗請聯絡管理員檢查 Google OAuth 設定。");
        return;
      }
      if(/session_token\s+required/i.test(msg)){
        showError("登入流程未完成或登入狀態已過期。請重新登入或重新整理頁面後再試。");
        return;
      }
      showError(msg || "Google 登入失敗，請稍後再試。");
    }
    finally{
      setLoginBusy_(false);
    }
  }

  async function ensureLoggedIn(){
    overlay = document.getElementById("loginOverlay");
    input = document.getElementById("loginUserId");
    pwInput = document.getElementById("loginPassword");
    pwToggleBtn = document.getElementById("loginPwToggle");
    rememberCk = document.getElementById("loginRemember");
    adminToggle = document.getElementById("loginAdminToggle");
    adminToggleWrap = document.getElementById("loginAdminToggleWrap");
    errBox = document.getElementById("loginError");
    statusBox = document.getElementById("loginStatus");
    btnSubmit = document.getElementById("loginSubmitBtn");
    btnClear = document.getElementById("loginClearBtn");
    pwWrap = document.getElementById("passwordLoginWrap");
    pwActions = document.getElementById("passwordLoginActions");
    var loginForm = document.getElementById("loginForm");
    if(!overlay || !input || !pwInput || !btnSubmit || !btnClear) return;

    // 帳密登入（救火）：由使用者手動勾選「管理者」才顯示
    try{
      var allowPwCfg = getAllowPasswordLogin_();
      if(adminToggleWrap) adminToggleWrap.style.display = allowPwCfg ? "" : "none";
      if(adminToggle && !adminToggle.dataset.bound){
        adminToggle.dataset.bound = "1";
        adminToggle.addEventListener("change", function(){
          try{ ensurePasswordAreaVisibility_(); }catch(_e){}
        });
      }

      function ensurePasswordAreaVisibility_(){
        // 預設不勾；只有手動勾選才顯示帳密區
        var allowPw = allowPwCfg && !!(adminToggle && adminToggle.checked);
        if(pwWrap) pwWrap.style.display = allowPw ? "" : "none";
        if(pwActions) pwActions.style.display = allowPw ? "" : "none";
        // 避免瀏覽器原生 required 阻擋（帳密隱藏時仍會擋 submit）
        try{ if(!allowPw) input.removeAttribute("required"); else input.setAttribute("required","required"); }catch(_eReq1){}
        try{ if(!allowPw) pwInput.removeAttribute("required"); else pwInput.setAttribute("required","required"); }catch(_eReq2){}
        if(!allowPw){
          clearLoginForm_();
        }
      }

      ensurePasswordAreaVisibility_();
    }catch(_ePw){}

    if(loginForm && !loginForm.dataset.boundSubmit){
      loginForm.dataset.boundSubmit = "1";
      loginForm.addEventListener("submit", function(e){
        e.preventDefault();
        doLogin();
      });
    }else if(!loginForm){
      btnSubmit.addEventListener("click", function(){ doLogin(); });
    }
    btnClear.addEventListener("click", function(){ clearLoginForm_(); });
    if(pwToggleBtn && !pwToggleBtn.dataset.bound){
      pwToggleBtn.dataset.bound = "1";
      pwToggleBtn.addEventListener("click", function(){
        try{
          var isPw = (pwInput.getAttribute("type") || "password") === "password";
          pwInput.setAttribute("type", isPw ? "text" : "password");
          syncPwToggleIcon_();
        }catch(_e){}
      });
    }
    syncPwToggleIcon_();

    setLocked(true);

    // Google Sign-In button（若有設定 client id）
    try{
      var gWrap = document.getElementById("googleSignInWrap");
      var gBtn = document.getElementById("googleSignInBtn");
      var cid = getGoogleClientId_();
      // 只要設定了 client id，就先顯示區塊；等 Google 腳本載入完成再 render（避免 async defer timing 造成「看不到按鈕」）
      if(gWrap) gWrap.style.display = cid ? "" : "none";
      if(gBtn && cid && !gBtn.dataset.inited){
        (function tryInitGoogleBtn_(){
          try{
            if(!(window.google && google.accounts && google.accounts.id)){
              // 最多等 10 秒（100 * 100ms），避免無限輪詢
              var left = Number(gBtn.dataset.gsiWaitLeft || "100");
              if(left <= 0){
                showError("Google 登入元件載入逾時。可能被瀏覽器外掛、網路政策或公司防火牆阻擋。請重新整理頁面後再試。");
                return;
              }
              gBtn.dataset.gsiWaitLeft = String(left - 1);
              setTimeout(tryInitGoogleBtn_, 100);
              return;
            }
            // 避免重複 init/render
            gBtn.dataset.inited = "1";
            google.accounts.id.initialize({
              client_id: cid,
              callback: function(resp){
                try{
                  var tok = resp && resp.credential ? String(resp.credential || "").trim() : "";
                  if(!tok) return;
                  doGoogleLogin(tok);
                }catch(_e){}
              }
            });
            google.accounts.id.renderButton(gBtn, { theme: "outline", size: "large", text: "signin_with" });
          }catch(_e2){}
        })();
      }
    }catch(_eG){}

    var tokResume = "";
    try{
      tokResume = typeof getSessionToken === "function" ? String(getSessionToken() || "").trim() : "";
    }catch(_eTok){}
    if(tokResume){
      try{
        if(typeof callAPI === "function"){
          setLoginBusy_(true, "登入中，等稍等...");
          var rr = await callAPI(
            { action: "session_resume", session_token: tokResume },
            { method: "POST", timeout_ms: 60000 }
          );
          var uu = erpNormalizeLoginResult_(rr);
          var st2 = String(uu && uu.status ? uu.status : "").trim().toUpperCase();
          if(uu && uu.user_id && st2 === "ACTIVE"){
            lastAuthedUserId = String(uu.user_id).trim();
            var roleSess = String(uu.role != null ? uu.role : "").trim();
            var nameSess = String(uu.user_name != null ? uu.user_name : "").trim();
            var remSess = !!uu.remember;
            if(typeof setCurrentUser === "function"){
              setCurrentUser(lastAuthedUserId, { remember: remSess, role: roleSess, user_name: nameSess, allowed_modules: String(uu && uu.allowed_modules != null ? uu.allowed_modules : "").trim() });
            }
            syncTopbarUserLabel(lastAuthedUserId);
            setOpen(false);
            setLocked(false);
            setLoginBusy_(false);
            try{
              if(typeof navigate === "function") navigate("dashboard");
            }catch(_eNav2){}
            // 保持登入自動恢復：不強制彈 toast（避免每次開頁都跳），但仍同步顯示名稱
            return;
          }
        }
      }catch(_eSess){
        try{ if(typeof clearSessionToken === "function") clearSessionToken(); }catch(_c){}
      }
      try{ if(typeof clearSessionToken === "function") clearSessionToken(); }catch(_c2){}
      setLoginBusy_(false);
    }

    setOpen(true);
  }

  async function doLogout(){
    try{
      if(typeof callAPI === "function" && typeof getSessionToken === "function"){
        var t = String(getSessionToken() || "").trim();
        if(t){
          await callAPI({ action: "session_logout", session_token: t }, { method: "POST", timeout_ms: 30000 });
        }
      }
    }catch(_eLo){}
    if(typeof setCurrentUser === "function") setCurrentUser("");
    else{
      try{ localStorage.removeItem("erp_current_user"); }catch(_e){}
      try{ sessionStorage.removeItem("erp_current_user"); }catch(_eSess){}
      try{ localStorage.removeItem("erp_current_role"); }catch(_eR){}
      try{ sessionStorage.removeItem("erp_current_role"); }catch(_eR2){}
    }
    syncTopbarUserLabel("");
    if(!overlay) overlay = document.getElementById("loginOverlay");
    if(!input) input = document.getElementById("loginUserId");
    if(!pwInput) pwInput = document.getElementById("loginPassword");
    if(!pwToggleBtn) pwToggleBtn = document.getElementById("loginPwToggle");
    if(!rememberCk) rememberCk = document.getElementById("loginRemember");
    if(!errBox) errBox = document.getElementById("loginError");
    showError("");
    setLocked(true);
    setOpen(true);
    clearLoginForm_();
    try{
      if(typeof navigate === "function") navigate("dashboard");
    }catch(_eNav3){}
  }

  /** doLogout 若拋錯時，仍強制清 session + 顯示登入遮罩（不依賴 closure 變數） */
  function fallbackLogoutDom_(){
    try{ if(typeof clearSessionToken === "function") clearSessionToken(); }catch(_cs){}
    if(typeof setCurrentUser === "function") setCurrentUser("");
    else{
      try{ localStorage.removeItem("erp_current_user"); }catch(_e){}
      try{ sessionStorage.removeItem("erp_current_user"); }catch(_e2){}
      try{ localStorage.removeItem("erp_current_role"); }catch(_eR){}
      try{ sessionStorage.removeItem("erp_current_role"); }catch(_eR2){}
    }
    try{ document.body.classList.add("erp-locked"); }catch(_e3){}
    try{ document.body.style.overflow = "hidden"; }catch(_e4){}
    var ov = document.getElementById("loginOverlay");
    if(ov){
      ov.classList.add("active");
      ov.setAttribute("aria-hidden","false");
    }
    loginClear_(["loginUserId", "loginPassword"]);
    var p = document.getElementById("loginPassword");
    if(p){
      p.setAttribute("type","password");
    }
    var er = document.getElementById("loginError");
    if(er){
      er.innerHTML = "";
      er.classList.remove("show");
    }
    var tb = document.getElementById("loginPwToggle");
    if(tb){
      tb.setAttribute("data-state","hidden");
      tb.setAttribute("title","顯示密碼");
      tb.setAttribute("aria-label","顯示密碼");
    }
    syncTopbarUserLabel("");
  }

  /**
   * 登出改由腳本綁定（勿用 HTML onclick：部分環境 CSP 會擋 inline handler，導致按鈕完全沒反應）
   */
  function bindLogoutBtn_(){
    async function performLogout(){
      try{
        await doLogout();
      }catch(err){
        try{ console.error("[ERP] logout", err); }catch(_e2){}
        fallbackLogoutDom_();
      }
    }
    try{ window.erpLogout = doLogout; }catch(_e0){}
    try{ window.erpPerformLogout = performLogout; }catch(_e1){}

    var btn = document.getElementById("logoutBtn");
    if(!btn || btn.getAttribute("data-erp-logout-bound") === "1") return;
    btn.setAttribute("data-erp-logout-bound","1");
    try{ btn.removeAttribute("onclick"); }catch(_e){}

    btn.addEventListener("click", function(ev){
      if(ev){
        ev.preventDefault();
        ev.stopPropagation();
      }
      performLogout();
    }, false);
  }

  try{ window.erpEnsureLoggedIn = ensureLoggedIn; }catch(_e){}

  function startErpLogin_(){
    bindLogoutBtn_();
    ensureLoggedIn();
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", startErpLogin_);
  }else{
    startErpLogin_();
  }

  /* 極晚再綁一次：避免主版被改動、腳本順序異常時按鈕尚未插入 DOM */
  setTimeout(function(){ bindLogoutBtn_(); }, 0);
})();
