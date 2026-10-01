# Boot script for the Windows GPU machine. Three modes:
#
#   --mode telemetry  (default) Start telemetry only; observe the already-running llama-server.
#   --mode server          Start/restart llama-server standalone.
#   --mode all             Start llama-server, then telemetry (hands-off logon boot).
#
# The telemetry server attaches to llama-server's first-class HTTP endpoints
# (/health, /v1/models, /slots, /metrics) -- it never spawns the `lms` CLI or
# scrapes logs.
#
# Environment overrides:
#   LLAMA_GGUF, LLAMA_ALIAS, LLAMA_CTX, LLAMA_NGL, LLAMA_NP,
#   LLAMA_HOST, LLAMA_PORT, LLAMA_EXTRA_ARGS,
#   GPU_STATS_HOST, GPU_STATS_PORT, GPU_STATS_TOKEN, GPU_STATS_URL

param(
  [ValidateSet("server", "all", "telemetry")]
  [string]$Mode = "telemetry"
)

$ErrorActionPreference = "Stop"

$RepoRoot = $PSScriptRoot
$LogDirectory = Join-Path $RepoRoot "logs"
$LogPath = Join-Path $LogDirectory "boot-llamacpp.log"

function Write-Log {
  param([string]$Message)
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Get-Env {
  param([string]$Name, [string]$Default)
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ($value) { return $value }
  return $Default
}

# --- Defaults match a typical llama.cpp server launch. ---
$LlamaGguf    = Get-Env "LLAMA_GGUF" "e:\LM Studio models\lmstudio-community\Qwen3.8-27B-GGUF\Qwen3.8-27B-Q4_K_M.gguf"
$LlamaAlias   = Get-Env "LLAMA_ALIAS" "qwen3.8-27b"
$LlamaCtx     = Get-Env "LLAMA_CTX" "152576"
$LlamaNgl     = Get-Env "LLAMA_NGL" "64"
$LlamaNp      = Get-Env "LLAMA_NP" "1"
$LlamaHost    = Get-Env "LLAMA_HOST" "127.0.0.1"
$LlamaPort    = Get-Env "LLAMA_PORT" "8080"
$LlamaExtra   = Get-Env "LLAMA_EXTRA_ARGS" "--no-reasoning-preserve --flash-attn on --spec-type draft-mtp --spec-draft-n-max 4 --cache-type-k q8_0 --cache-type-v q8_0 --threads 8 --threads-batch 8"
$LlamaUrl     = "http://127.0.0.1:$LlamaPort"

$StatsUrl = (Get-Env "GPU_STATS_URL" "http://127.0.0.1:8765").TrimEnd("/")
$StatsPort = (Get-Env "GPU_STATS_PORT" "8765")

function Get-LlamaServerExe {
  $command = Get-Command llama-server -ErrorAction SilentlyContinue
  if (-not $command) {
    $candidate = Join-Path $env:ProgramFiles "llama-cuda\llama-server.exe"
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  if (-not $command) {
    throw "llama-server was not found in PATH (or %ProgramFiles%\llama-cuda). Set LLAMA_GGUF/PATH or install llama.cpp."
  }
  return $command.Source
}

function Test-ServerReady {
  param([string]$BaseUrl)
  try {
    $response = Invoke-WebRequest -Uri "$BaseUrl/health" -UseBasicParsing -TimeoutSec 3
    return ($response.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Get-StatsToken {
  if ($env:GPU_STATS_TOKEN) { return $env:GPU_STATS_TOKEN }
  $tokenPath = Join-Path $env:USERPROFILE ".config\opencode\llamacpp-stats.token"
  if (Test-Path -LiteralPath $tokenPath) { return (Get-Content -LiteralPath $tokenPath -Raw).Trim() }
  return ""
}

function Test-TelemetryReady {
  $token = Get-StatsToken
  $headers = @{}
  if ($token) { $headers["Authorization"] = "Bearer $token" }
  try {
    $response = Invoke-WebRequest -Uri "$StatsUrl/health" -Headers $headers -UseBasicParsing -TimeoutSec 3
    return ($response.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Start-LlamaServer {
  $exe = Get-LlamaServerExe
  if (-not (Test-Path -LiteralPath $LlamaGguf -PathType Leaf)) {
    throw "Model file not found: $LlamaGguf (set LLAMA_GGUF to an existing GGUF file)"
  }
  Write-Log "Starting llama-server: gguf=$LlamaGguf alias=$LlamaAlias ctx=$LlamaCtx ngl=$LlamaNgl"
  $argsList = @(
    "-m", ('"{0}"' -f $LlamaGguf),
    "--alias", ('"{0}"' -f $LlamaAlias),
    "-c", $LlamaCtx,
    "-np", $LlamaNp,
    "-ngl", $LlamaNgl,
    "--metrics",
    "--slots",
    "--host", $LlamaHost,
    "--port", $LlamaPort
  )
  if ($LlamaExtra) { $argsList += $LlamaExtra.Split(" ", [System.StringSplitOptions]::RemoveEmptyEntries) }
  $stdout = Join-Path $LogDirectory "llama-server.stdout.log"
  $stderr = Join-Path $LogDirectory "llama-server.stderr.log"
  Write-Log "llama-server output: $stdout ; errors: $stderr"
  $process = Start-Process -FilePath $exe -ArgumentList $argsList -WorkingDirectory (Split-Path -Parent $exe) -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  Write-Log "llama-server launched (pid $($process.Id))."
  return $process
}

function Wait-ServerReady {
  param([System.Diagnostics.Process]$Process)
  $deadline = (Get-Date).AddSeconds(180)
  while ((Get-Date) -lt $deadline) {
    $Process.Refresh()
    if ($Process.HasExited) {
      throw "llama-server exited with code $($Process.ExitCode). See logs\llama-server.stderr.log and logs\llama-server.stdout.log."
    }
    if (Test-ServerReady -BaseUrl $LlamaUrl) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Start-Telemetry {
  $launcher = Join-Path $RepoRoot "start-llamacpp-server.cmd"
  if (-not (Test-Path -LiteralPath $launcher)) {
    throw "Telemetry launcher not found: $launcher"
  }
  & cmd.exe /c "`"$launcher`""
  Write-Log "Telemetry server start requested (port $StatsPort)."
}

trap {
  Write-Log "ERROR: $($_.Exception.Message)"
  exit 1
}

Write-Log "llama.cpp boot: mode=$Mode"

if ($Mode -in @("server", "all")) {
  if (Test-ServerReady -BaseUrl $LlamaUrl) {
    Write-Log "llama-server already ready on $LlamaUrl (skipping start)."
  } else {
    $serverProcess = Start-LlamaServer
    if (-not (Wait-ServerReady -Process $serverProcess)) {
      throw "llama-server did not become ready on $LlamaUrl within 180s"
    }
    Write-Log "llama-server is ready on $LlamaUrl."
  }
}

if ($Mode -in @("all", "telemetry")) {
  if (Test-TelemetryReady) {
    Write-Log "Telemetry already healthy (skipping start)."
  } else {
    Start-Telemetry
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
  }
}

Write-Log "Boot complete."
