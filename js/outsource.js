/**
 * Outsource / Process Orders（API 版）
 * - 分階段：建立(OPEN) → 送加工(PROCESS_OUT) → 回收(PROCESS_IN) → 完成(POSTED)
 * - 支援分批回收；取消加工單可回沖 movements
 */

let procInputs = [];
let procOutputs = [];
let procLots = [];
let procMovements = []; // legacy：已不再載入整表 inventory_movement；保留變數以免舊碼引用報錯
let procProducts = [];
let procSuppliers = [];
let procWarehouses = [];
let procEditing = false;
let procImportReceiptIdToDocId = {};
let procGoodsReceiptIdToPoId = {};
let procImportDocIdToImportNo = {};
let procLoadedInputsForHint = [];
let procLoadedOutputsForHint = [];
let procLoadedStatus_ = "";
let procRelInputsByOutputLotId = {};
let procAvailableByLotId = {};
let procReceiveInFlight = false;
let procIssueInFlight = false;
let procLoadInFlight = false;
let procPendingLoadId_ = "";
let procLoadWarnToken_ = "";
let procEditingInputDraftId = "";
let procEditingOutputDraftId = "";
let procSelectedDbInputId = "";
let procSelectedDbOutputId = "";
// 注意：不在前端鎖住投料新增；改以 Lot Picker 條件（可用量>0）避免誤選無庫存 Lot。

function procSetV_(id, v){
  try{
    if(typeof window.erpSetVById_ === "function") return window.erpSetVById_(id, v);
  }catch(_e){}
  const el = document.getElementById(String(id || ""));
  if(el && "value" in el) el.value = v;
}

function procClear_(ids){
  try{
    if(typeof window.erpClearIds_ === "function") return window.erpClearIds_(ids);
  }catch(_e){}
  const list = Array.isArray(ids) ? ids : [ids];
  for(let i = 0; i < list.length; i++){
    const el = document.getElementById(String(list[i] || ""));
    if(el && "value" in el) el.value = "";
  }
}

// 逐筆操作：列內「儲存中…」提示（避免誤以為沒按到）
const procRowBusy = {
  input: {},  // { [process_input_id]: "儲存中…" }
  output: {}  // { [process_output_id]: "儲存中…" }
};

function setProcRowBusy_(kind, id, text){
  const k = String(kind || "");
  const key = String(id || "");
  if(!key) return;
  if(k !== "input" && k !== "output") return;
  if(text){
    procRowBusy[k][key] = String(text);
  }else{
    delete procRowBusy[k][key];
  }
  if(k === "input") renderProcInputs();
  if(k === "output") renderProcOutputs();
}

function parseIsoNoTzAsLocalKey_(s){
  // 現有系統多用 nowIso16() → YYYY-MM-DDTHH:mm
  // 這裡用字串比大小即可（同格式時等同時間排序）
  return String(s || "");
}

function disableButtonsByOnclick_(onclickText, disabled){
  const sel = `button[onclick="${onclickText}"]`;
  document.querySelectorAll(sel).forEach(btn => {
    btn.disabled = !!disabled;
    if(disabled){
      if(!btn.getAttribute("title")) btn.setAttribute("title", "處理中…");
    }
  });
}

function setProcActionInlineHint_(onclickText, text){
  const sel = `button[onclick="${onclickText}"]`;
  document.querySelectorAll(sel).forEach(btn => {
    const group = btn.closest(".button-group");
    if(!group) return;
    const hintSel = `[data-proc-hint-for="${onclickText.replace(/"/g, '\\"')}"]`;
    const old = group.querySelector(hintSel);
    if(old) old.remove();
    if(text){
      const span = document.createElement("span");
      span.className = "save-hint-inline";
      span.setAttribute("data-proc-hint-for", onclickText);
      span.textContent = String(text);
      group.appendChild(span);
    }
  });
}

function invalidateProcCaches_(){
  // 確保作廢/回沖/送加工/回收後，Lot 清單與可用量立刻反映最新
  try{
    invalidateCache("lot");
    invalidateCache("inventory_movement");
    invalidateCache("process_order_input");
    invalidateCache("process_order_output");
    invalidateCache("lot_relation");
    invalidateCache("process_order");
  }catch(_e){}
}

function formatProcSupplierDisplay_(supplierId){
  const id = String(supplierId || "");
  if(!id) return "";
  const s = (procSuppliers || []).find(x => String(x.supplier_id || "") === id) || {};
  const name = String(s.supplier_name || "").trim();
  return name ? `${id} - ${name}` : id;
}

function setProcStatusHint_(text){
  const el = document.getElementById("procStatusHint");
  if(!el) return;
  const finalText = text || "加工流程：新單 — 填主檔後按下方「建立」";
  el.textContent = finalText;
  // 比照 import：warn 用棕色，其餘用灰色（避免過度搶眼）
  const t = String(finalText || "");
  // 對齊「銷售狀態」：新單維持灰色；需要提醒/阻擋的狀態才用棕色
  const isWarn = t.includes("未載入") || t.includes("載入中") || t.includes("處理中") || t.includes("待回收") || t.includes("部分回收");
  const isError = t.includes("已取消");
  el.style.color = isError ? "#991b1b" : (isWarn ? "#92400e" : "#64748b");
}

function setProcInvHint_(text){
  const el = document.getElementById("procInvHint");
  if(!el) return;
  const finalText = text || "庫存狀態：未載入 — 請先建立或載入加工單";
  el.textContent = finalText;
  const t = String(finalText || "");
  const isWarn = t.includes("未載入") || t.includes("載入中") || t.includes("處理中") || t.includes("已扣庫") || t.includes("部分入庫");
  const isError = t.includes("已取消");
  el.style.color = isError ? "#991b1b" : (isWarn ? "#92400e" : "#64748b");
}

function deriveProcStatusHint_(po, inputs, outputs){
  if(!po) return "加工流程：新單 — 填主檔後按下方「建立」";
  const status = String(po.status || "").trim().toUpperCase();
  if(status === "CANCELLED") return "加工流程：已取消（僅可檢視）";

  const inCount = Array.isArray(inputs) ? inputs.length : 0;
  // 已作廢回收不應計入「已回收批數」
  const outCount = Array.isArray(outputs)
    ? outputs.filter(x => String(x.status || "").toUpperCase() !== "CANCELLED").length
    : 0;

  if(inCount === 0){
    return "加工流程：已載入 — 未送加工（尚未扣庫）";
  }
  if(outCount === 0){
    return "加工流程：已載入 — 已送加工（待回收）";
  }
  if(status === "POSTED"){
    return "加工流程：已載入 — 已結案（加工已回收）";
  }
  // OPEN + outputs>0 → 部分回收
  return `加工流程：已載入 — 部分回收（已回收 ${outCount} 批）`;
}

function deriveProcInvHint_(po, inputs, outputs){
  if(!po) return "庫存狀態：未載入 — 請先建立或載入加工單";
  const status = String(po.status || "").trim().toUpperCase();
  if(status === "CANCELLED") return "庫存狀態：已取消（僅可檢視）";
  const inCount = Array.isArray(inputs) ? inputs.length : 0;
  const outCount = Array.isArray(outputs)
    ? outputs.filter(x => String(x.status || "").toUpperCase() !== "CANCELLED").length
    : 0;
  if(inCount === 0) return "庫存狀態：已載入 — 未扣庫（尚未送加工）";
  if(outCount === 0) return "庫存狀態：已載入 — 已扣庫（送加工）";
  if(status === "POSTED") return "庫存狀態：已載入 — 已入庫（回收完成）";
  return `庫存狀態：已載入 — 部分入庫（已回收 ${outCount} 批）`;
}

function formatProcProductDisplay_(productId){
  const p = (procProducts || []).find(x => x.product_id === productId) || {};
  const name = p.product_name || productId || "";
  const spec = p.spec || "";
  return spec ? `${name}（${spec}）` : name;
}

