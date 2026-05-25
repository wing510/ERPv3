param(
  [string]$ApiBase = "https://script.google.com/macros/s/AKfycbytLafLy8PRVmGx3IVRCQ7j1WKj2Go4eRSevTCECDYR4IgukvLkDMQS5rZ61ex9HUTa/exec",
  [string]$ConfigPath = "$PSScriptRoot\..\docs\erp-smoke-config.json"
)
$cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$login = Invoke-RestMethod -Method Post -Uri $ApiBase -Body @{
  action = "login"
  user_id = $cfg.login.userId
  password = $cfg.login.password
}
if (-not $login.success) { Write-Host "login fail"; exit 1 }
$tok = $login.session_token
$r = Invoke-RestMethod -Method Post -Uri $ApiBase -Body @{
  action = "list_logs_recent"
  session_token = $tok
  days = "30"
  limit = "500"
}
Write-Host "success=$($r.success) total=$(@($r.data).Count)"
$bundle = @($r.data | Where-Object { $_.action_type -like "BUNDLE_*" })
Write-Host "BUNDLE_* count=$($bundle.Count)"
$ship = @($bundle | Where-Object { $_.table_name -eq "shipment" })
Write-Host "shipment BUNDLE count=$($ship.Count)"
if ($ship.Count -gt 0) { $ship[0] | Format-List }
