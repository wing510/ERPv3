# DEV API: process order issue + retract smoke
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
  if (-not $r.success) { Write-Fail ("$label : " + ($r.errors -join "; ")) }
}

$cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$login = Invoke-ErpApi @{ action = "login"; user_id = [string]$cfg.login.userId; password = [string]$cfg.login.password }
Assert-Ok $login "login"
$tok = [string]$login.session_token
$actor = [string]$login.user_id
Write-Ok "login env=$($login.env)"

$tag = "SMOKE-PROC-" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$seed = Invoke-ErpApi @{ action = "dev_seed_smoke_fixtures"; session_token = $tok; created_by = $actor; tag = $tag }
Assert-Ok $seed "seed"
$fx = $seed.fixtures
if (-not $fx) { $fx = $seed.data.fixtures }
$lotId = [string]$fx.lotId
$productId = [string]$fx.productId
$supplierId = [string]$fx.supplierId
Write-Ok "seed lot=$lotId supplier=$supplierId"

$procId = "PROC-API-" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$create = Invoke-ErpApi @{
  action = "create_process_order_cmd"
  session_token = $tok
  created_by = $actor
  process_order_id = $procId
  process_type = "PROCESS"
  supplier_id = $supplierId
  remark = "[SMOKE] $tag"
}
Assert-Ok $create "create_process_order_cmd"
Write-Ok "process_order $procId"

$qa = Invoke-ErpApi @{
  action = "update_lot"
  session_token = $tok
  updated_by = $actor
  lot_id = $lotId
  status = "APPROVED"
}
Assert-Ok $qa "update_lot APPROVED"

$inputsJson = '[{"lot_id":"' + $lotId + '","product_id":"' + $productId + '","issue_qty":"1","unit":"EA"}]'
$issue = Invoke-ErpApi @{
  action = "issue_process_order_bundle"
  session_token = $tok
  created_by = $actor
  process_order_id = $procId
  inputs_json = $inputsJson
  expected_existed_inputs_count = "0"
  idempotency_key = "API-PROC-ISSUE-$tag"
}
Assert-Ok $issue "issue_process_order_bundle"
Write-Ok "issue OK"

$retract = Invoke-ErpApi @{
  action = "retract_process_issue_bundle"
  session_token = $tok
  updated_by = $actor
  process_order_id = $procId
  idempotency_key = "API-PROC-RETRACT-$tag"
}
Assert-Ok $retract "retract_process_issue_bundle"
Write-Ok "retract -> $($retract.message)"

$cleanup = Invoke-ErpApi @{ action = "dev_cleanup_smoke_fixtures"; session_token = $tok; updated_by = $actor; tag = $tag }
if ($cleanup.success) { Write-Ok "cleanup" } else { Write-Host "[WARN] cleanup" -ForegroundColor Yellow }

Write-Host ""
Write-Host "Process API smoke: issue + retract OK." -ForegroundColor Green
