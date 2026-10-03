# Boot script for the Windows GPU machine.
#
# Parameters:
#   -mode start|stop|restart        What to do (default: start).
#   -service llama|telemetry|all    Which service to act on (default: all).
#                                   "llama" = llama-server, "telemetry" = GPU stats server.
#
# Examples:
#   .\start-llamacpp.ps1                                    Start llama-server + telemetry
#   .\start-llamacpp.ps1 -mode stop -service llama           Stop llama-server only
#   .\start-llamacpp.ps1 -mode restart -service telemetry    Restart telemetry only
#
# The telemetry server attaches to llama-server's first-class HTTP endpoints
# (/health, /v1/models, /slots, /metrics) -- it never spawns the `lms` CLI or
# scrapes logs.
#
# Environment overrides:
#   LLAMA_GGUF, LLAMA_MMPROJ, LLAMA_ALIAS, LLAMA_CTX, LLAMA_NGL, LLAMA_NP,
#   LLAMA_VERBOSITY, LLAMA_HOST, LLAMA_PORT, LLAMA_EXTRA_ARGS,
#   GPU_STATS_HOST, GPU_STATS_PORT, GPU_STATS_TOKEN, GPU_STATS_URL, GPU_STATS_DEBUG

param(
  [ValidateSet("start", "stop", "restart")]
  [string]$Mode = "start",
  [ValidateSet("llama", "telemetry", "all")]
  [string]$Service = "all"
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
  if ($null -ne $value) { return $value }
  return $Default
}

# --- Defaults match a typical llama.cpp server launch. ---
$LlamaGguf    = Get-Env "LLAMA_GGUF" "e:\LM Studio models\lmstudio-community\Qwen3.8-27B-GGUF\Qwen3.8-27B-Q4_K_M.gguf"
$LlamaMmproj  = Get-Env "LLAMA_MMPROJ" "e:\LM Studio models\lmstudio-community\Qwen3.8-27B-GGUF\mmproj-Qwen3.8-27B-BF16.gguf"
$LlamaAlias   = Get-Env "LLAMA_ALIAS" "qwen3.8-27b"
$LlamaCtx     = Get-Env "LLAMA_CTX" "124928"
$LlamaNgl     = Get-Env "LLAMA_NGL" "64"
$LlamaNp      = Get-Env "LLAMA_NP" "1"
$LlamaVerbosity = Get-Env "LLAMA_VERBOSITY" "3"
$LlamaHost    = Get-Env "LLAMA_HOST" "0.0.0.0"
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

function Stop-ByPort {
  param([int]$Port, [string]$Label)
  $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $conns) {
    Write-Log "$Label is not listening on port $Port (nothing to stop)."
    return $true
  }
  $pids = @($conns | Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($procId in $pids) {
    try {
      Stop-Process -Id $procId -Force -ErrorAction Stop
      Write-Log "Stopped $Label (pid $procId, port $Port)."
    } catch {
      Write-Log "Failed to stop $Label (pid $procId): $($_.Exception.Message)"
      return $false
    }
  }
  # Give the OS a moment to release the port before we try to start again.
  Start-Sleep -Milliseconds 500
  return $true
}

function Start-LlamaServer {
  $exe = Get-LlamaServerExe
  if (-not (Test-Path -LiteralPath $LlamaGguf -PathType Leaf)) {
    throw "Model file not found: $LlamaGguf (set LLAMA_GGUF to an existing GGUF file)"
  }
  if ($LlamaMmproj -and -not (Test-Path -LiteralPath $LlamaMmproj -PathType Leaf)) {
    throw "MMProj file not found: $LlamaMmproj (set LLAMA_MMPROJ to an existing GGUF file, or set it to an empty string to disable mmproj)"
  }
  Write-Log "Starting llama-server: gguf=$LlamaGguf mmproj=$LlamaMmproj alias=$LlamaAlias ctx=$LlamaCtx ngl=$LlamaNgl verbosity=$LlamaVerbosity"
  $argsList = @(
    "-m", ('"{0}"' -f $LlamaGguf),
    "--alias", ('"{0}"' -f $LlamaAlias),
    "-c", $LlamaCtx,
    "-np", $LlamaNp,
    "-ngl", $LlamaNgl,
    "--metrics",
    "--slots",
    "--verbosity", $LlamaVerbosity,
    "--host", $LlamaHost,
    "--port", $LlamaPort
  )
  if ($LlamaMmproj) { $argsList += @("--mmproj", ('"{0}"' -f $LlamaMmproj)) }
  if ($LlamaExtra) { $argsList += $LlamaExtra.Split(" ", [System.StringSplitOptions]::RemoveEmptyEntries) }
  Write-Log "llama-server args: $($argsList -join ' ')"
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
  $python = Get-Command python.exe -ErrorAction SilentlyContinue
  if (-not $python) {
    throw "Python was not found in PATH. Install Python to run the telemetry server."
  }
  $serverScript = Join-Path $RepoRoot "llamacpp-and-nvidia\gpu_llamacpp_server.py"
  if (-not (Test-Path -LiteralPath $serverScript)) {
    throw "Telemetry server script not found: $serverScript"
  }
  if (-not $env:LLAMA_LOG_FILE) {
    $env:LLAMA_LOG_FILE = Join-Path $LogDirectory "llama-server.stderr.log"
  }
  $stdout = Join-Path $LogDirectory "gpu-llamacpp-server.stdout.log"
  $stderr = Join-Path $LogDirectory "gpu-llamacpp-server.stderr.log"
  Write-Log "Starting telemetry: $($python.Source) $serverScript (port $StatsPort)"
  $process = Start-Process -FilePath $python.Source -ArgumentList "`"$serverScript`"" -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  Write-Log "Telemetry launched (pid $($process.Id)). Logs: $stdout ; $stderr"
}

trap {
  Write-Log "ERROR: $($_.Exception.Message)"
  exit 1
}

$doLlama = $Service -in @("all", "llama")
$doTelemetry = $Service -in @("all", "telemetry")

Write-Log "llama.cpp: mode=$Mode service=$Service"

if ($Mode -in @("stop", "restart")) {
  $stopped = $true
  if ($doLlama) { $stopped = (Stop-ByPort -Port $LlamaPort -Label "llama-server") -and $stopped }
  if ($doTelemetry) { $stopped = (Stop-ByPort -Port $StatsPort -Label "telemetry") -and $stopped }
  if (-not $stopped) {
    Write-Log "Stop finished with errors (see above)."
    exit 1
  }
  if ($Mode -eq "stop") {
    Write-Log "Stop complete."
    exit 0
  }
  Write-Log "Stopped. Restarting..."
}

if ($doLlama) {
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

if ($doTelemetry) {
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

Write-Log "Done."
