/**
 * Inventory Data Loader（共用：lots/products/warehouses/movements）
 * - 統一讀取策略與錯誤旗標（movements 失敗 => movementLoadFailed=true）
 */

async function loadInventoryMovementAvailableMap_(){
  // 盡量不要整張 inventory_movement 全量下載（非常慢）
  // 優先使用後端彙總 API；若後端尚未部署，回退為前端自行彙總（可能很慢）
  try{
    // 用 POST + cache bust，避免 GET 被快取導致轉倉後仍拿到舊 map
    const result = await callAPI(
      { action: "list_inventory_movement_available_by_lot", _ts: String(Date.now()) },
      { method: "POST" }
    );
    // 後端可能回：{ data: map } 或直接把 map 展開在頂層（success:true, LOT-xxx: n, ...）
    let map = result?.data;
    if(map && typeof map === "object" && !Array.isArray(map)) {
      return { map: map || {}, failed: false };
    }
    // 若沒有 data，就嘗試從頂層抽出（排除 success/errors）
    const top = (result && typeof result === "object") ? result : {};
    const peeled = {};
    Object.keys(top).forEach(function(k){
      if(k === "success" || k === "errors") return;
      peeled[k] = top[k];
    });
    map = peeled;
    return { map: map || {}, failed: false };
  }catch(_e){
    try{
      // fallback 也用 POST 直打（避免 getAll 仍可能命中快取）
      const result = await callAPI(
        { action: "list_inventory_movement", _ts: String(Date.now()) },
        { method: "POST" }
      ).catch(() => null);
      const movements =
        Array.isArray(result?.data) ? result.data :
        Array.isArray(result?.data?.data) ? result.data.data :
        null;
      if(!Array.isArray(movements)) return { map: {}, failed: true };
      const map = {};
      movements.forEach(m=>{
        const lotId = String(m?.lot_id || "");
        if(!lotId) return;
        const q = Number(m.qty || 0);
        if(Number.isNaN(q)) return;
        map[lotId] = (map[lotId] || 0) + q;
      });
      return { map, failed: false };
    }catch(_e2){
      return { map: {}, failed: true };
    }
  }
}

async function loadInventoryCoreData_(options = {}){
  const needWarehouses = options?.needWarehouses !== false;
  const needMovementDetails = options?.needMovementDetails === true;
  const movementDays = Number(options?.movementDays || 90);

  const pWarehouses = needWarehouses ? getAll("warehouse").catch(() => null) : Promise.resolve(null);
  const pMovementAvailable = loadInventoryMovementAvailableMap_();
  const pMovements = needMovementDetails
    ? (async ()=>{
      // 需要明細時也避免全表 inventory_movement：優先取近 N 天
      try{
        const r = await callAPI(
          { action: "list_inventory_movement_recent", days: isNaN(movementDays) ? 90 : movementDays, _ts: String(Date.now()) },
          { method: "POST" }
        );
        const rows = typeof erpParseArrayDataResponse_ === "function" ? erpParseArrayDataResponse_(r) : [];
        return Array.isArray(rows) ? rows : [];
      }catch(_e){
        return await getAll("inventory_movement").catch(() => null);
      }
    })()
    : Promise.resolve([]);

  const [lots, products, movements, warehouses, avail] = await Promise.all([
    getAll("lot").catch(() => []),
    getAll("product").catch(() => []),
    pMovements,
    pWarehouses,
    pMovementAvailable
  ]);

  const movementLoadFailed = !!avail?.failed;

  return {
    lots: lots || [],
    products: products || [],
    warehouses: Array.isArray(warehouses) ? warehouses : [],
    movements: Array.isArray(movements) ? movements : [],
    movementAvailableByLotId: avail?.map || {},
    movementLoadFailed,
    loaded_at: Date.now()
  };
}

