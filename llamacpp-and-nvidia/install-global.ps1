param([string]$Destination)

$ErrorActionPreference = "Stop"

$source = Join-Path $PSScriptRoot ".opencode"
$profileRoot = [Environment]::GetFolderPath("UserProfile")
if (-not $Destination) {
  $Destination = Join-Path $profileRoot ".config\opencode"
}
$destination = $Destination
$pluginDirectory = Join-Path $destination "plugins\llamacpp-and-nvidia"

New-Item -ItemType Directory -Force -Path $pluginDirectory | Out-Null
Copy-Item -LiteralPath (Join-Path $source "plugins\llamacpp-and-nvidia.ts") -Destination (Join-Path $destination "plugins\llamacpp-and-nvidia.ts") -Force
Copy-Item -LiteralPath (Join-Path $source "plugins\llamacpp-and-nvidia\tui.tsx") -Destination (Join-Path $pluginDirectory "tui.tsx") -Force
New-Item -ItemType Directory -Force -Path (Join-Path $destination "lib") | Out-Null
Copy-Item -LiteralPath (Join-Path $source "lib\llamacpp-client.ts") -Destination (Join-Path $destination "lib\llamacpp-client.ts") -Force

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

$legacyDirectory = Join-Path $destination "plugins\lm-studio-and-nvidia"
if (Test-Path -LiteralPath $legacyDirectory) {
  Remove-Item -LiteralPath $legacyDirectory -Recurse -Force
}
$legacyFile = Join-Path $destination "plugins\lm-studio-and-nvidia.ts"
if (Test-Path -LiteralPath $legacyFile) {
  Remove-Item -LiteralPath $legacyFile -Force
}
$legacyDirectory2 = Join-Path $destination "plugins\gpu-lmstudio"
if (Test-Path -LiteralPath $legacyDirectory2) {
  Remove-Item -LiteralPath $legacyDirectory2 -Recurse -Force
}
$legacyFile2 = Join-Path $destination "plugins\gpu-lmstudio.ts"
if (Test-Path -LiteralPath $legacyFile2) {
  Remove-Item -LiteralPath $legacyFile2 -Force
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
$entry = "./plugins/llamacpp-and-nvidia/tui.tsx"
$toRemove = @($entry, "./plugins/lm-studio-and-nvidia/tui.tsx", "./plugins/gpu-lmstudio/tui.tsx")
$config.plugin = @($config.plugin | Where-Object { $_ -notin $toRemove }) + $entry
$config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $tuiPath -Encoding utf8

Write-Host "llama.cpp and NVIDIA plugin installed in:"
Write-Host $destination
Write-Host "Set GPU_STATS_TOKEN if needed, then restart OpenCode."
