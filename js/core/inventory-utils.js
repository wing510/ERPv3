/**
 * Inventory Utils（共用：可用量 / 效期 / 到期天數）
 * - 只處理純計算（不直接讀 DOM）
 */

function invParseYMD_(s){
  const m = String(s || "").trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if(!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if(!y || isNaN(mo) || !d) return null;
  return { y, mo, d };
}

/**
 * 回傳 expiry 狀態
 * - days：以「今天」為基準，距離到期日末（23:59:59）剩餘天數（ceil）
 */
function invExpiryInfo_(expiryDateStr){
  const raw = String(expiryDateStr || "").trim();
  if(!raw) return { has:false, expired:false, days:null, ymd:null, expiryEnd:null };
  const ymd = invParseYMD_(raw);
  const now = new Date();
  let expiryEnd = null;
  if(ymd){
    expiryEnd = new Date(ymd.y, ymd.mo, ymd.d, 23, 59, 59, 999);
  }else{
    const d = new Date(raw);
    if(!isNaN(d.getTime())) expiryEnd = d;
  }
  if(!expiryEnd) return { has:true, expired:false, days:null, ymd:null, expiryEnd:null };
  const ms = expiryEnd.getTime() - now.getTime();
  const days = Math.ceil(ms / (24*3600*1000));
  const expired = ms < 0;
  return { has:true, expired, days, ymd, expiryEnd };
}

function invIsExpired_(expiryDateStr){
  return !!invExpiryInfo_(expiryDateStr).expired;
}

function invNormalizeId_(s){
  return String(s || "").trim().toUpperCase();
}

/**
 * 計算某 lot 的可用量：movement.qty 加總；若該 lot 沒任何 movement，fallback 使用 lot.qty
 * @param {string} lotId
 * @param {Array<object>} lots
 * @param {Array<object>} movements
 */
function invAvailableByLotId_(lotId, lots, movements){
  const lid = invNormalizeId_(lotId);
  if(!lid) return 0;
  const rows = (movements || []).filter(m => invNormalizeId_(m.lot_id) === lid);
  if(!rows.length){
    const lot = (lots || []).find(l => invNormalizeId_(l.lot_id) === lid);
    return Number(lot?.qty || 0);
  }
  return rows.reduce((sum, m) => sum + Number(m.qty || 0), 0);
}

/**
 * 建立 lot_id -> available 的 map（只依 movements 加總；無 movements 的 lot 會以 lot.qty）
 */
function invBuildAvailableMap_(lots, movements){
  const map = {};
  (lots || []).forEach(l => {
    const id = String(l?.lot_id || "");
    if(!id) return;
    map[id] = invAvailableByLotId_(id, lots, movements);
  });
  return map;
}

