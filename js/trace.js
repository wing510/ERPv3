/*********************************
 * Traceability（API 版）
 * - Upstream：lot_relation (to_lot_id = current)
 * - Downstream：lot_relation (from_lot_id = current) + shipment_item（流向）
 *********************************/

let traceLots = [];
let traceRelations = [];
let traceMovements = [];
let traceShipments = [];
let traceShipmentItems = [];
let traceTxInFlight_ = false;
let traceTxPending_ = false;
// 查詢頁面已有就地狀態提示（hint），避免再疊一層橘色載入 Toast
let traceLotInFlight_ = false;
let traceLotPending_ = false;
// 查詢頁面已有就地狀態提示（hint），避免再疊一層橘色載入 Toast
let traceImportDocs = [];
let traceGoodsReceipts = [];
let traceProcessOrders = [];
let traceAvailByLotId = {};
let traceCustomers = [];
let traceCustomerNameById_ = {};

function upper_(s){ return String(s || "").trim().toUpperCase(); }

function traceSetV_(id, v){
  try{
    if(typeof window.erpSetVById_ === "function") return window.erpSetVById_(id, v);
  }catch(_e){}
  const el = document.getElementById(String(id || ""));
  if(el && "value" in el) el.value = v;
}

function traceClear_(ids){
  try{
    if(typeof window.erpClearIds_ === "function") return window.erpClearIds_(ids);
  }catch(_e){}
  const list = Array.isArray(ids) ? ids : [ids];
  for(let i = 0; i < list.length; i++){
    const el = document.getElementById(String(list[i] || ""));
    if(el && "value" in el) el.value = "";
  }
}

async function copyTextFromEl(elId){
  const el = document.getElementById(String(elId || ""));
  const txt = String(el && ("value" in el ? el.value : el.textContent) || "").trim();
  if(!txt) return showToast("沒有可複製的內容","error");
  return copyText_(txt);
}

