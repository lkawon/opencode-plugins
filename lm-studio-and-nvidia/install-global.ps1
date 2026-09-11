param([string]$Destination)

$ErrorActionPreference = "Stop"

$source = Join-Path $PSScriptRoot ".opencode"
$profileRoot = [Environment]::GetFolderPath("UserProfile")
if (-not $Destination) {
  $Destination = Join-Path $profileRoot ".config\opencode"
}
$destination = $Destination
$pluginDirectory = Join-Path $destination "plugins\lm-studio-and-nvidia"

New-Item -ItemType Directory -Force -Path $pluginDirectory | Out-Null
Copy-Item -LiteralPath (Join-Path $source "plugins\lm-studio-and-nvidia.ts") -Destination (Join-Path $destination "plugins\lm-studio-and-nvidia.ts") -Force
Copy-Item -LiteralPath (Join-Path $source "plugins\lm-studio-and-nvidia\tui.tsx") -Destination (Join-Path $pluginDirectory "tui.tsx") -Force

$legacyServer = Join-Path $destination "gpu_lmstudio_server.py"
if (Test-Path -LiteralPath $legacyServer) {
  Remove-Item -LiteralPath $legacyServer -Force
}

$sourcePackage = Get-Content -LiteralPath (Join-Path $source "package.json") -Raw | ConvertFrom-Json
$packagePath = Join-Path $destination "package.json"
$package = if (Test-Path -LiteralPath $packagePath) {
  Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
} else {
  [pscustomobject]@{ type = "module"; dependencies = [pscustomobject]@{} }
}
if (-not $package.PSObject.Properties["dependencies"]) {
  $package | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{})
}
foreach ($dependency in $sourcePackage.dependencies.PSObject.Properties) {
  $package.dependencies | Add-Member -NotePropertyName $dependency.Name -NotePropertyValue $dependency.Value -Force
}
$package | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $packagePath -Encoding utf8

$legacyDirectory = Join-Path $destination "plugins\gpu-lmstudio"
if (Test-Path -LiteralPath $legacyDirectory) {
  Remove-Item -LiteralPath $legacyDirectory -Recurse -Force
}
$legacyFile = Join-Path $destination "plugins\gpu-lmstudio.ts"
if (Test-Path -LiteralPath $legacyFile) {
  Remove-Item -LiteralPath $legacyFile -Force
}

$tuiPath = Join-Path $destination "tui.json"
$config = if (Test-Path -LiteralPath $tuiPath) {
  Get-Content -LiteralPath $tuiPath -Raw | ConvertFrom-Json
} else {
  [pscustomobject]@{ '$schema' = "https://opencode.ai/tui.json"; plugin = @() }
}
if (-not $config.PSObject.Properties["plugin"]) {
  $config | Add-Member -NotePropertyName plugin -NotePropertyValue @()
}
$entry = "./plugins/lm-studio-and-nvidia/tui.tsx"
$config.plugin = @($config.plugin | Where-Object { $_ -notin @($entry, "./plugins/gpu-lmstudio/tui.tsx") }) + $entry
$config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $tuiPath -Encoding utf8

Write-Host "LM Studio and NVIDIA plugin installed in:"
Write-Host $destination
Write-Host "Set GPU_STATS_TOKEN if needed, then restart OpenCode."
