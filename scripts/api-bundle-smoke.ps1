# DEV API: import receipt + shipment post/cancel smoke (no browser)
param(
  [string]$ApiBase = "https://script.google.com/macros/s/AKfycbytLafLy8PRVmGx3IVRCQ7j1WKj2Go4eRSevTCECDYR4IgukvLkDMQS5rZ61ex9HUTa/exec",
  [string]$ConfigPath = "$PSScriptRoot\..\docs\erp-smoke-config.json",
  [ValidateSet("All", "Import", "Shipment", "Process")]
  [string]$Test = "All"
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

# 舊版 seed 可能沒寫入 movement（generic 被封鎖）；補一筆 IN 供出貨/加工測試
function Ensure-SmokeLotMovement {
  param([string]$Tok, [string]$Actor, [string]$LotId, [string]$ProductId, [string]$Wh, [string]$Tag)
  $chk = Invoke-ErpApi @{
    action = "list_inventory_movement_by_lot"
    session_token = $Tok
    lot_id = $LotId
  }
  $rows = @($chk.data)
  if ($rows.Count -gt 0) {
    Write-Ok "seed lot already has movement"
    return
  }
  $mv = Invoke-ErpApi @{
    action = "create_inventory_movement"
    session_token = $Tok
    created_by = $Actor
    movement_id = "SMKMV-ENSURE-" + $Tag
    movement_type = "IN"
    lot_id = $LotId
    product_id = $ProductId
    warehouse_id = $Wh
    qty = "10"
    unit = "EA"
    ref_type = "SMOKE"
    ref_id = $Tag
    remark = "[SMOKE] ensure movement"
  }
  Assert-Ok $mv "ensure seed lot movement IN"
  Write-Ok "seed lot movement IN added"
}

$cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$userId = [string]$cfg.login.userId
$password = [string]$cfg.login.password
$today = Get-Date -Format "yyyy-MM-dd"
$now = Get-Date -Format "yyyy-MM-dd HH:mm"

Write-Host "API bundle smoke Test=$Test"
Write-Host "API: $ApiBase"
Write-Host ""

$login = Invoke-ErpApi @{ action = "login"; user_id = $userId; password = $password }
Assert-Ok $login "login"
$tok = [string]$login.session_token
$actor = [string]$login.user_id
Write-Ok "login env=$($login.env) actor=$actor"

$tag = "SMOKE-API-" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$seed = Invoke-ErpApi @{
  action = "dev_seed_smoke_fixtures"
  session_token = $tok
  created_by = $actor
  tag = $tag
}
Assert-Ok $seed "seed"
$fx = $seed.fixtures
if (-not $fx) { $fx = $seed.data.fixtures }
$wh = [string]$fx.warehouseId
if (-not $wh) { $wh = "MAIN" }
Write-Ok "seed tag=$tag wh=$wh"
Ensure-SmokeLotMovement -Tok $tok -Actor $actor -LotId ([string]$fx.lotId) -ProductId ([string]$fx.productId) -Wh $wh -Tag $tag
$rb = Invoke-ErpApi @{
  action = "dev_rebuild_lot_balance"
  session_token = $tok
  created_by = $actor
}
Assert-Ok $rb "dev_rebuild_lot_balance (sync snapshot)"
Write-Ok "lot_balance rebuilt=$($rb.rebuilt)"

if ($Test -eq "All" -or $Test -eq "Import") {
  Write-Host ""
  Write-Host "--- Import receipt ---"
  $docId = "IMPDOC-" + $tag.Substring($tag.Length - 8)
  $itemId = "IMPITEM-" + $tag.Substring($tag.Length - 8)
  $supplierId = [string]$fx.supplierId
  $productId = [string]$fx.productId

  $cd = Invoke-ErpApi @{
    action = "create_import_document"
    session_token = $tok
    created_by = $actor
    import_doc_id = $docId
    import_no = "SMK-$tag"
    import_date = $today
    supplier_id = $supplierId
    status = "OPEN"
    remark = "[SMOKE] $tag"
    created_at = $now
  }
  Assert-Ok $cd "create_import_document"
  Write-Ok "import_document $docId"

  $ci = Invoke-ErpApi @{
    action = "create_import_item"
    session_token = $tok
    created_by = $actor
    import_item_id = $itemId
    import_doc_id = $docId
    product_id = $productId
    declared_qty = "10"
    declared_unit = "EA"
    remark = "[SMOKE] $tag"
    created_at = $now
  }
  Assert-Ok $ci "create_import_item"
  Write-Ok "import_item $itemId"

  $irId = "IR-" + (Get-Date -Format "yyMMdd-HHmm") + "-API"
  $linesJson = '[{"import_item_id":"' + $itemId + '","received_qty":"1","unit":"EA"}]'
  $expectedJson = '{"' + $itemId + '":0}'

  $postIr = Invoke-ErpApi @{
    action = "post_import_receipt_bundle"
    session_token = $tok
    created_by = $actor
    import_receipt_id = $irId
    import_doc_id = $docId
    receipt_date = $today
    warehouse = $wh
    remark = "[SMOKE API] $tag"
    lines_json = $linesJson
    expected_received_by_import_item_json = $expectedJson
    expected_existed_import_receipt_item_count = "0"
    idempotency_key = "API-IR-$tag"
  }
  Assert-Ok $postIr "post_import_receipt_bundle"
  Write-Ok "post IR=$irId created_lots=$($postIr.created_lots)"

  $cancelIr = Invoke-ErpApi @{
    action = "cancel_import_receipt_bundle"
    session_token = $tok
    updated_by = $actor
    import_receipt_id = $irId
    void_reason_code = "TEST"
    void_reason_label = "test"
    void_reason_note = "api smoke"
    idempotency_key = "API-CANCEL-IR-$tag"
  }
  Assert-Ok $cancelIr "cancel_import_receipt_bundle"
  Write-Ok "cancel IR=$irId -> $($cancelIr.message)"
}

if ($Test -eq "All" -or $Test -eq "Process") {
  Write-Host ""
  Write-Host "--- Process (issue + retract) ---"
  $lotIdP = [string]$fx.lotId
  $productIdP = [string]$fx.productId
  $supplierIdP = [string]$fx.supplierId
  $procId = "PROC-" + (Get-Date -Format "yyMMdd-HHmm") + "-API"
  $createP = Invoke-ErpApi @{
    action = "create_process_order_cmd"
    session_token = $tok
    created_by = $actor
    process_order_id = $procId
    process_type = "PROCESS"
    supplier_id = $supplierIdP
    remark = "[SMOKE] $tag"
  }
  Assert-Ok $createP "create_process_order_cmd"
  $qaP = Invoke-ErpApi @{ action = "update_lot"; session_token = $tok; updated_by = $actor; lot_id = $lotIdP; status = "APPROVED" }
  Assert-Ok $qaP "update_lot APPROVED"
  $inJson = '[{"lot_id":"' + $lotIdP + '","product_id":"' + $productIdP + '","issue_qty":"1","unit":"EA"}]'
  $issueP = Invoke-ErpApi @{
    action = "issue_process_order_bundle"
    session_token = $tok
    created_by = $actor
    process_order_id = $procId
    inputs_json = $inJson
    expected_existed_inputs_count = "0"
    idempotency_key = "API-PROC-ISSUE-$tag"
  }
  Assert-Ok $issueP "issue_process_order_bundle"
  $retP = Invoke-ErpApi @{
    action = "retract_process_issue_bundle"
    session_token = $tok
    updated_by = $actor
    process_order_id = $procId
    idempotency_key = "API-PROC-RETRACT-$tag"
  }
  Assert-Ok $retP "retract_process_issue_bundle"
  Write-Ok "process $procId issue+retract"
}

if ($Test -eq "All" -or $Test -eq "Shipment") {
  Write-Host ""
  Write-Host "--- Shipment ---"
  $soId = [string]$fx.soId
  $soItemId = [string]$fx.soItemId
  $customerId = [string]$fx.customerId
  $lotId = [string]$fx.lotId
  $productId = [string]$fx.productId
  $shipId = "SHIP-" + (Get-Date -Format "yyMMdd-HHmm") + "-API"
  $itemsJson = '[{"so_id":"' + $soId + '","so_item_id":"' + $soItemId + '","lot_id":"' + $lotId + '","product_id":"' + $productId + '","ship_qty":"1","unit":"EA"}]'

  $postSh = Invoke-ErpApi @{
    action = "post_shipment_bundle"
    session_token = $tok
    created_by = $actor
    shipment_id = $shipId
    so_id = $soId
    customer_id = $customerId
    ship_date = $today
    shipper_id = $actor
    remark = "[SMOKE API] $tag"
    items_json = $itemsJson
    expected_existed_shipment_item_count = "0"
    idempotency_key = "API-SHIP-$tag"
  }
  Assert-Ok $postSh "post_shipment_bundle"
  Write-Ok "post SHIP=$shipId"

  $cancelSh = Invoke-ErpApi @{
    action = "cancel_shipment_bundle"
    session_token = $tok
    updated_by = $actor
    shipment_id = $shipId
    idempotency_key = "API-CANCEL-SHIP-$tag"
  }
  Assert-Ok $cancelSh "cancel_shipment_bundle"
  Write-Ok "cancel SHIP=$shipId -> $($cancelSh.message)"
}

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
Write-Host "Bundle smoke ($Test): all steps OK." -ForegroundColor Green
