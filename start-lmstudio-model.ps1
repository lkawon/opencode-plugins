# Boot script for the Windows GPU machine.
#
# 1. Restarts the LM Studio server on LMSTUDIO_HOST:LMSTUDIO_PORT
#    (defaults: 0.0.0.0:1234), guaranteeing the LAN bind.
# 2. Loads LMSTUDIO_MODEL (default: qwen/qwen3.8-27b) if it is not loaded.
# 3. Starts the GPU/LM Studio telemetry server (single-instance, port 8765).
#
# Environment overrides:
#   LMSTUDIO_HOST, LMSTUDIO_PORT, LMSTUDIO_MODEL, GPU_STATS_TOKEN, GPU_STATS_URL

$ErrorActionPreference = "Stop"

$RepoRoot = $PSScriptRoot
$LogDirectory = Join-Path $RepoRoot "logs"
$LogPath = Join-Path $LogDirectory "boot-lmstudio.log"

$lmHost = if ($env:LMSTUDIO_HOST) { $env:LMSTUDIO_HOST } else { "0.0.0.0" }
$lmPort = if ($env:LMSTUDIO_PORT) { [int]$env:LMSTUDIO_PORT } else { 1234 }
$model = if ($env:LMSTUDIO_MODEL) { $env:LMSTUDIO_MODEL } else { "qwen/qwen3.8-27b" }

function Write-Log {
  param([string]$Message)
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Get-LmsCommand {
  $command = Get-Command lms -ErrorAction SilentlyContinue
  if (-not $command) {
    # Standard LM Studio install location; the scheduled task inherits PATH,
    # but this keeps manual runs working when PATH is not set up.
    $candidate = Join-Path $env:USERPROFILE ".lmstudio\bin\lms.exe"
    if (Test-Path -LiteralPath $candidate) {
      $command = $candidate
    }
  }
  if (-not $command) {
    throw "lms was not found in PATH (or %USERPROFILE%\.lmstudio\bin). Install LM Studio or add it to PATH."
  }
  return $command
}

function Invoke-Lms {
  param([Parameter(Position = 0)][string[]]$LmsArgs)
  # Windows PowerShell 5.1 turns redirected native stderr into error records.
  # Keep those records as command output instead of terminating the boot script.
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $merged = & $LmsCommand $LmsArgs 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  return @{ Code = $code; Output = ($merged -join "`n") }
}

function Test-LmStudioReady {
  param([string]$BaseUrl)
  try {
    $response = Invoke-WebRequest -Uri "$BaseUrl/api/v1/models" -UseBasicParsing -TimeoutSec 3
    return ($response.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Get-LoadedModelKeys {
  $result = Invoke-Lms -LmsArgs @("ps", "--json")
  if ($result.Code -ne 0) {
    throw "lms ps failed (exit $($result.Code)): $($result.Output)"
  }
  $trimmed = $result.Output.Trim()
  if (-not $trimmed) { return @() }
  try {
    $data = $trimmed | ConvertFrom-Json
  } catch {
    throw "Could not parse 'lms ps --json' output: $($_.Exception.Message). Raw output: $trimmed"
  }
  $keys = @()
  foreach ($item in @($data)) {
    foreach ($property in @("modelKey", "identifier", "indexedModelIdentifier", "path")) {
      if ($item.PSObject.Properties.Name -contains $property -and $item.$property) {
        $keys += $item.$property
      }
    }
    if ($item.PSObject.Properties.Name -contains "selectedVariant" -and $item.selectedVariant) {
      $keys += $item.selectedVariant.Split("@", 2)[0]
    }
  }
  return $keys
}

function Test-TelemetryReady {
  $url = if ($env:GPU_STATS_URL) { $env:GPU_STATS_URL } else { "http://127.0.0.1:8765" }
  $url = $url.TrimEnd("/")
  # The telemetry server always runs with a token (start-lmstudio-server.cmd
  # defaults it to "token123"), so always send the Authorization header.
  $token = if ($env:GPU_STATS_TOKEN) { $env:GPU_STATS_TOKEN } else { "token123" }
  $headers = @{ Authorization = "Bearer $token" }
  try {
    $response = Invoke-WebRequest -Uri "$url/health" -Headers $headers -UseBasicParsing -TimeoutSec 3
    return ($response.StatusCode -eq 200)
  } catch {
    return $false
  }
}

trap {
  Write-Log "ERROR: $($_.Exception.Message)"
  exit 1
}

$LmsCommand = Get-LmsCommand
Write-Log "LM Studio boot: host=$lmHost port=$lmPort model=$model"

# 1. Stop any running server so the restart below guarantees the host/port bind.
$stop = Invoke-Lms -LmsArgs @("server", "stop")
if ($stop.Code -eq 0) {
  Write-Log "LM Studio server stopped."
} else {
  Write-Log "LM Studio server was not running (stop exit code $($stop.Code))."
}

# Wait until the port stops answering, so the new bind is not shadowed.
$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline -and (Test-LmStudioReady -BaseUrl "http://127.0.0.1:$lmPort")) {
  Start-Sleep -Seconds 1
}

# 2. Start the server on the requested host/port.
$start = Invoke-Lms -LmsArgs @("server", "start", "--bind", $lmHost, "--port", "$lmPort")
if ($start.Code -ne 0) {
  throw "lms server start failed (exit $($start.Code)): $($start.Output)"
}
Write-Log "LM Studio server starting on ${lmHost}:$lmPort ..."

# 3. Wait for the HTTP API to answer.
$deadline = (Get-Date).AddSeconds(60)
$ready = $false
while ((Get-Date) -lt $deadline) {
  if (Test-LmStudioReady -BaseUrl "http://127.0.0.1:$lmPort") { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) {
  throw "LM Studio server did not become ready within 60s on 127.0.0.1:$lmPort"
}
Write-Log "LM Studio server is ready on ${lmHost}:$lmPort."

# 4. Load the model unless it is already loaded.
$loaded = @(Get-LoadedModelKeys)
if ($loaded -contains $model) {
  Write-Log "Model $model is already loaded."
} else {
  Write-Log "Loading model $model (this may take a few minutes) ..."
  $load = Invoke-Lms -LmsArgs @("load", $model, "--yes")
  if ($load.Code -ne 0) {
    throw "lms load failed (exit $($load.Code)): $($load.Output)"
  }
  $deadline = (Get-Date).AddSeconds(300)
  $loadedNow = $false
  while ((Get-Date) -lt $deadline) {
    $current = @(Get-LoadedModelKeys)
    if ($current -contains $model) { $loadedNow = $true; break }
    Start-Sleep -Seconds 5
  }
  if (-not $loadedNow) {
    throw "Model $model did not appear in 'lms ps' within 300s"
  }
  Write-Log "Model $model is loaded."
}

# 5. Start the telemetry server (single-instance lock; safe to re-run).
$telemetry = Join-Path $RepoRoot "start-lmstudio-server.cmd"
if (-not (Test-Path -LiteralPath $telemetry)) {
  throw "Telemetry launcher not found: $telemetry"
}
& cmd.exe /c "`"$telemetry`""
Write-Log "Telemetry server start requested (single-instance, port 8765)."

$deadline = (Get-Date).AddSeconds(15)
$telemetryReady = $false
while ((Get-Date) -lt $deadline) {
  if (Test-TelemetryReady) { $telemetryReady = $true; break }
  Start-Sleep -Seconds 1
}
if ($telemetryReady) {
  Write-Log "Telemetry server is healthy."
} else {
  Write-Log "Telemetry server did not answer within 15s (it may still be starting)."
}

Write-Log "Boot complete."
