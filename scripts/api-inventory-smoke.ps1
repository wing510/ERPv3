# DEV API：庫存 movement 語意（缺 movement / 彙總 API / 出庫阻擋）
param(
  [string]$ApiBase = "https://script.google.com/macros/s/AKfycbytLafLy8PRVmGx3IVRCQ7j1WKj2Go4eRSevTCECDYR4IgukvLkDMQS5rZ61ex9HUTa/exec",
  [string]$ConfigPath = "$PSScriptRoot\..\docs\erp-smoke-config.json"
)

$ErrorActionPreference = "Stop"
function Write-Ok($m){ Write-Host "[OK]  $m" -ForegroundColor Green }
function Write-Fail($m){ Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }

function Invoke-ErpApi {
  param([hashtable]$Form)
  $r = Invoke-RestMethod -Method Post -Uri $ApiBase -Body $Form -ContentType "application/x-www-form-urlencoded"
  if ($r -is [string]) { $r = $r | ConvertFrom-Json }
  return $r
}

function Assert-Ok($r, $label) {
  if (-not $r.success) {
    Write-Fail ("$label : " + ($r.errors -join "; "))
  }
}

$cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$userId = [string]$cfg.login.userId
$password = [string]$cfg.login.password
$today = Get-Date -Format "yyyy-MM-dd"
$now = Get-Date -Format "yyyy-MM-dd HH:mm"

Write-Host "API inventory smoke"
Write-Host "API: $ApiBase"
Write-Host ""

$login = Invoke-ErpApi @{ action = "login"; user_id = $userId; password = $password }
Assert-Ok $login "login"
$tok = [string]$login.session_token
$actor = [string]$login.user_id
Write-Ok "login env=$($login.env) actor=$actor"

$tag = "SMK-INV-" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

# 1) 彙總 API 形狀
$avail = Invoke-ErpApi @{
  action = "list_inventory_movement_available_by_lot"
  session_token = $tok
  _ts = [string][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}
Assert-Ok $avail "list_inventory_movement_available_by_lot"
if ($null -eq $avail.data) { Write-Fail "list_inventory_movement_available_by_lot: missing data map" }
if ($null -eq $avail.missing_movement_count) { Write-Fail "list_inventory_movement_available_by_lot: missing missing_movement_count" }
Write-Ok ("available lots in map: " + (@($avail.data.PSObject.Properties).Count) + ", missing_movement_count=" + $avail.missing_movement_count)

$miss = Invoke-ErpApi @{
  action = "list_lots_missing_movement"
  session_token = $tok
  limit = "5"
}
Assert-Ok $miss "list_lots_missing_movement"
Write-Ok ("list_lots_missing_movement count=" + $miss.count)

# 2) 建立無 movement 的 lot，驗證不在 map、轉倉應失敗
$seed = Invoke-ErpApi @{
  action = "dev_seed_smoke_fixtures"
  session_token = $tok
  created_by = $actor
  tag = $tag
}
Assert-Ok $seed "seed"
$fx = $seed.fixtures
if (-not $fx) { $fx = $seed.data.fixtures }
$productId = [string]$fx.productId
$wh = [string]$fx.warehouseId
if (-not $wh) { $wh = "MAIN" }

$lotNoMv = "LOT-NOMV-$tag"
$cl = Invoke-ErpApi @{
  action = "create_lot"
  session_token = $tok
  created_by = $actor
  lot_id = $lotNoMv
  product_id = $productId
  warehouse_id = $wh
  source_type = "ADJUST"
  source_id = "SMOKE-NOMV-$tag"
  qty = "99"
  unit = "KG"
  status = "APPROVED"
  inventory_status = "ACTIVE"
  received_date = $today
  created_at = $now
}
Assert-Ok $cl "create_lot (no movement yet)"
Write-Ok "created lot $lotNoMv (qty=99 on sheet, no movement)"

$avail2 = Invoke-ErpApi @{
  action = "list_inventory_movement_available_by_lot"
  session_token = $tok
  _ts = [string][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}
Assert-Ok $avail2 "avail refresh"
if ($avail2.data.PSObject.Properties.Name -contains $lotNoMv) {
  Write-Fail "lot without movement should not appear in available map: $lotNoMv"
}
Write-Ok "lot $lotNoMv not in available map (missing movement)"

$xfer = Invoke-ErpApi @{
  action = "post_transfer_bundle"
  session_token = $tok
  created_by = $actor
  from_lot_id = $lotNoMv
  to_warehouse_id = "WH-B"
  qty = "1"
  remark = "[SMOKE] should fail no movement"
  idempotency_key = "xfer-nomv-$tag"
}
if ($xfer.success) {
  Write-Fail "post_transfer_bundle should fail for lot without movement"
}
$err = ($xfer.errors -join " ").ToLower()
if ($err -notmatch "no inventory movement") {
  Write-Fail ("post_transfer_bundle expected 'no inventory movement', got: " + ($xfer.errors -join "; "))
}
Write-Ok "post_transfer_bundle blocked: no inventory movement"

# 3) 重建 lot_balance 快照並驗證與 movement 一致
Write-Host ""
Write-Host "--- lot_balance rebuild ---"
$rb = Invoke-ErpApi @{
  action = "dev_rebuild_lot_balance"
  session_token = $tok
  created_by = $actor
}
Assert-Ok $rb "dev_rebuild_lot_balance"
$rebuilt = [int]$rb.rebuilt
if ($rebuilt -lt 1) { Write-Fail "dev_rebuild_lot_balance: expected rebuilt >= 1" }
Write-Ok "rebuilt lot_balance rows=$rebuilt"

$avail3 = Invoke-ErpApi @{
  action = "list_inventory_movement_available_by_lot"
  session_token = $tok
  _ts = [string][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}
Assert-Ok $avail3 "avail after rebuild"
if ($avail3.balance_source -ne "lot_balance") {
  Write-Fail ("expected balance_source=lot_balance, got: " + $avail3.balance_source)
}
Write-Ok "balance_source=lot_balance"

Write-Host ""
Write-Host "All inventory smoke checks passed." -ForegroundColor Green
