param(
  [Parameter(Mandatory=$true)]
  [string]$SiteUrl,

  [Parameter(Mandatory=$true)]
  [string]$ApiBase,

  [string]$ExpectedVersion = "3.3",

  # 選填：要做「已登入 API」檢查才需要
  [string]$ActorId = "",
  [string]$SessionToken = ""
)

$ErrorActionPreference = "Stop"

function Write-Ok([string]$msg){ Write-Host "[OK]  $msg" -ForegroundColor Green }
function Write-Warn([string]$msg){ Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Fail([string]$msg){ Write-Host "[FAIL] $msg" -ForegroundColor Red }

function Assert-Contains([string]$text, [string]$needle, [string]$label){
  if($text -notmatch [regex]::Escape($needle)){
    throw "缺少預期文字：$label（$needle）"
  }
}

function Normalize-Url([string]$u){
  $s = ($u ?? "").Trim()
  if(!$s){ return "" }
  if($s.EndsWith("/")){ return $s.TrimEnd("/") }
  return $s
}

$SiteUrl = Normalize-Url $SiteUrl
$ApiBase = Normalize-Url $ApiBase

Write-Host "ERP Smoke Test"
Write-Host "  SiteUrl: $SiteUrl"
Write-Host "  ApiBase: $ApiBase"
Write-Host "  ExpectedVersion: $ExpectedVersion"
if($ActorId -and $SessionToken){
  Write-Host "  ActorId: $ActorId (已提供 session token，會做 API 檢查)"
}else{
  Write-Host "  ActorId/SessionToken: (未提供，略過需要登入的 API 檢查)"
}
Write-Host ""

$failed = $false

try{
  # 1) 前端：抓 index.html 檢查版本字樣與 cache-busting
  $indexUrl = "$SiteUrl/index.html"
  $res = Invoke-WebRequest -UseBasicParsing -Uri $indexUrl -Headers @{ "Cache-Control"="no-cache"; "Pragma"="no-cache" }
  $html = [string]$res.Content

  Assert-Contains $html ("ERP v" + $ExpectedVersion) "頁面版本（vX.X）"
  Assert-Contains $html ("Version " + $ExpectedVersion) "右上角版本（Version X.X）"
  Write-Ok "index.html 版本字樣符合（v$ExpectedVersion / Version $ExpectedVersion）"

  # 檢查關鍵腳本是否有 ?v=（避免 GitHub Pages 快取）
  $mustHaveVersionParam = @(
    "js/core/config.js",
    "js/core/service.js",
    "js/core/login.js",
    "js/core/utils.js",
    "js/router.js"
  )

  foreach($p in $mustHaveVersionParam){
    $re = [regex]::Escape($p) + "\?v=[^\"']+"
    if($html -notmatch $re){
      Write-Warn "關鍵腳本可能未加版本參數：$p"
    }else{
      Write-Ok "版本參數 OK：$p"
    }
  }
}catch{
  $failed = $true
  Write-Fail ("前端檢查失敗：" + $_.Exception.Message)
}

try{
  # 2) 後端：連線檢查（不需要登入）
  $apiProbe = "$ApiBase?action=__probe__"
  $r = Invoke-RestMethod -Method GET -Uri $apiProbe -Headers @{ "Cache-Control"="no-cache"; "Pragma"="no-cache" }

  # 後端慣例：未知 action 會回 success=false + errors=[Unknown or missing action]
  $raw = ($r | ConvertTo-Json -Compress)
  if($raw -notmatch "Unknown or missing action"){
    Write-Warn "後端有回應，但訊息不像是預期的 Unknown action（可能你已新增 probe action 或回應格式不同）"
  }
  Write-Ok "後端 /exec 可連線（有回應）"
}catch{
  $failed = $true
  Write-Fail ("後端連線失敗：" + $_.Exception.Message)
}

if($ActorId -and $SessionToken){
  try{
    # 3) 已登入 API：挑幾個 list_* 做冒煙測試
    $checks = @(
      "list_product",
      "list_warehouse",
      "list_lot",
      "list_inventory_movement_recent"
    )

    foreach($a in $checks){
      $u = "$ApiBase?action=$a&created_by=$([uri]::EscapeDataString($ActorId))&session_token=$([uri]::EscapeDataString($SessionToken))"
      try{
        $x = Invoke-RestMethod -Method GET -Uri $u
        $j = ($x | ConvertTo-Json -Compress)
        if($j -match "Permission denied"){
          Write-Warn "API $a：權限不足（帳號可能沒開該功能）"
        }elseif($j -match "\"success\":false"){
          Write-Warn "API $a：回傳失敗（請人工確認）"
        }else{
          Write-Ok "API $a：回應正常"
        }
      }catch{
        Write-Warn ("API $a：呼叫失敗（" + $_.Exception.Message + "）")
      }
    }
  }catch{
    $failed = $true
    Write-Fail ("已登入 API 檢查整體失敗：" + $_.Exception.Message)
  }
}

Write-Host ""
if($failed){
  Write-Fail "Smoke test 完成：有失敗項目（請依輸出逐項排查）"
  exit 1
}else{
  Write-Ok "Smoke test 完成：未發現致命問題"
  exit 0
}

