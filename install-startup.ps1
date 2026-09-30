param(
  [string]$RepoPath,
  [switch]$Remove
)

$ErrorActionPreference = "Stop"
$TaskName = "OpenCode-LLamaCpp-Boot"
$LegacyTaskName = "OpenCode-LMStudio-Boot"

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
$bootScript = Join-Path $repoRoot "start-llamacpp.ps1"
if (-not (Test-Path -LiteralPath $bootScript)) {
  throw "Boot script not found: $bootScript"
}

$user = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$bootScript`" --mode all"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 120)

# Remove the legacy LM Studio boot task if present (migration cleanup).
$legacy = Get-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
if ($legacy) {
  Unregister-ScheduledTask -TaskName $LegacyTaskName -Confirm:$false
  Write-Host "Removed legacy scheduled task: $LegacyTaskName"
}

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
Write-Host "At logon it starts llama-server (--mode all), waits for /health, then starts telemetry."
