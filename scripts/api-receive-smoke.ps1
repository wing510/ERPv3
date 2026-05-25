# DEV API：採購收貨過帳 + 作廢（不需瀏覽器）
param(
  [string]$ApiBase = "https://script.google.com/macros/s/AKfycbytLafLy8PRVmGx3IVRCQ7j1WKj2Go4eRSevTCECDYR4IgukvLkDMQS5rZ61ex9HUTa/exec",
  [string]$ConfigPath = "$PSScriptRoot\..\docs\erp-smoke-config.json"
)

$ErrorActionPreference = "Stop"
function Write-Ok($m){ Write-Host "[OK]  $m" -ForegroundColor Green }
function Write-Fail($m){ Write-Host "[FAIL] $m" -ForegroundColor Red }

function Invoke-ErpApi {
  param([hashtable]$Form)
  $r = Invoke-RestMethod -Method Post -Uri $ApiBase -Body $Form -ContentType "application/x-www-form-urlencoded"
  if ($r -is [string]) { $r = $r | ConvertFrom-Json }
  return $r
}

$cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$userId = [string]$cfg.login.userId
$password = [string]$cfg.login.password

Write-Host "API: $ApiBase"
Write-Host "Login: $userId"
Write-Host ""

$login = Invoke-ErpApi @{
  action = "login"
  user_id = $userId
  password = $password
}
if (-not $login.success) {
  Write-Fail ("login: " + ($login.errors -join "; "))
  exit 1
}
$tok = [string]$login.session_token
$actor = [string]$login.user_id
Write-Ok "login env=$($login.env)"

$tag = "SMOKE-API-" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$seed = Invoke-ErpApi @{
  action = "dev_seed_smoke_fixtures"
  session_token = $tok
  created_by = $actor
  tag = $tag
}
if (-not $seed.success) {
  Write-Fail ("seed: " + ($seed.errors -join "; "))
  exit 1
}
$fx = $seed.fixtures
if (-not $fx) { $fx = $seed.data.fixtures }
$poId = [string]$fx.poId
$poItemId = [string]$fx.poItemId
$wh = [string]$fx.warehouseId
if (-not $wh) { $wh = "MAIN" }
Write-Ok "seed tag=$tag po=$poId item=$poItemId wh=$wh"

$grId = "GR-" + (Get-Date -Format "yyMMdd-HHmm") + "-API"
$linesJson = '[{"po_item_id":"' + $poItemId + '","received_qty":"1","unit":"EA","manufacture_date":"","expiry_date":""}]'
$expectedJson = '{"' + $poItemId + '":0}'

$post = Invoke-ErpApi @{
  action = "post_goods_receipt_bundle"
  session_token = $tok
  created_by = $actor
  gr_id = $grId
  po_id = $poId
  receipt_date = (Get-Date -Format "yyyy-MM-dd")
  warehouse = $wh
  remark = "[SMOKE API] $tag"
  lines_json = $linesJson
  expected_received_by_po_item_json = $expectedJson
  expected_existed_goods_receipt_item_count = "0"
  idempotency_key = "API-GR-$tag"
}
if (-not $post.success) {
  Write-Fail ("post_goods_receipt_bundle: " + ($post.errors -join "; "))
  exit 1
}
$created = $post.created_lots
if ($null -eq $created) { $created = $post.message }
Write-Ok "post GR=$grId created_lots=$created"

$cancel = Invoke-ErpApi @{
  action = "cancel_goods_receipt_bundle"
  session_token = $tok
  updated_by = $actor
  gr_id = $grId
  void_reason_code = "TEST"
  void_reason_label = "test"
  void_reason_note = "api smoke"
  idempotency_key = "API-CANCEL-GR-$tag"
}
if (-not $cancel.success) {
  Write-Fail ("cancel_goods_receipt_bundle: " + ($cancel.errors -join "; "))
  exit 1
}
Write-Ok "cancel GR=$grId -> $($cancel.message)"

$cleanup = Invoke-ErpApi @{
  action = "dev_cleanup_smoke_fixtures"
  session_token = $tok
  updated_by = $actor
  tag = $tag
}
if ($cleanup.success) {
  Write-Ok "cleanup tag=$tag"
} else {
  Write-Host "[WARN] cleanup: $($cleanup.errors -join '; ')" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "GR receive API smoke: POST + CANCEL OK." -ForegroundColor Green
