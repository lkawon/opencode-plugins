param(
  [string]$RepoPath,
  [switch]$Remove
)

$ErrorActionPreference = "Stop"
$TaskName = "OpenCode-LMStudio-Boot"

if (-not $RepoPath) { $RepoPath = $PSScriptRoot }

if ($Remove) {
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task: $TaskName"
  } else {
    Write-Host "Scheduled task not found (nothing to remove): $TaskName"
  }
  exit 0
}

$repoRoot = (Resolve-Path -LiteralPath $RepoPath).Path
$bootScript = Join-Path $repoRoot "start-lmstudio-model.ps1"
if (-not (Test-Path -LiteralPath $bootScript)) {
  throw "Boot script not found: $bootScript"
}

$user = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$bootScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 120)

# Re-run safe: replace any existing task.
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Replaced existing scheduled task: $TaskName"
}

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings | Out-Null

Write-Host "Scheduled task installed: $TaskName"
Write-Host "Boot script: $bootScript"
Write-Host "At logon it restarts the LM Studio server (0.0.0.0:1234), loads the model, and starts telemetry."