function escapeHtml_(s){
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 加工單列表「類型」欄：代碼 → 中文（與 proc_type 選項一致） */
function procProcessTypeLabel_(t){
  const u = String(t || "").trim().toUpperCase();
  const map = {
    PROCESS: "加工",
    PACKING: "包裝",
    REPACK: "重新包裝",
    REWORK: "重工",
    SPLIT: "拆批",
    MERGE: "併批"
  };
  if(map[u]) return map[u];
  const raw = String(t || "").trim();
  return raw || "—";
}

/** 加工單列表「加工廠」：優先顯示供應商中文名，並保留代號 */
function procSupplierListCell_(supplierId, supMap){
  const id = String(supplierId || "").trim();
  if(!id) return "—";
  const s = (supMap && (supMap[id] || supMap[id.toUpperCase()])) || null;
  const name = String(s?.supplier_name || "").trim();
  if(name) return `${name}（${id}）`;
  return id;
}

/** 從其他模組快速跳到 Lots，並帶入關鍵字（例如 lot_id） */
function procOpenLots_(keyword){
  const kw = String(keyword || "").trim();
  if(typeof navigate !== "function") return;
  navigate("lots");
  const t0 = Date.now();
  const timer = setInterval(function(){
    // 等 module 載入、DOM 出現
    const el = document.getElementById("search_lots_keyword");
    if(el){
      el.value = kw;
      try{
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }catch(_e){
        // 舊瀏覽器 fallback
        try{ if(typeof renderLots === "function") renderLots(); }catch(_e2){}
      }
      clearInterval(timer);
      return;
    }
    // 最多等 5 秒，避免無限輪詢
    if(Date.now() - t0 > 5000){
      clearInterval(timer);
    }
  }, 50);
}

function procOutputStatusLabel_(status){
  const s = String(status || "").trim().toUpperCase();
  // 相容舊資料：早期回收 output.status 可能是 PENDING（其實代表已建立）
  if(s === "PENDING" || s === "CREATED") return "已建立回收批次";
  if(s === "CANCELLED") return "已作廢";
  return (typeof termLabelZhOnly === "function" ? termLabelZhOnly(s) : (typeof termLabel === "function" ? termLabel(s) : s)) || s;
}

function renderProcLoadedInputsTable_(inputs){
  const tbody = document.getElementById("procLoadedInputsTbody");
  if(!tbody) return;
  const rows = Array.isArray(inputs) ? inputs : [];
  tbody.innerHTML = "";
  if(rows.length === 0){
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#64748b;">(無)</td></tr>`;
    return;
  }
  rows.forEach((x, idx) => {
    const inId = String(x.process_input_id || "");
    const lotId = String(x.lot_id || "");
    const productId = String(x.product_id || "");
    const qty = (x.issue_qty != null ? x.issue_qty : "");
    const unit = String(x.unit || "");
    const safeInId = inId.replace(/\\/g,"\\\\").replace(/'/g,"\\'");
    tbody.innerHTML += `
      <tr>
        <td>${idx+1}</td>
        <td>${escapeHtml_(lotId)}</td>
        <td>${escapeHtml_(formatProcProductDisplay_(productId))}</td>
        <td>${escapeHtml_(qty)}</td>
        <td>${escapeHtml_(unit)}</td>
        <td>
          <button class="btn-secondary" ${inId ? "" : "disabled"} onclick="${inId ? `voidProcessInput('${safeInId}')` : "return false;"}">回沖本筆投料</button>
        </td>
      </tr>
    `;
  });
}

async function voidProcessInput(processInputId){
  clearProcBlockNotice_();
  const inId = String(processInputId || "").trim();
  const procId = (document.getElementById("proc_id")?.value || "").trim().toUpperCase();
  if(!procId) return showToast("請先載入加工單","error");
  if(!inId) return showToast("找不到投料明細ID","error");

  setProcRowBusy_("input", inId, "儲存中…");
  showSaveHint();
  try{
    // 後端已封鎖 direct delete_process_order_input；避免前端回沖扣庫後卡在刪除明細。
    // 目前安全做法：提示使用者改用「撤回送加工」整單回沖（bundle 原子處理）。
    showProcBlockNotice_("回沖本筆投料目前不支援", [
      "為了避免交易一致性被繞過，系統已封鎖直接刪除投料明細（process_order_input）。",
      "請改用下方功能「撤回送加工」：會一次回沖所有投料扣庫並清除投料明細（由後端 bundle 原子完成）。"
    ]);
    return showToast("回沖本筆投料：目前請改用「撤回送加工」", "error");

    const po = await getOne("process_order","process_order_id",procId).catch(()=>null);
    if(!po) return showToast("找不到加工單","error");
    if((po.status || "").toUpperCase() === "CANCELLED"){
      return showToast("此加工單已取消，不能回沖投料。", "error");
    }

    const [inputsAll, outputsAll, mvAll] = await Promise.all([
      getAll("process_order_input").catch(()=>[]),
      getAll("process_order_output").catch(()=>[]),
      // 用 ref 篩選取得該加工單 movements（刷新，避免 cache 過舊）
      (async ()=>{
        try{
          const r = await callAPI({
            action: "list_inventory_movement_by_ref",
            ref_type: "PROCESS_ORDER",
            ref_id: procId
          }, { method: "GET" });
          return (r && r.data) ? r.data : [];
        }catch(_e){
          return await getAll("inventory_movement", { refresh: true }).catch(()=>[]);
        }
      })(),
    ]);

    const input = (inputsAll || []).find(x => String(x.process_input_id || "") === inId);
    if(!input) return showToast("找不到此投料明細","error");
    if(String(input.process_order_id || "").toUpperCase() !== procId){
      return showToast("投料明細不屬於目前加工單","error");
    }

    const outputs = (outputsAll || []).filter(x => String(x.process_order_id || "").toUpperCase() === procId);
    const activeOutputs = outputs.filter(x => String(x.status || "").toUpperCase() !== "CANCELLED");
    if(activeOutputs.length > 0){
      showProcBlockNotice_("回沖投料被阻擋", ["此加工單已有回收紀錄（未作廢），不可回沖投料（會造成已回收卻未投料的矛盾）。請先逐筆作廢回收，或整單取消。"]);
      return showToast("回沖失敗：已有回收紀錄（未作廢）。", "error");
    }

    const lotId = String(input.lot_id || "");
    if(!lotId) return showToast("此投料明細缺少 Lot ID，無法回沖", "error");

    // 下游出貨檢查：只需要本 lot 的出貨明細（優先走後端 by lot）
    let shipItems = [];
    try{
      const r = await callAPI({ action: "list_shipment_item_by_lot", lot_id: lotId });
      shipItems = (r && r.data) ? r.data : [];
    }catch(_e){
      // fallback：先用近期出貨的 shipment_item（降低全表機率），最後才全表
      try{
        const r = await callAPI({ action: "list_shipment_recent", days: 365, _ts: String(Date.now()) }, { method: "POST" });
        const ships = (r && r.data) ? r.data : [];
        const ids = (ships || []).map(s => String(s.shipment_id || "").trim()).filter(Boolean);
        if(ids.length){
          const rr = await callAPI({ action: "list_shipment_item_by_shipments", shipment_ids_json: JSON.stringify(ids) }, { method: "POST" });
          const rows = (rr && rr.data) ? rr.data : [];
          shipItems = Array.isArray(rows) ? rows : [];
        }else{
          shipItems = [];
        }
      }catch(_e2){
        shipItems = await getAll("shipment_item").catch(()=>[]);
      }
    }

    const srcMv = (mvAll || []).filter(m =>
      String(m.ref_type || "") === "PROCESS_ORDER" &&
      String(m.ref_id || "").toUpperCase() === procId &&
      String(m.movement_type || "").toUpperCase() === "PROCESS_OUT" &&
      String(m.lot_id || "") === lotId
    );
    if(srcMv.length === 0){
      showProcBlockNotice_("回沖投料被阻擋", [`找不到此投料 Lot ${lotId} 的送加工扣庫異動（PROCESS_OUT），無法回沖。`]);
      return showToast("回沖失敗：缺少送加工異動。", "error");
    }

    const msgFallback = `確定回沖本筆投料？\n- 投料ID：${inId}\n- 投料Lot：${lotId}\n- 數量：${input.issue_qty} ${input.unit || ""}\n\n注意：若該 Lot 已被下游使用，系統會阻擋。`;
    const ok = window.erpConfirmActionKey_("confirm.proc.reverse_input", {
      inId,
      lotId,
      qtyText: `${input.issue_qty} ${input.unit || ""}`.trim(),
      fallback: msgFallback
    });
    if(!ok){
      return;
    }

    // 下游使用檢查：送加工後，此 lot 是否有其他單據異動/出貨
    const issueAt = parseIsoNoTzAsLocalKey_(srcMv.map(m => m.created_at).sort()[0] || "");
    const blockReasons = [];
    (shipItems || []).forEach(s => {
      if(String(s.lot_id || "") === lotId){
        blockReasons.push(`投料 Lot ${lotId} 已被出貨使用（出貨單：${s.shipment_id || ""}），不可回沖投料。`);
      }
    });
    (mvAll || []).forEach(m => {
      if(String(m.lot_id || "") !== lotId) return;
      const createdAt = parseIsoNoTzAsLocalKey_(m.created_at);
      if(!(createdAt && issueAt && createdAt > issueAt)) return;
      const sameOrder = String(m.ref_type || "") === "PROCESS_ORDER" && String(m.ref_id || "").toUpperCase() === procId;
      const isReversal = String(m.system_remark || m.remark || "").includes("REVERSAL");
      if(!sameOrder && !isReversal){
        blockReasons.push(`投料 Lot ${lotId} 在送加工後已有下游庫存異動：${m.movement_type || "UNKNOWN"}（ref:${m.ref_type || ""}:${m.ref_id || ""}）。`);
      }
    });
    const uniq = Array.from(new Set(blockReasons));
    if(uniq.length){
      showProcBlockNotice_("回沖投料被阻擋", uniq);
      return showToast("回沖失敗：投料 Lot 已有下游使用紀錄，請先展開明細。", "error");
    }

    // 回沖此 lot 的 PROCESS_OUT（可能不只一筆，保守全回沖；並用 system_remark/remark 防重複）
    for(const m of srcMv){
      const already = (mvAll || []).some(x =>
        String(x.system_remark || x.remark || "").includes(`REVERSAL(PROCESS_OUT) of ${m.movement_id || ""}`)
      );
      if(already) continue;
      const qty = Number(m.qty || 0);
      if(!qty) continue;
      await createRecord("inventory_movement", {
        movement_id: generateId("MV"),
        movement_type: "ADJUST",
        lot_id: m.lot_id || "",
        product_id: m.product_id || "",
        warehouse_id: String(m.warehouse_id || "MAIN").trim().toUpperCase() || "MAIN",
        qty: String(-qty),
        unit: m.unit || "",
        ref_type: "PROCESS_ORDER",
        ref_id: procId,
        remark: "",
        created_by: getCurrentUser(),
        created_at: nowIso16(),
        updated_by: "",
        updated_at: "",
        system_remark: `REVERSAL(PROCESS_OUT) of ${m.movement_id || ""} (${procId})`,
      });
    }

    await deleteRecord("process_order_input","process_input_id",inId);

    setProcRowBusy_("input", inId, "");
    invalidateProcCaches_();
    await loadProcMasterData();
    await renderProcessOrders();
    await loadProcessOrder(procId);
    showToast("已回沖本筆投料（扣庫已回沖）");
  } finally {
    setProcRowBusy_("input", inId, "");
    hideSaveHint();
  }
}

function renderProcLoadedOutputsTable_(outputs){
  const tbody = document.getElementById("procLoadedOutputsTbody");
  if(!tbody) return;
  const rows = Array.isArray(outputs) ? outputs : [];
  tbody.innerHTML = "";
  if(rows.length === 0){
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#64748b;">(無)</td></tr>`;
    return;
  }
  rows.forEach((x, idx) => {
    const outId = String(x.process_output_id || "");
    const lotId = String(x.lot_id || "");
    const productId = String(x.product_id || "");
    const qty = (x.receive_qty != null ? x.receive_qty : "");
    const unit = String(x.unit || "").trim();
    const qtyUnit = unit ? `${escapeHtml_(String(qty))} ${escapeHtml_(unit)}` : escapeHtml_(String(qty));
    const status = String(x.status || "");
    const canVoid = !!outId && String(status).toUpperCase() !== "CANCELLED";
    const safeOutId = outId.replace(/\\/g,"\\\\").replace(/'/g,"\\'");
    tbody.innerHTML += `
      <tr>
        <td>${idx+1}</td>
        <td>${escapeHtml_(lotId)}</td>
        <td>${escapeHtml_(formatProcProductDisplay_(productId))}</td>
        <td>${qtyUnit}</td>
        <td>${escapeHtml_(procOutputStatusLabel_(status))}</td>
        <td>
          <button class="btn-secondary" ${canVoid ? "" : "disabled"} onclick="${canVoid ? `voidProcessOutput('${safeOutId}')` : "return false;"}">作廢本筆回收</button>
        </td>
      </tr>
    `;
  });
}

async function voidProcessOutput(processOutputId){
  clearProcBlockNotice_();
  const outId = String(processOutputId || "").trim();
  const procId = (document.getElementById("proc_id")?.value || "").trim().toUpperCase();
  if(!procId) return showToast("請先載入加工單","error");
  if(!outId) return showToast("找不到回收明細ID","error");

  setProcRowBusy_("output", outId, "儲存中…");
  showSaveHint();
  try{
    const po = await getOne("process_order","process_order_id",procId).catch(()=>null);
    if(!po) return showToast("找不到加工單","error");
    if((po.status || "").toUpperCase() === "CANCELLED"){
      return showToast("此加工單已取消，不能作廢回收。", "error");
    }

    const outputsAll = await getAll("process_order_output").catch(()=>[]);
    const out = (outputsAll || []).find(x => String(x.process_output_id || "") === outId);
    if(!out) return showToast("找不到此回收明細","error");
    if(String(out.process_order_id || "").toUpperCase() !== procId){
      return showToast("回收明細不屬於目前加工單","error");
    }
    if(String(out.status || "").toUpperCase() === "CANCELLED"){
      return showToast("此筆回收已作廢", "error");
    }

    const lotId = String(out.lot_id || "");
    const qty = Number(out.receive_qty || 0);
    if(!lotId) return showToast("此筆回收缺少 Lot ID，無法作廢", "error");
    if(!(qty > 0)) return showToast("此筆回收數量異常，無法作廢", "error");

    const msgFallback = `確定作廢本筆回收？\n- 回收ID：${outId}\n- 產出Lot：${lotId}\n- 數量：${out.receive_qty} ${out.unit || ""}\n\n注意：若此產出Lot已被下游使用，系統會阻擋。`;
    const ok = window.erpConfirmActionKey_("confirm.proc.void_output", {
      outId,
      lotId,
      qtyText: `${out.receive_qty} ${out.unit || ""}`.trim(),
      fallback: msgFallback
    });
    if(!ok){
      return;
    }

    await callAPI({
      action: "void_process_output_bundle",
      process_order_id: procId,
      process_output_id: outId,
      idempotency_key: procBuildIdempotencyKey_("PROC_VOID_OUT", [procId, outId, lotId, qty]),
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    }, { method: "POST" });

    clearProcOutputEditor_();
    updateLossHint();
    setProcRowBusy_("output", outId, "");
    invalidateProcCaches_();
    await loadProcMasterData();
    await renderProcessOrders();
    await loadProcessOrder(procId);
    showToast("已作廢本筆回收並回沖庫存");
  } finally {
    setProcRowBusy_("output", outId, "");
    hideSaveHint();
  }
}

function formatProcLotOptionLabel_(lot, available){
  const lotId = String(lot?.lot_id || "");
  const productId = String(lot?.product_id || "");
  const whText = procWarehouseLabelByLot_(lot) || "";
  const avText = (typeof invFormatAvailableText_ === "function") ? invFormatAvailableText_(available) : String(available ?? "--");
  return `${lotId} (${productId}) 可用:${avText}` + (whText ? ` | ${whText}` : "");
}

function formatProcSourceText_(lot){
  const sourceType = String(lot?.source_type || "").toUpperCase();
  const sourceId = String(lot?.source_id || "");
  if(sourceType === "PURCHASE"){
    const poId = procGoodsReceiptIdToPoId[sourceId] || "";
    return poId ? `採購單:${poId}（收貨:${sourceId}）` : `採購:${sourceId}`;
  }
  if(sourceType === "IMPORT"){
    const docId = procImportReceiptIdToDocId[sourceId] || "";
    const impNo = docId ? (procImportDocIdToImportNo[docId] || "") : "";
    if(impNo || docId){
      return `報單:${impNo || "—"}（ID:${docId || "—"} / 收貨:${sourceId}）`;
    }
    return `進口:${sourceId}`;
  }
  if(sourceType === "PROCESS") return `加工:${sourceId}`;
  return sourceType ? `${sourceType}:${sourceId}` : sourceId;
}

function renderProcLotPicker_(lots){
  const tbody = document.getElementById("procLotPickBody");
  if(!tbody) return;
  const kw = (document.getElementById("proc_lot_picker_keyword")?.value || "").trim().toLowerCase();
  const viewMode = document.getElementById("proc_lot_picker_viewmode")?.value || "flat";
  const source = Array.isArray(lots) ? lots : [];
  const list = source.filter(l => {
    if(!kw) return true;
    const lotId = String(l.lot_id || "").toLowerCase();
    const pname = String(formatProcProductDisplay_(l.product_id || "") || "").toLowerCase();
    const src = String(formatProcSourceText_(l) || "").toLowerCase();
    const wh = String(procWarehouseLabelByLot_(l) || "").toLowerCase();
    return lotId.includes(kw) || pname.includes(kw) || src.includes(kw) || wh.includes(kw);
  });
  tbody.innerHTML = "";
  if(!list.length){
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#64748b;">目前無可選 Lot</td></tr>`;
    return;
  }

  function renderLotRow_(l){
    const av = procGetAvailable(l.lot_id);
    const lotId = String(l.lot_id || "");
    const productText = formatProcProductDisplay_(l.product_id || "");
    const whText = procWarehouseLabelByLot_(l) || (l.warehouse_id ? String(l.warehouse_id) : "");
    const expiry = String(l.expiry_date || "") || "—";
    tbody.innerHTML += `
      <tr style="cursor:pointer;" onclick="pickProcInputLot('${lotId.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}')">
        <td>${lotId}</td>
        <td>${productText}</td>
        <td>${whText || "—"}</td>
        <td>${av}</td>
        <td>${expiry}</td>
        <td><button type="button" class="btn-secondary">帶入</button></td>
      </tr>
    `;
  }
  if(viewMode === "group_source"){
    const groups = {};
    list.forEach(l => {
      const key = formatProcSourceText_(l) || "未分類來源";
      if(!groups[key]) groups[key] = [];
      groups[key].push(l);
    });
    Object.keys(groups).sort().forEach(k => {
      tbody.innerHTML += `
        <tr style="background:#f8fafc;">
          <td colspan="6" style="font-weight:600;color:#334155;padding:8px 10px;">來源：${k}（${groups[k].length}）</td>
        </tr>
      `;
      groups[k].forEach(renderLotRow_);
    });
  }else{
    list.forEach(renderLotRow_);
  }
}

function getProcEligibleLots_(){
  return (procLots || []).filter(l => {
    if((l.inventory_status || "ACTIVE") !== "ACTIVE") return false;
    if((l.status || "PENDING") !== "APPROVED") return false;
    // 過期 Lot 不可投料
    if(typeof invIsExpired_ === "function" && invIsExpired_(l.expiry_date)) return false;
    // 已送加工扣完/無庫存（可用量<=0）不應出現在可選清單
    const av = procGetAvailable(l.lot_id);
    return Number(av) > 0;
  });
}

function openProcLotPicker(){
  const modal = document.getElementById("procLotPickerModal");
  if(!modal) return;
  modal.style.display = "flex";
  const kw = document.getElementById("proc_lot_picker_keyword");
  if(kw){
    procClear_("proc_lot_picker_keyword");
    kw.focus();
  }
  renderProcLotPicker_(getProcEligibleLots_());
}

function closeProcLotPicker(){
  const modal = document.getElementById("procLotPickerModal");
  if(modal) modal.style.display = "none";
}

function num(v){
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

function isDraftRow_(row){
  return !!(row && row._mode === "DRAFT");
}

function isDbRow_(row){
  return !!(row && row._mode === "DB");
}

function normUnit_(u){
  return String(u || "").trim().toUpperCase();
}

function uniqueUnits_(rows, unitField){
  const s = new Set();
  (rows || []).forEach(r => {
    const u = normUnit_(r?.[unitField]);
    if(u) s.add(u);
  });
  return Array.from(s);
}

function clearProcBlockNotice_(){
  const box = document.getElementById("procBlockNotice");
  const list = document.getElementById("procBlockReasonList");
  if(list) list.innerHTML = "";
  if(box) box.style.display = "none";
}

function showProcBlockNotice_(title, reasons){
  const box = document.getElementById("procBlockNotice");
  const titleEl = document.getElementById("procBlockTitle");
  const list = document.getElementById("procBlockReasonList");
  const details = document.getElementById("procBlockDetails");
  if(!box || !titleEl || !list) return;
  const rows = (Array.isArray(reasons) ? reasons : []).filter(Boolean);
  if(rows.length === 0){
    clearProcBlockNotice_();
    return;
  }
  titleEl.textContent = title || "操作被阻擋";
  list.innerHTML = rows.map(r => `<li>${String(r).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</li>`).join("");
  box.style.display = "block";
  if(details) details.open = true;
}

function procShouldAutoReloadAfterError_(err){
  const code = String(err && err.erpErrorCode || "").trim().toUpperCase();
  if(code === "ERR_SOURCE_CHANGED" || code === "ERR_DUPLICATE_REQUEST" || code === "ERR_ALREADY_PROCESSED") return true;
  const msg = String(err && err.message != null ? err.message : err || "");
  const backendErrors = err && Array.isArray(err.backendErrors) ? err.backendErrors : [];
  const full = (msg + " " + backendErrors.join(" ")).toLowerCase();
  return (
    /(process|order|source)\s+changed/.test(full) ||
    /please\s+reload\s+and\s+try\s+again/.test(full) ||
    /duplicate\s+request\s+detected/.test(full) ||
    /already\s+(posted|cancelled|canceled|issued|received)/.test(full) ||
    /狀態.*(已過帳|已作廢|不可重做|已取消|已完成)/.test(full) ||
    /此單據已被處理|狀態已變更/.test(full)
  );
}

function procBuildIdempotencyKey_(scope, payload){
  const raw = String(scope || "") + "|" + String(payload || "");
  let h = 0;
  for(let i = 0; i < raw.length; i++){
    h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
  }
  return "IDEM-" + String(scope || "PROC") + "-" + String(Math.abs(h)).toUpperCase();
}

async function procAutoReloadAfterConflict_(processOrderId){
  try{
    // 避免網路不穩/後端短暫錯誤造成重載迴圈：同加工單短時間最多自動重載 2 次
    try{
      const id = String(processOrderId || document.getElementById("proc_id")?.value || "").trim().toUpperCase() || "(unknown)";
      const now = Date.now();
      const w = (typeof window !== "undefined" && window) ? window : {};
      if(!w.__erpAutoReloadGuardProc__) w.__erpAutoReloadGuardProc__ = {};
      const g = w.__erpAutoReloadGuardProc__;
      const prev = g[id] || { at: 0, n: 0 };
      const withinMs = 15000;
      const n = (now - prev.at) < withinMs ? (prev.n + 1) : 1;
      g[id] = { at: now, n };
      if(n > 2){
        showToast("自動重新載入次數過多，請手動重新載入後再送出", "error");
        return false;
      }
    }catch(_eGuard){}
    const id = String(processOrderId || document.getElementById("proc_id")?.value || "").trim().toUpperCase();
    showToast("資料已更新，系統正在為你重新載入…", "warn", 6000);
    invalidateProcCaches_();
    await loadProcMasterData();
    await renderProcessOrders();
    if(id) await loadProcessOrder(id);
    showToast("已重新載入最新資料，請確認後再送出", "warn", 6000);
    return true;
  }catch(_eReload){
    showToast("自動重新載入失敗，請手動重新載入後再送出", "error");
    return false;
  }
}

async function outsourceInit(){
  await loadProcMasterData();
  const lotKw = document.getElementById("proc_lot_picker_keyword");
  if(lotKw && !lotKw.dataset.bound){
    lotKw.dataset.bound = "1";
    lotKw.addEventListener("input", () => renderProcLotPicker_(getProcEligibleLots_()));
  }
  const lotView = document.getElementById("proc_lot_picker_viewmode");
  if(lotView && !lotView.dataset.bound){
    lotView.dataset.bound = "1";
    lotView.addEventListener("change", () => renderProcLotPicker_(getProcEligibleLots_()));
  }
  // 預估損耗：確保輸入回收數量就即時更新（避免某些情境下全域監聽沒打到）
  const outQtyEl = document.getElementById("proc_output_qty");
  if(outQtyEl && !outQtyEl.dataset.boundLoss){
    outQtyEl.dataset.boundLoss = "1";
    outQtyEl.addEventListener("input", updateLossHint);
    outQtyEl.addEventListener("change", updateLossHint);
  }
  const outProdEl = document.getElementById("proc_output_product");
  if(outProdEl && !outProdEl.dataset.boundLoss){
    outProdEl.dataset.boundLoss = "1";
    outProdEl.addEventListener("change", updateLossHint);
  }
  resetProcessForm();
  bindAutoSearchToolbar_([
    ["proc_search_keyword", "input"],
    ["proc_search_status", "change"]
  ], () => renderProcessOrders());
  await renderProcessOrders();
}

function resetProcListSearch(){
  procClear_(["proc_search_keyword", "proc_search_status"]);
  renderProcessOrders();
}

/**
 * 送加工前強制更新 lot 與依 lot 彙總可用量（不打整張 inventory_movement）
 */
async function procRefreshLotsAndAvailability_(){
  const [lots, availPack] = await Promise.all([
    getAll("lot", { refresh: true }).catch(() => []),
    typeof loadInventoryMovementAvailableMap_ === "function"
      ? loadInventoryMovementAvailableMap_()
      : Promise.resolve({ map: {}, failed: true })
  ]);
  procLots = lots || [];
  procAvailableByLotId = (availPack && availPack.map) || {};
}

async function loadProcMasterData(){
  const [products, suppliersRaw, lots, avail, warehouses, importReceipts, goodsReceipts, importDocs] = await Promise.all([
    getAll("product"),
    getAll("supplier"),
    getAll("lot"),
    loadInventoryMovementAvailableMap_().catch(() => ({ map:{}, failed:true })),
    getAll("warehouse").catch(() => []),
    getAll("import_receipt").catch(() => []),
    getAll("goods_receipt").catch(() => []),
    getAll("import_document").catch(() => [])
  ]);
  procProducts = products || [];
  procSuppliers = (suppliersRaw || [])
    .filter(s => s.status === "ACTIVE")
    .filter(s => {
      const flows = String(s.supplier_flow || "").toUpperCase();
      // 未填 flow 視為可用（避免舊資料突然消失）
      return !flows || flows.split(",").map(x=>x.trim()).includes("OUTSOURCE");
    });
  procLots = lots || [];
  procWarehouses = (warehouses || []).filter(w => String(w.status || "ACTIVE").toUpperCase() === "ACTIVE");
  procAvailableByLotId = avail?.map || {};
  procImportReceiptIdToDocId = {};
  (importReceipts || []).forEach(r => {
    if(r && r.import_receipt_id){
      procImportReceiptIdToDocId[r.import_receipt_id] = r.import_doc_id || "";
    }
  });
  procGoodsReceiptIdToPoId = {};
  (goodsReceipts || []).forEach(r => {
    if(r && r.gr_id){
      procGoodsReceiptIdToPoId[r.gr_id] = r.po_id || "";
    }
  });
  procImportDocIdToImportNo = {};
  (importDocs || []).forEach(d => {
    if(d && d.import_doc_id){
      procImportDocIdToImportNo[d.import_doc_id] = d.import_no || "";
    }
  });

  initProcDropdowns();
}

function procWarehouseLabelById_(warehouseId){
  const id = String(warehouseId || "").trim().toUpperCase();
  if(!id) return "";
  const w = (procWarehouses || []).find(x => String(x.warehouse_id || "").toUpperCase() === id) || null;
  if(!w) return id;
  const name = String(w.warehouse_name || "").trim();
  const cat = String(w.category || "").trim().toUpperCase();
  const catLabel = (typeof termShortZh_ === "function" ? termShortZh_(cat) : ((typeof termLabel === "function" ? termLabel(cat) : "") || cat));
  const namePart = name || id;
  return catLabel ? `${namePart}-${catLabel}` : namePart;
}

function procWarehouseLabelByLot_(lot){
  return procWarehouseLabelById_(lot?.warehouse_id || "");
}

function procGetAvailable(lotId){
  const id = String(lotId || "");
  if(!id) return null;
  const hit = procAvailableByLotId?.[id];
  if(hit !== undefined) return hit;
  return null;
}

function initProcDropdowns(){
  const supplierSel = document.getElementById("proc_supplier_id");
  if(supplierSel){
    supplierSel.innerHTML =
      `<option value="">請選擇</option>` +
      procSuppliers.map(s => {
        const name = String(s.supplier_name || "").trim();
        const label = name || s.supplier_id;
        return `<option value="${s.supplier_id}">${label}</option>`;
      }).join("");
  }

  renderProcLotPicker_(getProcEligibleLots_());

  const whSel = document.getElementById("proc_output_warehouse");
  if(whSel){
    whSel.innerHTML =
      `<option value="">（自動：跟第一筆投料倉別）</option>` +
      (procWarehouses || []).map(w => {
        const id = String(w.warehouse_id || "").trim();
        if(!id) return "";
        const label = procWarehouseLabelById_(id) || id;
        return `<option value="${id}">${label}</option>`;
      }).join("");
  }

  const outSel = document.getElementById("proc_output_product");
  if(outSel){
    const activeProducts = (procProducts || []).filter(p => p.status === "ACTIVE");
    outSel.innerHTML =
      `<option value="">請選擇</option>` +
      activeProducts.map(p => {
        const name = String(p.product_name || "").trim();
        const spec = String(p.spec || "").trim();
        const label = spec ? `${name}（${spec}）` : (name || (p.product_id || ""));
        return `<option value="${p.product_id}" data-unit="${p.unit || ""}">${label}</option>`;
      }).join("");
  }
}

function procDeriveDefaultReceiveWarehouseId_(inputs){
  const rows = Array.isArray(inputs) ? inputs : [];
  const lotId = String(rows[0]?.lot_id || "").trim();
  if(!lotId) return "";
  const lot = (procLots || []).find(l => String(l.lot_id || "") === lotId) || null;
  const wid = String(lot?.warehouse_id || "").trim().toUpperCase();
  return wid || "";
}

function procApplyDefaultReceiveWarehouse_(inputs){
  const el = document.getElementById("proc_output_warehouse");
  if(!el) return;
  // 使用者若已手動選擇就不覆蓋
  if(String(el.value || "").trim()) return;
  const wid = procDeriveDefaultReceiveWarehouseId_(inputs);
  if(!wid) return;
  // 若下拉沒有該值（例如倉庫停用或尚未載入），就保持空白（仍走自動）
  const has = Array.from(el.options || []).some(o => String(o.value || "").toUpperCase() === wid);
  if(has) el.value = wid;
}

function resetProcessForm(){
  clearProcBlockNotice_();
  procEditing = false;
  procLoadedStatus_ = "";
  procInputs = [];
  procOutputs = [];
  procSelectedDbInputId = "";
  procSelectedDbOutputId = "";
  setProcStatusHint_("加工流程：新單 — 填主檔後按下方「建立」");
  setProcInvHint_("庫存狀態：未載入 — 請先建立或載入加工單");
  renderProcInputs();
  renderProcOutputs();

  const idEl = document.getElementById("proc_id");
  if(idEl){
    // 清除：強制產生新單號（避免沿用剛載入的 proc_id）
    erpInitAutoId_("proc_id", { gen: () => (typeof generateId === "function" ? generateId("PROC") : ""), force: true });
    idEl.disabled = false;
  }
  procClear_([
    "proc_planned_date",
    "proc_remark",
    "proc_input_lot",
    "proc_input_lot_display",
    "proc_input_available",
    "proc_input_qty",
    "proc_input_unit",
    "proc_input_remark",
    "proc_output_product",
    "proc_output_qty",
    "proc_output_unit",
    "proc_output_remark",
    "proc_output_warehouse"
  ]);
  const planned = document.getElementById("proc_planned_date");
  const remark = document.getElementById("proc_remark");
  // planned/remark 已由 procClear_ 清空；保留這兩行只做 null-safe 讀取（不再賦值）

  const supplier = document.getElementById("proc_supplier_id");
  if(supplier){
    procClear_("proc_supplier_id");
    supplier.disabled = false;
  }
  const type = document.getElementById("proc_type");
  if(type){
    procClear_("proc_type");
    type.disabled = false;
  }
  const srcType = document.getElementById("proc_source_type");
  if(srcType){
    procClear_("proc_source_type");
    srcType.disabled = false;
  }

  // input/output 清空已由 procClear_ 統一處理
  syncErpQtyUnitSuffix_("proc_input_unit", "proc_input_unit_suffix");

  syncErpQtyUnitSuffix_("proc_output_unit", "proc_output_unit_suffix");
  const allowLoss = document.getElementById("proc_close_allow_loss");
  if(allowLoss) allowLoss.checked = false;
  updateLossHint();

  const s1 = document.getElementById("procLoadedSummary");
  const s2 = document.getElementById("procLoadedInputs");
  const s3 = document.getElementById("procLoadedOutputs");
  const s4 = document.getElementById("procLoadedRelations");
  if(s1) s1.textContent = "";
  if(s2) s2.textContent = "";
  if(s3) s3.textContent = "";
  if(s4) s4.textContent = "";
}

function onSelectProcInputLot(){
  const lotId = document.getElementById("proc_input_lot")?.value || "";
  const lot = (procLots || []).find(l => String(l.lot_id || "") === String(lotId || ""));
  if(!lot){
    procClear_(["proc_input_unit", "proc_input_available", "proc_input_qty", "proc_input_remark"]);
    syncErpQtyUnitSuffix_("proc_input_unit", "proc_input_unit_suffix");
    return;
  }
  procSetV_("proc_input_unit", lot.unit || "");
  syncErpQtyUnitSuffix_("proc_input_unit", "proc_input_unit_suffix");
  procSetV_("proc_input_available", String(procGetAvailable(lotId)));
  // UX：Lot 切換時，清空數量/備註，避免殘留上一筆
  try{
    procClear_(["proc_input_qty", "proc_input_remark"]);
    procEditingInputDraftId = "";
    procSelectedDbInputId = "";
  }catch(_e){}
  setProcButtons_();
}

function pickProcInputLot(lotId){
  const input = document.getElementById("proc_input_lot");
  const display = document.getElementById("proc_input_lot_display");
  if(!input) return;
  input.value = lotId || "";
  if(display){
    const lot = (procLots || []).find(l => String(l.lot_id || "") === String(lotId || ""));
    const av = lot ? procGetAvailable(lot.lot_id) : "";
    display.value = lot ? formatProcLotOptionLabel_(lot, av) : (lotId || "");
  }
  onSelectProcInputLot();
  closeProcLotPicker();
  setProcButtons_();
}

function onSelectProcOutputProduct(){
  const sel = document.getElementById("proc_output_product");
  const opt = sel?.selectedOptions?.[0];
  const uEl = document.getElementById("proc_output_unit");
  if(!uEl) return;
  if(!opt || !String(sel?.value || "").trim()){
    procClear_("proc_output_unit");
    syncErpQtyUnitSuffix_("proc_output_unit", "proc_output_unit_suffix");
    procClear_(["proc_output_qty", "proc_output_remark"]);
    setProcButtons_();
    return;
  }
  uEl.value = opt.getAttribute("data-unit") || "";
  syncErpQtyUnitSuffix_("proc_output_unit", "proc_output_unit_suffix");
  // UX：產出產品切換時，清空數量/備註，避免殘留上一筆
  try{
    procClear_(["proc_output_qty", "proc_output_remark"]);
    procEditingOutputDraftId = "";
    procSelectedDbOutputId = "";
  }catch(_e){}
  setProcButtons_();
}

function beginEditProcInputDraft_(draftId){
  const it = (procInputs || []).find(x => x._mode === "DRAFT" && x.draft_id === draftId);
  if(!it) return;
  procEditingInputDraftId = draftId;
  pickProcInputLot(it.lot_id);
  const inQty = document.getElementById("proc_input_qty");
  if(inQty) inQty.value = String(it.issue_qty ?? "");
  const inRm = document.getElementById("proc_input_remark");
  if(inRm) inRm.value = String(it.remark || "");
  procInputs = procInputs.filter(x => !(x._mode === "DRAFT" && x.draft_id === draftId));
  renderProcInputs();
  updateLossHint();
}

function beginEditProcOutputDraft_(draftId){
  const it = (procOutputs || []).find(x => x._mode === "DRAFT" && x.draft_id === draftId);
  if(!it) return;
  procEditingOutputDraftId = draftId;
  const sel = document.getElementById("proc_output_product");
  const qtyEl = document.getElementById("proc_output_qty");
  if(sel) sel.value = it.product_id || "";
  onSelectProcOutputProduct();
  if(qtyEl) qtyEl.value = String(it.receive_qty ?? "");
  const outRm = document.getElementById("proc_output_remark");
  if(outRm) outRm.value = String(it.remark || "");
  procOutputs = procOutputs.filter(x => !(x._mode === "DRAFT" && x.draft_id === draftId));
  renderProcOutputs();
  updateLossHint();
}

function addProcOutputDraft(){
  const outProduct = document.getElementById("proc_output_product")?.value || "";
  const outQty = num(document.getElementById("proc_output_qty")?.value || 0);
  const outUnit = document.getElementById("proc_output_unit")?.value || "";
  const outRemark = (document.getElementById("proc_output_remark")?.value || "").trim();
  if(!outProduct) return showToast("請選擇產出產品","error");
  if(!outQty || outQty <= 0) return showToast("回收數量需大於 0","error");
  if(!outUnit) return showToast("產出單位缺失","error");

  procOutputs.push({
    _mode: "DRAFT",
    draft_id: "OUTDRAFT-" + Date.now() + "-" + Math.floor(Math.random()*1000),
    product_id: outProduct,
    receive_qty: outQty,
    unit: outUnit,
    remark: outRemark
  });

  procClear_(["proc_output_product", "proc_output_qty", "proc_output_unit", "proc_output_remark"]);
  syncErpQtyUnitSuffix_("proc_output_unit", "proc_output_unit_suffix");
  procEditingOutputDraftId = "";
  renderProcOutputs();
  updateLossHint();
  setProcButtons_();
}

function removeProcOutputDraft(draftId){
  procOutputs = procOutputs.filter(x => !(x._mode === "DRAFT" && x.draft_id === draftId));
  if(procEditingOutputDraftId === draftId) procEditingOutputDraftId = "";
  renderProcOutputs();
  updateLossHint();
  setProcButtons_();
}

async function updateSelectedProcInputRemark(){
  clearProcBlockNotice_();
  const procId = (document.getElementById("proc_id")?.value || "").trim().toUpperCase();
  const inId = String(procSelectedDbInputId || "").trim();
  if(!procId) return showToast("請先載入加工單","error");
  if(!inId) return showToast("請先在投料列表點選一筆（已送出）","error");
  const remark = (document.getElementById("proc_input_remark")?.value || "").trim();

  setProcRowBusy_("input", inId, "儲存中…");
  setProcActionInlineHint_("updateSelectedProcInputRemark()", "儲存中，請稍等…");
  try{
    await callAPI({
      action: "update_process_order_input_remark",
      process_input_id: inId,
      remark: remark,
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    }, { method: "POST" });
    invalidateProcCaches_();
    await loadProcMasterData();
    await loadProcessOrder(procId);
    showToast("投料備註已更新");
  } finally {
    setProcActionInlineHint_("updateSelectedProcInputRemark()", "");
    setProcRowBusy_("input", inId, "");
  }
  setProcButtons_();
}

async function updateSelectedProcOutputRemark(){
  clearProcBlockNotice_();
  const procId = (document.getElementById("proc_id")?.value || "").trim().toUpperCase();
  const outId = String(procSelectedDbOutputId || "").trim();
  if(!procId) return showToast("請先載入加工單","error");
  if(!outId) return showToast("請先在回收列表點選一筆（已回收）","error");
  const remark = (document.getElementById("proc_output_remark")?.value || "").trim();

  setProcRowBusy_("output", outId, "儲存中…");
  setProcActionInlineHint_("updateSelectedProcOutputRemark()", "儲存中，請稍等…");
  try{
    // 更新回收明細備註
    await callAPI({
      action: "update_process_order_output_remark",
      process_output_id: outId,
      remark: remark,
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    }, { method: "POST" });

    // 同步更新該產出 lot 的備註（避免兩邊不同步）
    const outputsAll = await getAll("process_order_output").catch(()=>[]);
    const out = (outputsAll || []).find(x => String(x.process_output_id || "") === outId);
    const lotId = String(out?.lot_id || "");
    if(lotId){
      await updateRecord("lot","lot_id",lotId,{
        remark,
        updated_by: getCurrentUser(),
        updated_at: nowIso16()
      });
    }

    invalidateProcCaches_();
    await loadProcMasterData();
    await loadProcessOrder(procId);
    showToast("回收備註已更新");
  } finally {
    setProcActionInlineHint_("updateSelectedProcOutputRemark()", "");
    setProcRowBusy_("output", outId, "");
  }
}

function renderProcOutputs(){
  const tbody = document.getElementById("procOutputBody");
  if(!tbody) return;
  tbody.innerHTML = "";
  procOutputs.forEach((it, idx) => {
    const isDraft = isDraftRow_(it);
    const isDb = isDbRow_(it);
    let statusText = "—";
    if(isDraft){
      statusText = "草稿";
    }else if(isDb){
      // 狀態改回與後端 process_order_output.status 一致
      statusText = procOutputStatusLabel_(it.status || "");
    }
    let actionHtml = "";
    if(isDraft){
      actionHtml =
        `<button class="btn-secondary" onclick="event.stopPropagation(); beginEditProcOutputDraft_('${it.draft_id}')">編輯</button> ` +
        `<button class="btn-secondary" onclick="event.stopPropagation(); removeProcOutputDraft('${it.draft_id}')">刪除</button>`;
    }else if(isDb){
      const st = String(it.status || "").toUpperCase();
      const disabled = st === "CANCELLED";
      const outId = String(it.process_output_id || "");
      const busyText = procRowBusy.output[outId] || "";
      const isBusy = !!busyText;
      const safeOutId = outId.replace(/\\/g,"\\\\").replace(/'/g,"\\'");
      const lotId = String(it.lot_id || "");
      const safeLotId = lotId.replace(/\\/g,"\\\\").replace(/'/g,"\\'");
      actionHtml =
        `<button class="btn-secondary" ${(!lotId ? "disabled" : "")} onclick="event.stopPropagation(); ${!lotId ? "return false;" : `procOpenLots_('${safeLotId}')`}">Lots</button> ` +
        `<button class="btn-secondary" ${(disabled || isBusy) ? "disabled" : ""} onclick="event.stopPropagation(); ${(disabled || isBusy) ? "return false;" : `voidProcessOutput('${safeOutId}')`}">作廢回收</button>` +
        (busyText ? ` <span style="font-size:12px;color:#64748b;">${busyText}</span>` : "");
    }
    const rowOnclick = isDraft
      ? `beginEditProcOutputDraft_('${it.draft_id}')`
      : (isDb ? `selectProcOutputDbRow_('${String(it.process_output_id || "").replace(/\\/g,"\\\\").replace(/'/g,"\\'")}')` : "");
    const ou = String(it.unit || "").trim();
    const outQtyCell = ou ? `${it.receive_qty} ${ou.replace(/</g, "")}` : String(it.receive_qty);
    tbody.innerHTML += `
      <tr style="cursor:pointer;" onclick="${rowOnclick}">
        <td>${idx+1}</td>
        <td>${formatProcProductDisplay_(it.product_id)}</td>
        <td>${outQtyCell}</td>
        <td>
          ${statusText}
        </td>
        <td>${actionHtml}</td>
      </tr>
    `;
  });
}

function selectProcOutputDbRow_(processOutputId){
  const id = String(processOutputId || "");
  const row = (procOutputs || []).find(x => x._mode === "DB" && String(x.process_output_id || "") === id);
  if(!row) return;
  procSelectedDbOutputId = id;
  const sel = document.getElementById("proc_output_product");
  const qtyEl = document.getElementById("proc_output_qty");
  const rmEl = document.getElementById("proc_output_remark");
  if(sel) sel.value = row.product_id || "";
  onSelectProcOutputProduct();
  if(qtyEl) qtyEl.value = String(row.receive_qty ?? "");
  if(rmEl) rmEl.value = String(row.remark || "");
  showToast("已帶入回收明細（僅供查看；作廢請用右側按鈕）");
}

function addProcInputDraft(){
  const lot_id = document.getElementById("proc_input_lot")?.value || "";
  const qty = num(document.getElementById("proc_input_qty")?.value || 0);
  const unit = document.getElementById("proc_input_unit")?.value || "";
  const remark = (document.getElementById("proc_input_remark")?.value || "").trim();

  if(!lot_id) return showToast("請選擇 Lot","error");
  if(!qty || qty <= 0) return showToast("投料數量需大於 0","error");
  if(!unit) return showToast("Lot 單位缺失","error");

  const lot = procLots.find(l => l.lot_id === lot_id);
  if(!lot) return showToast("找不到 Lot","error");

  const available = procGetAvailable(lot_id);
  if(typeof invIsMissingMovement_ === "function" && invIsMissingMovement_(available)){
    return showToast("此 Lot 缺 movement（請先補齊入庫/異動紀錄）", "error");
  }
  if(qty > available) return showToast("投料不可超過可用量","error");

  procInputs.push({
    _mode: "DRAFT",
    draft_id: "DRAFT-" + Date.now() + "-" + Math.floor(Math.random()*1000),
    lot_id,
    product_id: lot.product_id,
    issue_qty: qty,
    unit,
    remark
  });

  procClear_([
    "proc_input_lot",
    "proc_input_lot_display",
    "proc_input_available",
    "proc_input_qty",
    "proc_input_unit",
    "proc_input_remark"
  ]);
  syncErpQtyUnitSuffix_("proc_input_unit", "proc_input_unit_suffix");
  procEditingInputDraftId = "";

  renderProcInputs();
  updateLossHint();
  setProcButtons_();
}

function removeProcInputDraft(draftId){
  procInputs = procInputs.filter(x => !(x._mode === "DRAFT" && x.draft_id === draftId));
  if(procEditingInputDraftId === draftId) procEditingInputDraftId = "";
  renderProcInputs();
  updateLossHint();
  setProcButtons_();
}

function renderProcInputs(){
  const tbody = document.getElementById("procInputBody");
  if(!tbody) return;
  tbody.innerHTML = "";

  procInputs.forEach((it, idx) => {
    const isDraft = isDraftRow_(it);
    const isDb = isDbRow_(it);
    const statusText = isDraft ? "草稿" : (isDb ? "已送加工" : "");
    let actionHtml = "";
    if(isDraft){
      actionHtml =
        `<button class="btn-secondary" onclick="event.stopPropagation(); beginEditProcInputDraft_('${it.draft_id}')">編輯</button> ` +
        `<button class="btn-secondary" onclick="event.stopPropagation(); removeProcInputDraft('${it.draft_id}')">刪除</button>`;
    }else if(isDb){
      const inId = String(it.process_input_id || "");
      const busyText = procRowBusy.input[inId] || "";
      const isBusy = !!busyText;
      const safeInId = inId.replace(/\\/g,"\\\\").replace(/'/g,"\\'");
      actionHtml =
        `<button class="btn-secondary" ${(inId && !isBusy) ? "" : "disabled"} onclick="event.stopPropagation(); ${(inId && !isBusy) ? `voidProcessInput('${safeInId}')` : "return false;"}">回沖投料</button>` +
        (busyText ? ` <span style="font-size:12px;color:#64748b;">${busyText}</span>` : "");
    }
    const rowOnclick = isDraft
      ? `beginEditProcInputDraft_('${it.draft_id}')`
      : (isDb ? `selectProcInputDbRow_('${String(it.process_input_id || "").replace(/\\/g,"\\\\").replace(/'/g,"\\'")}')` : "");
    const lot = (procLots || []).find(l => String(l.lot_id || "") === String(it.lot_id || "")) || null;
    const whText = lot ? (procWarehouseLabelByLot_(lot) || (lot.warehouse_id ? String(lot.warehouse_id) : "")) : "";
    const pu = String(it.unit || "").trim();
    const inQtyCell = pu ? `${it.issue_qty} ${pu.replace(/</g, "")}` : String(it.issue_qty);
    tbody.innerHTML += `
      <tr style="cursor:pointer;" onclick="${rowOnclick}">
        <td>${idx+1}</td>
        <td>${it.lot_id}</td>
        <td>${formatProcProductDisplay_(it.product_id)}</td>
        <td>${whText || "—"}</td>
        <td>${inQtyCell}</td>
        <td>${statusText}</td>
        <td>${actionHtml}</td>
      </tr>
    `;
  });
}

function selectProcInputDbRow_(processInputId){
  const id = String(processInputId || "");
  const row = (procInputs || []).find(x => x._mode === "DB" && String(x.process_input_id || "") === id);
  if(!row) return;
  procSelectedDbInputId = id;
  pickProcInputLot(row.lot_id);
  const qtyEl = document.getElementById("proc_input_qty");
  const rmEl = document.getElementById("proc_input_remark");
  if(qtyEl) qtyEl.value = String(row.issue_qty ?? "");
  if(rmEl) rmEl.value = String(row.remark || "");
  showToast("已帶入投料明細（僅供查看；回沖請用右側按鈕）");
}

function updateLossHint(){
  const hint = document.getElementById("proc_loss_hint");
  if(!hint) return;
  const draftOutputsOnly = (procOutputs || []).filter(it => it && it._mode === "DRAFT");
  const draftOut = draftOutputsOnly.reduce((sum, it) => sum + num(it.receive_qty), 0);
  const editingOut = num(document.getElementById("proc_output_qty")?.value || 0);
  const outQty = draftOut + editingOut;
  const inputsForCalc = procInputs.length ? procInputs : (procLoadedInputsForHint || []);
  const outputsForCalcExisting = (procLoadedOutputsForHint || []).filter(x => String(x.status || "").toUpperCase() !== "CANCELLED");
  if(inputsForCalc.length === 0){
    procSetV_("proc_loss_hint", outQty > 0 ? "尚無投料，無法計算" : "");
    return;
  }
  if(outQty <= 0){
    procClear_("proc_loss_hint");
    return;
  }

  const baseUnits = new Set();
  let canConvert = true;

  function toBase_(productId, qty, unit){
    const pid = String(productId || "");
    const p = (procProducts || []).find(x => String(x.product_id || "") === pid);
    if(!p) return null;
    const converted = convertToBase(p, qty, unit);
    // convertToBase 的基準單位來源：uom_config / 舊 @UOM / product.unit
    const cfg = typeof getProductUomConfig === "function" ? getProductUomConfig(p) : null;
    const base = normalizeUnit(cfg?.base_unit || p.unit || "");
    if(base) baseUnits.add(base);
    return converted;
  }

  const inBaseTotal = inputsForCalc.reduce((sum, it) => {
    const q = it.issue_qty != null ? it.issue_qty : (it.qty != null ? it.qty : it.issue_qty);
    const v = toBase_(it.product_id, num(q), it.unit);
    if(v == null) canConvert = false;
    return sum + (v || 0);
  }, 0);

  // 回收：已存在（資料庫）+ 已新增草稿 + 目前正在編輯的那筆（若有選產品）
  const { outProduct, outQty: editingQty, outUnit } = getProcOutputForm_();
  const outputsAll = [
    ...(outputsForCalcExisting || []).map(x => ({ product_id: x.product_id, qty: x.receive_qty, unit: x.unit })),
    ...draftOutputsOnly.map(x => ({ product_id: x.product_id, qty: x.receive_qty, unit: x.unit })),
    ...(outProduct && editingQty > 0 ? [{ product_id: outProduct, qty: editingQty, unit: outUnit }] : [])
  ];
  const outBaseTotal = outputsAll.reduce((sum, it) => {
    const v = toBase_(it.product_id, num(it.qty), it.unit);
    if(v == null) canConvert = false;
    return sum + (v || 0);
  }, 0);

  if(!canConvert || baseUnits.size !== 1){
    hint.value = baseUnits.size > 1
      ? "多基準單位，無法計算"
      : "單位不一致，無法計算";
    return;
  }

  const baseUnit = Array.from(baseUnits)[0] || "";
  const loss = inBaseTotal - outBaseTotal;
  const rounded = (Math.round(loss * 10000) / 10000);
  const text = String(rounded).replace(/\.0+$/,"").replace(/(\.\d*[1-9])0+$/,"$1");
  hint.value = `${text} ${baseUnit}（換算後）`;
}

function getProcHeaderForm_(){
  const process_order_id = (document.getElementById("proc_id")?.value || "").trim().toUpperCase();
  document.getElementById("proc_id").value = process_order_id;
  const process_type = document.getElementById("proc_type")?.value || "";
  const source_type = document.getElementById("proc_source_type")?.value || "";
  const supplier_id = document.getElementById("proc_supplier_id")?.value || "";
  const planned_date = document.getElementById("proc_planned_date")?.value || "";
  const remark = (document.getElementById("proc_remark")?.value || "").trim();
  return { process_order_id, process_type, source_type, supplier_id, planned_date, remark };
}

function getProcOutputForm_(){
  const outProduct = document.getElementById("proc_output_product")?.value || "";
  const outQty = num(document.getElementById("proc_output_qty")?.value || 0);
  const outUnit = document.getElementById("proc_output_unit")?.value || "";
  const outWarehouseId = (document.getElementById("proc_output_warehouse")?.value || "").trim().toUpperCase();
  return { outProduct, outQty, outUnit, outWarehouseId };
}

function clearProcOutputEditor_(){
  procClear_([
    "proc_output_product",
    "proc_output_qty",
    "proc_output_unit",
    "proc_output_remark",
    "proc_output_warehouse"
  ]);
  syncErpQtyUnitSuffix_("proc_output_unit", "proc_output_unit_suffix");
  procSelectedDbOutputId = "";
}

function setProcButtons_(){
  const createBtn = document.getElementById("proc_create_btn");
  const updHdrBtn = document.getElementById("proc_update_hdr_btn");
  const cancelBtn = document.getElementById("proc_cancel_btn");
  const issueBtn = document.getElementById("proc_issue_btn");
  const receiveBtn = document.getElementById("proc_receive_btn");
  const addInBtn = document.getElementById("proc_add_input_btn");
  const updInRemarkBtn = document.getElementById("proc_update_in_remark_btn");
  const addOutBtn = document.getElementById("proc_add_output_btn");
  const updOutRemarkBtn = document.getElementById("proc_update_out_remark_btn");

  const procId = (document.getElementById("proc_id")?.value || "").trim().toUpperCase();
  const editing = !!procEditing;
  const inFlight = !!procIssueInFlight || !!procReceiveInFlight || !!procLoadInFlight;

  const draftInputs = (procInputs || []).filter(x => x && x._mode === "DRAFT");
  const draftOutputs = (procOutputs || []).filter(x => x && x._mode === "DRAFT");

  const st = String(procLoadedStatus_ || "").toUpperCase();
  const ended = st === "POSTED" || st === "CANCELLED";

  if(createBtn){
    createBtn.disabled = inFlight || editing;
    createBtn.title = inFlight ? "處理中…" : (editing ? "已載入加工單，若要新建請先清除" : "建立加工單");
  }
  if(updHdrBtn){
    updHdrBtn.disabled = inFlight || !editing || ended;
    updHdrBtn.title =
      inFlight ? "處理中…" :
      (!editing ? "請先載入加工單" :
      (st === "POSTED" ? "已結案（POSTED），不可修改" :
      (st === "CANCELLED" ? "已取消（CANCELLED），不可修改" :
      "更新備註/預計到貨日期")));
  }
  if(cancelBtn){
    cancelBtn.disabled = inFlight || !editing || ended;
    cancelBtn.title =
      inFlight ? "處理中…" :
      (!editing ? "請先載入加工單" :
      (st === "POSTED" ? "已結案（POSTED），不可取消" :
      (st === "CANCELLED" ? "已取消（CANCELLED）" :
      "取消加工單（回沖）")));
  }
  if(issueBtn){
    const can = !inFlight && procId && draftInputs.length > 0 && st !== "CANCELLED" && st !== "POSTED";
    issueBtn.disabled = !can;
    issueBtn.title =
      inFlight ? "處理中…" :
      (!procId ? "請先建立或載入加工單" :
      (st === "CANCELLED" ? "此加工單已取消，不能送加工" :
      (st === "POSTED" ? "此加工單已完成，不能送加工" :
      (draftInputs.length === 0 ? "請至少新增 1 筆投料" : "送加工（扣庫）"))));
  }
  if(receiveBtn){
    const can = !inFlight && procId && (draftOutputs.length > 0 || !!document.getElementById("proc_output_product")?.value) && st !== "CANCELLED" && st !== "POSTED";
    receiveBtn.disabled = !can;
    receiveBtn.title =
      inFlight ? "處理中…" :
      (!procId ? "請先建立或載入加工單" :
      (st === "CANCELLED" ? "此加工單已取消，不能回收" :
      (st === "POSTED" ? "此加工單已完成，不能回收" :
      "回收加工品（建立回收批次）")));
  }

  // ===== 投料：新增/更新備註 =====
  if(addInBtn){
    const lotId = String(document.getElementById("proc_input_lot")?.value || "").trim();
    const qty = Number(document.getElementById("proc_input_qty")?.value || 0);
    const unit = String(document.getElementById("proc_input_unit")?.value || "").trim();
    const can =
      !inFlight &&
      editing &&
      !ended &&
      !!lotId &&
      (qty > 0) &&
      !!unit;
    addInBtn.disabled = !can;
    addInBtn.title =
      inFlight ? "處理中…" :
      (!editing ? "請先建立或載入加工單" :
      (ended ? `此加工單已結束（${st}），不可新增投料` :
      (!lotId ? "請先選擇 Lot" :
      (!(qty > 0) ? "請先輸入投料數量（>0）" :
      (!unit ? "Lot 單位缺失" :
      "新增投料")))));
  }
  if(updInRemarkBtn){
    const can = !inFlight && !!procId && !!String(procSelectedDbInputId || "").trim();
    updInRemarkBtn.disabled = !can;
    updInRemarkBtn.title =
      inFlight ? "處理中…" :
      (!procId ? "請先載入加工單" :
      (!String(procSelectedDbInputId || "").trim() ? "請先在投料列表點選一筆（已送出）" :
      "更新本筆投料備註"));
  }

  // ===== 回收：新增/更新備註 =====
  if(addOutBtn){
    const prod = String(document.getElementById("proc_output_product")?.value || "").trim();
    const qty = Number(document.getElementById("proc_output_qty")?.value || 0);
    const unit = String(document.getElementById("proc_output_unit")?.value || "").trim();
    const can =
      !inFlight &&
      editing &&
      !ended &&
      !!prod &&
      (qty > 0) &&
      !!unit;
    addOutBtn.disabled = !can;
    addOutBtn.title =
      inFlight ? "處理中…" :
      (!editing ? "請先建立或載入加工單" :
      (ended ? `此加工單已結束（${st}），不可新增產出` :
      (!prod ? "請先選擇產出產品" :
      (!(qty > 0) ? "請先輸入回收數量（>0）" :
      (!unit ? "產出單位缺失" :
      "新增產出")))));
  }
  if(updOutRemarkBtn){
    const can = !inFlight && !!procId && !!String(procSelectedDbOutputId || "").trim();
    updOutRemarkBtn.disabled = !can;
    updOutRemarkBtn.title =
      inFlight ? "處理中…" :
      (!procId ? "請先載入加工單" :
      (!String(procSelectedDbOutputId || "").trim() ? "請先在回收列表點選一筆（已回收）" :
      "更新本筆回收備註"));
  }
}

async function createProcessOrderOnly(triggerEl){
  if(procLoadInFlight){
    return showToast("加工單載入中，請稍候…","error");
  }
  clearProcBlockNotice_();
  if(procEditing){
    return showToast("目前為「已載入加工單」模式。若要建立新加工單，請先按「清除」。","error");
  }
  const { process_order_id, process_type, source_type, supplier_id, planned_date, remark } = getProcHeaderForm_();
  const missing = [];
  if(!process_order_id) missing.push("加工單ID");
  if(!process_type) missing.push("加工類型");
  if(!supplier_id) missing.push("加工廠");
  if(missing.length) return showToast("缺少必填：" + missing.join("、"), "error");

  showSaveHint(triggerEl);
  try {
    await callAPI({
      action: "create_process_order_cmd",
      process_order_id,
      process_type,
      ...(source_type ? { source_type } : {}),
      supplier_id,
      planned_date,
      remark,
      created_by: getCurrentUser(),
      created_at: nowIso16()
    }, { method: "POST" });
    await renderProcessOrders();
    await loadProcessOrder(process_order_id);
    showToast("加工單已建立（OPEN）");
  } finally { hideSaveHint(); }
  setProcButtons_();
}

async function issueProcessOrder(){
  if(procLoadInFlight){
    return showToast("加工單載入中，請稍候…","error");
  }
  if(procIssueInFlight){
    return showToast("送加工處理中，請稍候…","error");
  }
  clearProcBlockNotice_();
  const { process_order_id } = getProcHeaderForm_();
  if(!process_order_id) return showToast("請先建立或載入加工單","error");
  const draftInputs = (procInputs || []).filter(x => x && x._mode === "DRAFT");
  if(draftInputs.length === 0) return showToast("請至少新增 1 筆投料","error");

  procIssueInFlight = true;
  setProcStatusHint_("加工流程：處理中 — 送加工");
  setProcInvHint_("庫存狀態：處理中 — 扣庫中…");
  setProcActionInlineHint_("issueProcessOrder()", "儲存中，請稍等…");
  disableButtonsByOnclick_("issueProcessOrder()", true);
  setProcButtons_();
  try {
    const po = await getOne("process_order","process_order_id",process_order_id).catch(()=>null);
    if(!po) return showToast("找不到加工單，請先建立。","error");
    if((po.status || "").toUpperCase() === "CANCELLED") return showToast("此加工單已取消，不能送加工。","error");
    if((po.status || "").toUpperCase() === "POSTED") return showToast("此加工單已完成，不能再次送加工。","error");

    const existedInputsAll = await getAll("process_order_input").catch(()=>[]);
    const existedInputs = (existedInputsAll || []).filter(x => x.process_order_id === process_order_id);
    const existedCount = existedInputs.length;

    // 分批投料：允許在同一張加工單「追加送加工」，但只會扣本次草稿投料
    // 前置檢查：確保投料單位可換算到同一基準單位（避免後續回收比較混亂）
    const convertBlockReasons = [];
    const baseUnits = new Set();
    function getProductBaseUnit_(product){
      const p = product || {};
      const cfg = typeof getProductUomConfig === "function" ? getProductUomConfig(p) : null;
      return normalizeUnit(cfg?.base_unit || p.unit || "");
    }
    function validateRowsConvertible_(rows, qtyField, tag){
      (rows || []).forEach(r => {
        const productId = String(r.product_id || "");
        const product = (procProducts || []).find(p => String(p.product_id || "") === productId);
        const q = num(r[qtyField]);
        const u = String(r.unit || "");
        if(!product){
          convertBlockReasons.push(`${tag}產品不存在：${productId || "（空白）"}`);
          return;
        }
        const baseUnit = getProductBaseUnit_(product);
        if(baseUnit) baseUnits.add(baseUnit);
        const converted = convertToBase(product, q, u);
        if(converted == null){
          convertBlockReasons.push(`${tag}${productId} 單位 ${u || "（空白）"} 無法轉為基準單位，請至產品主檔設定。`);
        }
      });
    }
    // 既有投料 + 本次投料都要可換算、且基準單位一致
    validateRowsConvertible_(existedInputs, "issue_qty", "既有投料 ");
    validateRowsConvertible_(draftInputs, "issue_qty", "本次投料 ");
    if(baseUnits.size > 1){
      convertBlockReasons.push(`本加工單涉及多種基準單位（${Array.from(baseUnits).join(", ")}），目前不支援跨基準單位合併投料比較。`);
    }
    if(convertBlockReasons.length){
      showProcBlockNotice_("送加工被阻擋", Array.from(new Set(convertBlockReasons)));
      return showToast("單位換算檢查未通過，請展開下方明細。", "error");
    }

    // 重新抓最新 lots + 依 lot 彙總可用量（避免整張 inventory_movement）
    await procRefreshLotsAndAvailability_();
    for(const it of draftInputs){
      const lot = procLots.find(l => l.lot_id === it.lot_id);
      if(!lot) return showToast("找不到投料 Lot：" + it.lot_id, "error");
      if((lot.status || "PENDING") !== "APPROVED") return showToast("投料 Lot 必須 APPROVED：" + it.lot_id, "error");
      const av = procGetAvailable(it.lot_id);
      if(it.issue_qty > av) return showToast("投料超過可用量：" + it.lot_id, "error");
    }

    const payloadInputs = draftInputs.map(it => ({
      lot_id: it.lot_id,
      product_id: it.product_id,
      issue_qty: String(it.issue_qty),
      unit: it.unit,
      remark: it.remark || ""
    }));

    await callAPI({
      action: "issue_process_order_bundle",
      process_order_id: process_order_id,
      expected_existed_inputs_count: String(existedCount),
      idempotency_key: procBuildIdempotencyKey_("PROC_ISSUE", [process_order_id, existedCount, payloadInputs]),
      inputs_json: JSON.stringify(payloadInputs),
      created_by: getCurrentUser(),
      created_at: nowIso16()
    }, { method: "POST" });

    invalidateProcCaches_();
    setProcStatusHint_(existedCount > 0 ? "加工流程：已追加送加工（待回收）" : "加工流程：已送加工（待回收）");
    procInputs = [];
    renderProcInputs();
    updateLossHint();
    await loadProcMasterData();
    await renderProcessOrders();
    await loadProcessOrder(process_order_id);
    showToast(existedCount > 0 ? "送加工完成：已追加本次資料並同步更新" : "送加工完成：資料已同步更新", "success", 6000);
  } catch(err){
    if (procShouldAutoReloadAfterError_(err)) {
      await procAutoReloadAfterConflict_(process_order_id);
      return;
    }
    if(!(err && err.erpApiToastShown)){
      showToast("送加工失敗：請稍後重試；若仍失敗請重新載入後再試", "error");
    }
  } finally {
    setProcActionInlineHint_("issueProcessOrder()", "");
    procIssueInFlight = false;
    disableButtonsByOnclick_("issueProcessOrder()", false);
    setProcButtons_();
  }
}

async function retractProcessIssue(){
  if(procLoadInFlight){
    return showToast("加工單載入中，請稍候…","error");
  }
  clearProcBlockNotice_();
  const procId = (document.getElementById("proc_id")?.value || "").trim().toUpperCase();
  if(!procId) return showToast("請先載入加工單","error");
  {
    const ok = window.erpConfirmActionKey_("confirm.proc.retract_issue", {
      fallback: "確定撤回「送加工（扣庫）」？\n系統會回沖投料扣庫，並刪除本加工單的投料明細。\n\n限制：若已有任何回收（未作廢）或投料 Lot 已被下游使用，會被阻擋。"
    });
    if(!ok) return;
  }

  showSaveHint();
  try{
    await callAPI({
      action: "retract_process_issue_bundle",
      process_order_id: procId,
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    }, { method: "POST" });

    invalidateProcCaches_();
    await loadProcMasterData();
    await renderProcessOrders();
    await loadProcessOrder(procId);
    showToast("撤回完成：已取消本次送加工並同步更新資料", "success", 6000);
  } catch(err){
    if (procShouldAutoReloadAfterError_(err)) {
      await procAutoReloadAfterConflict_(procId);
      return;
    }
    if(!(err && err.erpApiToastShown)){
      showToast("撤回失敗：請稍後重試；若仍失敗請重新載入後再試", "error");
    }
  } finally {
    hideSaveHint();
    setProcButtons_();
  }
}

async function receiveProcessOutput(){
  if(procLoadInFlight){
    return showToast("加工單載入中，請稍候…","error");
  }
  if(procReceiveInFlight){
    return showToast("回收處理中，請稍候…","error");
  }
  clearProcBlockNotice_();
  const { process_order_id } = getProcHeaderForm_();
  const { outProduct, outQty, outUnit, outWarehouseId } = getProcOutputForm_();
  if(!process_order_id) return showToast("請先建立或載入加工單","error");
  const pendingOutputs = (procOutputs || []).filter(x => x && x._mode === "DRAFT");
  if(pendingOutputs.length === 0){
    if(!outProduct) return showToast("請選擇產出產品","error");
    if(!outQty || outQty <= 0) return showToast("回收數量需大於 0","error");
    if(!outUnit) return showToast("產出單位缺失","error");
    pendingOutputs.push({
      draft_id: "OUTDRAFT-ONESHOT",
      _mode: "DRAFT",
      product_id: outProduct,
      receive_qty: outQty,
      unit: outUnit,
      remark: (document.getElementById("proc_output_remark")?.value || "").trim()
    });
  }

  procReceiveInFlight = true;
  setProcStatusHint_("加工流程：處理中 — 回收");
  setProcInvHint_("庫存狀態：處理中 — 入庫中…");
  setProcActionInlineHint_("receiveProcessOutput()", "儲存中，請稍等…");
  document.querySelectorAll('button[onclick="receiveProcessOutput()"]').forEach(btn => {
    btn.disabled = true;
  });
  setProcButtons_();
  try {
    const po = await getOne("process_order","process_order_id",process_order_id).catch(()=>null);
    if(!po) return showToast("找不到加工單，請先建立。","error");
    if((po.status || "").toUpperCase() === "CANCELLED") return showToast("此加工單已取消，不能回收。","error");
    if((po.status || "").toUpperCase() === "POSTED") return showToast("此加工單已完成，不能再回收。","error");

    const inputsAll = await getAll("process_order_input").catch(()=>[]);
    const outputsAll = await getAll("process_order_output").catch(()=>[]);
    const inputs = (inputsAll || []).filter(x => x.process_order_id === process_order_id);
  const outputs = (outputsAll || []).filter(x => x.process_order_id === process_order_id);
  // 作廢回收（CANCELLED）不應計入「既有回收總量」
  const activeOutputs = (outputs || []).filter(x => String(x.status || "").toUpperCase() !== "CANCELLED");
    if(inputs.length === 0){
      return showToast("請先送加工（建立投料與扣庫）", "error");
    }

    const convertBlockReasons = [];
    const baseUnits = new Set();

    function getProductBaseUnit_(product){
      const p = product || {};
      const cfg = typeof getProductUomConfig === "function" ? getProductUomConfig(p) : null;
      return normalizeUnit(cfg?.base_unit || p.unit || "");
    }

    function convertRowsToBaseTotal_(rows, qtyField, tag){
      return (rows || []).reduce((sum, r) => {
        const productId = String(r.product_id || "");
        const product = (procProducts || []).find(p => String(p.product_id || "") === productId);
        const q = num(r[qtyField]);
        const u = String(r.unit || "");
        if(!product){
          convertBlockReasons.push(`${tag}產品不存在：${productId || "（空白）"}`);
          return sum;
        }
        const converted = convertToBase(product, q, u);
        const baseUnit = getProductBaseUnit_(product);
        if(baseUnit) baseUnits.add(baseUnit);
        if(converted == null){
          convertBlockReasons.push(`${tag}${productId} 單位 ${u || "（空白）"} 無法轉為基準單位，請至產品主檔設定。`);
          return sum;
        }
        return sum + converted;
      }, 0);
    }

    const issuedTotalBase = convertRowsToBaseTotal_(inputs, "issue_qty", "投料 ");
  const receivedTotalBase = convertRowsToBaseTotal_(activeOutputs, "receive_qty", "既有回收 ");
    const newReceiveTotalBase = convertRowsToBaseTotal_(pendingOutputs, "receive_qty", "本次回收 ");

    if(baseUnits.size > 1){
      convertBlockReasons.push(`本加工單涉及多種基準單位（${Array.from(baseUnits).join(", ")}），目前不支援跨基準單位合計比較。`);
    }
    if(convertBlockReasons.length){
      showProcBlockNotice_("回收加工品被阻擋", Array.from(new Set(convertBlockReasons)));
      return showToast("單位換算檢查未通過，請展開下方明細。", "error");
    }

    if(receivedTotalBase + newReceiveTotalBase > issuedTotalBase + 1e-9){
      return showToast("回收總量（換算後）不可超過已送加工總量", "error");
    }
    const baseUnit = Array.from(baseUnits)[0] || "";
    let runningReceivedBase = receivedTotalBase;
    const payloadOutputs = [];
    for(let i=0; i<pendingOutputs.length; i++){
      const out = pendingOutputs[i];
      const outProduct = (procProducts || []).find(p => String(p.product_id || "") === String(out.product_id || ""));
      const outBaseQty = outProduct ? convertToBase(outProduct, num(out.receive_qty), String(out.unit || "")) : null;
      if(outBaseQty == null){
        return showToast("回收單位換算失敗（無法計算損耗），請確認產品主檔多單位換算設定。","error");
      }
      runningReceivedBase += outBaseQty;
      const lossAfter = issuedTotalBase - runningReceivedBase;
      payloadOutputs.push({
        product_id: out.product_id,
        receive_qty: String(out.receive_qty),
        unit: out.unit,
        remark: out.remark || "",
        loss_base_qty_after: String(Math.round(lossAfter * 10000) / 10000),
        loss_base_unit: baseUnit
      });
    }

    const nextTotalBase = receivedTotalBase + newReceiveTotalBase;
    const allowLossClose = !!document.getElementById("proc_close_allow_loss")?.checked;
    const nextStatus = allowLossClose
      ? "POSTED"
      : (nextTotalBase + 1e-9 >= issuedTotalBase ? "POSTED" : "OPEN");

    const res = await callAPI({
      action: "receive_process_output_bundle",
      process_order_id: process_order_id,
      expected_existed_outputs_count: String(outputs.length),
      idempotency_key: procBuildIdempotencyKey_("PROC_RECEIVE", [process_order_id, outputs.length, nextStatus, payloadOutputs]),
      next_status: nextStatus,
      allow_loss_close: allowLossClose ? "1" : "0",
      ...(outWarehouseId ? { warehouse_id: outWarehouseId } : {}),
      outputs_json: JSON.stringify(payloadOutputs),
      created_by: getCurrentUser(),
      created_at: nowIso16()
    }, { method: "POST" });

    const createdLots = Array.isArray(res?.created_lots) ? res.created_lots : [];
    setProcStatusHint_(nextStatus === "POSTED" ? "加工流程：加工已回收（已結案）" : "加工流程：部分回收");

    const outQtyEl = document.getElementById("proc_output_qty");
    const outSelEl = document.getElementById("proc_output_product");
    const outUnitEl = document.getElementById("proc_output_unit");
    const outRmEl = document.getElementById("proc_output_remark");
    const outWhEl = document.getElementById("proc_output_warehouse");
    procClear_([
      "proc_output_qty",
      "proc_output_product",
      "proc_output_unit",
      "proc_output_remark",
      "proc_output_warehouse"
    ]);
    syncErpQtyUnitSuffix_("proc_output_unit", "proc_output_unit_suffix");
    procOutputs = [];
    renderProcOutputs();
    updateLossHint();
    invalidateProcCaches_();
    await loadProcMasterData();
    await renderProcessOrders();
    await loadProcessOrder(process_order_id);
    const lotText = createdLots.join(", ");
    showToast(
      nextStatus === "POSTED"
        ? `回收完成：已結案${lotText ? "（批次：" + lotText + "）" : ""}`
        : `回收完成：已更新資料${lotText ? "（批次：" + lotText + "）" : ""}`,
      "success",
      6000
    );
  } catch(err){
    if (procShouldAutoReloadAfterError_(err)) {
      await procAutoReloadAfterConflict_(process_order_id);
      return;
    }
    if(!(err && err.erpApiToastShown)){
      showToast("回收失敗：請稍後重試；若仍失敗請重新載入後再試", "error");
    }
  } finally {
    setProcActionInlineHint_("receiveProcessOutput()", "");
    procReceiveInFlight = false;
    document.querySelectorAll('button[onclick="receiveProcessOutput()"]').forEach(btn => {
      btn.disabled = false;
    });
    setProcButtons_();
  }
}

async function cancelProcessOrder(triggerEl){
  if(procLoadInFlight){
    return showToast("加工單載入中，請稍候…","error");
  }
  clearProcBlockNotice_();
  const id = (document.getElementById("proc_id")?.value || "").trim().toUpperCase();
  if(!id) return showToast("請先載入加工單","error");
  {
    const ok = window.erpConfirmActionKey_("confirm.proc.cancel_order", {
      fallback: "確定取消此加工單？系統會建立回沖庫存異動。"
    });
    if(!ok) return;
  }

  showSaveHint(triggerEl);
  try{
    await callAPI({
      action: "cancel_process_order_bundle",
      process_order_id: id,
      idempotency_key: procBuildIdempotencyKey_("PROC_CANCEL", [id]),
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    }, { method: "POST" });

    setProcStatusHint_("加工流程：已取消");
    invalidateProcCaches_();
    await loadProcMasterData();
    await renderProcessOrders();
    await loadProcessOrder(id);
    showToast("取消完成：這張加工單已取消，畫面資料已同步更新", "success", 6000);
  } catch(err){
    if (procShouldAutoReloadAfterError_(err)) {
      await procAutoReloadAfterConflict_(id);
      return;
    }
    if(!(err && err.erpApiToastShown)){
      showToast("取消失敗：請稍後重試；若仍失敗請重新載入後再試", "error");
    }
  } finally { hideSaveHint(); }
}

async function loadProcessOrder(processOrderId, triggerEl){
  const id = String(processOrderId || "").trim().toUpperCase();
  if(!id) return;
  if(procLoadInFlight){
    procPendingLoadId_ = id;
    try{
      setProcStatusHint_(`加工流程：載入中 — 已排隊 ${id}（完成後自動載入）`);
    }catch(_e){}
    return;
  }
  procLoadInFlight = true;
  setProcButtons_();
  try{
    if(typeof erpBeginLoadWarnToast_ === "function"){
      procLoadWarnToken_ = erpBeginLoadWarnToast_(`載入中...請稍等（${id}）`);
    }
  }catch(_eWarn){}
  try{
    if(triggerEl) triggerEl.disabled = true;
  }catch(_e0){}
  // 對齊規則：載入中進度不要用 Toast（避免覆蓋錯誤/提醒造成一閃而過）
  setProcStatusHint_(`加工流程：載入中 — ${id}`);
  try{
    const s1 = document.getElementById("procLoadedSummary");
    const s2 = document.getElementById("procLoadedInputs");
    const s3 = document.getElementById("procLoadedOutputs");
    const s4 = document.getElementById("procLoadedRelations");
    if(s1) s1.textContent = `載入中：${id} ...`;
    if(s2) s2.textContent = "";
    if(s3) s3.textContent = "";
    if(s4) s4.textContent = "";
  }catch(_e2){}
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
  try{
    await loadProcMasterData();

    const po = await getOne("process_order","process_order_id",id).catch(()=>null);
    if(!po) return showToast("找不到加工單","error");

  procEditing = true;
  procLoadedStatus_ = String(po.status || "OPEN").toUpperCase();
  procInputs = [];
  procOutputs = [];
  clearProcOutputEditor_();
  renderProcInputs();
  renderProcOutputs();
  updateLossHint();

  const idEl = document.getElementById("proc_id");
  if(idEl){
    idEl.value = id;
    idEl.disabled = true;
  }
  const typeEl = document.getElementById("proc_type");
  if(typeEl){
    typeEl.value = po.process_type || "PROCESS";
    typeEl.disabled = true;
  }
  const srcTypeEl = document.getElementById("proc_source_type");
  if(srcTypeEl){
    srcTypeEl.value = po.source_type || "";
    srcTypeEl.disabled = true;
  }
  const supEl = document.getElementById("proc_supplier_id");
  if(supEl){
    supEl.value = po.supplier_id || "";
    supEl.disabled = true;
  }
  const planEl = document.getElementById("proc_planned_date");
  if(planEl) planEl.value = po.planned_date || "";
  const rmEl = document.getElementById("proc_remark");
  if(rmEl) rmEl.value = po.remark || "";
  setProcButtons_();

  // 優先用後端 by id/ref 直接取子表，避免前端全表下載後再 filter（若後端未更新，fallback 舊邏輯）
  let inputs = [];
  let outputs = [];
  let rels = [];
  try{
    const [rIn, rOut, rRel] = await Promise.all([
      callAPI({ action: "list_process_order_input_by_order", process_order_id: id }),
      callAPI({ action: "list_process_order_output_by_order", process_order_id: id }),
      callAPI({ action: "list_lot_relation_by_ref", ref_type: "PROCESS_ORDER", ref_id: id })
    ]);
    inputs = (rIn && rIn.data) ? rIn.data : [];
    outputs = (rOut && rOut.data) ? rOut.data : [];
    rels = (rRel && rRel.data) ? rRel.data : [];
  }catch(_e){
    const [inputsAll, outputsAll, relAll] = await Promise.all([
      getAll("process_order_input").catch(()=>[]),
      getAll("process_order_output").catch(()=>[]),
      // fallback：盡量縮小範圍（優先用 by ref，失敗才全表）
      (async ()=>{
        try{
          const r = await callAPI({ action: "list_lot_relation_by_ref", ref_type: "PROCESS_ORDER", ref_id: id });
          return (r && r.data) ? r.data : [];
        }catch(_e2){
          return await getAll("lot_relation").catch(()=>[]);
        }
      })()
    ]);
    inputs = (inputsAll || []).filter(x => x.process_order_id === id);
    outputs = (outputsAll || []).filter(x => x.process_order_id === id);
    rels = (relAll || []).filter(x => x.ref_type === "PROCESS_ORDER" && x.ref_id === id);
  }

  // 追溯顯示：彙整「每個產出 lot」對應哪些投料 lot（依目前 lot_relation INPUT）
  procRelInputsByOutputLotId = {};
  (rels || []).forEach(r => {
    if(String(r.relation_type || "").toUpperCase() !== "INPUT") return;
    const toLot = String(r.to_lot_id || "");
    const fromLot = String(r.from_lot_id || "");
    if(!toLot || !fromLot) return;
    if(!procRelInputsByOutputLotId[toLot]) procRelInputsByOutputLotId[toLot] = [];
    procRelInputsByOutputLotId[toLot].push(fromLot);
  });
  Object.keys(procRelInputsByOutputLotId).forEach(k => {
    procRelInputsByOutputLotId[k] = Array.from(new Set(procRelInputsByOutputLotId[k]));
  });

  // 供損耗提示使用（草稿清空後仍可計算）
  procLoadedInputsForHint = inputs || [];
  procLoadedOutputsForHint = outputs || [];
  // 回收入庫倉庫：預設跟第一筆投料倉別（可由使用者改選）
  procApplyDefaultReceiveWarehouse_(inputs);

  // 一套明細表：載入後直接把正式明細帶到上方表格（操作會變成回沖/作廢）
  procInputs = (inputs || []).map(x => ({
    _mode: "DB",
    process_input_id: x.process_input_id,
    lot_id: x.lot_id,
    product_id: x.product_id,
    issue_qty: x.issue_qty,
    unit: x.unit,
    remark: x.remark || ""
  }));
  procOutputs = (outputs || []).map(x => ({
    _mode: "DB",
    process_output_id: x.process_output_id,
    lot_id: x.lot_id,
    product_id: x.product_id,
    receive_qty: x.receive_qty,
    unit: x.unit,
    status: x.status,
    remark: x.remark || ""
  }));
  renderProcInputs();
  renderProcOutputs();

  // 不鎖投料；由 Lot 可用量過濾 + 超投檢查控管

  setProcStatusHint_(deriveProcStatusHint_(po, inputs, outputs));
  setProcInvHint_(deriveProcInvHint_(po, inputs, outputs));

  const summaryEl = document.getElementById("procLoadedSummary");
  if(summaryEl){
    summaryEl.textContent =
      `Process Order: ${id}\n` +
      `Type: ${po.process_type || ""}\n` +
      `Source Type: ${po.source_type || ""}\n` +
      `Supplier: ${formatProcSupplierDisplay_(po.supplier_id || "")}\n` +
      `狀態：${typeof termLabelZhOnly === "function" ? termLabelZhOnly(po.status) : termLabel(po.status)}\n` +
      `Planned: ${po.planned_date || ""}\n` +
      `Created: ${(po.created_at||"")} by ${(po.created_by||"")}\n` +
      `Updated: ${(po.updated_at||"")} by ${(po.updated_by||"")}\n` +
      `Remark: ${po.remark || ""}\n`;
  }

  // 已載入明細（文字版）：恢復原本的 pre 顯示（不影響上方一套明細表）
  const inEl = document.getElementById("procLoadedInputs");
  if(inEl){
    inEl.textContent = inputs.length
      ? inputs.map(x => {
          const prod = formatProcProductDisplay_(x.product_id) || (x.product_id || "");
          return `- ${x.process_input_id || ""} | ${x.lot_id} | ${prod} | qty:${x.issue_qty} ${x.unit} | ${x.remark||""}`;
        }).join("\n")
      : "(無)";
  }
  const outEl = document.getElementById("procLoadedOutputs");
  if(outEl){
    outEl.textContent = outputs.length
      ? outputs.map(x => {
          const prod = formatProcProductDisplay_(x.product_id) || (x.product_id || "");
          const lossText = (x.loss_base_qty_after != null && x.loss_base_unit)
            ? ` | loss_after:${x.loss_base_qty_after} ${x.loss_base_unit}`
            : "";
          return `- ${x.process_output_id || ""} | ${x.lot_id} | ${prod} | qty:${x.receive_qty} ${x.unit} | 狀態:${typeof termLabelZhOnly === "function" ? termLabelZhOnly(x.status) : termLabel(x.status)}${lossText} | ${x.remark||""}`;
        }).join("\n")
      : "(無)";
  }

  const relEl = document.getElementById("procLoadedRelations");
  if(relEl){
    relEl.textContent = rels.length
      ? rels.map(x => `- ${x.relation_type} | ${x.from_lot_id} -> ${x.to_lot_id} | qty:${x.qty} ${x.unit}`).join("\n")
      : "(無)";
  }

    showToast("已載入加工單：" + id);
    if(typeof scrollToEditorTop === "function") scrollToEditorTop();
    updateLossHint();
  }finally{
    try{
      if(typeof erpEndLoadWarnToast_ === "function"){
        erpEndLoadWarnToast_(procLoadWarnToken_);
      }
      procLoadWarnToken_ = "";
    }catch(_eWarnEnd){}
    try{ if(triggerEl) triggerEl.disabled = false; }catch(_eB){}
  procLoadInFlight = false;
  // 若載入期間又點了其他單號，完成後自動載入最後一次點選的單號
  try{
    const nextId = String(procPendingLoadId_ || "").trim().toUpperCase();
    procPendingLoadId_ = "";
    if(nextId && nextId !== id){
      setTimeout(function(){
        try{ loadProcessOrder(nextId); }catch(_e){}
      }, 0);
    }
  }catch(_eNext){}
    setProcButtons_();
  }
}

async function updateProcessOrderHeader(triggerEl){
  if(procLoadInFlight){
    return showToast("加工單載入中，請稍候…","error");
  }
  const id = (document.getElementById("proc_id")?.value || "").trim().toUpperCase();
  if(!id) return showToast("請先載入加工單","error");

  showSaveHint(triggerEl);
  try {
  const po = await getOne("process_order","process_order_id",id).catch(()=>null);
  if(!po) return showToast("找不到加工單","error");

  const planned_date = document.getElementById("proc_planned_date")?.value || "";
  const source_type = document.getElementById("proc_source_type")?.value || "";
  const remark = (document.getElementById("proc_remark")?.value || "").trim();

  await callAPI({
    action: "update_process_order_header_cmd",
    process_order_id: id,
    planned_date,
    // command 只允許改 planned_date/remark；source_type 仍保留在 UI，但不透過 header cmd 修改
    remark,
    updated_by: getCurrentUser(),
    updated_at: nowIso16()
  }, { method: "POST" });

  await renderProcessOrders();
  await loadProcessOrder(id);
  showToast("加工單主檔已更新");
  } finally { hideSaveHint(); }
}

async function renderProcessOrders(){
  const tbody = document.getElementById("procTableBody");
  if(!tbody) return;

  setTbodyLoading_(tbody, 7);
  const list = await getAll("process_order").catch(()=>[]);
  const kw = (document.getElementById("proc_search_keyword")?.value || "").trim().toLowerCase();
  const qSt = (document.getElementById("proc_search_status")?.value || "").trim().toUpperCase();
  const supMap = {};
  (procSuppliers || []).forEach(s => {
    if(!s || s.supplier_id == null || s.supplier_id === "") return;
    const sid = String(s.supplier_id).trim();
    supMap[sid] = s;
    supMap[sid.toUpperCase()] = s;
  });
  const filtered = (list || []).filter(p => {
    if(qSt && String(p.status || "").toUpperCase() !== qSt) return false;
    if(!kw) return true;
    const sn = String(supMap[p.supplier_id]?.supplier_name || "").toLowerCase();
    const ptZh = procProcessTypeLabel_(p.process_type);
    const hay = [
      p.process_order_id,
      p.process_type,
      ptZh,
      p.source_type,
      p.supplier_id,
      sn
    ].map(x => String(x || "").toLowerCase()).join(" ");
    return hay.includes(kw);
  });
  const sorted = [...filtered].sort((a,b)=>(b.created_at||"").localeCompare(a.created_at||""));

  tbody.innerHTML = "";
  if(!sorted.length){
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#64748b;padding:24px;">${kw || qSt ? "沒有符合條件的加工單。" : "尚無加工單。請於上方建立或載入。"}</td></tr>`;
    return;
  }
  sorted.forEach(p => {
    const poId = String(p.process_order_id || "").replace(/'/g, "\\'");
    tbody.innerHTML += `
      <tr>
        <td>${escapeHtml_(p.process_order_id || "")}</td>
        <td>${escapeHtml_(procProcessTypeLabel_(p.process_type))}</td>
        <td>${escapeHtml_(p.source_type || "")}</td>
        <td>${escapeHtml_(procSupplierListCell_(p.supplier_id, supMap))}</td>
        <td>${escapeHtml_(termLabelZhOnly(p.status))}</td>
        <td>${escapeHtml_(p.created_at || "")}</td>
        <td>
          <button class="btn-edit" onclick="loadProcessOrder('${poId}', this)">Load</button>
        </td>
      </tr>
    `;
  });
}

// 讓產出損耗提示即時更新
document.addEventListener("input", (e)=>{
  const id = e && e.target ? String(e.target.id || "") : "";
  if(id === "proc_output_qty"){
    updateLossHint();
    try{ setProcButtons_(); }catch(_e){}
    return;
  }
  if(id === "proc_input_qty"){
    // 投料數量變更時，同步更新按鈕可用狀態（避免填了數量仍顯示 disabled）
    try{ setProcButtons_(); }catch(_e){}
    return;
  }
});

