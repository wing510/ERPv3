/**
 * UX Guards（確認＋清空）共用工具
 * - 目的：避免各模組重複寫 prevValue/confirm/revert/clear 的樣板碼
 */
(function () {
  var confirmModalBound_ = false;
  var confirmModalBusy_ = false;

  function bindConfirmModalOnce_() {
    if (confirmModalBound_) return;
    confirmModalBound_ = true;
    try {
      var overlay = document.getElementById("erpConfirmOverlay");
      if (!overlay) return;
      var btnOk = document.getElementById("erpConfirmOkBtn");
      var btnCancel = document.getElementById("erpConfirmCancelBtn");
      var btnClose = document.getElementById("erpConfirmCloseBtn");
      function stop(e) {
        try {
          e.stopPropagation();
        } catch (_e) {}
      }
      if (btnOk) btnOk.addEventListener("click", stop);
      if (btnCancel) btnCancel.addEventListener("click", stop);
      if (btnClose) btnClose.addEventListener("click", stop);
    } catch (_e) {}
  }

  function confirmModalAsync_(opts) {
    bindConfirmModalOnce_();
    return new Promise(function (resolve) {
      try {
        var overlay = document.getElementById("erpConfirmOverlay");
        var titleEl = document.getElementById("erpConfirmTitle");
        var msgEl = document.getElementById("erpConfirmMessage");
        var btnOk = document.getElementById("erpConfirmOkBtn");
        var btnCancel = document.getElementById("erpConfirmCancelBtn");
        var btnClose = document.getElementById("erpConfirmCloseBtn");
        if (!overlay || !btnOk || !btnCancel || !msgEl) {
          // 找不到 DOM：退回原生 confirm（同步），但仍 resolve
          resolve(confirm(String((opts && opts.message) || "確定要繼續？")));
          return;
        }
        if (confirmModalBusy_) {
          resolve(false);
          return;
        }
        confirmModalBusy_ = true;
        if (titleEl) titleEl.textContent = String((opts && opts.title) || "確認");
        msgEl.textContent = String((opts && opts.message) || "");
        btnOk.textContent = String((opts && opts.okText) || "確定");
        btnCancel.textContent = String((opts && opts.cancelText) || "取消");

        function cleanup_(ok) {
          try {
            overlay.classList.remove("active");
            overlay.setAttribute("aria-hidden", "true");
          } catch (_e) {}
          try {
            btnOk.removeEventListener("click", onOk_);
            btnCancel.removeEventListener("click", onCancel_);
            if (btnClose) btnClose.removeEventListener("click", onCancel_);
            overlay.removeEventListener("click", onCancel_);
            document.removeEventListener("keydown", onKey_);
          } catch (_e2) {}
          confirmModalBusy_ = false;
          resolve(!!ok);
        }
        function onOk_() {
          cleanup_(true);
        }
        function onCancel_() {
          cleanup_(false);
        }
        function onKey_(e) {
          try {
            if (e.key === "Escape") onCancel_();
          } catch (_e) {}
        }

        btnOk.addEventListener("click", onOk_);
        btnCancel.addEventListener("click", onCancel_);
        if (btnClose) btnClose.addEventListener("click", onCancel_);
        overlay.addEventListener("click", onCancel_);
        document.addEventListener("keydown", onKey_);

        overlay.classList.add("active");
        overlay.setAttribute("aria-hidden", "false");
        try {
          btnCancel.focus();
        } catch (_e3) {}
      } catch (_e0) {
        resolve(confirm(String((opts && opts.message) || "確定要繼續？")));
      }
    });
  }

  function getVal_(el) {
    try {
      return el && "value" in el ? String(el.value || "") : "";
    } catch (_e) {
      return "";
    }
  }

  function setVal_(el, v) {
    try {
      if (el && "value" in el) el.value = v;
    } catch (_e) {}
  }

  function setVById_(id, v) {
    try {
      var el = document.getElementById(String(id || ""));
      if (!el) return false;
      if ("value" in el) el.value = v;
      return true;
    } catch (_e) {
      return false;
    }
  }

  function clearIds_(ids) {
    try {
      if (!ids) return;
      // 支援：clearIds_("a") 或 clearIds_(["a","b"])
      var list = Array.isArray(ids) ? ids : [ids];
      for (var i = 0; i < list.length; i++) {
        setVById_(list[i], "");
      }
    } catch (_e) {}
  }

  function vTrimById_(id) {
    try {
      var el = document.getElementById(String(id || ""));
      return String((el && "value" in el ? el.value : "") || "").trim();
    } catch (_e) {
      return "";
    }
  }

  function vTrimUpperById_(id) {
    return vTrimById_(id).toUpperCase();
  }

  function vById_(id) {
    try {
      var el = document.getElementById(String(id || ""));
      return el && "value" in el ? el.value : "";
    } catch (_e) {
      return "";
    }
  }

  function vNumById_(id, fallback) {
    var raw = vTrimById_(id);
    var n = Number(raw);
    if (Number.isFinite(n)) return n;
    return typeof fallback === "number" ? fallback : 0;
  }

  function vIntById_(id, fallback) {
    var n = vNumById_(id, typeof fallback === "number" ? fallback : 0);
    return Math.trunc(n);
  }

  function vDateById_(id) {
    // 不 parse 成 Date：維持原字串（多數欄位是 input[type=date] / datetime-local）
    return vTrimById_(id);
  }

  function vBoolById_(id) {
    try {
      var el = document.getElementById(String(id || ""));
      if (!el) return false;
      if ("checked" in el) return !!el.checked;
      var v = String(("value" in el ? el.value : "") || "").trim().toLowerCase();
      return v === "1" || v === "true" || v === "yes" || v === "y";
    } catch (_e) {
      return false;
    }
  }

  function confirmDiscard_(message) {
    return confirm(String(message || "你有尚未完成的內容，切換會清空。\n\n是否繼續？"));
  }

  function confirmAction_(message) {
    return confirm(String(message || "確定要繼續？"));
  }

  function confirmDiscardKey_(key, params) {
    try {
      if (typeof msg_ === "function") return confirmDiscard_(msg_(key, params));
    } catch (_e) {}
    return confirmDiscard_(String((params && params.fallback) || ""));
  }

  function confirmActionKey_(key, params) {
    try {
      if (typeof msg_ === "function") return confirmAction_(msg_(key, params));
    } catch (_e) {}
    return confirmAction_(String((params && params.fallback) || ""));
  }

  var confirmPolicy_ = {
    // 若 key 在此列出，可統一未來的「必填原因/二次確認/危險樣式」等策略
    // 目前只做資料收斂，尚未改動 UI/流程
    CANCEL_PO: { kind: "action", requireReason: false, doubleConfirm: false, danger: true },
    CANCEL_SO: { kind: "action", requireReason: false, doubleConfirm: false, danger: true },
    CANCEL_IMPORT: { kind: "action", requireReason: false, doubleConfirm: false, danger: true },
    CANCEL_SHIPMENT: { kind: "action", requireReason: false, doubleConfirm: false, danger: true },
    DEACTIVATE_MASTER: { kind: "action", requireReason: false, doubleConfirm: false, danger: false },
    DISCARD_DRAFT: { kind: "discard", requireReason: false, doubleConfirm: false, danger: false },
  };

  function getConfirmPolicy_(key) {
    var k = String(key || "").trim();
    return confirmPolicy_[k] || null;
  }

  function normalizeIdUpper_(v) {
    // 預設規則：主檔 ID 一律轉大寫（可由 __ERP_CONFIG__ 覆寫）
    try {
      var cfg = window.__ERP_CONFIG__ || null;
      if (cfg && typeof cfg.ERP_NORMALIZE_ID_UPPER === "function") {
        return String(cfg.ERP_NORMALIZE_ID_UPPER(v));
      }
    } catch (_e0) {}
    return String(v || "").trim().toUpperCase();
  }

  function normalizeIdTrim_(v) {
    try {
      var cfg = window.__ERP_CONFIG__ || null;
      if (cfg && typeof cfg.ERP_NORMALIZE_ID_TRIM === "function") {
        return String(cfg.ERP_NORMALIZE_ID_TRIM(v));
      }
    } catch (_e0) {}
    return String(v || "").trim();
  }

  /**
   * 主檔 Load 守衛：切換載入目標前，若有未存檔變更則先確認。
   * - 回傳 true：允許繼續 load
   * - 回傳 false：中止 load
   *
   * @param {{
   *   nextId: any,
   *   curId: any,
   *   isEditing?: () => boolean,
   *   getCurrentSnapshot?: () => string,
   *   getLoadedSnapshot?: () => string,
   *   message?: string,
   * }} opts
   */
  function guardBeforeLoadDiscard_(opts) {
    try {
      if (!opts) return true;
      var normalizeId =
        typeof opts.normalizeId === "function"
          ? opts.normalizeId
          : normalizeIdUpper_;
      var nextId = normalizeId(opts.nextId);
      var curId = normalizeId(opts.curId);
      if (!nextId || !curId || nextId === curId) return true;
      if (typeof opts.isEditing === "function" && !opts.isEditing()) return true;
      if (typeof opts.getCurrentSnapshot !== "function") return true;
      if (typeof opts.getLoadedSnapshot !== "function") return true;

      var snap = String(opts.getCurrentSnapshot() || "");
      var prev = String(opts.getLoadedSnapshot() || "");
      if (!snap || !prev || snap === prev) return true;

      var msg = String(opts.message || masterLoadMessageByKey_(opts.key));
      return confirmDiscard_(msg);
    } catch (_e) {
      return true;
    }
  }

  function masterLoadMessageByKey_(key) {
    var k = String(key || "").trim().toLowerCase();
    if (k === "product")
      return "你有尚未儲存的產品變更。\n切換 Load 會丟棄目前變更。\n\n是否繼續？";
    if (k === "supplier")
      return "你有尚未儲存的供應商變更。\n切換 Load 會丟棄目前變更。\n\n是否繼續？";
    if (k === "customer")
      return "你有尚未儲存的客戶變更。\n切換 Load 會丟棄目前變更。\n\n是否繼續？";
    if (k === "warehouse")
      return "你有尚未儲存的倉庫變更。\n切換 Load 會丟棄目前變更。\n\n是否繼續？";
    if (k === "user")
      return "你有尚未儲存的使用者變更。\n切換 Load 會丟棄目前變更。\n\n是否繼續？";
    return "你有尚未儲存的變更。\n切換 Load 會丟棄目前變更。\n\n是否繼續？";
  }

  function msg_(key, params) {
    var k = String(key || "").trim().toLowerCase();
    var p = params && typeof params === "object" ? params : {};
    if (k === "confirm.discard.generic")
      return "你有尚未完成的內容，切換會清空。\n\n是否繼續？";
    if (k === "confirm.action.generic") return "確定要繼續？";
    if (k === "confirm.lots.close_modal")
      return (
        "你正在操作 Lots 的 QA/日期視窗。\n切換篩選條件會關閉視窗並清空目前操作內容，避免誤操作。\n\n是否繼續？"
      );
    if (k === "confirm.import.reset_draft")
      return "你目前已有報單品項草稿。\n重設會清空草稿與表單內容。\n\n是否繼續？";
    if (k === "confirm.master.deactivate.used") {
      var n1 = String(p.name || "此主檔");
      var use = String(p.usedHint || "可能已有歷史紀錄");
      return (
        n1 +
        "已被使用（" +
        use +
        "）。\n\n仍要停用嗎？停用後將不能在新單據被選用，但歷史紀錄會保留。"
      );
    }
    if (k === "confirm.master.deactivate.basic") {
      var n2 = String(p.name || "此主檔");
      return "確定要將" + n2 + "停用（INACTIVE）嗎？";
    }
    if (k === "confirm.user.deactivate.used") {
      return "此使用者可能已有歷史操作紀錄。\n\n仍要停用嗎？停用後不得再登入，但歷史紀錄會保留。";
    }
    if (k === "confirm.user.deactivate.basic") {
      return "確定要將此使用者停用（INACTIVE）嗎？停用後不得再登入，但歷史紀錄會保留。";
    }
    if (k === "confirm.cancel.po") {
      return (
        "確定作廢此採購單？\n- PO：" +
        String(p.po_id || "") +
        "\n\n限制：需先作廢所有收貨單。"
      );
    }
    if (k === "confirm.cancel.so") {
      return (
        "確定作廢此銷售單？\n- SO：" +
        String(p.so_id || "") +
        "\n\n限制：需先作廢所有出貨單。"
      );
    }
    if (k === "confirm.cancel.import") {
      return (
        "確定作廢此報單？\n- 報單ID：" +
        String(p.import_doc_id || "") +
        "\n\n限制：需先作廢所有收貨單。"
      );
    }
    if (k === "confirm.cancel.shipment") {
      return "確定要作廢這張出貨單？\n\n作廢後系統會：\n- 把已扣掉的庫存加回來\n- 同步更新銷售單的「已出貨量」\n\n作廢後此出貨單會顯示為「已作廢」。";
    }
    if (k === "confirm.proc.reverse_input") {
      return (
        "確定回沖本筆投料？\n- 投料ID：" +
        String(p.inId || "") +
        "\n- 投料Lot：" +
        String(p.lotId || "") +
        "\n- 數量：" +
        String(p.qtyText || "") +
        "\n\n注意：若該 Lot 已被下游使用，系統會阻擋。"
      );
    }
    if (k === "confirm.proc.void_output") {
      return (
        "確定作廢本筆回收？\n- 回收ID：" +
        String(p.outId || "") +
        "\n- 產出Lot：" +
        String(p.lotId || "") +
        "\n- 數量：" +
        String(p.qtyText || "") +
        "\n\n注意：若此產出Lot已被下游使用，系統會阻擋。"
      );
    }
    if (k === "confirm.proc.retract_issue") {
      return "確定撤回「送加工（扣庫）」？\n系統會回沖投料扣庫，並刪除本加工單的投料明細。\n\n限制：若已有任何回收（未作廢）或投料 Lot 已被下游使用，會被阻擋。";
    }
    if (k === "confirm.proc.cancel_order") {
      return "確定取消此加工單？系統會建立回沖庫存異動。";
    }
    if (k === "confirm.master.load") return masterLoadMessageByKey_(p.key);
    return String(p.fallback || "");
  }

  /**
   * 主檔 Load 守衛（物件參數版）
   * @param {{
   *   nextId: any,
   *   curId: any,
   *   isEditing: boolean,
   *   getCurrentSnapshot: () => string,
   *   getLoadedSnapshot: () => string,
   *   normalizeId?: (v:any) => string,
   *   key?: string,
   *   message?: string,
   * }} opts
   */
  function guardMasterLoad_(opts) {
    if (!opts || typeof opts !== "object") return true;
    return guardBeforeLoadDiscard_({
      nextId: opts.nextId,
      curId: opts.curId,
      isEditing: function () {
        return !!opts.isEditing;
      },
      getCurrentSnapshot: opts.getCurrentSnapshot,
      getLoadedSnapshot: opts.getLoadedSnapshot,
      normalizeId: opts.normalizeId,
      key: opts.key,
      message: opts.message,
    });
  }

  /**
   * 綁定欄位切換守衛：有草稿/有輸入時切換會先確認；取消則回復原值。
   * @param {HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement} el
   * @param {{
   *   key?: string,
   *   hasBlocking: () => boolean,
   *   message: string,
   *   onClear?: () => void,
   *   onAfter?: () => void,
   * }} opts
   */
  function bindGuardedValueChange(el, opts) {
    if (!el || !opts || typeof opts.hasBlocking !== "function") return;
    var key = String(opts.key || "erpUxGuard");
    try {
      if (el.dataset && el.dataset[key + "Bound"] === "1") return;
      if (el.dataset) el.dataset[key + "Bound"] = "1";
    } catch (_e0) {}

    function setPrev_(v) {
      try {
        if (el.dataset) el.dataset[key + "Prev"] = v;
      } catch (_e) {}
    }
    function getPrev_() {
      try {
        return el.dataset ? String(el.dataset[key + "Prev"] || "") : "";
      } catch (_e) {
        return "";
      }
    }

    setPrev_(getVal_(el));
    el.addEventListener("focus", function () {
      setPrev_(getVal_(el));
    });
    el.addEventListener("change", function () {
      var prev = getPrev_();
      var next = getVal_(el);
      if (prev === next) {
        if (typeof opts.onAfter === "function") opts.onAfter();
        return;
      }

      var blocked = false;
      try {
        blocked = !!opts.hasBlocking();
      } catch (_eB) {
        blocked = false;
      }

      if (!blocked) {
        setPrev_(next);
        if (typeof opts.onAfter === "function") opts.onAfter();
        return;
      }

      var ok = confirmDiscard_(opts.message);
      if (!ok) {
        setVal_(el, prev);
        if (typeof opts.onAfter === "function") opts.onAfter();
        return;
      }

      try {
        if (typeof opts.onClear === "function") opts.onClear();
      } catch (_eC) {}
      setPrev_(next);
      if (typeof opts.onAfter === "function") opts.onAfter();
    });
  }

  function guardedChangeMessageByKey_(key) {
    var k = String(key || "").trim().toLowerCase();
    if (k === "po.supplier")
      return "你已經有採購明細草稿/已載入明細。\n切換供應商會清空目前明細，避免誤送。\n\n是否繼續？";
    if (k === "so.customer")
      return "你已經有銷售明細草稿/已載入明細。\n切換客戶會清空目前明細，避免誤送。\n\n是否繼續？";
    if (k === "so.salesperson")
      return "你已經有銷售明細草稿/已載入明細。\n切換業務會清空目前明細，避免誤送。\n\n是否繼續？";
    if (k === "so.type")
      return "你已經有銷售明細草稿/已載入明細。\n切換類型會清空目前明細，避免誤送。\n\n是否繼續？";
    if (k === "import.doc_id")
      return "你目前已有報單品項草稿。\n切換報單ID會清空草稿，避免誤存到另一張報單。\n\n是否繼續？";
    if (k === "rcv.source_type")
      return "你已選擇來源單號或已輸入收貨數量。\n切換來源類型會清空目前明細與已輸入數量，避免誤收。\n\n是否繼續？";
    if (k === "rcv.source_id")
      return "你已輸入本次收貨數量。\n切換來源單號會清空目前已輸入數量，避免誤收。\n\n是否繼續？";
    if (k === "ws.warehouse")
      return "你目前有輸入關鍵字篩選。\n切換倉別會清空關鍵字，避免誤判。\n\n是否繼續？";
    if (k === "split.source_lot")
      return "你已經新增拆批草稿。\n切換來源 Lot 會清空目前草稿，避免誤拆。\n\n是否繼續？";
    if (k === "merge.source_lot")
      return "你已經新增合批草稿或已輸入取用數量。\n切換來源 Lot 會清空目前取用數量/備註（草稿不會被影響）。\n\n是否繼續？";
    return "";
  }

  function bindGuardedValueChangeByKey_(el, opts) {
    if (!opts || typeof opts !== "object") return;
    var msg = String(opts.message || guardedChangeMessageByKey_(opts.messageKey || opts.key) || "");
    if (!msg) return; // 未知 key：避免靜默用空訊息彈窗
    return bindGuardedValueChange(el, {
      key: opts.key,
      hasBlocking: opts.hasBlocking,
      message: msg,
      onClear: opts.onClear,
      onAfter: opts.onAfter,
    });
  }

  // ===== Dirty tracker（共用）=====
  var dirty_ = (function () {
    var loaded = {}; // { [key]: string }
    var getSnap = {}; // { [key]: () => string }
    function k_(key) {
      return String(key || "").trim();
    }
    function bind(key, snapshotFn) {
      var kk = k_(key);
      if (!kk || typeof snapshotFn !== "function") return;
      getSnap[kk] = snapshotFn;
      try {
        if (loaded[kk] == null) loaded[kk] = String(snapshotFn() || "");
      } catch (_e) {
        if (loaded[kk] == null) loaded[kk] = "";
      }
    }
    function markSaved(key) {
      var kk = k_(key);
      if (!kk) return;
      var fn = getSnap[kk];
      if (typeof fn !== "function") return;
      try {
        loaded[kk] = String(fn() || "");
      } catch (_e) {
        loaded[kk] = "";
      }
    }
    function isDirty(key) {
      var kk = k_(key);
      if (!kk) return false;
      var fn = getSnap[kk];
      if (typeof fn !== "function") return false;
      var cur = "";
      try {
        cur = String(fn() || "");
      } catch (_e) {
        cur = "";
      }
      var prev = String(loaded[kk] || "");
      return !!(cur && prev && cur !== prev);
    }
    function getLoaded(key) {
      return String(loaded[k_(key)] || "");
    }
    function setLoaded(key, snapshot) {
      loaded[k_(key)] = String(snapshot || "");
    }
    return {
      bind: bind,
      markSaved: markSaved,
      isDirty: isDirty,
      getLoaded: getLoaded,
      setLoaded: setLoaded,
    };
  })();

  try {
    window.erpConfirmDiscard_ = confirmDiscard_;
    window.erpConfirmAction_ = confirmAction_;
    window.erpConfirmDiscardKey_ = confirmDiscardKey_;
    window.erpConfirmActionKey_ = confirmActionKey_;
    window.erpConfirmModalAsync_ = confirmModalAsync_;
    window.erpNormalizeIdUpper_ = normalizeIdUpper_;
    window.erpNormalizeIdTrim_ = normalizeIdTrim_;
    window.erpVById_ = vById_;
    window.erpVTrimById_ = vTrimById_;
    window.erpVTrimUpperById_ = vTrimUpperById_;
    window.erpVNumById_ = vNumById_;
    window.erpVIntById_ = vIntById_;
    window.erpVDateById_ = vDateById_;
    window.erpVBoolById_ = vBoolById_;
    window.erpSetVById_ = setVById_;
    window.erpClearIds_ = clearIds_;
    window.erpDirty_ = dirty_;
    window.erpMsg_ = msg_;
    window.erpConfirmPolicy_ = confirmPolicy_;
    window.erpGetConfirmPolicy_ = getConfirmPolicy_;
    window.erpBindGuardedValueChange = bindGuardedValueChange;
    window.erpBindGuardedValueChangeByKey = bindGuardedValueChangeByKey_;
    window.erpGuardMasterLoad_ = guardMasterLoad_;
  } catch (_e) {}
})();