async function copyText_(txt){
  const text = String(txt || "").trim();
  if(!text) return showToast("沒有可複製的內容","error");
  try{
    if(navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function"){
      await navigator.clipboard.writeText(text);
    }else{
      // fallback：舊瀏覽器
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    showToast("已複製","success");
  }catch(_e){
    showToast("複製失敗","error");
  }
}

async function runTraceTx(){
  const inputEl = document.getElementById("trace_tx_id");
  const raw = upper_(inputEl && inputEl.value || "");
  if(!raw) return showToast("請輸入 TX 或單號（例如：TX-... / SHIP-... / SO-...）","error");

  if(traceTxInFlight_){
    traceTxPending_ = true;
    const hint = document.getElementById("traceTxRunHint");
    if(hint){ hint.style.display = "inline-block"; hint.textContent = "查詢中…（已排隊）"; }
    return;
  }
  traceTxInFlight_ = true;

  const runBtn = document.getElementById("trace_tx_run_btn");
  const hint = document.getElementById("traceTxRunHint");
  const outEl = document.getElementById("traceTxResult");
  const linksEl = document.getElementById("traceTxLinks");

  if(runBtn) runBtn.disabled = true;
  if(hint){ hint.style.display = "inline-block"; hint.textContent = "查詢中…"; }
  if(outEl) outEl.textContent = "查詢中…";
  if(linksEl){ linksEl.style.display = "none"; linksEl.innerHTML = ""; }

  try{
    const txId = await traceResolveTxIdInput_(raw, hint);
    if(!txId) return; // resolve 已提示錯誤
    // 把輸入框統一回填成 TX（使用者後續按延伸/分享更一致）
    try{ if(inputEl) inputEl.value = txId; }catch(_e0){}

    const r = await callAPI({ action: "trace_transaction_bundle", transaction_id: txId, limit: 2000 }, { method:"POST" });
    const d = (r && r.data) ? r.data : null;
    if(!d){
      if(outEl) outEl.textContent =
        "查無資料。\n\n" +
        "建議：\n" +
        "- 確認 transaction_id 是否正確（通常長得像 TX-...）。\n" +
        "- 若你是想追「這批貨從哪來/出到哪」，請改用上方「區塊 1：查貨（Lot）」。\n" +
        "- 若這筆是很舊的資料，可能當時尚未填入 transaction_id。";
      const rawEl = document.getElementById("traceTxRawResult");
      if(rawEl) rawEl.textContent = "";
      if(linksEl){ linksEl.style.display = "none"; linksEl.innerHTML = ""; }
      return;
    }
    try{ window.__ERP_TRACE_TX_LAST__ = d; }catch(_e0){}
    if(outEl) outEl.textContent = formatTraceTxReadable_(d, null);
    const rawEl = document.getElementById("traceTxRawResult");
    if(rawEl) rawEl.textContent = JSON.stringify(d, null, 2);
    renderTraceTxLinks_(d).catch(()=>{});
  }catch(e){
    if(outEl) outEl.textContent = (e && e.message) ? e.message : String(e || "查詢失敗");
    showToast("查詢失敗","error");
  }finally{
    if(runBtn) runBtn.disabled = false;
    if(hint) hint.style.display = "none";
    traceTxInFlight_ = false;
    if(traceTxPending_){
      traceTxPending_ = false;
      setTimeout(function(){ try{ runTraceTx().catch(()=>{}); }catch(_e){} }, 0);
    }
  }
}

async function traceResolveTxIdInput_(rawInput, hintEl){
  const v = upper_(rawInput);
  if(!v) return "";
  if(/^TX[-_]/i.test(v)) return v;

  // 顯示「正在解析單號」的小提示（沿用原本 hint 區塊）
  try{
    if(hintEl){
      hintEl.style.display = "inline-block";
      hintEl.textContent = "解析單號中…";
    }
  }catch(_e){}

  async function getTx_(table, key, id){
    const row = await getOne(table, key, id).catch(()=>null);
    return upper_(row && row.transaction_id || "");
  }
  async function getTxFromLatestGrByPo_(poId){
    const pid = upper_(poId);
    if(!pid) return "";
    let grs = [];
    try{
      grs = await getAll("goods_receipt").catch(()=>[]);
    }catch(_e){
      grs = [];
    }
    const related = (grs || [])
      .filter(r => upper_(r && r.po_id || "") === pid)
      .filter(r => upper_(r && r.transaction_id || ""));
    if(!related.length) return "";
    // 新→舊
    related.sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")));
    return upper_(related[0] && related[0].transaction_id || "");
  }
  async function getTxFromLatestIrByImportDoc_(importDocId){
    const did = upper_(importDocId);
    if(!did) return "";
    let irs = [];
    try{
      irs = await getAll("import_receipt").catch(()=>[]);
    }catch(_e){
      irs = [];
    }
    const related = (irs || [])
      .filter(r => upper_(r && r.import_doc_id || "") === did)
      .filter(r => upper_(r && r.transaction_id || ""))
      .filter(r => String(r && r.status || "").trim().toUpperCase() !== "CANCELLED");
    if(!related.length) return "";
    related.sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")));
    return upper_(related[0] && related[0].transaction_id || "");
  }

  let tx = "";
  if(/^SO[-_]/i.test(v)){
    tx = await getTx_("sales_order", "so_id", v);
  }else if(/^SHIP[-_]/i.test(v)){
    tx = await getTx_("shipment", "shipment_id", v);
  }else if(/^GR[-_]/i.test(v)){
    tx = await getTx_("goods_receipt", "gr_id", v);
  }else if(/^IR[-_]/i.test(v)){
    tx = await getTx_("import_receipt", "import_receipt_id", v);
  }else if(/^PO[-_]/i.test(v)){
    tx = await getTx_("purchase_order", "po_id", v);
    // 相容：部分 PO 本身未填 transaction_id，但收貨單（GR）會有；改用最近一筆 GR 的 tx 當入口
    if(!tx){
      tx = await getTxFromLatestGrByPo_(v);
    }
  }else if(/^IMPORT[-_]/i.test(v)){
    tx = await getTx_("import_document", "import_doc_id", v);
    // 相容：部分報單本身未填 transaction_id，但收貨單（IR）會有；改用最近一筆 IR 的 tx 當入口
    if(!tx){
      tx = await getTxFromLatestIrByImportDoc_(v);
    }
  }else if(/^PROC[-_]/i.test(v) || /^PROCESS[-_]/i.test(v)){
    tx = await getTx_("process_order", "process_order_id", v);
  }else if(/^MV[-_]/i.test(v) || /^MOV[-_]/i.test(v)){
    tx = await getTx_("inventory_movement", "movement_id", v);
  }else{
    showToast("不支援的單號格式：請輸入 TX/SO/SHIP/GR/IR/PO/IMPORT/PROC/MV-...","error");
    return "";
  }

  if(!tx){
    const more =
      /^PO[-_]/i.test(v)
        ? "（此 PO 可能尚未收貨；可改用 GR-... 或 Lot-... 查）"
        : /^IMPORT[-_]/i.test(v)
          ? "（此報單可能尚未收貨；可改用 IR-... 或 Lot-... 查）"
        : "（可能尚未過帳或資料未填）";
    showToast("找不到對應的 transaction_id" + more, "error");
    return "";
  }
  return tx;
}

function traceTxLoad_(txId){
  const tx = String(txId || "").trim().toUpperCase();
  if(!tx) return;
  traceSetV_("trace_tx_id", tx);
  runTraceTx().catch(()=>{});
}

async function renderTraceTxLinks_(bundle){
  const linksEl = document.getElementById("traceTxLinks");
  if(!linksEl) return;

  const base = bundle || {};
  const baseTx = String(base.transaction_id || "").trim().toUpperCase();
  if(!baseTx){
    linksEl.style.display = "none";
    linksEl.innerHTML = "";
    return;
  }

  let candidates = [];
  try{
    candidates = await guessLinkedTxIdsFromBundle_(base);
  }catch(_e){}
  candidates = Array.from(new Set((candidates || []).map(x => String(x || "").trim().toUpperCase()).filter(Boolean)))
    .filter(x => x !== baseTx)
    .slice(0, 5);

  if(!candidates.length){
    linksEl.style.display = "none";
    linksEl.innerHTML = "";
    return;
  }

  // 嘗試替候選 tx 加上「來源標籤」（原銷售/原出貨/上游：採購收貨/進口收貨…）
  const labelsByTx = {};
  try{
    const refs = [];
    function pushRef_(label, t, id){
      const tp = String(t || "").trim().toUpperCase();
      const rid = String(id || "").trim().toUpperCase();
      if(!tp || !rid) return;
      refs.push({ label: String(label || ""), t: tp, id: rid });
    }

    // 來源 1：SO 的補寄參考（最常用）
    try{
      const so = Array.isArray(base.sales_order) ? (base.sales_order[0] || null) : null;
      if(so){
        pushRef_("原銷售/原出貨", so.reship_ref_type, so.reship_ref_id);
        pushRef_("上游", so.parent_ref_type, so.parent_ref_id);
      }
    }catch(_eSo){}

    // 來源 2：掃整包 bundle 的 parent_ref/ref（讓採購收貨/進口收貨/加工/庫存異動等也能標籤）
    try{
      const tableKeys = [
        "sales_order","sales_order_item",
        "shipment","shipment_item",
        "goods_receipt","goods_receipt_item",
        "import_receipt","import_receipt_item",
        "process_order","process_order_input","process_order_output",
        "inventory_movement","lot_relation"
      ];
      for(let k = 0; k < tableKeys.length; k++){
        const arr = Array.isArray(base[tableKeys[k]]) ? base[tableKeys[k]] : [];
        for(let i = 0; i < arr.length; i++){
          const row = arr[i] || {};
          // parent_ref → 優先視為上游
          if(String(row.parent_ref_type || "").trim() || String(row.parent_ref_id || "").trim()){
            pushRef_("上游", row.parent_ref_type, row.parent_ref_id);
          }
          // ref_type/ref_id → 若沒有 parent_ref 時，也當作來源線索
          if(
            !String(row.parent_ref_type || "").trim() &&
            !String(row.parent_ref_id || "").trim()
          ){
            pushRef_("來源", row.ref_type, row.ref_id);
          }
        }
      }
    }catch(_eScan){}

    async function refToTx_(t, id){
      try{
        if(t === "SO"){
          const ref = await getOne("sales_order", "so_id", id).catch(()=>null);
          return String(ref && ref.transaction_id || "").trim().toUpperCase();
        }
        if(t === "SHIPMENT"){
          const ref = await getOne("shipment", "shipment_id", id).catch(()=>null);
          return String(ref && ref.transaction_id || "").trim().toUpperCase();
        }
        if(t === "GOODS_RECEIPT"){
          const ref = await getOne("goods_receipt", "gr_id", id).catch(()=>null);
          return String(ref && ref.transaction_id || "").trim().toUpperCase();
        }
        if(t === "IMPORT_RECEIPT"){
          const ref = await getOne("import_receipt", "import_receipt_id", id).catch(()=>null);
          return String(ref && ref.transaction_id || "").trim().toUpperCase();
        }
        if(t === "PROCESS_ORDER"){
          const ref = await getOne("process_order", "process_order_id", id).catch(()=>null);
          return String(ref && ref.transaction_id || "").trim().toUpperCase();
        }
      }catch(_e){}
      return "";
    }
    function refLabel_(t, label){
      const tp = String(t || "").trim().toUpperCase();
      if(tp === "SO") return "原銷售";
      if(tp === "SHIPMENT") return "原出貨";
      if(tp === "GOODS_RECEIPT") return "上游：採購收貨";
      if(tp === "IMPORT_RECEIPT") return "上游：進口收貨";
      if(tp === "PROCESS_ORDER") return "上游：委外加工";
      if(tp === "INVENTORY_MOVEMENT") return "上游：庫存異動";
      if(label && String(label).trim()) return String(label).trim();
      return "上游";
    }
    function rankLabel_(l){
      const s = String(l || "");
      // 數字越小越優先
      if(s.indexOf("原銷售") >= 0) return 1;
      if(s.indexOf("原出貨") >= 0) return 2;
      if(s.indexOf("上游：採購收貨") >= 0) return 3;
      if(s.indexOf("上游：進口收貨") >= 0) return 4;
      if(s.indexOf("上游：委外加工") >= 0) return 5;
      if(s.indexOf("上游：庫存異動") >= 0) return 6;
      if(s.indexOf("來源") >= 0) return 90;
      return 50;
    }
    for(let i = 0; i < refs.length; i++){
      const r = refs[i];
      const tx = await refToTx_(r.t, r.id);
      if(!tx) continue;
      if(!candidates.includes(tx)) continue;
      const next = refLabel_(r.t, r.label);
      const cur = labelsByTx[tx] || "";
      if(!cur || rankLabel_(next) < rankLabel_(cur)) labelsByTx[tx] = next;
    }
  }catch(_eLabel){}

  linksEl.style.display = "block";
  linksEl.innerHTML = "";

  const title = document.createElement("div");
  title.style.fontSize = "12px";
  title.style.fontWeight = "700";
  title.style.color = "#334155";
  title.style.marginBottom = "6px";
  title.textContent = "可延伸的上一段（點一下直接查詢）";
  linksEl.appendChild(title);

  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexWrap = "wrap";
  wrap.style.gap = "6px";
  linksEl.appendChild(wrap);

  candidates.forEach(function(tx){
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-secondary";
    const label = labelsByTx[tx] ? ("（" + labelsByTx[tx] + "）") : "";
    btn.textContent = tx + label;
    btn.title = "點一下查詢這個 transaction_id";
    btn.onclick = function(){ traceTxLoad_(tx); };
    wrap.appendChild(btn);
  });
}

function toggleTraceTxRaw_(){
  const rawEl = document.getElementById("traceTxRawResult");
  if(!rawEl) return;
  const on = rawEl.style.display !== "none";
  rawEl.style.display = on ? "none" : "block";
}

async function extendTraceTx_(){
  // 相容舊按鈕：等同延伸 1 層
  return extendTraceTxDeep_(1);
}

function extendTraceTxSelected_(){
  const sel = document.getElementById("trace_tx_extend_depth");
  const depth = Number(sel && sel.value || 1) || 1;
  extendTraceTxDeep_(depth).catch(()=>{});
}

async function extendTraceTxDeep_(maxDepth){
  const base = (function(){
    try{ return window.__ERP_TRACE_TX_LAST__ || null; }catch(_e){ return null; }
  })();
  if(!base) return showToast("請先查詢一筆交易鏈，再按「延伸」","error");

  const runBtn = document.getElementById("trace_tx_run_btn");
  const hint = document.getElementById("traceTxRunHint");
  const outEl = document.getElementById("traceTxResult");
  if(runBtn) runBtn.disabled = true;
  if(hint){ hint.style.display = "inline-block"; hint.textContent = "延伸查詢中…"; }

  try{
    const depthMax = Math.max(1, Math.min(6, Number(maxDepth || 1)));
    const baseTx = String(base.transaction_id || "").trim().toUpperCase();
    const seenTx = new Set();
    if(baseTx) seenTx.add(baseTx);

    const extras = [];
    let cur = base;
    for(let depth = 1; depth <= depthMax; depth++){
      const extraTxIds = await guessLinkedTxIdsFromBundle_(cur);
      const uniq = Array.from(new Set((extraTxIds || []).map(x => String(x || "").trim().toUpperCase()).filter(Boolean)));
      const nextTx = uniq.find(x => x && !seenTx.has(x)) || "";
      if(!nextTx) break;
      seenTx.add(nextTx);

      const r = await callAPI(
        { action: "trace_transaction_bundle", transaction_id: nextTx, limit: 2000 },
        { method:"POST", silent: true }
      );
      const d = (r && r.data) ? r.data : null;
      if(!d) break;
      extras.push(d);
      cur = d;
    }

    if(!extras.length){
      showToast("目前這筆資料沒有找到可延伸的上一段（可能尚未填父子關係或補寄參考）", "error");
      return;
    }

    if(outEl) outEl.textContent = formatTraceTxReadable_(base, extras);
  }catch(e){
    showToast("延伸查詢失敗", "error");
  }finally{
    if(runBtn) runBtn.disabled = false;
    if(hint) hint.style.display = "none";
  }
}


async function guessLinkedTxIdsFromBundle_(bundle){
  const b = bundle || {};
  const out = [];

  function pushTx_(tx){
    const t = String(tx || "").trim().toUpperCase();
    if(t) out.push(t);
  }

  function pushParentRef_(type, id){
    const t = String(type || "").trim().toUpperCase();
    const rid = String(id || "").trim().toUpperCase();
    if(!t || !rid) return;
    refs.push({ t: t, id: rid });
  }

  async function resolveRefTx_(t, id){
    const key = t + ":" + id;
    if(resolved[key] != null) return resolved[key];
    let tx = "";
    try{
      if(t === "SO"){
        const ref = await getOne("sales_order", "so_id", id).catch(()=>null);
        tx = String(ref && ref.transaction_id || "").trim().toUpperCase();
      }else if(t === "SHIPMENT"){
        const ref = await getOne("shipment", "shipment_id", id).catch(()=>null);
        tx = String(ref && ref.transaction_id || "").trim().toUpperCase();
      }else if(t === "GOODS_RECEIPT"){
        const ref = await getOne("goods_receipt", "gr_id", id).catch(()=>null);
        tx = String(ref && ref.transaction_id || "").trim().toUpperCase();
      }else if(t === "IMPORT_RECEIPT"){
        const ref = await getOne("import_receipt", "import_receipt_id", id).catch(()=>null);
        tx = String(ref && ref.transaction_id || "").trim().toUpperCase();
      }else if(t === "PROCESS_ORDER"){
        const ref = await getOne("process_order", "process_order_id", id).catch(()=>null);
        tx = String(ref && ref.transaction_id || "").trim().toUpperCase();
      }else if(t === "INVENTORY_MOVEMENT"){
        const ref = await getOne("inventory_movement", "movement_id", id).catch(()=>null);
        tx = String(ref && ref.transaction_id || "").trim().toUpperCase();
      }else if(t === "LOT_RELATION"){
        const ref = await getOne("lot_relation", "relation_id", id).catch(()=>null);
        tx = String(ref && ref.transaction_id || "").trim().toUpperCase();
      }
    }catch(_e){}
    resolved[key] = tx || "";
    return resolved[key];
  }

  const refs = [];
  const resolved = {};

  const so = Array.isArray(b.sales_order) ? (b.sales_order[0] || null) : null;
  if(so){
    const t = String(so.reship_ref_type || "").trim().toUpperCase();
    const id = String(so.reship_ref_id || "").trim().toUpperCase();
    if(t && id){
      // 補寄最常用：指向原 SO 或原 Shipment
      pushParentRef_(t, id);
    }
    // 若有 parent_ref 指向更上游，也一併嘗試（小範圍）
    pushParentRef_(so.parent_ref_type, so.parent_ref_id);
  }

  // 從 bundle 內所有表再蒐集一次 parent_ref（讓作廢/回沖也可延伸）
  const tableKeys = [
    "sales_order","sales_order_item",
    "shipment","shipment_item",
    "goods_receipt","goods_receipt_item",
    "import_receipt","import_receipt_item",
    "process_order","process_order_input","process_order_output",
    "inventory_movement","lot_relation"
  ];
  for(let k = 0; k < tableKeys.length; k++){
    const arr = Array.isArray(b[tableKeys[k]]) ? b[tableKeys[k]] : [];
    for(let i = 0; i < arr.length; i++){
      const row = arr[i] || {};
      pushParentRef_(row.parent_ref_type, row.parent_ref_id);
      // 有些表也會把 ref_type/ref_id 當作「指向來源」：在沒有 parent_ref 時也值得嘗試（小範圍）
      if(!String(row.parent_ref_type || "").trim() && !String(row.parent_ref_id || "").trim()){
        pushParentRef_(row.ref_type, row.ref_id);
      }
    }
  }

  // 加強：若事件本身沒有 parent_ref，但有 lot_id（出貨/庫存異動/關聯），可由 Lot 的 source 反查上游單據 → tx
  try{
    const lotIds = [];
    function pushLot_(id){
      const s = String(id || "").trim().toUpperCase();
      if(s) lotIds.push(s);
    }
    // shipment_item / movement / goods_receipt_item / import_receipt_item / process_input/output 都可能帶 lot_id
    const lotKeys = [
      "shipment_item",
      "inventory_movement",
      "goods_receipt_item",
      "import_receipt_item",
      "process_order_input",
      "process_order_output"
    ];
    for(let k = 0; k < lotKeys.length; k++){
      const arr = Array.isArray(b[lotKeys[k]]) ? b[lotKeys[k]] : [];
      for(let i = 0; i < arr.length; i++){
        const row = arr[i] || {};
        pushLot_(row.lot_id);
      }
    }
    // lot_relation 也可能帶 from/to lot
    const rels = Array.isArray(b.lot_relation) ? b.lot_relation : [];
    for(let i = 0; i < rels.length; i++){
      const r = rels[i] || {};
      pushLot_(r.from_lot_id);
      pushLot_(r.to_lot_id);
    }
    const uniqLots = Array.from(new Set(lotIds)).slice(0, 10);

    async function lotToUpstreamTx_(lotId){
      const lot = await getOne("lot", "lot_id", lotId).catch(()=>null);
      if(!lot) return "";
      const st = String(lot.source_type || "").trim().toUpperCase();
      const sid = String(lot.source_id || "").trim().toUpperCase();
      if(!st || !sid) return "";
      try{
        if(st === "PURCHASE"){
          // source_id 通常是 GR
          const gr = await getOne("goods_receipt", "gr_id", sid).catch(()=>null);
          return String(gr && gr.transaction_id || "").trim().toUpperCase();
        }
        if(st === "IMPORT"){
          // source_id 可能是 IMPORT_RECEIPT 或 IMPORT_DOCUMENT（依你們資料）
          const ir = await getOne("import_receipt", "import_receipt_id", sid).catch(()=>null);
          const tx = String(ir && ir.transaction_id || "").trim().toUpperCase();
          if(tx) return tx;
          const doc = await getOne("import_document", "import_doc_id", sid).catch(()=>null);
          return String(doc && doc.transaction_id || "").trim().toUpperCase();
        }
        if(st === "PROCESS"){
          const po = await getOne("process_order", "process_order_id", sid).catch(()=>null);
          return String(po && po.transaction_id || "").trim().toUpperCase();
        }
      }catch(_e){}
      return "";
    }

    for(let i = 0; i < uniqLots.length; i++){
      const tx = await lotToUpstreamTx_(uniqLots[i]);
      pushTx_(tx);
    }
  }catch(_eLotBridge){}

  // 解析 refs → tx，並限制數量避免一次打太多
  const uniqRefs = [];
  const seen = {};
  for(let i = 0; i < refs.length; i++){
    const r = refs[i];
    const key = String(r.t || "") + ":" + String(r.id || "");
    if(!key || seen[key]) continue;
    seen[key] = true;
    uniqRefs.push(r);
    if(uniqRefs.length >= 12) break;
  }
  for(let i = 0; i < uniqRefs.length; i++){
    const r = uniqRefs[i];
    const tx = await resolveRefTx_(r.t, r.id);
    pushTx_(tx);
  }

  return out;
}

function formatTraceTxReadable_(bundle, extraBundles){
  const b = bundle || {};
  const tx = String(b.transaction_id || "").trim();

  const sections = [
    ["銷售單", "sales_order", ["so_id","status","so_type","reship_ref_type","reship_ref_id","parent_ref_type","parent_ref_id","order_date","created_at","updated_at"]],
    ["銷售單明細", "sales_order_item", ["so_item_id","so_id","product_id","order_qty","unit","shipped_qty","status","parent_ref_type","parent_ref_id","created_at"]],
    ["出貨單", "shipment", ["shipment_id","so_id","customer_id","status","ship_date","parent_ref_type","parent_ref_id","created_at","updated_at"]],
    ["出貨明細", "shipment_item", ["shipment_item_id","shipment_id","so_id","so_item_id","lot_id","product_id","ship_qty","unit","parent_ref_type","parent_ref_id","created_at"]],
    ["庫存異動", "inventory_movement", ["movement_id","movement_type","lot_id","product_id","warehouse_id","qty","unit","ref_type","ref_id","parent_ref_type","parent_ref_id","created_at"]],
    ["批次關聯", "lot_relation", ["relation_id","relation_type","from_lot_id","to_lot_id","qty","unit","ref_type","ref_id","parent_ref_type","parent_ref_id","created_at"]],
    ["採購收貨", "goods_receipt", ["gr_id","po_id","status","receipt_date","warehouse","parent_ref_type","parent_ref_id","created_at"]],
    ["採購收貨明細", "goods_receipt_item", ["gr_item_id","gr_id","po_id","po_item_id","lot_id","product_id","received_qty","unit","parent_ref_type","parent_ref_id","created_at"]],
    ["進口收貨", "import_receipt", ["import_receipt_id","import_doc_id","status","receipt_date","warehouse","parent_ref_type","parent_ref_id","created_at"]],
    ["進口收貨明細", "import_receipt_item", ["import_receipt_item_id","import_receipt_id","import_item_id","lot_id","product_id","received_qty","unit","parent_ref_type","parent_ref_id","created_at"]],
    ["委外加工單", "process_order", ["process_order_id","process_type","source_type","supplier_id","status","planned_date","parent_ref_type","parent_ref_id","created_at","updated_at"]],
    ["投料", "process_order_input", ["process_input_id","process_order_id","lot_id","product_id","issue_qty","unit","parent_ref_type","parent_ref_id","created_at"]],
    ["回收", "process_order_output", ["process_output_id","process_order_id","lot_id","product_id","receive_qty","unit","status","parent_ref_type","parent_ref_id","created_at","updated_at"]]
  ];

  function asArr_(x){ return Array.isArray(x) ? x : []; }
  function v_(o, k){
    try{
      const val = o && o[k] != null ? o[k] : "";
      const s = String(val).trim();
      return s;
    }catch(_e){
      return "";
    }
  }
  function oneLine_(o, keys){
    const mainId = v_(o, keys[0]);
    const parts = [];
    for(let i = 1; i < keys.length; i++){
      const k = keys[i];
      const val = v_(o, k);
      if(!val) continue;
      // 避免太長：備註類不顯示（整理版只放關鍵）
      if(k === "remark" || k === "system_remark") continue;
      parts.push(k + "=" + val);
    }
    return (mainId ? (mainId + (parts.length ? (" | " + parts.join(" | ")) : "")) : parts.join(" | "));
  }
  function sortKey_(o){
    return v_(o, "updated_at") || v_(o, "created_at") || v_(o, "ship_date") || v_(o, "receipt_date") || v_(o, "order_date") || "";
  }

  function summarizeTxConclusion_(bundle){
    const b = bundle || {};
    const mvs = Array.isArray(b.inventory_movement) ? b.inventory_movement : [];
    const ships = Array.isArray(b.shipment) ? b.shipment : [];
    const so = Array.isArray(b.sales_order) ? (b.sales_order[0] || null) : null;
    const gr = Array.isArray(b.goods_receipt) ? (b.goods_receipt[0] || null) : null;
    const ir = Array.isArray(b.import_receipt) ? (b.import_receipt[0] || null) : null;
    const proc = Array.isArray(b.process_order) ? (b.process_order[0] || null) : null;
    const hasProcIn = Array.isArray(b.process_order_input) && b.process_order_input.length > 0;
    const hasProcOut = Array.isArray(b.process_order_output) && b.process_order_output.length > 0;

    const hasShipOut = mvs.some(m => String(m && m.movement_type || "").trim().toUpperCase() === "SHIP_OUT");
    const hasShipCancel = mvs.some(m => String(m && m.ref_type || "").trim().toUpperCase() === "SHIPMENT_CANCEL");
    const shipPosted = ships.some(s => String(s && s.status || "").trim().toUpperCase() === "POSTED");
    const shipCancelled = ships.some(s => String(s && s.status || "").trim().toUpperCase() === "CANCELLED");
    const hasInMv = mvs.some(m => String(m && m.movement_type || "").trim().toUpperCase() === "IN");
    const hasTransferMv = mvs.some(m => String(m && m.movement_type || "").trim().toUpperCase() === "TRANSFER");
    const hasAdjustMv = mvs.some(m => String(m && m.movement_type || "").trim().toUpperCase() === "ADJUST");

    const hasSO = !!(so && String(so.so_id || "").trim());
    const soType = String(so && so.so_type || "").trim().toUpperCase();
    const soTypeZhMap = {
      NORMAL: "正常訂單",
      SAMPLE: "樣品",
      GIFT: "贈品",
      PR: "公關",
      RESHIP: "補寄",
      OTHER: "其他"
    };
    const soTypeZh = soType ? (soTypeZhMap[soType] || soType) : "";
    const salesLabel = hasSO ? ("銷售" + (soTypeZh ? ("(" + soTypeZh + ")") : "")) : "";
    const shipLabel = "出貨";
    const chainPrefix = salesLabel ? (salesLabel + " → ") : "";

    const tags = [];
    if(hasShipOut) tags.push("出貨扣庫");
    if(hasShipCancel) tags.push("作廢回沖");
    if(hasShipOut && hasShipCancel && shipPosted) tags.push("再出貨");
    if(gr && hasInMv) return "此事件類型：採購 → 收貨入庫";
    if(ir && hasInMv) return "此事件類型：進口 → 收貨入庫";
    if(proc && (hasProcIn || hasProcOut)) return "此事件類型：委外 → 投料/回收 → 入庫";
    if(hasTransferMv) return "此事件類型：轉倉";
    if(hasAdjustMv && !hasShipCancel) return "此事件類型：庫存調整";
    if(!tags.length) return "";

    // 優先用「故事版」輸出
    if(hasShipOut && hasShipCancel && shipPosted){
      return "此事件包含：" + chainPrefix + shipLabel + " → 作廢回沖 → 再出貨";
    }
    if(hasShipOut && shipPosted && !hasShipCancel && !shipCancelled){
      return "此事件包含：" + chainPrefix + shipLabel;
    }
    if(shipCancelled && hasShipCancel && !shipPosted){
      return "此事件包含：作廢回沖";
    }
    return "此事件包含：" + tags.join("、");
  }

  function collectLinkHints_(bundle){
    const b = bundle || {};
    const hints = [];
    function push_(label, type, id){
      const t = String(type || "").trim().toUpperCase();
      const rid = String(id || "").trim().toUpperCase();
      if(!t || !rid) return;
      hints.push(label + "： " + t + " " + rid);
    }
    // 以 SO 為主：補寄參考 + parent_ref
    const so = Array.isArray(b.sales_order) ? (b.sales_order[0] || null) : null;
    if(so){
      push_("補寄參考", so.reship_ref_type, so.reship_ref_id);
      push_("父子關係", so.parent_ref_type, so.parent_ref_id);
    }
    // 其他表：挑前幾筆有 parent_ref 的紀錄當線索（避免太多）
    const tableKeys = ["shipment","shipment_item","inventory_movement","lot_relation"];
    for(let k = 0; k < tableKeys.length; k++){
      const arr = Array.isArray(b[tableKeys[k]]) ? b[tableKeys[k]] : [];
      for(let i = 0; i < arr.length && hints.length < 8; i++){
        const row = arr[i] || {};
        push_("父子關係", row.parent_ref_type, row.parent_ref_id);
        // 有些紀錄會用 ref_type/ref_id 表示來源（小範圍提示即可）
        if(!String(row.parent_ref_type || "").trim() && !String(row.parent_ref_id || "").trim()){
          push_("來源參考", row.ref_type, row.ref_id);
        }
      }
    }
    // 去重
    const seen = new Set();
    return hints.filter(x => {
      const s = String(x || "").trim();
      if(!s) return false;
      if(seen.has(s)) return false;
      seen.add(s);
      return true;
    }).slice(0, 8);
  }

  function traceHealthCheck_(bundle){
    const b = bundle || {};
    const rows = [];
    function add_(tableKey, idKey, label){
      const arr = asArr_(b[tableKey]);
      if(!arr.length) return;
      let missing = 0;
      const samples = [];
      for(let i = 0; i < arr.length; i++){
        const r = arr[i] || {};
        const pt = String(r.parent_ref_type || "").trim();
        const pid = String(r.parent_ref_id || "").trim();
        const rt = String(r.ref_type || "").trim();
        const rid = String(r.ref_id || "").trim();
        if(pt || pid || rt || rid) continue;
        missing++;
        const id = String(r[idKey] || "").trim();
        if(id && samples.length < 3) samples.push(id);
      }
      if(!missing) return;
      rows.push({
        label: String(label || tableKey),
        missing,
        total: arr.length,
        samples
      });
    }
    add_("shipment", "shipment_id", "出貨單");
    add_("shipment_item", "shipment_item_id", "出貨明細");
    add_("inventory_movement", "movement_id", "庫存異動");
    add_("lot_relation", "relation_id", "批次關聯");
    add_("goods_receipt", "gr_id", "採購收貨");
    add_("goods_receipt_item", "gr_item_id", "採購收貨明細");
    add_("import_receipt", "import_receipt_id", "進口收貨");
    add_("import_receipt_item", "import_receipt_item_id", "進口收貨明細");
    add_("process_order", "process_order_id", "委外加工單");
    add_("process_order_input", "process_input_id", "投料");
    add_("process_order_output", "process_output_id", "回收");
    rows.sort((a,b)=>b.missing - a.missing);
    return rows;
  }

  let out = "";
  out += "交易鏈（transaction_id）\n";
  out += (tx ? ("- transaction_id: " + tx + "\n") : "");
  out += "（整理版：依表分段顯示；可按「顯示原始資料」查看完整欄位）\n";

  const conc = summarizeTxConclusion_(b);
  if(conc){
    out += "\n【結論判讀】\n";
    out += "- " + conc + "\n";
  }

  const hints = collectLinkHints_(b);
  if(hints.length){
    out += "\n【可能的上一段線索】\n";
    for(let i = 0; i < hints.length; i++){
      out += "- " + hints[i] + "\n";
    }
    out += "（提示：可按「延伸上一段」自動往上查）\n";
  }

  // 追溯健康檢查：快速找出「完全沒寫 ref/parent_ref」的資料表（方便治理盤點）
  try{
    const hc = traceHealthCheck_(b);
    if(hc.length){
      out += "\n【追溯健康檢查（ref/parent_ref 缺漏）】\n";
      hc.forEach(function(x){
        const s = x.samples && x.samples.length ? ("；例：" + x.samples.join("、")) : "";
        out += `- ${x.label}：${x.missing}/${x.total} 筆完全未寫 ref/parent_ref${s}\n`;
      });
    }
  }catch(_eHc){}

  for(let s = 0; s < sections.length; s++){
    const title = sections[s][0];
    const key = sections[s][1];
    const keys = sections[s][2];
    const rows = asArr_(b[key]).slice();
    if(!rows.length) continue;
    rows.sort((a,b2) => String(sortKey_(a)).localeCompare(String(sortKey_(b2))));
    out += "\n【" + title + "】(" + rows.length + ")\n";
    for(let i = 0; i < rows.length; i++){
      out += "- " + oneLine_(rows[i], keys) + "\n";
    }
  }

  // 若全都空，提示
  const hasAny = sections.some(s => asArr_(b[s[1]]).length > 0);
  if(!hasAny){
    out += "\n（此 transaction_id 沒查到任何關聯資料）\n";
  }

  const extras = Array.isArray(extraBundles) ? extraBundles : [];
  if(extras.length){
    out += "\n\n============================\n";
    out += "延伸（上一段）\n";
    out += "（通常用於補寄/作廢等情境：這些動作可能會有新的 transaction_id，需要靠參考關係再往上追）\n";
    out += "============================\n";
    for(let i = 0; i < extras.length; i++){
      const ex = extras[i] || {};
      const exTx = String(ex.transaction_id || "").trim();
      out += "\n\n---\n";
      out += "【上一段 第" + String(i + 1) + "層】" + (exTx ? (" transaction_id=" + exTx) : "") + "\n";
      out += formatTraceTxReadable_(ex, null);
    }
  }
  return out;
}

function resetTraceTx(){
  const a = document.getElementById("trace_tx_id");
  const b = document.getElementById("traceTxResult");
  const rawEl = document.getElementById("traceTxRawResult");
  const linksEl = document.getElementById("traceTxLinks");
  traceClear_("trace_tx_id");
  if(b) b.textContent = "";
  if(rawEl) rawEl.textContent = "";
  if(linksEl){ linksEl.style.display = "none"; linksEl.innerHTML = ""; }
}

async function fetchLotRelationsByLot_(lotId, direction){
  const id = upper_(lotId);
  if(!id) return [];
  try{
    const r = await callAPI({ action: "list_lot_relation_by_lot", lot_id: id, direction: direction || "ANY" });
    return (r && r.data) ? r.data : [];
  }catch(_e){
    // fallback：優先用後端 bundle（若有），再最後才全表
    try{
      const r = await callAPI({ action: "trace_lot_bundle", lot_id: id, max_lots: 1 }, { method: "POST" });
      const d = r && r.data ? r.data : null;
      const rels = Array.isArray(d?.relations) ? d.relations : [];
      if(direction === "UP") return rels.filter(x => upper_(x.to_lot_id) === id);
      if(direction === "DOWN") return rels.filter(x => upper_(x.from_lot_id) === id);
      return rels.filter(x => upper_(x.from_lot_id) === id || upper_(x.to_lot_id) === id);
    }catch(_eB){}

    const all = await getAll("lot_relation").catch(() => []);
    if(direction === "UP") return (all || []).filter(x => upper_(x.to_lot_id) === id);
    if(direction === "DOWN") return (all || []).filter(x => upper_(x.from_lot_id) === id);
    return (all || []).filter(x => upper_(x.from_lot_id) === id || upper_(x.to_lot_id) === id);
  }
}

async function fetchShipmentItemsByLot_(lotId){
  const id = upper_(lotId);
  if(!id) return [];
  try{
    const r = await callAPI({ action: "list_shipment_item_by_lot", lot_id: id });
    return (r && r.data) ? r.data : [];
  }catch(_e){
    // fallback：優先用後端 bundle（若有），再最後才全表
    try{
      const r = await callAPI({ action: "trace_lot_bundle", lot_id: id, max_lots: 1 }, { method: "POST" });
      const d = r && r.data ? r.data : null;
      const items = Array.isArray(d?.shipment_items) ? d.shipment_items : [];
      return items.filter(x => upper_(x.lot_id) === id);
    }catch(_eB){}

    const all = await getAll("shipment_item").catch(() => []);
    return (all || []).filter(x => upper_(x.lot_id) === id);
  }
}

async function fetchAvailByLot_(lotId){
  const id = upper_(lotId);
  if(!id) return null;
  function sumRows_(rows){
    const list = Array.isArray(rows) ? rows : [];
    if(!list.length) return null;
    return list.reduce((sum, m) => sum + Number(m.qty || 0), 0);
  }
  try{
    const r = await callAPI({ action: "list_inventory_movement_by_lot", lot_id: id }, { method: "POST" });
    const mv = typeof erpParseArrayDataResponse_ === "function"
      ? erpParseArrayDataResponse_(r)
      : ((r && r.data) ? r.data : []);
    return sumRows_(mv);
  }catch(_e){
    // fallback：舊版後端未支援時，優先用「近 N 天 movements」避免全表下載；
    // 僅在這也失敗時才退回全表。
    try{
      const r = await callAPI(
        { action: "list_inventory_movement_recent", days: 365, _ts: String(Date.now()) },
        { method: "POST" }
      );
      const mvRecent = typeof erpParseArrayDataResponse_ === "function" ? erpParseArrayDataResponse_(r) : [];
      if(Array.isArray(mvRecent)){
        return sumRows_(mvRecent.filter(m => upper_(m.lot_id) === id));
      }
    }catch(_e2){}

    const mv = await getAll("inventory_movement").catch(() => []);
    return sumRows_((mv || []).filter(m => upper_(m.lot_id) === id));
  }
}

async function buildTraceGraph_(rootLotId, maxLots){
  const MAX = Number(maxLots || 150);
  const root = upper_(rootLotId);
  // 優先使用後端 bundle：一次回來 relations / shipment_items / avail map（避免逐 lot 多次 API）
  try{
    const r = await callAPI({ action: "trace_lot_bundle", lot_id: root, max_lots: MAX }, { method: "POST" });
    const d = r && r.data ? r.data : null;
    if(d && (Array.isArray(d.relations) || Array.isArray(d.shipment_items) || typeof d.avail_by_lot_id === "object")){
      return {
        lotsVisitedCount: Array.isArray(d.lots) ? d.lots.length : 0,
        truncated: !!d.truncated,
        relations: Array.isArray(d.relations) ? d.relations : [],
        shipmentItems: Array.isArray(d.shipment_items) ? d.shipment_items : [],
        availByLotId: (d.avail_by_lot_id && typeof d.avail_by_lot_id === "object") ? d.avail_by_lot_id : {}
      };
    }
  }catch(_eBundle){}

  const visited = new Set();
  const queue = [root];
  const rels = [];
  const shipItems = [];
  const availMap = {};

  while(queue.length && visited.size < MAX){
    const cur = queue.shift();
    if(!cur || visited.has(cur)) continue;
    visited.add(cur);

    // 取得上下游 relations
    const [up, down] = await Promise.all([
      fetchLotRelationsByLot_(cur, "UP"),
      fetchLotRelationsByLot_(cur, "DOWN")
    ]);
    const both = ([]).concat(up || [], down || []);
    both.forEach(r => { if(r) rels.push(r); });

    both.forEach(r => {
      const fromId = upper_(r.from_lot_id);
      const toId = upper_(r.to_lot_id);
      if(fromId && !visited.has(fromId)) queue.push(fromId);
      if(toId && !visited.has(toId)) queue.push(toId);
    });

    // 取得本 lot 的出貨明細
    try{
      const si = await fetchShipmentItemsByLot_(cur);
      (si || []).forEach(x => { if(x) shipItems.push(x); });
    }catch(_e2){}

    // 取得本 lot 可用量（movement sum）
    try{
      availMap[cur] = await fetchAvailByLot_(cur);
    }catch(_e3){
      availMap[cur] = null;
    }
  }

  // 去重（避免 up/down 重複）
  const relKey = (r)=>`${upper_(r.relation_id)}|${upper_(r.from_lot_id)}|${upper_(r.to_lot_id)}|${upper_(r.ref_type)}|${upper_(r.ref_id)}|${upper_(r.relation_type)}`;
  const uniqRel = [];
  const relSeen = new Set();
  (rels || []).forEach(r => {
    const k = relKey(r || {});
    if(relSeen.has(k)) return;
    relSeen.add(k);
    uniqRel.push(r);
  });

  const shipKey = (x)=>`${upper_(x.shipment_item_id)}|${upper_(x.shipment_id)}|${upper_(x.lot_id)}|${upper_(x.so_id)}|${upper_(x.so_item_id)}`;
  const uniqShip = [];
  const shipSeen = new Set();
  (shipItems || []).forEach(x => {
    const k = shipKey(x || {});
    if(shipSeen.has(k)) return;
    shipSeen.add(k);
    uniqShip.push(x);
  });

  return {
    lotsVisitedCount: visited.size,
    truncated: visited.size >= MAX && queue.length > 0,
    relations: uniqRel,
    shipmentItems: uniqShip,
    availByLotId: availMap
  };
}

async function traceInit(){
  await loadTraceCaches();
  // UX：輸入變更時先清空舊結果，避免殘留誤判
  try{
    const lotEl = document.getElementById("trace_lot_id");
    if(lotEl && !lotEl.dataset.uxBound){
      lotEl.dataset.uxBound = "1";
      lotEl.addEventListener("input", function(){
        const sum = document.getElementById("traceSummary");
        const up = document.getElementById("traceUp");
        const down = document.getElementById("traceDown");
        if(sum) sum.textContent = "";
        if(up) up.textContent = "";
        if(down) down.textContent = "";
      });
    }
  }catch(_eLot){}
  try{
    const txEl = document.getElementById("trace_tx_id");
    if(txEl && !txEl.dataset.uxBound){
      txEl.dataset.uxBound = "1";
      txEl.addEventListener("input", function(){
        const out = document.getElementById("traceTxResult");
        if(out) out.textContent = "";
      });
      // UX：貼上 TX 後自動查詢（避免再按按鈕）
      txEl.addEventListener("paste", function(){
        setTimeout(function(){
          try{
            const v = upper_(txEl.value || "");
            if(v) txEl.value = v;
            if(/^TX[-_]/i.test(v) && typeof runTraceTx === "function"){
              runTraceTx().catch(function(){});
            }
          }catch(_e){}
        }, 0);
      });
    }
  }catch(_eTx){}

  // UX：切換「向下追（流向）」篩選時，立即重算輸出（否則看起來像沒作用）
  try{
    const sel = document.getElementById("trace_down_ship_filter");
    if(sel && !sel.dataset.bound){
      sel.dataset.bound = "1";
      sel.addEventListener("change", function(){
        traceRefreshDown_().catch(function(){});
      });
    }
  }catch(_eFilter){}

  const pending = window.__pendingTraceLotId;
  if(pending && typeof pending === "string") {
    delete window.__pendingTraceLotId;
    const input = document.getElementById("trace_lot_id");
    if(input){ input.value = pending; await runTrace(); }
  }
}

async function traceRefreshDown_(){
  const lotId = upper_(document.getElementById("trace_lot_id")?.value || "");
  const downEl = document.getElementById("traceDown");
  if(!lotId || !downEl) return;
  // 若此 Lot 尚未查詢成功，直接略過
  if(typeof getLot === "function" && !getLot(lotId)) return;

  // 若使用者要篩選（非 ALL），確保出貨單狀態有載入；否則篩選會看起來失效或不準
  const shipFilter = (function(){
    try{
      const sel = document.getElementById("trace_down_ship_filter");
      return String(sel && sel.value || "ALL").trim().toUpperCase() || "ALL";
    }catch(_e){
      return "ALL";
    }
  })();
  if(shipFilter !== "ALL"){
    try{
      const ids = Array.from(new Set(
        (traceShipmentItems || [])
          .filter(si => upper_(si && si.lot_id) === lotId)
          .map(si => upper_(si && si.shipment_id))
          .filter(Boolean)
      )).slice(0, 30);
      const have = new Set((traceShipments || []).map(s => upper_(s && s.shipment_id)).filter(Boolean));
      const miss = ids.filter(id => !have.has(id));
      if(miss.length){
        const rows = await Promise.all(miss.map(function(id){
          return getOne("shipment", "shipment_id", id).catch(function(){ return null; });
        }));
        rows.forEach(function(r){
          if(r && r.shipment_id){
            traceShipments.push(r);
          }
        });
      }
    }catch(_eFetch){}
  }

  downEl.textContent = traceDown(lotId, 0, new Set());
}

async function loadTraceCaches(){
  // 追溯畫面很容易被「全表 movements / relations / shipment_item」拖慢。
  // 這裡採分段載入：先載入主檔，等使用者輸入 lot 再按需抓明細（runTrace 補齊）。
  function can_(k){
    try{
      return (typeof erpIsModuleAllowed_ === "function") ? !!erpIsModuleAllowed_(k) : true;
    }catch(_e){
      return true;
    }
  }

  // 注意：Trace 預設開放，但部分帳號可能沒有庫存/進貨/加工/出貨模組權限。
  // 這裡務必「不丟例外」，否則整個模組會被 router 視為載入失敗。
  const [lots, shipments, importDocs, goodsReceipts, processOrders, customers] = await Promise.all([
    (can_("lots") ? getAll("lot").catch(() => []) : Promise.resolve([])),
    (can_("shipping")
      ? (async ()=>{
          try{
            const r = await callAPI({ action: "list_shipment_recent", days: 365, _ts: String(Date.now()) }, { method: "POST" });
            return (r && r.data) ? r.data : [];
          }catch(_e){
            return await getAll("shipment").catch(() => []);
          }
        })()
      : Promise.resolve([])),
    (can_("import") ? getAll("import_document").catch(() => []) : Promise.resolve([])),
    (can_("receive") ? getAll("goods_receipt").catch(() => []) : Promise.resolve([])),
    (can_("outsource") ? getAll("process_order").catch(() => []) : Promise.resolve([])),
    getAll("customer").catch(() => [])
  ]);
  traceLots = lots || [];
  traceShipments = shipments || [];
  traceImportDocs = importDocs || [];
  traceGoodsReceipts = goodsReceipts || [];
  traceProcessOrders = processOrders || [];
  traceCustomers = customers || [];
  traceCustomerNameById_ = {};
  (traceCustomers || []).forEach(function(c){
    const id = String(c && c.customer_id || "").trim().toUpperCase();
    const name = String(c && c.customer_name || "").trim();
    if(id) traceCustomerNameById_[id] = name || id;
  });
  traceRelations = [];
  traceMovements = [];
  traceShipmentItems = [];
}

function traceCustomerZh_(customerId){
  const id = String(customerId || "").trim().toUpperCase();
  if(!id) return "";
  return traceCustomerNameById_[id] || id;
}

function traceStatusZh_(code){
  const c = String(code || "").trim().toUpperCase();
  if(!c) return "";
  try{
    if(typeof termLabelZhOnly === "function") return termLabelZhOnly(c);
  }catch(_e){}
  try{
    if(typeof termLabel === "function") return termLabel(c);
  }catch(_e2){}
  return c;
}

function traceFormatAvail_(available){
  if(typeof invFormatAvailableText_ === "function") return invFormatAvailableText_(available);
  if(available === null || available === undefined) return "--";
  return String(available);
}

function traceGetAvailable(lotId){
  const id = upper_(lotId);
  if(!id) return null;
  if(traceAvailByLotId && typeof traceAvailByLotId === "object"){
    if(Object.prototype.hasOwnProperty.call(traceAvailByLotId, id)){
      const v = traceAvailByLotId[id];
      return (v === null || v === undefined) ? null : Number(v || 0);
    }
    if(Object.keys(traceAvailByLotId).length > 0) return null;
  }
  const rows = (traceMovements || []).filter(m => upper_(m.lot_id) === id);
  if(!rows.length) return null;
  return rows.reduce((sum, m) => sum + Number(m.qty || 0), 0);
}

function getLot(lotId){
  return traceLots.find(l => l.lot_id === lotId);
}

function fmtLotLine(lotId, depth){
  const lot = getLot(lotId);
  const indent = "  ".repeat(depth);
  if(!lot) return `${indent}- Lot: ${lotId} (找不到)\n`;

  const av = traceGetAvailable(lotId);
  const qa = lot.status || "PENDING";
  const inv = lot.inventory_status || "ACTIVE";
  const src = `${lot.source_type || ""}:${lot.source_id || ""}`;
  return `${indent}- Lot: ${lot.lot_id} | Product:${lot.product_id} | Type:${lot.type} | QA:${qa} | Inv:${inv} | Avail:${traceFormatAvail_(av)} | Src:${src}\n`;
}

function traceUp(lotId, depth, visited){
  const id = upper_(lotId);
  if(visited.has(id)) return "  ".repeat(depth) + `- (循環偵測) ${id}\n`;
  visited.add(id);

  let out = fmtLotLine(id, depth);

  // relations: parents are from_lot_id when to_lot_id == current
  const parents = traceRelations.filter(r => upper_(r.to_lot_id) === id);
  parents.forEach(r => {
    out += "  ".repeat(depth+1) + `↳ relation:${r.relation_type} qty:${r.qty || ""} unit:${r.unit || ""} ref:${r.ref_type || ""}:${r.ref_id || ""}\n`;
    out += traceUp(r.from_lot_id, depth+2, visited);
  });

  // also show source docs (import/receipt/process)
  const lot = getLot(lotId);
  if(lot){
    if(lot.source_type === "IMPORT"){
      const doc = traceImportDocs.find(d => d.import_doc_id === lot.source_id) || null;
      if(doc){
        const indent = "  ".repeat(depth+1);
        const docId = upper_(doc.import_doc_id || lot.source_id || "");
        const no = String(doc.import_no || "").trim();
        const rel = dateInputValue_(doc.release_date);
        const sup = upper_(doc.supplier_id || "");
        const stZh = traceStatusZh_(doc.status);
        const tx = upper_(doc.transaction_id || "");
        out +=
          indent +
          "↳ 進口報單 " + (docId || "") +
          (no ? (" | 報單號 " + no) : "") +
          (sup ? (" | 供應商 " + sup) : "") +
          (rel ? (" | 放行日 " + rel) : "") +
          (stZh ? (" | 狀態 " + stZh) : "") +
          (tx ? (" | 交易 " + tx) : "") +
          "\n";
      }else{
        out += "  ".repeat(depth+1) + "↳ 進口來源 " + String(lot.source_id || "") + "\n";
      }
    }
    if(lot.source_type === "PURCHASE"){
      const gr = traceGoodsReceipts.find(g => g.gr_id === lot.source_id) || null;
      if(gr){
        const indent = "  ".repeat(depth+1);
        const grId = upper_(gr.gr_id || lot.source_id || "");
        const poId = upper_(gr.po_id || "");
        const dt = dateInputValue_(gr.receipt_date);
        const stZh = traceStatusZh_(gr.status);
        const tx = upper_(gr.transaction_id || "");
        out +=
          indent +
          "↳ 收貨入庫 " + (grId || "") +
          (poId ? (" | 採購單 " + poId) : "") +
          (dt ? (" | 日期 " + dt) : "") +
          (stZh ? (" | 狀態 " + stZh) : "") +
          (tx ? (" | 交易 " + tx) : "") +
          "\n";
      }else{
        out += "  ".repeat(depth+1) + "↳ 採購來源 " + String(lot.source_id || "") + "\n";
      }
    }
    if(lot.source_type === "PROCESS"){
      const po = traceProcessOrders.find(p => p.process_order_id === lot.source_id) || null;
      if(po){
        const indent = "  ".repeat(depth+1);
        const pid = upper_(po.process_order_id || lot.source_id || "");
        const tp = upper_(po.process_type || "");
        const sup = upper_(po.supplier_id || "");
        const plan = dateInputValue_(po.planned_date);
        const stZh = traceStatusZh_(po.status);
        const tx = upper_(po.transaction_id || "");
        out +=
          indent +
          "↳ 委外加工 " + (pid || "") +
          (tp ? (" | 類型 " + tp) : "") +
          (sup ? (" | 加工廠 " + sup) : "") +
          (plan ? (" | 預計 " + plan) : "") +
          (stZh ? (" | 狀態 " + stZh) : "") +
          (tx ? (" | 交易 " + tx) : "") +
          "\n";
      }else{
        out += "  ".repeat(depth+1) + "↳ 委外來源 " + String(lot.source_id || "") + "\n";
      }
    }
  }

  return out;
}

function traceDown(lotId, depth, visited){
  const id = upper_(lotId);
  if(visited.has(id)) return "  ".repeat(depth) + `- (循環偵測) ${id}\n`;
  visited.add(id);

  let out = fmtLotLine(id, depth);

  // downstream lots by relation
  const children = traceRelations.filter(r => upper_(r.from_lot_id) === id);
  children.forEach(r => {
    out += "  ".repeat(depth+1) + `↳ relation:${r.relation_type} qty:${r.qty || ""} unit:${r.unit || ""} ref:${r.ref_type || ""}:${r.ref_id || ""}\n`;
    out += traceDown(r.to_lot_id, depth+2, visited);
  });

  // shipment flow
  const ships = traceShipmentItems.filter(si => upper_(si.lot_id) === id);
  // 以 shipment_id 分組（同一張出貨可能拆多行）
  const byShip = {};
  ships.forEach(function(si){
    const sid = upper_(si && si.shipment_id);
    if(!sid) return;
    if(!byShip[sid]) byShip[sid] = [];
    byShip[sid].push(si);
  });
  const shipFilter = (function(){
    try{
      const sel = document.getElementById("trace_down_ship_filter");
      return String(sel && sel.value || "ALL").trim().toUpperCase() || "ALL";
    }catch(_e){
      return "ALL";
    }
  })();

  Object.keys(byShip).sort().forEach(function(sid){
    const items = byShip[sid] || [];
    const sh = traceShipments.find(s => upper_(s && s.shipment_id) === sid) || null;
    const soId = upper_((sh && sh.so_id) || (items[0] && items[0].so_id) || "");
    const custId = upper_((sh && sh.customer_id) || "");
    const custZh = traceCustomerZh_(custId);
    const date = dateInputValue_(sh && sh.ship_date);
    const stRaw = String(sh && sh.status || "").trim().toUpperCase();
    const stZh =
      stRaw === "POSTED" ? "已出貨" :
      stRaw === "CANCELLED" ? "已作廢" :
      traceStatusZh_(sh && sh.status);
    if(shipFilter === "POSTED" && stRaw !== "POSTED") return;
    if(shipFilter === "CANCELLED" && stRaw !== "CANCELLED") return;
    const qtySum = items.reduce(function(sum, it){ return sum + Number(it && it.ship_qty || 0); }, 0);
    const unit = String(items[0] && items[0].unit || "").trim();
    const tx = String((sh && sh.transaction_id) || (items[0] && items[0].transaction_id) || "").trim().toUpperCase();
    const indent = "  ".repeat(depth+1);
    out +=
      indent +
      "↳ 出貨單 " + sid +
      (soId ? (" | 銷售單 " + soId) : "") +
      (custZh ? (" | 客戶 " + custZh) : (custId ? (" | 客戶 " + custId) : "")) +
      (date ? (" | 日期 " + date) : "") +
      (stZh ? (" | 狀態 " + stZh) : "") +
      (" | 數量 " + qtySum + (unit ? (" " + unit) : "")) +
      (tx ? (" | 交易 " + tx) : "") +
      "\n";
  });

  return out;
}

async function runTrace(){
  const lotId = (document.getElementById("trace_lot_id")?.value || "").trim().toUpperCase();
  if(!lotId) return showToast("請輸入 Lot ID","error");

  if(traceLotInFlight_){
    traceLotPending_ = true;
    const hint = document.getElementById("traceRunHint");
    if(hint){ hint.style.display = "inline-block"; hint.textContent = "查詢中…（已排隊）"; }
    return;
  }
  traceLotInFlight_ = true;

  const runBtn = document.getElementById("trace_run_btn");
  const hint = document.getElementById("traceRunHint");
  const resetBtn = (function(){
    const btns = Array.from(document.querySelectorAll(".search-toolbar button"));
    return btns.find(b => (b && b.textContent || "").includes("重設")) || null;
  })();
  const logBtn = (function(){
    const btns = Array.from(document.querySelectorAll(".search-toolbar button"));
    return btns.find(b => (b && b.textContent || "").trim() === "Log") || null;
  })();

  if(runBtn) runBtn.disabled = true;
  if(resetBtn) resetBtn.disabled = true;
  if(logBtn) logBtn.disabled = true;
  if(hint){ hint.style.display = "inline-block"; hint.textContent = "查詢中…"; }

  const summaryEl = document.getElementById("traceSummary");
  const upEl = document.getElementById("traceUp");
  const downEl = document.getElementById("traceDown");
  const linksEl = document.getElementById("traceLotTxLinks");
  if(summaryEl) summaryEl.textContent = "查詢中…";
  if(upEl) upEl.textContent = "";
  if(downEl) downEl.textContent = "";
  if(linksEl){ linksEl.style.display = "none"; linksEl.innerHTML = ""; }

  try{
    await loadTraceCaches();
    // 逐層按需載入：relations/shipments/movements 都以 lot 為單位查詢，避免全表下載
    try{
      const g = await buildTraceGraph_(lotId, 150);
      traceRelations = g.relations || [];
      traceShipmentItems = g.shipmentItems || [];
      traceAvailByLotId = g.availByLotId || {};
      traceMovements = []; // 不再依賴全表 movements
      if(g.truncated){
        showToast("追溯範圍過大，已限制最多 150 個 Lot（可再優化成後端一次查詢）。","error");
      }
    }catch(_e0){
      // fallback：不要直接全表下載；只取此 lot 的必要資料
      try{
        const [up, down, ships, av] = await Promise.all([
          fetchLotRelationsByLot_(lotId, "UP").catch(() => []),
          fetchLotRelationsByLot_(lotId, "DOWN").catch(() => []),
          fetchShipmentItemsByLot_(lotId).catch(() => []),
          fetchAvailByLot_(lotId).catch(() => null)
        ]);
        traceRelations = ([]).concat(up || [], down || []);
        traceShipmentItems = ships || [];
        const lid = String(lotId || "").trim().toUpperCase();
        traceAvailByLotId = {};
        if(lid) traceAvailByLotId[lid] = (av === null || av === undefined) ? null : Number(av || 0);
        traceMovements = [];
      }catch(_e1){
        // 最後最後才全表（極端情況）
        try{ traceRelations = await getAll("lot_relation").catch(() => []); }catch(_e2){ traceRelations = []; }
        try{ traceShipmentItems = await getAll("shipment_item").catch(() => []); }catch(_e3){ traceShipmentItems = []; }
        try{ traceMovements = await getAll("inventory_movement").catch(() => []); }catch(_e4){ traceMovements = []; }
        traceAvailByLotId = {};
      }
    }
  } finally {
    if(runBtn) runBtn.disabled = false;
    if(resetBtn) resetBtn.disabled = false;
    if(logBtn) logBtn.disabled = false;
    if(hint) hint.style.display = "none";
    traceLotInFlight_ = false;
    if(traceLotPending_){
      traceLotPending_ = false;
      setTimeout(function(){ try{ runTrace().catch(()=>{}); }catch(_e){} }, 0);
    }
  }

  const lot = getLot(lotId);

  if(!lot){
    if(summaryEl) summaryEl.textContent = "找不到批次";
    if(upEl) upEl.textContent = "";
    if(downEl) downEl.textContent = "";
    return;
  }

  const av = traceGetAvailable(lotId);
  if(summaryEl){
    summaryEl.textContent =
      `Lot: ${lot.lot_id}\n` +
      `Product: ${lot.product_id}\n` +
      `Type: ${lot.type}\n` +
      `品檢：${typeof termLabelZhOnly === "function" ? termLabelZhOnly(lot.status || "PENDING") : termLabel(lot.status || "PENDING")}\n` +
      `庫存：${typeof termLabelZhOnly === "function" ? termLabelZhOnly(lot.inventory_status || "ACTIVE") : termLabel(lot.inventory_status || "ACTIVE")}\n` +
      `Available: ${av}\n` +
      `Source: ${(lot.source_type||"")} ${(lot.source_id||"")}\n`;
  }

  if(upEl) upEl.textContent = traceUp(lotId, 0, new Set());
  if(downEl){
    // 統一由 refresh（可按需要補抓 shipment 狀態以支援篩選）
    await traceRefreshDown_();
  }
  try{ await renderTraceLotTxLinks_(lotId); }catch(_eLinks){}
}

function traceLotTxLoad_(txId){
  const tx = String(txId || "").trim().toUpperCase();
  if(!tx) return;
  traceSetV_("trace_tx_id", tx);
  runTraceTx().catch(()=>{});
}

async function renderTraceLotTxLinks_(rootLotId){
  const linksEl = document.getElementById("traceLotTxLinks");
  if(!linksEl) return;
  const root = upper_(rootLotId);
  if(!root){
    linksEl.style.display = "none";
    linksEl.innerHTML = "";
    return;
  }

  const txs = [];
  const txMeta = {}; // { [tx]: { tags:Set<string>, soIds:Set<string>, shipIds:Set<string> } }
  function pushTx_(t){
    const s = String(t || "").trim().toUpperCase();
    if(s) txs.push(s);
  }
  function ensureTx_(t){
    const tx = String(t || "").trim().toUpperCase();
    if(!tx) return null;
    const m = txMeta[tx];
    if(m) return m;
    txMeta[tx] = { tags: new Set(), soIds: new Set(), shipIds: new Set() };
    return txMeta[tx];
  }
  function addTag_(tx, tag){
    const m = ensureTx_(tx);
    const s = String(tag || "").trim();
    if(m && s) m.tags.add(s);
  }
  function addSo_(tx, soId){
    const m = ensureTx_(tx);
    const s = String(soId || "").trim().toUpperCase();
    if(m && s) m.soIds.add(s);
  }
  function addShip_(tx, shipId){
    const m = ensureTx_(tx);
    const s = String(shipId || "").trim().toUpperCase();
    if(m && s) m.shipIds.add(s);
  }

  // shipment_item
  (traceShipmentItems || []).forEach(function(si){
    if(upper_(si && si.lot_id) !== root) return;
    pushTx_(si.transaction_id);
    addTag_(si.transaction_id, "出貨");
    addSo_(si.transaction_id, si.so_id);
    addShip_(si.transaction_id, si.shipment_id);
  });
  // inventory_movement（可能是 fallback 未載入）
  (traceMovements || []).forEach(function(m){
    if(upper_(m && m.lot_id) !== root) return;
    pushTx_(m.transaction_id);
    const mt = String(m && m.movement_type || "").trim().toUpperCase();
    const rt = String(m && m.ref_type || "").trim().toUpperCase();
    if(rt === "SHIPMENT_CANCEL") addTag_(m.transaction_id, "作廢回沖");
    else if(mt === "TRANSFER") addTag_(m.transaction_id, "轉倉");
    else if(mt === "ADJUST") addTag_(m.transaction_id, "調整");
    else if(mt === "IN") addTag_(m.transaction_id, "入庫");
    else if(mt) addTag_(m.transaction_id, mt);
    // 有些 movement 的 parent/ref 會指向單據
    const pType = String(m && m.parent_ref_type || "").trim().toUpperCase();
    const pId = String(m && m.parent_ref_id || "").trim().toUpperCase();
    if(pType === "SHIPMENT") addShip_(m.transaction_id, pId);
    if(pType === "SO") addSo_(m.transaction_id, pId);
  });
  // lot_relation
  (traceRelations || []).forEach(function(r){
    const fromOk = upper_(r && r.from_lot_id) === root;
    const toOk = upper_(r && r.to_lot_id) === root;
    if(!fromOk && !toOk) return;
    pushTx_(r.transaction_id);
    addTag_(r.transaction_id, "批次關聯/加工");
  });

  const uniq = Array.from(new Set(txs)).slice(0, 12);
  if(!uniq.length){
    linksEl.style.display = "none";
    linksEl.innerHTML = "";
    return;
  }

  // 若含出貨：補上銷售用途（so_type）中文（NORMAL/RESHIP/…）
  const soTypeZhMap = {
    NORMAL: "正常訂單",
    SAMPLE: "樣品",
    GIFT: "贈品",
    PR: "公關",
    RESHIP: "補寄",
    OTHER: "其他"
  };
  const soTypeZhBySoId = {};
  try{
    const needSoIds = new Set();
    uniq.forEach(function(tx){
      const meta = txMeta[tx];
      if(!meta) return;
      if(!meta.tags || !meta.tags.has("出貨")) return;
      (meta.soIds ? Array.from(meta.soIds) : []).forEach(function(soId){
        if(soId) needSoIds.add(String(soId).trim().toUpperCase());
      });
    });
    const ids = Array.from(needSoIds).slice(0, 20);
    if(ids.length){
      const rows = await Promise.all(ids.map(function(id){
        return getOne("sales_order", "so_id", id).catch(function(){ return null; });
      }));
      rows.forEach(function(row, idx){
        const soId = ids[idx];
        const t = String(row && row.so_type || "").trim().toUpperCase();
        soTypeZhBySoId[soId] = t ? (soTypeZhMap[t] || t) : "";
      });
    }
  }catch(_eSoType){}

  linksEl.style.display = "block";
  linksEl.innerHTML = "";

  const title = document.createElement("div");
  title.style.fontSize = "12px";
  title.style.fontWeight = "700";
  title.style.color = "#334155";
  title.style.marginBottom = "6px";
  title.textContent = "此 Lot 相關交易（點一下看交易鏈）";
  linksEl.appendChild(title);

  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexWrap = "wrap";
  wrap.style.gap = "6px";
  linksEl.appendChild(wrap);

  uniq.forEach(function(tx){
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-secondary";
    const meta = txMeta[tx] || null;
    const tags = meta ? Array.from(meta.tags) : [];
    let label = "";
    if(tags.length){
      // 出貨：加上銷售用途（若取得到）
      if(tags.includes("出貨") && meta && meta.soIds && meta.soIds.size){
        const soIds = Array.from(meta.soIds).map(x => String(x||"").trim().toUpperCase()).filter(Boolean);
        const types = Array.from(new Set(soIds.map(id => soTypeZhBySoId[id]).filter(Boolean)));
        const typeLabel = types.length === 1 ? types[0] : (types.length > 1 ? "多用途" : "");
        const main = typeLabel ? ("出貨/" + typeLabel) : "出貨/銷售用途";
        const other = tags.filter(t => t !== "出貨");
        const parts = [main].concat(other).filter(Boolean);
        label = "（" + parts.slice(0, 2).join("、") + (parts.length > 2 ? "…" : "") + "）";
      }else{
        label = "（" + tags.slice(0, 2).join("、") + (tags.length > 2 ? "…" : "") + "）";
      }
    }
    btn.textContent = tx + label;
    btn.title = "點一下查詢這個 transaction_id";
    btn.onclick = function(){ traceLotTxLoad_(tx); };
    wrap.appendChild(btn);
  });
}

function resetTrace(){
  const a = document.getElementById("trace_lot_id");
  traceClear_("trace_lot_id");
  const b = document.getElementById("traceSummary");
  const c = document.getElementById("traceUp");
  const d = document.getElementById("traceDown");
  const linksEl = document.getElementById("traceLotTxLinks");
  if(b) b.textContent = "";
  if(c) c.textContent = "";
  if(d) d.textContent = "";
  if(linksEl){ linksEl.style.display = "none"; linksEl.innerHTML = ""; }
}